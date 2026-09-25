//! The sheet a page is laid out on, and the margin left around it.
//!
//! Three small decisions that both print paths ask the same questions of, so
//! that Windows and GTK cannot answer them differently again -- which they
//! did, and it cost every exported PDF a blank page after every real one.
//!
//! `pdf_margin_mm` and `paper_sheet` return plain numbers and a name, so they
//! compile wherever there is a PDF path at all. `gtk_page_setup` returns a
//! `gtk::PageSetup`, and the `gtk` crate exists only on the five Unix-likes,
//! so its gate is one target shorter. The difference is load-bearing: merging
//! the two lists breaks Windows. `webview2_print_settings` is its Windows
//! counterpart, gated to Windows alone, where `webview2-com` is.

#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2PrintSettings,
};

/// The margin to leave around an exported page, in millimetres.
///
/// Zero for anything that arrives already laid out. A Marp slide brings its
/// own page, and the paginated Document view is a stack of A4-sized sheets
/// with their 2.5 cm already inside them — `paged.css` never reaches the
/// document, so what the print engine is handed is those sheets, not a page
/// box it should margin. Adding a printer margin there does it twice and asks
/// an A4 sheet to fit inside less than A4. Only the plain, unpaginated web
/// view is a document that still needs margins of its own.
///
/// Shared because the two platform paths each decided this for themselves and
/// drifted: Windows honoured `paged` and Linux never read it, so the same
/// export came out with 25 mm of extra margin on one platform and not the
/// other — while the comment on the Windows side said they matched.
///
/// The 25 mm is fixed on purpose, and is not the page margin the reader chose.
/// That one belongs to the Document view, which carries it inside each sheet;
/// the web view is a different layout with no pages in it, and giving it the
/// same number would be borrowing a measurement from a page it does not have.
/// So an export from the web view uses the paper that was chosen and a margin
/// that was not — half of the geometry travelling, which is worth knowing
/// rather than discovering.
///
/// Limited to the platforms that have a PDF path at all — the same list the
/// two branches of `export_pdf` are written against. macOS and Android have
/// neither and answer `pdf.notSupported`, where an ungated helper is dead code
/// and `clippy -D warnings` rightly says so.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
pub fn pdf_margin_mm(custom_page: bool, paged: bool) -> f64 {
    if custom_page || paged {
        0.0
    } else {
        25.0
    }
}

/// The sheet a paper id names: its size in inches, and what GTK calls it.
///
/// One table, so the size the document was laid out on and the size the printer
/// is asked for cannot disagree. They must not: a page composed for one paper
/// and printed on another does not shift, it spills, and every page takes two —
/// the shape of the defect #89 measured on this very path.
///
/// Anything unknown is A4, the same fallback the frontend applies to a stored
/// preference it does not recognise: a build that has never heard of a paper
/// prints on the one it knows rather than refusing.
///
/// Gated like `pdf_margin_mm` above, and for the same reason. macOS and Android
/// have no PDF path to call it from, and there `clippy -D warnings` is right
/// that it is dead code — which is how this was found, on the one platform this
/// project cannot build locally.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
pub fn paper_sheet(paper: Option<&str>) -> ((f64, f64), &'static str) {
    match paper {
        Some("letter") => ((8.5, 11.0), "na_letter"),
        _ => ((8.267_716_5, 11.692_913_4), "iso_a4"),
    }
}

/// The page a GTK print operation lays out on.
///
/// Shared by `export_pdf` and `print_document` for the reason `pdf_margin_mm`
/// is shared: these two wrote the same page setup twice and drifted apart,
/// and the drift was the bug. A slide asks for its own size in inches;
/// everything else is A4, and the margin is whatever the rule says.
///
/// GTK must be up before this is called — it is, inside `with_webview`, and
/// the test below calls `gtk::init` itself.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub fn gtk_page_setup(
    custom_page: Option<(f64, f64)>,
    paged: bool,
    paper_id: Option<&str>,
) -> gtk::PageSetup {
    let page_setup = gtk::PageSetup::new();
    let paper = match custom_page {
        Some((w, h)) => gtk::PaperSize::new_custom("marp-slide", "Slide", w, h, gtk::Unit::Inch),
        None => gtk::PaperSize::new(Some(paper_sheet(paper_id).1)),
    };
    page_setup.set_paper_size_and_default_margins(&paper);
    let margin = pdf_margin_mm(custom_page.is_some(), paged);
    page_setup.set_top_margin(margin, gtk::Unit::Mm);
    page_setup.set_bottom_margin(margin, gtk::Unit::Mm);
    page_setup.set_left_margin(margin, gtk::Unit::Mm);
    page_setup.set_right_margin(margin, gtk::Unit::Mm);
    page_setup
}

