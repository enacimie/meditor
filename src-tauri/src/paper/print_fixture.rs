//! What both print harnesses print and read: the shape paged.js hands the
//! print engine, styled with the application's own print stylesheet, and the
//! size a PDF says its first page is. One copy, so that WebKitGTK and WebView2
//! are asked to print the same document and measured the same way.

/// The application's print stylesheet, read rather than restated.
///
/// This is what makes the GTK test a guard: the sheet height that keeps a
/// page from spilling is a rule in this file, so removing it has to turn that
/// test red. WebView2 does not need the rule — measured, a sheet exactly as
/// tall as its paper prints on one sheet there — so the WebView2 test reads
/// the stylesheet only to print what the application prints.
pub(super) const PRINT_CSS: &str = include_str!("../../../src/preview/print.css");

/// What paged.js leaves behind: page boxes sized from its own variables,
/// inside the wrapper `print.css` selects on, under the `@page` rule it
/// injects for the printer — the sheet's size and `margin: 0`, as its
/// `addRootPage` writes them.
pub(super) fn paged_document(sheets: usize) -> String {
    paged_document_on(sheets, "a4", "210mm", "297mm")
}

/// The same, on a named sheet — what `buildPagedCss` produces for a paper.
pub(super) fn paged_document_on(
    sheets: usize,
    css_size: &str,
    width: &str,
    height: &str,
) -> String {
    let pages: String = (1..=sheets)
        .map(|n| format!("<div class=\"pagedjs_page\" id=\"page-{n}\">Page {n}</div>"))
        .collect();
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>\
         @page {{ size: {css_size}; margin: 0; }}\
         html, body {{ margin: 0; padding: 0; }}\
         .pagedjs_page {{\
           --pagedjs-width: {width}; --pagedjs-height: {height};\
           width: var(--pagedjs-width); height: var(--pagedjs-height);\
           break-after: page; overflow: hidden;\
         }}\
         .paged-view .pagedjs_page {{ margin: 0 auto 24px; }}\
         </style><style>{PRINT_CSS}</style></head>\
         <body><div class=\"paged-view\"><div class=\"pagedjs_pages\">{pages}</div></div></body></html>"
    )
}

/// The first `/MediaBox` as (width, height) in points.
pub(super) fn first_media_box(pdf: &[u8]) -> Option<(f64, f64)> {
    let at = pdf.windows(9).position(|w| w == b"/MediaBox")?;
    let rest = &pdf[at..];
    let open = rest.iter().position(|b| *b == b'[')?;
    let close = rest.iter().position(|b| *b == b']')?;
    let inside = std::str::from_utf8(&rest[open + 1..close]).ok()?;
    let numbers: Vec<f64> = inside
        .split_whitespace()
        .filter_map(|n| n.parse::<f64>().ok())
        .collect();
    match numbers.as_slice() {
        [x0, y0, x1, y1] => Some((x1 - x0, y1 - y0)),
        _ => None,
    }
}
