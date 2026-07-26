use tauri::Manager;

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
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
                let uri = format!("file://{}", path);
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
            .map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            session_path,
            export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
