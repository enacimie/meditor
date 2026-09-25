//! Printing through WebView2, for real: the sheet.
//!
//! The Windows counterpart of `gtk_print_tests`: the same document and
//! stylesheet, printed the two ways `export_pdf` prints on Windows — the
//! DevTools protocol's `Page.printToPDF` first, `PrintToPdf` when that one
//! will not answer — by the engine the installed application prints with, and
//! read back. Nothing else produces a PDF on this path: the E2E suite prints
//! with Chrome's own `Page.printToPDF`, which is Chrome and not WebView2. What
//! the PDF carries besides its pages is `webview2_print_contents_tests`' part.
//!
//! `#[ignore]` because it needs the WebView2 runtime and a desktop to open a
//! window on, which `cargo test --lib` does not ask for anywhere. CI runs both
//! modules as their own Windows-only step, whose filter both names answer to:
//!
//! ```sh
//! cargo test --lib -- --ignored --test-threads=1 webview2_print
//! ```

use super::print_fixture::{first_media_box, paged_document, paged_document_on, PRINT_CSS};
use super::skia_pdf::{first_page_content, first_page_placement, page_count};
use super::webview2_engine::{print_through_webview2, start, Engine, Route, View};

/// Every claim about the sheet, on both routes, in one test.
///
/// Measured on WebView2 on 2026-09-25, and in two ways not what WebKitGTK
/// does. A page taller than its sheet does not spill onto a second one:
/// Chromium shrinks it to fit. And a page's own `@page` rule wins over the
/// printer: when it names a size, its orientation is the one printed, and
/// when it sets a margin, the settings' margin is not added. So the claims
/// are about the sheet and how the page sits on it, not only about how many
/// sheets there are, and each setting is checked where no rule overrides it.
#[test]
#[ignore = "needs the WebView2 runtime and a desktop; CI runs it on Windows only"]
fn webview2_print_puts_each_view_on_the_sheet_it_asks_for() {
    let engine = start();
    for route in [Route::DevTools, Route::PrintToPdf] {
        each_view_on_its_sheet(&engine, route);
    }
}

