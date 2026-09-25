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

/// A heading as the frontend sends it, for the tests here and the print
/// harnesses.
#[cfg(test)]
pub(crate) fn heading(level: u8, title: &str, page: u32, top: f64) -> PdfOutlineEntry {
    PdfOutlineEntry {
        level,
        title: title.to_string(),
        page,
        top,
    }
}

/// What `export_pdf` does to a PDF once the engine has printed it, done the
/// same way, on a file: the metadata, then the bookmarks. For the print
/// harnesses, which have a real engine's PDF to try it on.
#[cfg(test)]
pub(crate) fn after_export(pdf: &[u8], tag: &str, outline: &[PdfOutlineEntry]) -> Vec<u8> {
    let path = std::env::temp_dir().join(format!(
        "meditor-after-export-{}-{tag}.pdf",
        std::process::id()
    ));
    std::fs::write(&path, pdf).expect("the engine's PDF, on disk");
    let meta = crate::export::PdfMeta {
        author: Some("Ana Pérez".to_string()),
        ..Default::default()
    };
    crate::pdf_meta::add_to_file(Locale::En, &path, Some(&meta));
    add_to_file(Locale::En, &path, Some(outline));
    let after = std::fs::read(&path).expect("the PDF, after the export");
    let _ = std::fs::remove_file(&path);
    after
}

