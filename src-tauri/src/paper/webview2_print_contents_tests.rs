//! Printing through WebView2, for real: what the PDF carries besides its pages.
//!
//! The headings as bookmarks, the table of contents' links and the page's
//! title. `#[ignore]`, and run by the same Windows-only CI step as
//! `webview2_print_tests`.

use super::print_fixture::PRINT_CSS;
use super::skia_pdf::{info_entry, link_count, outline};
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
/// is the engine's half of that.
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
}
