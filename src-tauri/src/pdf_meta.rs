//! The front-matter's author, subject and keywords, written into a PDF the
//! engine has already printed.
//!
//! No engine this application prints with writes them, and none can be asked
//! to: measured on 2026-09-25 (#189), WebView2 by either route, WebKitGTK and
//! Chrome leave the information dictionary with a title and a producer at
//! most. So they are added afterwards, as an incremental update (ISO 32000-1,
//! 7.5.6). The engine's bytes stay exactly as they were, and a new
//! information dictionary goes after them, with a cross-reference section
//! whose `/Prev` points back at the engine's. The pages are never rewritten.
//!
//! An export never fails over metadata. When the PDF cannot be read, or the
//! update cannot be written, the file stays as the engine wrote it and the
//! reason goes to the log.

use crate::export::PdfMeta;
use crate::locale::Locale;
use lopdf::{Dictionary, IncrementalDocument, Object};
use std::path::Path;

/// The entries to write, by their key in the information dictionary: only
/// those the document names, and none that are blank.
fn entries(meta: &PdfMeta) -> Vec<(&'static str, &str)> {
    [
        ("Author", &meta.author),
        ("Subject", &meta.subject),
        ("Keywords", &meta.keywords),
    ]
    .into_iter()
    .filter_map(|(key, value)| {
        let value = value.as_deref()?.trim();
        (!value.is_empty()).then_some((key, value))
    })
    .collect()
}

/// Add `meta` to the PDF at `path`, in place and atomically. Nothing to add,
/// a file that will not parse, or a write that fails: the file is left as it
/// was.
pub fn add_to_file(locale: Locale, path: &Path, meta: Option<&PdfMeta>) {
    let Some(meta) = meta else {
        return;
    };
    let pdf = match std::fs::read(path) {
        Ok(pdf) => pdf,
        Err(error) => {
            eprintln!("the PDF keeps the engine's metadata: {error}");
            return;
        }
    };
    if let Some(updated) = updated(&pdf, meta) {
        if let Err(error) = crate::location::write_atomic_bytes(locale, path, &updated) {
            eprintln!("the PDF keeps the engine's metadata: {error}");
        }
    }
}

/// `pdf` with `meta` added, or `None` when there is nothing to add or the
/// update cannot be made.
fn updated(pdf: &[u8], meta: &PdfMeta) -> Option<Vec<u8>> {
    let entries = entries(meta);
    if entries.is_empty() {
        return None;
    }
    match update(pdf, &entries) {
        Ok(updated) => Some(updated),
        Err(error) => {
            eprintln!("the PDF keeps the engine's metadata: {error}");
            None
        }
    }
}