/// The sheet and the margin WebView2 is asked for, in its unit: inches.
///
/// Both ways this application prints through WebView2 read them — the
/// DevTools protocol's `Page.printToPDF`, and `PrintToPdf` when that one will
/// not answer — so the two cannot be asked for different paper.
#[cfg(target_os = "windows")]
pub fn webview2_sheet_inches(
    custom_page: Option<(f64, f64)>,
    paged: bool,
    paper_id: Option<&str>,
) -> ((f64, f64), f64) {
    let sheet = custom_page.unwrap_or(paper_sheet(paper_id).0);
    let margin = pdf_margin_mm(custom_page.is_some(), paged) / 25.4;
    (sheet, margin)
}

/// The settings WebView2's `PrintToPdf` prints a PDF with: the sheet in
/// inches, the margin the rule gives, and backgrounds.
///
/// The Windows counterpart of `gtk_page_setup`, and shared for the same
/// reason: `export_pdf` falls back to it when the DevTools protocol will not
/// print, and the test in `paper/webview2_print_tests.rs` prints a real
/// WebView2 with it and counts what comes out, so the settings that test
/// measures are the ones the application uses.
///
/// Only the sheet's size always holds. A page with an `@page` rule of its own
/// keeps that rule's orientation and margin, whatever these settings say —
/// measured on 2026-09-25 — and every paginated document has one, written by
/// paged.js, as every slide does. So on this engine the margin only reaches
/// the unpaginated Web view; the zero the rule gives everything else is what
/// those pages ask for anyway.
#[cfg(target_os = "windows")]
pub fn webview2_print_settings(
    environment: &ICoreWebView2Environment6,
    custom_page: Option<(f64, f64)>,
    paged: bool,
    paper_id: Option<&str>,
) -> windows::core::Result<ICoreWebView2PrintSettings> {
    let ((width, height), margin) = webview2_sheet_inches(custom_page, paged, paper_id);
    let settings = unsafe { environment.CreatePrintSettings() }?;
    unsafe {
        settings.SetPageWidth(width)?;
        settings.SetPageHeight(height)?;
        settings.SetMarginTop(margin)?;
        settings.SetMarginBottom(margin)?;
        settings.SetMarginLeft(margin)?;
        settings.SetMarginRight(margin)?;
        settings.SetShouldPrintBackgrounds(true)?;
    }
    Ok(settings)
}

/*
 * Gated as a module rather than test by test.
 *
 * Every test here calls `pdf_margin_mm` or `paper_sheet`, and neither
 * exists on a platform with no PDF path — macOS among them. Six copies of
 * the same attribute said that six times and still left `use super::*`
 * unused on macOS, which `-D warnings` makes fatal; said once, here, a test
 * added later cannot forget it.
 */
#[cfg(test)]
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
mod tests {
    use super::*;

    /*
     * The margin decision, which is the whole of the Linux double-margin bug.
     *
     * It cannot be checked by printing anything from here — WebKitGTK is not
     * on this platform, and the branch that used to get it wrong only compiles
     * on Linux. What is testable, and what actually broke, is the rule itself:
     * both platforms now ask the same question and must get the same answer.
     */
    #[test]
    fn a_paginated_document_is_not_margined_again() {
        // The default, and the case that was wrong on Linux: the sheets that
        // paged.js produced already contain their 2.5 cm.
        assert_eq!(pdf_margin_mm(false, true), 0.0);
    }

    #[test]
    fn a_slide_brings_its_own_page() {
        assert_eq!(pdf_margin_mm(true, true), 0.0);
        assert_eq!(pdf_margin_mm(true, false), 0.0);
    }

    #[test]
    fn the_plain_web_view_still_gets_real_margins() {
        // The one case that needs them: an unpaginated document is a run of
        // text with nothing around it.
        assert_eq!(pdf_margin_mm(false, false), 25.0);
    }

    #[test]
    fn a4_is_what_an_unknown_paper_falls_back_to() {
        // A build that has never heard of a paper prints on the one it knows,
        // rather than refusing. The same fallback the frontend applies to a
        // stored preference it does not recognise.
        let ((w, h), name) = paper_sheet(None);
        assert_eq!(name, "iso_a4");
        assert!((w - 8.27).abs() < 0.01, "A4 is 210 mm wide, got {w} in");
        assert!((h - 11.69).abs() < 0.01, "A4 is 297 mm tall, got {h} in");
        assert_eq!(paper_sheet(Some("foolscap")).1, "iso_a4");
        assert_eq!(paper_sheet(Some("")).1, "iso_a4");
    }