fn each_view_on_its_sheet(engine: &Engine, route: Route) {
    // ── A4, the paper this project has always used ────────────────────────
    let pdf = print_through_webview2(
        engine,
        "a4",
        &paged_document(3),
        View::Document(None),
        route,
    );
    assert_eq!(
        &pdf[..5],
        b"%PDF-",
        "{route:?}, A4: the printer should write a PDF"
    );
    assert_eq!(
        page_count(&pdf),
        3,
        "{route:?}, A4: three paged.js pages should print as three sheets"
    );
    let (width, height) = first_media_box(&pdf).expect("A4: a page should declare its size");
    assert!(
        (width - 595.0).abs() < 3.0 && (height - 842.0).abs() < 3.0,
        "{route:?}, A4: the sheet should be 595 x 842 points, got {width} x {height}",
    );
    // The paged view's sheets carry their own margins, inside them: each one
    // should fill its paper, rather than be drawn smaller or away from the
    // edge.
    let (scale, left) =
        first_page_placement(&pdf).expect("A4: the page's drawing should be readable");
    assert!(
        (scale - 1.0).abs() < 0.01 && left.abs() < 1.0,
        "{route:?}, A4: the page should fill its sheet at full size, from the edge; got {scale} of full size, {left} pt in",
    );

    // ── Letter, laid out and printed on the same paper ────────────────────
    let pdf = print_through_webview2(
        engine,
        "letter",
        &paged_document_on(3, "letter", "215.9mm", "279.4mm"),
        View::Document(Some("letter")),
        route,
    );
    assert_eq!(
        page_count(&pdf),
        3,
        "{route:?}, Letter: three sheets should print as three pages"
    );
    let (width, height) = first_media_box(&pdf).expect("Letter: a page should declare its size");
    assert!(
        (width - 612.0).abs() < 3.0 && (height - 792.0).abs() < 3.0,
        "{route:?}, Letter: the sheet should be 612 x 792 points, got {width} x {height}",
    );
    let (scale, left) =
        first_page_placement(&pdf).expect("Letter: the page's drawing should be readable");
    assert!(
        (scale - 1.0).abs() < 0.01 && left.abs() < 1.0,
        "{route:?}, Letter: the page should fill its sheet at full size, from the edge; got {scale}, {left} pt in",
    );

    /*
     * ── An A4 layout sent to Letter ──────────────────────────────────────
     *
     * The application does not do this: the paper travels with the layout.
     * It is the premise the rest rests on, that the printer takes the paper
     * it is given and not the one the document's CSS names, and here it
     * shows what WebView2 does with the difference. The sheet is Letter,
     * although the document says A4, and each A4 page is drawn whole at
     * 279.4/297 of its size, rather than spilling as in WebKitGTK or being
     * cut at the foot.
     */
    let pdf = print_through_webview2(
        engine,
        "a4-on-letter",
        &paged_document(3),
        View::Document(Some("letter")),
        route,
    );
    let (width, height) = first_media_box(&pdf).expect("a page should declare its size");
    assert!(
        (width - 612.0).abs() < 3.0 && (height - 792.0).abs() < 3.0,
        "{route:?}: the sheet should be the Letter asked for, whatever the CSS says; got {width} x {height}",
    );
    assert_eq!(
        page_count(&pdf),
        3,
        "{route:?}: an A4 layout on Letter should not spill in WebView2"
    );
    let (scale, _) = first_page_placement(&pdf).expect("the page's drawing should be readable");
    assert!(
        (scale - 279.4 / 297.0).abs() < 0.01,
        "{route:?}: each A4 page should be drawn whole, shrunk to the Letter sheet's height; got {scale} of full size",
    );

    /*
     * ── The Web view, the one document with no `@page` rule ──────────────
     *
     * paged.js writes `@page { size; margin: 0 }` in front of every
     * paginated document, and a Marp slide brings a rule of its own. Those
     * rules decide the orientation and the margin, whatever the settings
     * say: the A4 fixture above printed the same with a 25 mm margin in its
     * settings, and with its sheet turned sideways; only once `margin: 0`
     * was taken out of its rule did the 25 mm shrink it. So the settings'
     * orientation and margin can only be seen here: an upright sheet, and
     * 25 mm around the text. It measured 69.75 pt, which is 93 CSS pixels,
     * where 25 mm is 70.9.
     */
    let web = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>{PRINT_CSS}</style></head>\
         <body><div class=\"markdown-body\"><p>A paragraph with no page around it.</p></div>\
         </body></html>"
    );
    let pdf = print_through_webview2(engine, "web", &web, View::Web(None), route);
    assert_eq!(
        page_count(&pdf),
        1,
        "{route:?}, Web view: a paragraph should print on one sheet"
    );
    let (width, height) = first_media_box(&pdf).expect("Web view: a page should declare its size");
    assert!(
        (width - 595.0).abs() < 3.0 && (height - 842.0).abs() < 3.0,
        "{route:?}, Web view: the sheet should be A4 and upright, 595 x 842 points; got {width} x {height}",
    );
    let (scale, left) =
        first_page_placement(&pdf).expect("Web view: the page's drawing should be readable");
    let margin = 25.0 / 25.4 * 72.0;
    assert!(
        (scale - 1.0).abs() < 0.01 && (left - margin).abs() < 2.0,
        "{route:?}, Web view: the text should start {margin:.1} pt in from the edge, at full size; got {left} pt in, at {scale}",
    );

    /*
     * ── Slides, on a sheet the size of the slide ─────────────────────────
     *
     * What `exportPdf` sends for Marp: the slide's size in inches, read from
     * its 1280 x 720 viewBox, in front of the `@page` rule `MarpPreview`
     * writes. 13.33 by 7.5 inches is 960 by 540 points.
     */
    let slides = "<!doctype html><html><head><meta charset=\"utf-8\"><style>\
                  @page{size:1280px 720px;margin:0;}\
                  html, body { margin: 0; }\
                  section { width: 1280px; height: 720px; break-after: page; }\
                  </style></head><body><section>One</section><section>Two</section></body></html>";
    let pdf = print_through_webview2(
        engine,
        "slides",
        slides,
        View::Slides(1280.0 / 96.0, 720.0 / 96.0),
        route,
    );
    assert_eq!(
        page_count(&pdf),
        2,
        "{route:?}, Slides: two slides should print as two sheets"
    );
    let (width, height) = first_media_box(&pdf).expect("Slides: a page should declare its size");
    assert!(
        (width - 960.0).abs() < 3.0 && (height - 540.0).abs() < 3.0,
        "{route:?}, Slides: the sheet should be the slide's, 960 x 540 points; got {width} x {height}",
    );
    let (scale, left) =
        first_page_placement(&pdf).expect("Slides: the page's drawing should be readable");
    assert!(
        (scale - 1.0).abs() < 0.01 && left.abs() < 1.0,
        "{route:?}, Slides: each slide should fill its sheet at full size; got {scale} of full size, {left} pt in",
    );

    // ── Backgrounds, which a table's header and a code block are made of ─
    let red = "<!doctype html><html><head><style>@page { size: a4; margin: 0; }\
               html, body { margin: 0; }</style></head><body>\
               <div style=\"background: #ff0000; width: 50mm; height: 20mm\"></div></body></html>";
    let pdf = print_through_webview2(engine, "background", red, View::Document(None), route);
    let content = first_page_content(&pdf).expect("the page's drawing should be readable");
    assert!(
        content.contains("1 0 0 rg"),
        "{route:?}: a background should print, as the Document view's shading needs; the page drew no red fill",
    );
}