fn update(pdf: &[u8], entries: &[(&str, &str)]) -> lopdf::Result<Vec<u8>> {
    let mut document: IncrementalDocument = pdf.try_into()?;
    let existing = document
        .get_prev_documents()
        .trailer
        .get(b"Info")
        .and_then(Object::as_reference)
        .ok();
    // The engine's own dictionary, copied into the update, so what it wrote
    // there — the title, the producer — stays; or a new one.
    let info = match existing {
        Some(id) => {
            document.opt_clone_object_to_new_document(id)?;
            id
        }
        None => {
            let id = document.new_document.add_object(Dictionary::new());
            document
                .new_document
                .trailer
                .set("Info", Object::Reference(id));
            id
        }
    };
    let dictionary = document.new_document.get_object_mut(info)?.as_dict_mut()?;
    for (key, value) in entries {
        dictionary.set(*key, lopdf::text_string(value));
    }
    let mut updated = Vec::with_capacity(pdf.len() + 1024);
    document.save_to(&mut updated)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Stream};

    /// A one-page PDF as an engine hands it over, with an information
    /// dictionary of its own or none.
    fn engine_pdf(info: Option<Dictionary>) -> Vec<u8> {
        let mut document = Document::with_version("1.4");
        let pages = document.new_object_id();
        let content = document.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
        let page = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages,
            "Contents" => content,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        document.objects.insert(
            pages,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page.into()],
                "Count" => 1,
            }),
        );
        let catalog = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        document.trailer.set("Root", catalog);
        if let Some(info) = info {
            let id = document.add_object(info);
            document.trailer.set("Info", id);
        }
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).expect("a PDF to start from");
        bytes
    }

    fn meta(author: Option<&str>, subject: Option<&str>, keywords: Option<&str>) -> PdfMeta {
        PdfMeta {
            author: author.map(str::to_owned),
            subject: subject.map(str::to_owned),
            keywords: keywords.map(str::to_owned),
        }
    }

    /// The information dictionary a reader sees: the one the last trailer
    /// points at.
    fn info_text(pdf: &[u8], key: &[u8]) -> Option<String> {
        let document = Document::load_mem(pdf).expect("the result should parse");
        let id = document.trailer.get(b"Info").ok()?.as_reference().ok()?;
        let info = document.get_object(id).ok()?.as_dict().ok()?;
        lopdf::decode_text_string(info.get(key).ok()?).ok()
    }

    #[test]
    fn writes_the_three_fields_in_any_script() {
        let pdf = engine_pdf(Some(dictionary! {
            "Title" => lopdf::text_string("Informe de medición"),
            "Producer" => Object::string_literal("Skia/PDF m153"),
        }));
        let updated = updated(
            &pdf,
            &meta(
                Some("Año Núñez, Ελληνικά"),
                Some("Medición"),
                Some("pdf, marcadores"),
            ),
        )
        .expect("something to add");
        assert_eq!(
            info_text(&updated, b"Author").as_deref(),
            Some("Año Núñez, Ελληνικά")
        );
        assert_eq!(info_text(&updated, b"Subject").as_deref(), Some("Medición"));
        assert_eq!(
            info_text(&updated, b"Keywords").as_deref(),
            Some("pdf, marcadores")
        );
        // What the engine wrote there stays.
        assert_eq!(
            info_text(&updated, b"Title").as_deref(),
            Some("Informe de medición")
        );
        assert_eq!(
            info_text(&updated, b"Producer").as_deref(),
            Some("Skia/PDF m153")
        );
    }

    #[test]
    fn only_appends_to_what_the_engine_wrote() {
        let pdf = engine_pdf(None);
        let updated = updated(&pdf, &meta(Some("Ana"), None, None)).expect("something to add");
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
            1,
            "the pages should be the engine's"
        );
        // No dictionary before, so a new one.
        assert_eq!(info_text(&updated, b"Author").as_deref(), Some("Ana"));
        assert_eq!(info_text(&updated, b"Subject"), None);
    }

    #[test]
    fn adds_nothing_when_the_document_names_nothing() {
        let pdf = engine_pdf(None);
        assert!(updated(&pdf, &PdfMeta::default()).is_none());
        assert!(
            updated(&pdf, &meta(Some("  "), Some(""), None)).is_none(),
            "blank is nothing"
        );
    }

    #[test]
    fn leaves_what_is_not_a_pdf_alone() {
        assert!(updated(b"<html>not a pdf</html>", &meta(Some("Ana"), None, None)).is_none());
    }

    #[test]
    fn rewrites_the_file_in_place_or_not_at_all() {
        let dir = std::env::temp_dir().join(format!("meditor-pdf-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder for the test");
        let path = dir.join("out.pdf");
        std::fs::write(&path, engine_pdf(None)).expect("the engine's PDF");
        add_to_file(Locale::En, &path, Some(&meta(Some("Ana"), None, None)));
        let written = std::fs::read(&path).expect("the file");
        assert_eq!(info_text(&written, b"Author").as_deref(), Some("Ana"));

        std::fs::write(&path, b"not a pdf").expect("a broken file");
        add_to_file(Locale::En, &path, Some(&meta(Some("Ana"), None, None)));
        assert_eq!(
            std::fs::read(&path).expect("the file"),
            b"not a pdf",
            "left as it was"
        );

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }
}
