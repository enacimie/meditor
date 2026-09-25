//! The two ways `export_pdf` prints a PDF on Windows: the DevTools
//! protocol's `Page.printToPDF`, which it tries first because it writes the
//! headings as bookmarks, and WebView2's `PrintToPdf`, which it falls back
//! to. Each dispatches to the webview's thread and waits for the answer on a
//! blocking one, as the command itself cannot.

use crate::locale::{t, tf, Locale};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, PrintToPdfCompletedHandler};
use windows::core::{w, Interface, HSTRING, PCWSTR};

/// Ask the webview for the page as a PDF over the DevTools protocol, and read
/// the PDF out of the answer.
///
/// Every failure here is only a reason to print the other way, so it comes
/// back as text for the log, not as a message for the reader. `with_webview`
/// dispatches to the main thread and returns, so the wait happens on a
/// blocking thread: blocking the main thread would stop the message loop the
/// answer arrives through.
pub(super) async fn print_through_devtools(
    window: &tauri::WebviewWindow,
    params: String,
) -> Result<Vec<u8>, String> {
    let (answer_tx, answer_rx) = mpsc::channel::<Result<String, String>>();
    let setup_tx = answer_tx.clone();
    window
        .with_webview(move |webview| {
            let started = (|| -> Result<(), String> {
                let core =
                    unsafe { webview.controller().CoreWebView2() }.map_err(|e| e.to_string())?;
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, answer| {
                        let _ = answer_tx.send(result.map(|()| answer).map_err(|e| e.to_string()));
                        Ok(())
                    },
                ));
                unsafe {
                    core.CallDevToolsProtocolMethod(
                        w!("Page.printToPDF"),
                        &HSTRING::from(params.as_str()),
                        &handler,
                    )
                }
                .map_err(|e| e.to_string())
            })();
            if let Err(error) = started {
                let _ = setup_tx.send(Err(error));
            }
        })
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let answer = answer_rx
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| "no answer within a minute".to_string())??;
        crate::devtools_pdf::pdf_from_answer(&answer).map_err(|why| format!("{why:?}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Print the webview straight to `path` with `PrintToPdf`, the way this always
/// printed: the same sheet and margin as the DevTools route, and no outline,
/// which `PrintToPdf` has no setting for.
pub(super) async fn print_to_pdf(
    window: &tauri::WebviewWindow,
    path: &Path,
    custom_page: Option<(f64, f64)>,
    paged: bool,
    paper: Option<&str>,
    loc: Locale,
) -> Result<(), String> {
    // PrintToPdf takes a null-terminated wide string.
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let paper = paper.map(str::to_owned);
    let (result_tx, result_rx) = mpsc::channel::<Result<(), String>>();
    let setup_tx = result_tx.clone();
    window
        .with_webview(move |webview| {
            let started = (|| -> Result<(), String> {
                let core =
                    unsafe { webview.controller().CoreWebView2() }.map_err(|e| e.to_string())?;
                let printer: ICoreWebView2_7 = core.cast().map_err(|e| e.to_string())?;
                let environment: ICoreWebView2Environment6 =
                    webview.environment().cast().map_err(|e| e.to_string())?;
                // The sheet, the margin and the backgrounds, from the same
                // table and rule the GTK path reads, and the settings that
                // paper/webview2_print_tests.rs prints a real WebView2 with.
                let settings = crate::paper::webview2_print_settings(
                    &environment,
                    custom_page,
                    paged,
                    paper.as_deref(),
                )
                .map_err(|e| e.to_string())?;
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
    completion.map_err(|_| t(loc, "pdf.timeout"))?
}
