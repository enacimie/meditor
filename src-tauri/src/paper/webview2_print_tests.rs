//! Printing through WebView2, for real.
//!
//! The Windows counterpart of `gtk_print_tests`: the same document and
//! stylesheet, printed the two ways `export_pdf` prints on Windows — the
//! DevTools protocol's `Page.printToPDF` first, `PrintToPdf` when that one
//! will not answer — by the engine the installed application prints with, and
//! read back. Nothing else produces a PDF on this path: the E2E suite prints
//! with Chrome's own `Page.printToPDF`, which is Chrome and not WebView2.
//!
//! `#[ignore]` because it needs the WebView2 runtime and a desktop to open a
//! window on, which `cargo test --lib` does not ask for anywhere. CI runs it as
//! its own Windows-only step:
//!
//! ```sh
//! cargo test --lib -- --ignored --test-threads=1 webview2_print
//! ```
//!
//! On one thread, like the GTK one: a WebView2 belongs to the thread that made
//! it, and its callbacks arrive through that thread's message loop.

use super::print_fixture::{first_media_box, paged_document, paged_document_on, PRINT_CSS};
use super::skia_pdf::{first_page_content, first_page_placement, link_count, outline, page_count};
use super::*;
use std::os::windows::ffi::OsStrExt;
use std::sync::mpsc;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2Controller,
    ICoreWebView2Environment, ICoreWebView2EnvironmentOptions, ICoreWebView2_7,
};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, CoreWebView2EnvironmentOptions,
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    NavigationCompletedEventHandler, PrintToPdfCompletedHandler,
};
use windows::core::{w, Interface, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, RegisterClassW, ShowWindow, CW_USEDEFAULT, SW_SHOW,
    WINDOW_EX_STYLE, WNDCLASSW, WS_OVERLAPPEDWINDOW,
};

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    DefWindowProcW(window, message, wparam, lparam)
}

/// A WebView2 in a window of its own, with the environment its print
/// settings come from. The controller is kept because dropping it closes
/// the webview.
struct Engine {
    environment: ICoreWebView2Environment,
    _controller: ICoreWebView2Controller,
    view: ICoreWebView2,
}

fn start() -> Engine {
    unsafe {
        // S_FALSE when this thread already is an apartment: fine either way.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let instance = unsafe { GetModuleHandleW(None) }.expect("the test's own module");
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance.into(),
        lpszClassName: w!("meditor-webview2-print-test"),
        ..Default::default()
    };
    // A second test registers the same class again, which fails harmlessly:
    // a window class belongs to the process, not to the thread that made it.
    unsafe { RegisterClassW(&class) };
    let window = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("meditor-webview2-print-test"),
            w!("meditor print test"),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            1024,
            768,
            None,
            None,
            Some(instance.into()),
            None,
        )
    }
    .expect("a window for the webview");
    unsafe {
        let _ = ShowWindow(window, SW_SHOW);
    }

    // A profile of its own in the temp folder: nothing of the user's. One
    // folder, used again on every run, because WebView2 leaves some ten
    // megabytes in it that a folder per run would pile up.
    let profile = std::env::temp_dir().join("meditor-webview2-print-test");
    let profile = HSTRING::from(profile.as_os_str());
    let (tx, rx) = mpsc::channel();
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            &profile,
            &ICoreWebView2EnvironmentOptions::from(CoreWebView2EnvironmentOptions::default()),
            &CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
                move |error, environment| {
                    let _ = tx.send(error.map(|()| environment));
                    Ok(())
                },
            )),
        )
    }
    .expect("WebView2 should start: is its runtime installed?");
    let environment = webview2_com::wait_with_pump(rx)
        .expect("the environment should be created")
        .expect("the environment should not fail")
        .expect("an environment");

    let (tx, rx) = mpsc::channel();
    unsafe {
        environment.CreateCoreWebView2Controller(
            window,
            &CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
                move |error, controller| {
                    let _ = tx.send(error.map(|()| controller));
                    Ok(())
                },
            )),
        )
    }
    .expect("a controller should be asked for");
    let controller = webview2_com::wait_with_pump(rx)
        .expect("the controller should be created")
        .expect("the controller should not fail")
        .expect("a controller");
    unsafe {
        controller
            .SetBounds(RECT {
                left: 0,
                top: 0,
                right: 1024,
                bottom: 768,
            })
            .expect("the webview should take the window");
        controller
            .SetIsVisible(true)
            .expect("the webview should show");
    }
    let view = unsafe { controller.CoreWebView2() }.expect("the webview itself");
    // As the released application has it. A release build of Tauri turns the
    // DevTools off — wry passes its `devtools` flag to this very setting — so
    // the DevTools route has to print with them off, not only in a debug
    // build where they are on.
    unsafe {
        view.Settings()
            .and_then(|settings| settings.SetAreDevToolsEnabled(false))
    }
    .expect("the DevTools should turn off, as in a release build");
    Engine {
        environment,
        _controller: controller,
        view,
    }
}

