//! Handing the live document to a printer, or to a file the reader picks.
//!
//! Four commands and three platform implementations of each shape: WebView2
//! on Windows, WebKitGTK on the Unix-likes, and a refusal everywhere else.
//! None of it has tests, because none of it can have them without a printer
//! and a webview -- which is why the decisions it makes about the sheet and
//! the margin live next door in `paper.rs`, where they are tested, and why
//! `gtk_print_tests` went there rather than here.

use crate::locale::{parse_locale, t, tf};
use crate::location::{as_path, normalize_location, write_location, MAX_FILE_BYTES};

// Only the two branches that pick a destination file need this, and neither
// is compiled on a platform without a PDF path. Left ungated it is an unused
// import there, which `-D warnings` makes fatal -- and macOS is the only job
// that would have said so.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
use crate::location::normalize_path;
use std::path::Path;
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
use std::sync::mpsc;
use tauri_plugin_dialog::DialogExt;

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_16, ICoreWebView2_7,
    COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
};
#[cfg(target_os = "windows")]
use webview2_com::PrintToPdfCompletedHandler;
#[cfg(target_os = "windows")]
use windows::core::{Interface, PCWSTR};

const MAX_PDF_BYTES: u64 = 128 * 1024 * 1024;

/// Save raw PDF bytes from the Typst WASM compiler.
#[tauri::command]
pub fn write_pdf_bytes(
    app: tauri::AppHandle,
    pdf_bytes: Vec<u8>,
    default_name: String,
    locale: Option<String>,
) -> Result<(), String> {
    let loc = parse_locale(locale);
    let selected = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();
    let location = match selected {
        Some(location) => location,
        None => return Ok(()),
    };
    let location = normalize_location(loc, location)?;
    if let Some(parent) = as_path(&location).and_then(Path::parent) {
        if !parent.exists() {
            return Err(t(loc, "pdf.directoryMissing"));
        }
    }
    if pdf_bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(tf(
            loc,
            "file.contentTooLarge",
            &(MAX_PDF_BYTES / (1024 * 1024)).to_string(),
        ));
    }
    // Validate before touching the selected destination so invalid output
    // can never overwrite an existing PDF.
    if pdf_bytes.len() < 5 || &pdf_bytes[..5] != b"%PDF-" {
        return Err(t(loc, "pdf.invalidPdf"));
    }
    write_location(&app, loc, &location, &pdf_bytes)
}

/// Save a self-contained HTML export produced by the frontend.
///
/// Returns whether a file was written: cancelling the dialog is a normal
/// outcome, not an error, and the caller must not claim success for it.
#[tauri::command]
pub fn write_html_file(
    app: tauri::AppHandle,
    html: String,
    default_name: String,
    locale: Option<String>,
) -> Result<bool, String> {
    let loc = parse_locale(locale);
    let selected = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("HTML", &["html"])
        .blocking_save_file();
    let location = match selected {
        Some(location) => location,
        None => return Ok(false),
    };
    let location = normalize_location(loc, location)?;
    if let Some(parent) = as_path(&location).and_then(Path::parent) {
        if !parent.exists() {
            return Err(t(loc, "file.directoryMissing"));
        }
    }
    if html.len() as u64 > MAX_FILE_BYTES {
        return Err(tf(
            loc,
            "file.contentTooLarge",
            &(MAX_FILE_BYTES / (1024 * 1024)).to_string(),
        ));
    }
    write_location(&app, loc, &location, html.as_bytes())?;
    Ok(true)
}