/// A PDF's bookmarks as a reader sees them, for the tests here and the print
/// harnesses: depth, title, page (0 for the first) and the height it points
/// at, if it points at one. Read with lopdf, which follows the incremental
/// updates to the catalog that is current.
#[cfg(test)]
pub(crate) fn bookmarks(pdf: &[u8]) -> Vec<(usize, String, usize, Option<f64>)> {
    let document = Document::load_mem(pdf).expect("the PDF should parse");
    let pages: Vec<ObjectId> = document.get_pages().into_values().collect();
    let catalog = document.catalog().expect("a catalog");
    let Ok(outlines) = catalog
        .get(b"Outlines")
        .and_then(|outlines| document.dereference(outlines))
        .and_then(|(_, outlines)| outlines.as_dict())
    else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut stack: Vec<(ObjectId, usize)> = Vec::new();
    if let Ok(first) = outlines.get(b"First").and_then(Object::as_reference) {
        stack.push((first, 1));
    }
    while let Some((id, depth)) = stack.pop() {
        let item = document.get_dictionary(id).expect("a bookmark");
        let title = item
            .get(b"Title")
            .and_then(lopdf::decode_text_string)
            .expect("a bookmark's title");
        let dest = item
            .get(b"Dest")
            .and_then(Object::as_array)
            .expect("a bookmark that points at its page");
        let page = dest[0].as_reference().expect("a page");
        let top = dest
            .get(3)
            .and_then(|top| top.as_float().ok())
            .map(f64::from);
        found.push((
            depth,
            title,
            pages
                .iter()
                .position(|&p| p == page)
                .expect("one of the PDF's pages"),
            top,
        ));
        // The sibling after the children, so it is pushed first.
        if let Ok(next) = item.get(b"Next").and_then(Object::as_reference) {
            stack.push((next, depth));
        }
        if let Ok(child) = item.get(b"First").and_then(Object::as_reference) {
            stack.push((child, depth + 1));
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Stream;

    const A4: [i64; 4] = [0, 0, 595, 842];

    /// A PDF as an engine hands it over: `pages` sheets of `media_box`, the
    /// box on each page or only on the page tree, and an outline of its own
    /// or none.
    fn engine_pdf(pages: usize, media_box: [i64; 4], box_on_pages: bool, outline: bool) -> Vec<u8> {
        let mut document = Document::with_version("1.4");
        let tree = document.new_object_id();
        let boxed = || Object::Array(media_box.iter().map(|&n| n.into()).collect());
        let kids: Vec<ObjectId> = (0..pages)
            .map(|_| {
                let content = document.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
                let mut page = dictionary! {
                    "Type" => "Page",
                    "Parent" => tree,
                    "Contents" => content,
                };
                if box_on_pages {
                    page.set("MediaBox", boxed());
                }
                document.add_object(page)
            })
            .collect();
        let mut node = dictionary! {
            "Type" => "Pages",
            "Kids" => kids.iter().map(|&kid| kid.into()).collect::<Vec<Object>>(),
            "Count" => pages as i64,
        };
        if !box_on_pages {
            node.set("MediaBox", boxed());
        }
        document.objects.insert(tree, Object::Dictionary(node));
        let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => tree };
        if outline {
            let root = document.new_object_id();
            let item = document.add_object(dictionary! {
                "Title" => lopdf::text_string("Del motor"),
                "Parent" => root,
                "Dest" => vec![kids[0].into(), Object::Name(b"Fit".to_vec())],
            });
            document.objects.insert(
                root,
                Object::Dictionary(dictionary! {
                    "Type" => "Outlines",
                    "First" => item,
                    "Last" => item,
                    "Count" => 1,
                }),
            );
            catalog.set("Outlines", root);
        }
        let catalog = document.add_object(catalog);
        document.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).expect("a PDF to start from");
        bytes
    }

    /// pdf-outline.spec's document as the frontend sends it: a title, three
    /// chapters over four pages, and a heading that skips a level.
    fn chapters() -> Vec<PdfOutlineEntry> {
        vec![
            heading(1, "Informe de prueba", 0, 0.08),
            heading(1, "Primero", 0, 0.25),
            heading(2, "Uno punto uno", 0, 0.78),
            heading(1, "Segundo", 1, 0.58),
            heading(3, "Detalle", 2, 0.28),
            heading(1, "Tercero", 3, 0.08),
        ]
    }

    fn shape(read: &[(usize, String, usize, Option<f64>)]) -> Vec<(usize, &str, usize)> {
        read.iter()
            .map(|(depth, title, page, _)| (*depth, title.as_str(), *page))
            .collect()
    }

    /// The height expected, as closely as a PDF keeps one: a 32-bit real.
    fn at(top: Option<f64>, expected: f64) -> bool {
        top.is_some_and(|top| (top - expected).abs() < 0.01)
    }

    #[test]
    fn nests_the_headings_and_points_each_at_its_page_and_height() {
        let pdf = engine_pdf(4, A4, true, false);
        let read = bookmarks(&updated(&pdf, &chapters()).expect("something to add"));
        assert_eq!(
            shape(&read),
            [
                (1, "Informe de prueba", 0),
                (1, "Primero", 0),
                (2, "Uno punto uno", 0),
                (1, "Segundo", 1),
                (2, "Detalle", 2),
                (1, "Tercero", 3),
            ],
            "each heading once, nested as Chromium nests them: a skipped level sits under the heading above",
        );
        for ((_, title, _, top), fraction) in read.iter().zip([0.08, 0.25, 0.78, 0.58, 0.28, 0.08])
        {
            assert!(
                at(*top, 842.0 * (1.0 - fraction)),
                "{title} should point {} pt up its page, measured from the foot; got {top:?}",
                842.0 * (1.0 - fraction),
            );
        }
    }

    #[test]
    fn keeps_every_item_open_as_chromium_does() {
        let pdf = engine_pdf(4, A4, true, false);
        let document = Document::load_mem(&updated(&pdf, &chapters()).expect("something to add"))
            .expect("parses");
        let outlines = document
            .catalog()
            .and_then(|catalog| catalog.get(b"Outlines"))
            .and_then(|outlines| document.dereference(outlines))
            .and_then(|(_, outlines)| outlines.as_dict())
            .expect("an outline");
        assert_eq!(
            outlines.get(b"Count").and_then(Object::as_i64).ok(),
            Some(6)
        );
        let count = |title: &str| {
            document.objects.values().find_map(|object| {
                let item = object.as_dict().ok()?;
                let read = lopdf::decode_text_string(item.get(b"Title").ok()?).ok()?;
                (read == title).then(|| item.get(b"Count").and_then(Object::as_i64).ok())
            })
        };
        assert_eq!(
            count("Primero"),
            Some(Some(1)),
            "open, over the one under it"
        );
        assert_eq!(
            count("Segundo"),
            Some(Some(1)),
            "open, over the one under it"
        );
        assert_eq!(
            count("Tercero"),
            Some(None),
            "nothing under it, so no count"
        );
    }

    #[test]
    fn titles_in_any_script() {
        let pdf = engine_pdf(1, A4, true, false);
        let read = bookmarks(
            &updated(
                &pdf,
                &[
                    heading(1, "Año Núñez, Ελληνικά", 0, 0.1),
                    heading(2, "Método", 0, 0.5),
                ],
            )
            .expect("something to add"),
        );
        assert_eq!(
            shape(&read),
            [(1, "Año Núñez, Ελληνικά", 0), (2, "Método", 0)]
        );
    }

    #[test]
    fn keeps_an_outline_the_engine_wrote() {
        let pdf = engine_pdf(2, A4, true, true);
        assert!(
            updated(&pdf, &[heading(1, "Uno", 0, 0.1)]).is_none(),
            "Chromium's own outline stays, and nothing is appended",
        );
    }

    #[test]
    fn only_appends_to_what_the_engine_wrote() {
        let pdf = engine_pdf(4, A4, true, false);
        let updated = updated(&pdf, &chapters()).expect("something to add");
        assert!(
            updated.starts_with(&pdf),
            "an incremental update leaves the engine's bytes alone"
        );
        let tail = String::from_utf8_lossy(&updated[pdf.len()..]);
        assert!(
            tail.contains("/Prev"),
            "the new trailer should point back at the engine's cross-reference"
        );
        let document = Document::load_mem(&updated).expect("the result should parse");
        assert_eq!(
            document.get_pages().len(),
            4,
            "the pages should be the engine's"
        );
    }

    #[test]
    fn leaves_out_the_headings_it_cannot_place() {
        let pdf = engine_pdf(2, A4, true, false);
        let read = bookmarks(
            &updated(
                &pdf,
                &[
                    heading(1, "Uno", 0, 0.1),
                    heading(1, "   ", 0, 0.2),
                    heading(2, "Fuera", 5, 0.3),
                    heading(1, "Sin altura", 1, f64::NAN),
                    heading(2, "Más allá", 1, 7.0),
                ],
            )
            .expect("something to add"),
        );
        assert_eq!(
            shape(&read),
            [(1, "Uno", 0), (1, "Sin altura", 1), (2, "Más allá", 1)],
            "no text, or a page the PDF lacks: left out",
        );
        assert!(
            at(read[1].3, 842.0),
            "a height that is no number: the top of the page"
        );
        assert!(at(read[2].3, 0.0), "a height past the page: its foot");
    }

    #[test]
    fn takes_the_size_from_the_page_tree_and_off_the_origin() {
        let pdf = engine_pdf(1, [0, 10, 612, 802], false, false);
        let read =
            bookmarks(&updated(&pdf, &[heading(1, "Uno", 0, 0.25)]).expect("something to add"));
        assert!(
            at(read[0].3, 802.0 - 0.25 * 792.0),
            "a quarter of the way down a box from 10 to 802, got {:?}",
            read[0].3,
        );
    }

    #[test]
    fn adds_nothing_without_headings() {
        let pdf = engine_pdf(1, A4, true, false);
        assert!(updated(&pdf, &[]).is_none());
        assert!(
            updated(&pdf, &[heading(1, " ", 0, 0.0)]).is_none(),
            "blank is nothing"
        );
    }

    #[test]
    fn leaves_what_is_not_a_pdf_alone() {
        assert!(updated(b"<html>not a pdf</html>", &chapters()).is_none());
    }

    #[test]
    fn goes_on_top_of_the_metadata_and_in_place() {
        let dir = std::env::temp_dir().join(format!("meditor-pdf-outline-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder for the test");
        let path = dir.join("out.pdf");
        std::fs::write(&path, engine_pdf(4, A4, true, false)).expect("the engine's PDF");

        // As `export_pdf` does: the metadata first, then the bookmarks.
        let meta = crate::export::PdfMeta {
            author: Some("Ana".to_string()),
            ..Default::default()
        };
        crate::pdf_meta::add_to_file(Locale::En, &path, Some(&meta));
        add_to_file(Locale::En, &path, Some(&chapters()));
        let written = std::fs::read(&path).expect("the file");
        assert_eq!(
            bookmarks(&written).len(),
            6,
            "the bookmarks, over the metadata"
        );
        let document = Document::load_mem(&written).expect("parses");
        let author = document
            .trailer
            .get(b"Info")
            .and_then(Object::as_reference)
            .and_then(|id| document.get_dictionary(id))
            .and_then(|info| info.get(b"Author"))
            .and_then(lopdf::decode_text_string)
            .ok();
        assert_eq!(
            author.as_deref(),
            Some("Ana"),
            "and the metadata under them"
        );

        let before = std::fs::read(&path).expect("the file");
        add_to_file(Locale::En, &path, None);
        add_to_file(Locale::En, &path, Some(&[]));
        assert_eq!(
            std::fs::read(&path).expect("the file"),
            before,
            "no headings, no change"
        );

        std::fs::write(&path, b"not a pdf").expect("a broken file");
        add_to_file(Locale::En, &path, Some(&chapters()));
        assert_eq!(
            std::fs::read(&path).expect("the file"),
            b"not a pdf",
            "left as it was"
        );

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }
}