/// What the application asks the printer for: one variant for each way
/// `exportPdf` in `App.tsx` calls `export_pdf`.
#[derive(Clone, Copy)]
enum View {
    /// The Document view: paged.js's sheets, on the paper they were laid
    /// out on.
    Document(Option<&'static str>),
    /// The unpaginated Web view, on the paper chosen.
    Web(Option<&'static str>),
    /// Marp slides: a sheet the size of the slide, in inches.
    Slides(f64, f64),
}

/// The two ways `export_pdf` prints on Windows, in the order it tries them.
#[derive(Clone, Copy, Debug)]
enum Route {
    /// `Page.printToPDF`, over the DevTools protocol: with bookmarks.
    DevTools,
    /// `PrintToPdf`: what `export_pdf` falls back to, without them.
    PrintToPdf,
}

/// Load `body` and wait until it has.
fn load(engine: &Engine, body: &str) {
    let (tx, rx) = mpsc::channel();
    let mut token = 0_i64;
    unsafe {
        engine.view.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, _| {
                let _ = tx.send(());
                Ok(())
            })),
            &mut token,
        )
    }
    .expect("the load should be watched");
    unsafe { engine.view.NavigateToString(&HSTRING::from(body)) }
        .expect("the fixture should be handed over");
    webview2_com::wait_with_pump(rx).expect("the fixture should finish loading");
    unsafe { engine.view.remove_NavigationCompleted(token) }.expect("the watch should end");
}

/// Load `body`, print it the way `route` does with what the application asks
/// for `view`, and hand back the PDF's bytes.
fn print_through_webview2(
    engine: &Engine,
    tag: &str,
    body: &str,
    view: View,
    route: Route,
) -> Vec<u8> {
    load(engine, body);
    let (custom_page, paged, paper) = match view {
        View::Document(paper) => (None, true, paper),
        View::Web(paper) => (None, false, paper),
        View::Slides(width, height) => (Some((width, height)), true, None),
    };
    match route {
        Route::DevTools => {
            let params = crate::devtools_pdf::print_params(custom_page, paged, paper);
            let (tx, rx) = mpsc::channel();
            unsafe {
                engine.view.CallDevToolsProtocolMethod(
                    w!("Page.printToPDF"),
                    &HSTRING::from(params.as_str()),
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |result, answer| {
                            let _ = tx.send(result.map(|()| answer));
                            Ok(())
                        },
                    )),
                )
            }
            .expect("the print should start");
            let answer = webview2_com::wait_with_pump(rx)
                .expect("the print should finish")
                .expect("the print should not fail");
            crate::devtools_pdf::pdf_from_answer(&answer)
                .unwrap_or_else(|why| panic!("{tag}: the answer held no PDF: {why:?}"))
        }
        Route::PrintToPdf => {
            let out = std::env::temp_dir().join(format!(
                "meditor-webview2-print-{}-{tag}.pdf",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&out);
            let wide: Vec<u16> = out.as_os_str().encode_wide().chain(Some(0)).collect();
            let environment: ICoreWebView2Environment6 = engine
                .environment
                .cast()
                .expect("an environment that makes print settings");
            let settings = webview2_print_settings(&environment, custom_page, paged, paper)
                .expect("the application's print settings");
            let printer: ICoreWebView2_7 = engine.view.cast().expect("a webview that prints");
            let (tx, rx) = mpsc::channel();
            unsafe {
                printer.PrintToPdf(
                    PCWSTR(wide.as_ptr()),
                    &settings,
                    &PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
                        let _ = tx.send(result.map(|()| succeeded));
                        Ok(())
                    })),
                )
            }
            .expect("the print should start");
            let printed = webview2_com::wait_with_pump(rx)
                .expect("the print should finish")
                .expect("the print should not fail");
            assert!(printed, "{tag}: WebView2 declined to print");
            let bytes = std::fs::read(&out).expect("the printer should have written a file");
            let _ = std::fs::remove_file(&out);
            bytes
        }
    }
}

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

/// The headings, as the PDF's bookmarks: what the DevTools route is for.
///
/// On the shape paged.js gives the Document view — the headings inside page
/// boxes, and a running head in each page's top margin, which is text and
/// must not become a bookmark — with a table of contents whose links work by
/// either route, as they always did through `PrintToPdf`.
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
        "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><style>\
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
}