/// Open the native print dialog for the live webview.
///
/// Unlike `export_pdf`, nothing is saved to a file: the document is handed to
/// the OS print dialog so the user can pick a printer (or "Save as PDF").
/// Print what is on screen.
///
/// `paged` says whether the view already carries its own page boxes — the
/// paginated Document view and a Marp deck do. It reaches the GTK path only:
/// Windows opens WebView2's print dialog, where the margins are the person's
/// to choose, and macOS has no print path at all.
#[tauri::command]
pub async fn print_document(
    window: tauri::WebviewWindow,
    locale: Option<String>,
    paged: Option<bool>,
    paper: Option<String>,
) -> Result<(), String> {
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd",
        target_os = "windows"
    )))]
    {
        let _ = (&window, paged, &paper);
        Err(t(parse_locale(locale), "pdf.notSupported"))
    }

    #[cfg(target_os = "windows")]
    {
        // `paged` and `paper` go unread here on purpose: this opens WebView2's
        // own print dialog, and both the margins and the sheet in it belong to
        // whoever is standing at it.
        let _ = (&locale, paged, &paper);
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        window
            .with_webview(move |webview| {
                let result = (|| -> Result<(), String> {
                    let core = unsafe { webview.controller().CoreWebView2() }
                        .map_err(|e| e.to_string())?;
                    let printer: ICoreWebView2_16 = core.cast().map_err(|e| e.to_string())?;
                    unsafe { printer.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER) }
                        .map_err(|e| e.to_string())
                })();
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        rx.recv().unwrap_or(Ok(()))?;
        Ok(())
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let _ = &locale;
        window
            .with_webview(move |webview| {
                use webkit2gtk::{PrintOperationExt, SettingsExt, WebViewExt};
                let wv = webview.inner();
                if let Some(settings) = wv.settings() {
                    settings.set_print_backgrounds(true);
                }
                let print_settings = gtk::PrintSettings::new();
                let page_setup =
                    crate::paper::gtk_page_setup(None, paged.unwrap_or(true), paper.as_deref());
                let operation = webkit2gtk::PrintOperation::new(&wv);
                operation.set_print_settings(&print_settings);
                operation.set_page_setup(&page_setup);

                // `print()` is asynchronous: hold the operation until WebKitGTK
                // emits `finished` or `failed`, then drop it to avoid cycles.
                let keepalive = std::rc::Rc::new(std::cell::RefCell::new(Some(operation.clone())));
                let keepalive_failed = std::rc::Rc::clone(&keepalive);
                let keepalive_finished = std::rc::Rc::clone(&keepalive);
                operation.connect_failed(move |_, _| {
                    keepalive_failed.borrow_mut().take();
                });
                operation.connect_finished(move |_| {
                    keepalive_finished.borrow_mut().take();
                });
                operation.print();
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Print the live webview to a PDF the user picks.
///
/// `paged` is true when the preview is the paginated document view, which lays
/// out its own A4 pages complete with margins. Asking the printer for margins
/// on top of that insets every page twice and spills each one onto a second
/// sheet, so the export gains a blank page for every real one.
/*
 * Eight arguments, and clippy is right that it is a lot.
 *
 * They are not a parameter list, though: they are this command's IPC surface,
 * the object the frontend sends. Folding four of them into a `PageRequest`
 * struct would read better here and would change the shape of the message —
 * `{ page: { paged, width, height, paper } }` — for one caller and one command.
 * Worth doing when a second command wants the same group; not worth doing to
 * quiet a lint.
 */
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    default_name: String,
    locale: Option<String>,
    paged: Option<bool>,
    page_width: Option<f64>,
    page_height: Option<f64>,
    paper: Option<String>,
) -> Result<(), String> {
    let loc = parse_locale(locale);
    // A caller that supplies both dimensions wants exactly that page — a Marp
    // slide — instead of the A4 the two platform paths otherwise impose.
    let custom_page = match (page_width, page_height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => Some((w, h)),
        _ => None,
    };

    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd",
        target_os = "windows"
    )))]
    {
        let _ = (app, window, default_name, loc, paged, custom_page, paper);
        Err(t(loc, "pdf.notSupported"))
    }

    /*
     * Windows. WebView2 can print the page it is showing straight to a file,
     * so the shape is the same as the GTK path below: pick a destination, hand
     * it to the webview, wait for the completion callback off the main thread,
     * and then check what actually landed on disk.
     *
     * `with_webview` dispatches to the main thread and returns, so the wait
     * must not happen here — blocking the main thread would stop the message
     * loop the callback needs.
     */
    #[cfg(target_os = "windows")]
    {
        // WebView2 measures in inches. A4 with the same 25 mm margins the GTK
        // path sets, so both platforms produce the same page.
        // The sheet, from the same table the GTK path reads, so the two
        // platforms cannot be asked for different paper.
        let (page_w, page_h) = custom_page.unwrap_or(crate::paper::paper_sheet(paper.as_deref()).0);
        // WebView2 measures in inches; the decision itself is shared with the
        // GTK path so the two cannot drift again.
        let margin =
            crate::paper::pdf_margin_mm(custom_page.is_some(), paged.unwrap_or(true)) / 25.4;

        let path = {
            let selected = app
                .dialog()
                .file()
                .set_file_name(default_name)
                .add_filter("PDF", &["pdf"])
                .blocking_save_file();
            match selected {
                Some(path) => path.into_path().map_err(|e| e.to_string())?,
                None => return Ok(()),
            }
        };
        let path = normalize_path(loc, &path)?;
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                return Err(t(loc, "pdf.directoryMissing"));
            }
        }

        // PrintToPdf takes a null-terminated wide string.
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();

        let (result_tx, result_rx) = mpsc::channel::<Result<(), String>>();
        let setup_tx = result_tx.clone();
        window
            .with_webview(move |webview| {
                let started = (|| -> Result<(), String> {
                    let core = unsafe { webview.controller().CoreWebView2() }
                        .map_err(|e| e.to_string())?;
                    let printer: ICoreWebView2_7 = core.cast().map_err(|e| e.to_string())?;
                    let environment: ICoreWebView2Environment6 =
                        webview.environment().cast().map_err(|e| e.to_string())?;
                    let settings =
                        unsafe { environment.CreatePrintSettings() }.map_err(|e| e.to_string())?;
                    unsafe {
                        settings.SetPageWidth(page_w).map_err(|e| e.to_string())?;
                        settings.SetPageHeight(page_h).map_err(|e| e.to_string())?;
                        settings.SetMarginTop(margin).map_err(|e| e.to_string())?;
                        settings
                            .SetMarginBottom(margin)
                            .map_err(|e| e.to_string())?;
                        settings.SetMarginLeft(margin).map_err(|e| e.to_string())?;
                        settings.SetMarginRight(margin).map_err(|e| e.to_string())?;
                        settings
                            .SetShouldPrintBackgrounds(true)
                            .map_err(|e| e.to_string())?;
                    }
                    let done_tx = result_tx;
                    let handler =
                        PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
                            let outcome = match result {
                                Err(error) => Err(error.to_string()),
                                Ok(()) if succeeded => Ok(()),
                                // WebView2 declined without raising an error.
                                Ok(()) => Err(t(loc, "pdf.invalidPdf")),
                            };
                            let _ = done_tx.send(outcome);
                            Ok(())
                        }));
                    unsafe { printer.PrintToPdf(PCWSTR(wide.as_ptr()), &settings, &handler) }
                        .map_err(|e| e.to_string())
                })();
                if let Err(error) = started {
                    let _ = setup_tx.send(Err(error));
                }
            })
            .map_err(|e| e.to_string())?;

        let completion = tauri::async_runtime::spawn_blocking(move || {
            result_rx.recv_timeout(Duration::from_secs(60))
        })
        .await
        .map_err(|error| tf(loc, "pdf.waitFailed", &error.to_string()))?;
        completion.map_err(|_| t(loc, "pdf.timeout"))??;

        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() == 0 {
            return Err(t(loc, "pdf.emptyFile"));
        }
        let mut header = [0_u8; 5];
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        use std::io::Read;
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        if &header != b"%PDF-" {
            return Err(t(loc, "pdf.invalidPdf"));
        }
        Ok(())
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let path = {
            let selected = app
                .dialog()
                .file()
                .set_file_name(default_name)
                .add_filter("PDF", &["pdf"])
                .blocking_save_file();
            match selected {
                Some(path) => path.into_path().map_err(|e| e.to_string())?,
                None => return Ok(()),
            }
        };
        let path = normalize_path(loc, &path)?;
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                return Err(t(loc, "pdf.directoryMissing"));
            }
        }
        /*
         * The double margin this used to warn about is gone. The page setup
         * below asks `pdf_margin_mm` for its margin — the same rule Windows
         * asks — so a document that already carries 2.5 cm inside every
         * `.pagedjs_page` is not margined a second time around them. What was
         * measured on Windows before that rule existed, 7 preview pages
         * arriving as 9, is what its unit tests now hold in place.
         *
         * The sheet itself is still unseen. Nobody on the project has run this
         * path and looked at the PDF that comes out: WebKitGTK is on no
         * machine here, and CI compiles this branch and starts the binary
         * without ever printing through it.
         */
        let url = url::Url::from_file_path(&path).map_err(|_| t(loc, "pdf.invalidPath"))?;
        let uri = url.as_str().to_string();
        let (result_tx, result_rx) = mpsc::channel::<Result<(), String>>();
        window
            .with_webview(move |webview| {
                use webkit2gtk::{PrintOperationExt, SettingsExt, WebViewExt};
                let wv = webview.inner();
                if let Some(settings) = wv.settings() {
                    settings.set_print_backgrounds(true);
                }
                let print_settings = gtk::PrintSettings::new();
                let printer = glib::dgettext(Some("gtk30"), "Print to File");
                print_settings.set_printer(&printer);
                print_settings.set("output-file-format", Some("pdf"));
                print_settings.set("output-uri", Some(uri.as_str()));
                let page_setup = crate::paper::gtk_page_setup(
                    custom_page,
                    paged.unwrap_or(true),
                    paper.as_deref(),
                );
                let operation = webkit2gtk::PrintOperation::new(&wv);
                operation.set_print_settings(&print_settings);
                operation.set_page_setup(&page_setup);

                // `print()` is asynchronous: hold the operation until WebKitGTK
                // emits `finished` or `failed`, then drop it to avoid cycles.
                let keepalive = std::rc::Rc::new(std::cell::RefCell::new(Some(operation.clone())));
                let keepalive_failed = std::rc::Rc::clone(&keepalive);
                let keepalive_finished = std::rc::Rc::clone(&keepalive);
                let failed_tx = result_tx.clone();
                operation.connect_failed(move |_, err| {
                    keepalive_failed.borrow_mut().take();
                    let _ = failed_tx.send(Err(err.to_string()));
                });
                operation.connect_finished(move |_| {
                    keepalive_finished.borrow_mut().take();
                    let _ = result_tx.send(Ok(()));
                });
                operation.print();
            })
            .map_err(|e| e.to_string())?;
        let loc_clone = loc;
        let completion = tauri::async_runtime::spawn_blocking(move || {
            result_rx.recv_timeout(Duration::from_secs(60))
        })
        .await
        .map_err(|error| tf(loc_clone, "pdf.waitFailed", &error.to_string()))?;
        let result = completion.map_err(|_| t(loc, "pdf.timeout"))?;
        result?;
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() == 0 {
            return Err(t(loc, "pdf.emptyFile"));
        }
        let mut header = [0_u8; 5];
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        use std::io::Read;
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        if &header != b"%PDF-" {
            return Err(t(loc, "pdf.invalidPdf"));
        }
        Ok(())
    }
}
