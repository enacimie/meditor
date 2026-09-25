//! A WebView2 of the tests' own, and the two ways `export_pdf` prints with it,
//! for `webview2_print_tests` and `webview2_print_contents_tests` beside it.
//!
//! On one thread per test, like the GTK harness: a WebView2 belongs to the
//! thread that made it, and its callbacks arrive through that thread's message
//! loop.

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
pub(super) struct Engine {
    environment: ICoreWebView2Environment,
    _controller: ICoreWebView2Controller,
    view: ICoreWebView2,
}

pub(super) fn start() -> Engine {
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
pub(super) enum View {
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
pub(super) enum Route {
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
pub(super) fn print_through_webview2(
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
