//! The Document view's headings, written into a PDF as its bookmarks when the
//! engine wrote none.
//!
//! WebKitGTK writes no outline at all (measured in #189), and WebView2 writes
//! none when `export_pdf` falls back to `PrintToPdf`. The frontend reads where
//! each heading landed from the pages paged.js laid out — the very pages the
//! printer is handed, one sheet each — and this adds the outline after
//! printing, as an incremental update (ISO 32000-1, 7.5.6), the way `pdf_meta`
//! adds the metadata: the engine's bytes stay exactly as they were.
//!
//! The shape is the one Chromium writes when it writes an outline itself:
//! every item open, nested by heading level, each pointing at its page and at
//! the height of its heading there. A PDF that already has an outline keeps
//! it: on Windows, the DevTools route has written Chromium's own.
//!
//! An export never fails over bookmarks. When the PDF cannot be read, or the
//! update cannot be written, the file stays as the engine wrote it and the
//! reason goes to the log.

use crate::export::PdfOutlineEntry;
use crate::locale::Locale;
use lopdf::{dictionary, Document, IncrementalDocument, Object, ObjectId};
use std::path::Path;

/// Add `outline` to the PDF at `path` as its bookmarks, in place and
/// atomically. No headings, an outline already there, a file that will not
/// parse, or a write that fails: the file is left as it was.
pub fn add_to_file(locale: Locale, path: &Path, outline: Option<&[PdfOutlineEntry]>) {
    let Some(outline) = outline.filter(|entries| !entries.is_empty()) else {
        return;
    };
    let pdf = match std::fs::read(path) {
        Ok(pdf) => pdf,
        Err(error) => {
            eprintln!("the PDF has no bookmarks: {error}");
            return;
        }
    };
    if let Some(updated) = updated(&pdf, outline) {
        if let Err(error) = crate::location::write_atomic_bytes(locale, path, &updated) {
            eprintln!("the PDF has no bookmarks: {error}");
        }
    }
}

/// `pdf` with `outline` added, or `None` when there is nothing to add, the
/// engine wrote an outline of its own, or the update cannot be made.
fn updated(pdf: &[u8], outline: &[PdfOutlineEntry]) -> Option<Vec<u8>> {
    match update(pdf, outline) {
        Ok(updated) => updated,
        Err(error) => {
            eprintln!("the PDF has no bookmarks: {error}");
            None
        }
    }
}

/// One bookmark: its text, the bookmark it sits under, and where it points.
struct Item<'a> {
    title: &'a str,
    parent: Option<usize>,
    page: ObjectId,
    /// The height of the heading on its page, in the page's own units; `None`
    /// for a page that gives no size, which is then shown whole.
    top: Option<f64>,
}

fn update(pdf: &[u8], outline: &[PdfOutlineEntry]) -> lopdf::Result<Option<Vec<u8>>> {
    let mut document: IncrementalDocument = pdf.try_into()?;
    let engine = document.get_prev_documents();
    let catalog = engine.trailer.get(b"Root")?.as_reference()?;
    if has_outline(engine, catalog) {
        return Ok(None);
    }
    let pages: Vec<ObjectId> = engine.get_pages().into_values().collect();
    let items = items(engine, &pages, outline);
    if items.is_empty() {
        return Ok(None);
    }

    let new = &mut document.new_document;
    let root = new.new_object_id();
    let ids: Vec<ObjectId> = items.iter().map(|_| new.new_object_id()).collect();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); items.len()];
    let mut top_level = Vec::new();
    for (index, item) in items.iter().enumerate() {
        match item.parent {
            Some(parent) => children[parent].push(index),
            None => top_level.push(index),
        }
    }
    let mut previous = vec![None; items.len()];
    let mut next = vec![None; items.len()];
    for siblings in children.iter().chain(std::iter::once(&top_level)) {
        for pair in siblings.windows(2) {
            next[pair[0]] = Some(pair[1]);
            previous[pair[1]] = Some(pair[0]);
        }
    }
    // Every item is open, so an item counts all that is under it. A child
    // always comes after its parent, so counting from the end sees each
    // child's count finished before it is added to its parent's.
    let mut under = vec![0_i64; items.len()];
    for index in (0..items.len()).rev() {
        if let Some(parent) = items[index].parent {
            under[parent] += 1 + under[index];
        }
    }

    for (index, item) in items.iter().enumerate() {
        let mut bookmark = dictionary! {
            "Title" => lopdf::text_string(item.title),
            "Parent" => item.parent.map_or(root, |parent| ids[parent]),
            "Dest" => destination(item),
        };
        if let Some(previous) = previous[index] {
            bookmark.set("Prev", ids[previous]);
        }
        if let Some(next) = next[index] {
            bookmark.set("Next", ids[next]);
        }
        if let (Some(&first), Some(&last)) = (children[index].first(), children[index].last()) {
            bookmark.set("First", ids[first]);
            bookmark.set("Last", ids[last]);
            bookmark.set("Count", under[index]);
        }
        new.objects.insert(ids[index], Object::Dictionary(bookmark));
    }
    // Never empty: the first heading has nothing above it to sit under.
    let (first, last) = (top_level[0], top_level[top_level.len() - 1]);
    new.objects.insert(
        root,
        Object::Dictionary(dictionary! {
            "Type" => "Outlines",
            "First" => ids[first],
            "Last" => ids[last],
            "Count" => items.len() as i64,
        }),
    );

    document.opt_clone_object_to_new_document(catalog)?;
    document
        .new_document
        .get_object_mut(catalog)?
        .as_dict_mut()?
        .set("Outlines", root);
    let mut updated = Vec::with_capacity(pdf.len() + 256 * items.len());
    document.save_to(&mut updated)?;
    Ok(Some(updated))
}