    #[test]
    fn letter_is_eight_and_a_half_by_eleven() {
        let ((w, h), name) = paper_sheet(Some("letter"));
        assert_eq!(name, "na_letter");
        assert_eq!(w, 8.5);
        assert_eq!(h, 11.0);
    }

    #[test]
    fn the_two_papers_are_not_the_same_sheet() {
        // The assertion that matters, because the failure it guards is a page
        // laid out for one and printed on the other: Letter is wider and
        // shorter, so every page of an A4 document spills onto a second sheet.
        let (a4, _) = paper_sheet(Some("a4"));
        let (letter, _) = paper_sheet(Some("letter"));
        assert!(letter.0 > a4.0, "Letter is wider");
        assert!(letter.1 < a4.1, "and shorter");
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "windows")))]
mod print_fixture;

/// Printing a paginated document through WebKitGTK, for real.
///
/// Everything else about this path is checked by reasoning: `pdf_margin_mm`
/// has unit tests, `gtk_page_setup` is shared so its two callers cannot drift,
/// and CI compiles the branch. None of that has ever produced a PDF, and the
/// defect this test exists for is invisible to all of it — WebKitGTK put the
/// seven-page sample onto fourteen sheets, a nearly blank one after every real
/// one, on every version of this code that has shipped.
///
/// So: build the shape paged.js hands the print engine, style it with the
/// application's own print stylesheet, print it, and count the pages that come
/// out. `include_str!` is the point of the design — the fix lives in
/// `print.css`, so the test has to read `print.css` rather than a copy of what
/// it says.
///
/// `#[ignore]` because it needs a display and a GTK main loop, which
/// `cargo test --lib` has on no other platform and is not asked to arrange.
/// CI runs it as its own Linux-only step:
///
/// ```sh
/// LC_ALL=C GTK_PRINT_BACKENDS=file xvfb-run -a \
///   cargo test --lib -- --ignored --test-threads=1 gtk_print
/// ```
///
/// `--test-threads=1` is not tidiness: gtk-rs pins "the main thread" to
/// whichever thread calls `init` first, and every GTK call here has to be on
/// that one.
#[cfg(all(test, target_os = "linux"))]
mod gtk_print_tests {
    use super::print_fixture::{first_media_box, paged_document, paged_document_on};
    use super::*;
    use gtk::prelude::*;
    use std::cell::Cell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};
    use webkit2gtk::{LoadEvent, PrintOperationExt, WebViewExt};

    /// Pump the GTK main loop until `done`, or give up.
    ///
    /// `recv_timeout` on a channel is what the application does, because there
    /// the loop is somebody else's job. Here that would deadlock: nothing else
    /// is running the loop the load and the print both need.
    fn pump_until(done: &Rc<Cell<bool>>, limit: Duration) -> bool {
        let deadline = Instant::now() + limit;
        while !done.get() && Instant::now() < deadline {
            gtk::main_iteration_do(false);
            std::thread::sleep(Duration::from_millis(5));
        }
        done.get()
    }

    /// How many pages a cairo-written PDF has.
    ///
    /// One `/MediaBox` per page object, and cairo writes its dictionaries
    /// uncompressed, so this is a count rather than a guess.
    fn page_count(pdf: &[u8]) -> usize {
        pdf.windows(9).filter(|w| *w == b"/MediaBox").count()
    }

    /// Print `body` through the page setup the application uses, and hand back
    /// the PDF bytes.
    fn print_through_webkit(tag: &str, body: &str) -> Vec<u8> {
        print_through_webkit_on(tag, body, None)
    }

    fn print_through_webkit_on(tag: &str, body: &str, paper: Option<&str>) -> Vec<u8> {
        gtk::init().expect("GTK should start; this test needs a display");

        let out = std::env::temp_dir().join(format!(
            "meditor-gtk-print-{}-{tag}.pdf",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&out);
        let uri = url::Url::from_file_path(&out).expect("a temp path is a valid file URL");

        let view = webkit2gtk::WebView::new();
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.add(&view);
        window.show_all();

        let loaded = Rc::new(Cell::new(false));
        let loaded_signal = Rc::clone(&loaded);
        view.connect_load_changed(move |_, event| {
            if event == LoadEvent::Finished {
                loaded_signal.set(true);
            }
        });
        view.load_html(body, None);
        assert!(
            pump_until(&loaded, Duration::from_secs(30)),
            "the fixture should finish loading",
        );

        let settings = gtk::PrintSettings::new();
        // Never consult CUPS: there may be no printer at all, and the point is
        // the file. The application asks for this printer by its translated
        // name; the step that runs this test sets LC_ALL=C so the name here is
        // the untranslated one.
        settings.set_printer("Print to File");
        settings.set("output-file-format", Some("pdf"));
        settings.set("output-uri", Some(uri.as_str()));

        let operation = webkit2gtk::PrintOperation::new(&view);
        operation.set_print_settings(&settings);
        operation.set_page_setup(&gtk_page_setup(None, true, paper));

        let settled = Rc::new(Cell::new(false));
        let failure = Rc::new(Cell::new(false));
        let settled_on_finish = Rc::clone(&settled);
        let settled_on_failure = Rc::clone(&settled);
        let failure_flag = Rc::clone(&failure);
        operation.connect_finished(move |_| settled_on_finish.set(true));
        operation.connect_failed(move |_, error| {
            eprintln!("the print operation failed: {error}");
            failure_flag.set(true);
            settled_on_failure.set(true);
        });
        operation.print();

        assert!(
            pump_until(&settled, Duration::from_secs(60)),
            "the print operation should finish or fail, not hang",
        );
        assert!(!failure.get(), "the print operation reported a failure");

        let bytes = std::fs::read(&out).expect("the printer should have written a file");
        let _ = std::fs::remove_file(&out);
        bytes
    }

    /// Every claim about this print path, in one test, on one thread.
    ///
    /// One test and not three, and that is not tidiness. gtk-rs pins "the main
    /// thread" to whichever thread calls `init` first, and libtest gives each
    /// test function a thread of its own even under `--test-threads=1`: the
    /// second test to run dies with "Attempted to initialize GTK from two
    /// different threads" before it asserts anything. Measured, when this was
    /// three tests.
    ///
    /// So the phases are numbered in the failure messages instead, which is
    /// what a test name would have given.
    #[test]
    #[ignore = "needs a display and a GTK main loop; CI runs it on Linux only"]
    fn gtk_print_lays_each_paper_out_one_sheet_per_page() {
        // ── A4, the paper this project has always used ────────────────────
        let pdf = print_through_webkit("a4", &paged_document(3));
        assert_eq!(&pdf[..5], b"%PDF-", "A4: the printer should write a PDF");
        assert_eq!(
            page_count(&pdf),
            3,
            "A4: three paged.js pages should print as three sheets; six means \
             each one spilled onto a blank second sheet, which is what this \
             engine does to a page box exactly as tall as the paper",
        );
        let (width, height) = first_media_box(&pdf).expect("A4: a page should declare its size");
        assert!(
            (width - 595.0).abs() < 3.0 && (height - 842.0).abs() < 3.0,
            "A4: the sheet should be 595 x 842 points, got {width} x {height}",
        );

        // ── Letter, laid out and printed on the same paper ────────────────
        let pdf = print_through_webkit_on(
            "letter",
            &paged_document_on(3, "letter", "215.9mm", "279.4mm"),
            Some("letter"),
        );
        assert_eq!(
            page_count(&pdf),
            3,
            "Letter: three sheets should print as three pages, not six",
        );
        let (width, height) =
            first_media_box(&pdf).expect("Letter: a page should declare its size");
        assert!(
            (width - 612.0).abs() < 3.0 && (height - 792.0).abs() < 3.0,
            "Letter: the sheet should be 612 x 792 points, got {width} x {height}",
        );

        /*
         * ── And the mismatch this pairing exists to prevent ───────────────
         *
         * Not something the application can produce: it is the claim the rest
         * of the design rests on, that sending a layout to the wrong paper is
         * not cosmetic. A Letter sheet is 17 mm shorter than A4, so it fits an
         * A4 page — the spill goes the other way, and that is the direction
         * worth pinning, because it is the one a wrong default would cause.
         */
        let pdf = print_through_webkit_on("a4-on-letter", &paged_document(3), Some("letter"));
        assert!(
            page_count(&pdf) > 3,
            "an A4 layout on a Letter printer should spill onto more sheets; if \
             it does not, threading the paper through to the printer buys \
             nothing and half of this can go",
        );
    }
}

#[cfg(all(test, target_os = "windows"))]
mod skia_pdf;

#[cfg(all(test, target_os = "windows"))]
mod webview2_print_tests;
