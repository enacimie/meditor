//! What the operating system does that the webview cannot.
//!
//! Three commands with no tests between them, because each is a call into a
//! toolkit: `alert` is four platform dialogs stacked in one function — GTK,
//! `MessageBoxW`, `osascript` and the mobile plugin — and the other two ask
//! the host what it is and to go away.

use crate::locale::{parse_locale, t};

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use gtk::prelude::{DialogExt as GtkDialogExt, GtkWindowExt};

// The plugin dialog is `alert`'s mobile branch only. document.rs and
// export.rs import it unconditionally because their file pickers need it
// everywhere; copied here without its gate it is unused on all three desktops.
#[cfg(mobile)]
use tauri_plugin_dialog::DialogExt;

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use std::sync::mpsc;

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::ptr;
#[cfg(target_os = "windows")]
use winapi::um::winuser::{MessageBoxW, MB_ICONERROR, MB_OK, MB_SYSTEMMODAL};

/// Which operating system this is, so the interface can stop offering what
/// the backend cannot do.
///
/// PDF export and printing exist on Linux and Windows and nowhere else; on
/// Android they would open a menu entry that fails. The frontend asks once at
/// startup rather than guessing from the user agent, which on Android says
/// "Linux" and would guess wrong.
#[tauri::command]
pub fn platform() -> &'static str {
    std::env::consts::OS
}

/// Force-exit the application. The JS `window.close()`/`window.destroy()`
/// calls are unreliable on Linux/WebKitGTK once an `onCloseRequested` JS
/// listener is registered (Tauri auto-prevent_close's the request and the
/// destroy does not tear the window down), so the close guard finishes by
/// exiting the whole app instead.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Show a native error dialog.
///
/// This is the only channel the frontend has for reporting a failed file
/// operation, so a platform without a branch here does not merely look
/// different — it swallows every save, open and export error in silence.
///
/// Desktop blocks until the dialog is dismissed; mobile does not (see below).
#[tauri::command]
pub fn alert(app: tauri::AppHandle, message: String, locale: Option<String>) {
    // Each desktop branch below talks to its toolkit directly; only the mobile
    // one needs the handle.
    #[cfg(desktop)]
    let _ = &app;

    let loc = parse_locale(locale);
    let title = t(loc, "alert.title");

    // Android and iOS get the plugin's dialog, and get it without blocking:
    // neither platform has a modal that stops its caller, and every call site
    // treats the alert as the last thing it does. The frontend keeps its
    // `await`; it simply resolves once the dialog is on screen.
    #[cfg(mobile)]
    {
        app.dialog()
            .message(message)
            .title(title)
            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
            .show(|_| {});
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let (tx, rx) = mpsc::channel();
        gtk::glib::MainContext::default().invoke(move || {
            let dlg = gtk::MessageDialog::new(
                None::<&gtk::Window>,
                gtk::DialogFlags::MODAL,
                gtk::MessageType::Error,
                gtk::ButtonsType::Ok,
                &message,
            );
            dlg.set_title(&title);
            dlg.run();
            let _ = tx.send(());
        });
        let ctx = gtk::glib::MainContext::default();
        while rx.try_recv().is_err() {
            ctx.iteration(true);
        }
        rx.recv().ok();
    }
    #[cfg(target_os = "windows")]
    {
        let title_wide: Vec<u16> = OsStr::new(&title).encode_wide().chain(Some(0)).collect();
        let text: Vec<u16> = OsStr::new(&message).encode_wide().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                ptr::null_mut(),
                text.as_ptr(),
                title_wide.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SYSTEMMODAL,
            );
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Backslashes first: escaping quotes alone leaves a literal \" pair
        // producing a stray quote once the backslash is interpreted.
        let message = message.replace('\\', "\\\\").replace('"', "\\\"");
        let title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let _ = Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "display dialog \"{}\" with title \"{}\" buttons {{\"OK\"}} default button \"OK\" with icon stop",
                    message, title,
                ),
            ])
            .output();
    }
}