/// Whether the catalog already names an outline with something in it.
fn has_outline(document: &Document, catalog: ObjectId) -> bool {
    document
        .get_dictionary(catalog)
        .and_then(|catalog| catalog.get(b"Outlines"))
        .and_then(|outlines| document.dereference(outlines))
        .and_then(|(_, outlines)| outlines.as_dict())
        .is_ok_and(|outlines| outlines.has(b"First"))
}

/// The headings that can be bookmarks, placed in the tree. A heading on a page
/// the PDF does not have, or with no text, is left out; one that skips a level
/// sits under the last heading above it, as Chromium nests it.
fn items<'a>(
    document: &Document,
    pages: &[ObjectId],
    outline: &'a [PdfOutlineEntry],
) -> Vec<Item<'a>> {
    let mut items: Vec<Item<'a>> = Vec::new();
    // The headings a later one can still sit under, with their levels.
    let mut open: Vec<(u8, usize)> = Vec::new();
    for entry in outline {
        let title = entry.title.trim();
        let Some(&page) = pages.get(entry.page as usize) else {
            continue;
        };
        if title.is_empty() {
            continue;
        }
        while open.last().is_some_and(|&(above, _)| above >= entry.level) {
            open.pop();
        }
        let fraction = if entry.top.is_finite() {
            entry.top.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let top =
            media_box(document, page).map(|[_, bottom, _, top]| top - fraction * (top - bottom));
        items.push(Item {
            title,
            parent: open.last().map(|&(_, index)| index),
            page,
            top,
        });
        open.push((entry.level, items.len() - 1));
    }
    items
}

/// The page's `MediaBox` as `[left, bottom, right, top]`, from the page or
/// from the first node above it that has one: the entry is inherited.
fn media_box(document: &Document, page: ObjectId) -> Option<[f64; 4]> {
    let mut node = document.get_dictionary(page).ok()?;
    // A tree that loops is broken; no real one is this deep.
    for _ in 0..64 {
        if let Ok(value) = node.get(b"MediaBox") {
            let (_, value) = document.dereference(value).ok()?;
            let numbers: Vec<f64> = value
                .as_array()
                .ok()?
                .iter()
                .map(|number| number.as_float().map(f64::from))
                .collect::<lopdf::Result<_>>()
                .ok()?;
            let [x0, y0, x1, y1] = numbers[..] else {
                return None;
            };
            return Some([x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]);
        }
        let parent = node.get(b"Parent").ok()?.as_reference().ok()?;
        node = document.get_dictionary(parent).ok()?;
    }
    None
}

/// Where a bookmark takes the reader: its page, scrolled to its heading
/// (`/XYZ`, keeping the horizontal position and the zoom, as Chromium's do),
/// or the whole page when the page gives no height.
fn destination(item: &Item<'_>) -> Object {
    match item.top {
        Some(top) => Object::Array(vec![
            Object::Reference(item.page),
            Object::Name(b"XYZ".to_vec()),
            Object::Null,
            Object::Real(top as f32),
            Object::Null,
        ]),
        None => Object::Array(vec![
            Object::Reference(item.page),
            Object::Name(b"Fit".to_vec()),
        ]),
    }
}

#[cfg(test)]
mod support;
#[cfg(test)]
pub(crate) use support::{after_export, bookmarks, heading};

#[cfg(test)]
mod tests;
