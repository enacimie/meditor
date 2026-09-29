//! What the tests here and the print harnesses need: a heading as the
//! frontend sends it, what `export_pdf` does after printing, done on a file,
//! and a reader for the bookmarks that follows incremental updates.

use super::add_to_file;
use crate::export::PdfOutlineEntry;
use crate::locale::Locale;
use lopdf::{Document, Object, ObjectId};

/// A heading as the frontend sends it, for the tests here and the print
/// harnesses.
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
