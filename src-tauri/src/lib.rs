use tauri::{Emitter, Manager};

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use gtk::prelude::DialogExt;

#[cfg(target_os = "windows")]
use winapi::um::winuser::{MessageBoxW, MB_YESNO, MB_ICONWARNING, MB_SYSTEMMODAL, MB_OK, MB_ICONERROR, IDYES};

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::ptr;

fn files_from_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| std::fs::canonicalize(a).ok())
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn cli_files() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    files_from_args(&args)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut tmp = path.to_path_buf();
    let ext = tmp.extension().map_or_else(String::new, |e| {
        let mut s = String::from(".");
        s.push_str(e.to_string_lossy().as_ref());
        s
    });
    tmp.set_file_name(format!(
        ".{}.tmp{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        ext
    ));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
fn confirm(message: String) -> bool {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let dlg = gtk::MessageDialog::new(
            None::<&gtk::Window>,
            gtk::DialogFlags::MODAL,
            gtk::MessageType::Warning,
            gtk::ButtonsType::YesNo,
            &message,
        );
        let resp = dlg.run();
        return resp == gtk::ResponseType::Yes;
    }
    #[cfg(target_os = "windows")]
    {
        let title: Vec<u16> = OsStr::new("Confirmar").encode_wide().chain(Some(0)).collect();
        let text: Vec<u16> = OsStr::new(&message).encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            MessageBoxW(ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONWARNING | MB_SYSTEMMODAL)
        };
        return result == IDYES;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "display dialog \"{}\" with title \"Confirmar\" buttons {{\"No\", \"Yes\"}} default button \"Yes\" with icon caution",
                    message.replace('"', "\\\"")
                ),
            ])
            .output();
        match output {
            Ok(out) => String::from_utf8_lossy(&out.stdout).contains("Yes"),
            Err(_) => false,
        }
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd",
        target_os = "windows",
        target_os = "macos"
    )))]
    {
        let _ = message;
        false
    }
}

#[tauri::command]
fn alert(message: String) {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let dlg = gtk::MessageDialog::new(
            None::<&gtk::Window>,
            gtk::DialogFlags::MODAL,
            gtk::MessageType::Error,
            gtk::ButtonsType::Ok,
            &message,
        );
        dlg.run();
    }
    #[cfg(target_os = "windows")]
    {
        let title: Vec<u16> = OsStr::new("Error").encode_wide().chain(Some(0)).collect();
        let text: Vec<u16> = OsStr::new(&message).encode_wide().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR | MB_SYSTEMMODAL);
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "display dialog \"{}\" with title \"Error\" buttons {{\"OK\"}} default button \"OK\" with icon stop",
                    message.replace('"', "\\\"")
                ),
            ])
            .output();
    }
}

#[tauri::command]
fn session_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json").to_string_lossy().to_string())
}

#[tauri::command]
fn export_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let url = url::Url::from_file_path(&path)
            .map_err(|_| format!("Ruta inválida para exportar: {path}"))?;
        let uri = url.as_str().to_string();
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

                let page_setup = gtk::PageSetup::new();
                let paper = gtk::PaperSize::new(Some("iso_a4"));
                page_setup.set_paper_size_and_default_margins(&paper);
                page_setup.set_top_margin(25.0, gtk::Unit::Mm);
                page_setup.set_bottom_margin(25.0, gtk::Unit::Mm);
                page_setup.set_left_margin(25.0, gtk::Unit::Mm);
                page_setup.set_right_margin(25.0, gtk::Unit::Mm);

                let op = webkit2gtk::PrintOperation::new(&wv);
                op.set_print_settings(&print_settings);
                op.set_page_setup(&page_setup);
                op.connect_failed(|_, err| {
                    eprintln!("Error exportando PDF: {err}");
                });
                op.print();
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = (window, path);
        Err("Exportar PDF solo está soportado en Linux por ahora".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let files = files_from_args(&args);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            session_path,
            export_pdf,
            cli_files,
            confirm,
            alert
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
