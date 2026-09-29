//! Printing through WebView2, for real: what the PDF carries besides its pages.
//!
//! The headings as bookmarks, the table of contents' links, the page's title,
//! and the front-matter's metadata added on top by `pdf_meta`. `#[ignore]`,
//! and run by the same Windows-only CI step as `webview2_print_tests`.

use super::print_fixture::PRINT_CSS;
use super::skia_pdf::{info_entry, link_count, outline, page_count};
use super::webview2_engine::{print_through_webview2, start, Route, View};

/// The headings, as the PDF's bookmarks: what the DevTools route is for.
///
/// On the shape paged.js gives the Document view — the headings inside page
/// boxes, and a running head in each page's top margin, which is text and
/// must not become a bookmark — with a table of contents whose links work by
/// either route, as they always did through `PrintToPdf`.
///
/// And the page's title as the PDF's, by either route: the application sets
/// `document.title` to the front-matter's `title:` while it exports, and this
/// is the engine's half of that. Then the front-matter's author, subject and
/// keywords added on top, as `export_pdf` does after either route, with the
/// engine's PDF left whole: its bytes, pages, bookmarks, links and title.
/// And the headings as bookmarks, which `export_pdf` adds after `PrintToPdf`,
/// which writes none, and leaves out after the DevTools route, which has.
#[test]
#[ignore = "needs the WebView2 runtime and a desktop; CI runs it on Windows only"]
fn webview2_print_writes_the_headings_as_bookmarks() {
    let engine = start();
    let page = |content: &str| {
        format!(
            "<div class=\"pagedjs_page\"><div class=\"pagedjs_margin-top\">Informe</div>\
             <div class=\"markdown-body doc\">{content}</div></div>"
        )
    };
    let document = format!(
        "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">\
         <title>Informe de medición</title><style>\
         @page {{ size: a4; margin: 0; }}\
         html, body {{ margin: 0; }}\
         .pagedjs_page {{ --pagedjs-height: 297mm; width: 210mm; height: 297mm;\
           break-after: page; overflow: hidden; }}\
         </style><style>{PRINT_CSS}</style></head>\
         <body><div class=\"paged-view\"><div class=\"pagedjs_pages\">{}{}</div></div></body></html>",
        page(
            "<nav class=\"markdown-toc\" role=\"doc-toc\"><ol>\
             <li><a href=\"#uno\">Uno</a></li>\
             <li><a href=\"#m%C3%A9todo\">Método</a></li>\
             <li><a href=\"#dos\">Dos</a></li></ol></nav>\
             <h1 id=\"uno\">Uno</h1><p>Primero.</p><h2 id=\"método\">Método</h2><p>Segundo.</p>"
        ),
        page("<h1 id=\"dos\">Dos</h1><p>Tercero.</p>"),
    );

    let pdf = print_through_webview2(
        &engine,
        "bookmarks",
        &document,
        View::Document(None),
        Route::DevTools,
    );
    assert_eq!(
        outline(&pdf),
        [(1, "Uno"), (2, "Método"), (1, "Dos")].map(|(depth, title)| (depth, title.to_string())),
        "the headings should be the bookmarks, each once and nested as they are; the running head none of them",
    );
    assert!(
        pdf.windows(b"/StructTreeRoot".len())
            .any(|w| w == b"/StructTreeRoot"),
        "DevTools: the PDF should be tagged, with a structure tree",
    );
    assert_eq!(
        link_count(&pdf),
        3,
        "DevTools: the contents' three links should work in the PDF"
    );
    assert_eq!(
        info_entry(&pdf, "/Title").as_deref(),
        Some("Informe de medición"),
        "DevTools: the PDF's title should be the page's",
    );
    front_matter_added_to(&pdf, Route::DevTools);
    outline_added_to(&pdf, Route::DevTools);

    let pdf = print_through_webview2(
        &engine,
        "links",
        &document,
        View::Document(None),
        Route::PrintToPdf,
    );
    assert_eq!(
        link_count(&pdf),
        3,
        "PrintToPdf: the contents' three links should work in the PDF"
    );
    assert_eq!(
        info_entry(&pdf, "/Title").as_deref(),
        Some("Informe de medición"),
        "PrintToPdf: the PDF's title should be the page's",
    );
    front_matter_added_to(&pdf, Route::PrintToPdf);
    outline_added_to(&pdf, Route::PrintToPdf);
}

/// Run `pdf` through what `export_pdf` does after printing, with the
/// headings the frontend would send: over `PrintToPdf`, which writes no
/// outline, they become the bookmarks; over the DevTools route, Chromium's
/// own outline stays as it was, and nothing is added for it.
fn outline_added_to(pdf: &[u8], route: Route) {
    use crate::pdf_outline::{after_export, bookmarks, heading};
    let headings = [
        heading(1, "Uno", 0, 0.2),
        heading(2, "Método", 0, 0.5),
        heading(1, "Dos", 1, 0.1),
    ];
    let after = after_export(pdf, &format!("webview2-{route:?}"), &headings);
    let read = bookmarks(&after);
    let shape: Vec<(usize, &str, usize)> = read
        .iter()
        .map(|(depth, title, page, _)| (*depth, title.as_str(), *page))
        .collect();
    assert_eq!(
        shape,
        [(1, "Uno", 0), (2, "Método", 0), (1, "Dos", 1)],
        "{route:?}: the headings should be the bookmarks, on their pages",
    );
    match route {
        // Chromium's, found where it put them: by the heading's own place.
        Route::DevTools => assert_eq!(
            outline(&after),
            outline(pdf),
            "DevTools: Chromium's outline should stay as it wrote it",
        ),
        // Ours, pointing at the height the frontend measured.
        Route::PrintToPdf => {
            for ((_, title, _, top), fraction) in read.iter().zip([0.2, 0.5, 0.1]) {
                let top =
                    top.unwrap_or_else(|| panic!("PrintToPdf: {title} should point at a height"));
                let expected = 842.0 * (1.0 - fraction);
                assert!(
                    (top - expected).abs() < 5.0,
                    "PrintToPdf: {title} should point about {expected} pt up its A4 page, got {top}",
                );
            }
        }
    }
    assert!(
        after.starts_with(pdf),
        "{route:?}: whatever is added goes after the engine's bytes"
    );
    assert_eq!(
        page_count(&after),
        page_count(pdf),
        "{route:?}: the pages should stay"
    );
    assert_eq!(
        link_count(&after),
        link_count(pdf),
        "{route:?}: the links should stay"
    );
}

/// Add the front-matter's metadata to `pdf` the way `export_pdf` does, on
/// the file, and check that it arrived and that nothing the engine wrote
/// was lost on the way.
fn front_matter_added_to(pdf: &[u8], route: Route) {
    let path = std::env::temp_dir().join(format!(
        "meditor-webview2-meta-{}-{route:?}.pdf",
        std::process::id()
    ));
    std::fs::write(&path, pdf).expect("the engine's PDF, on disk");
    let meta = crate::export::PdfMeta {
        author: Some("Ana Pérez".to_string()),
        subject: Some("Medición".to_string()),
        keywords: Some("pdf, marcadores".to_string()),
    };
    crate::pdf_meta::add_to_file(crate::locale::Locale::En, &path, Some(&meta));
    let added = std::fs::read(&path).expect("the PDF, with its metadata");
    let _ = std::fs::remove_file(&path);

    for (key, value) in [
        ("/Author", "Ana Pérez"),
        ("/Subject", "Medición"),
        ("/Keywords", "pdf, marcadores"),
        ("/Title", "Informe de medición"),
    ] {
        assert_eq!(
            info_entry(&added, key).as_deref(),
            Some(value),
            "{route:?}: {key} should read {value} once the metadata is added",
        );
    }
    assert!(
        added.starts_with(pdf),
        "{route:?}: the metadata should go after the engine's bytes, not into them",
    );
    assert_eq!(
        page_count(&added),
        page_count(pdf),
        "{route:?}: the pages should stay"
    );
    assert_eq!(
        outline(&added),
        outline(pdf),
        "{route:?}: the bookmarks should stay"
    );
    assert_eq!(
        link_count(&added),
        link_count(pdf),
        "{route:?}: the links should stay"
    );
}
