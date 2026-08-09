#[cfg(target_os = "linux")]
use std::{cell::RefCell, env, fs, path::PathBuf, rc::Rc, time::Duration};

#[cfg(target_os = "linux")]
use gtk::prelude::*;
#[cfg(target_os = "linux")]
use url::Url;
#[cfg(target_os = "linux")]
use webkit2gtk::{LoadEvent, PrintOperation, PrintOperationExt, WebView, WebViewExt};

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("print_probe solo está disponible en Linux con WebKitGTK");
}

#[cfg(target_os = "linux")]
fn main() -> Result<(), String> {
    gtk::init().map_err(|error| error.to_string())?;

    let output = env::args()
        .nth(1)
        .ok_or_else(|| "Uso: cargo run --bin print_probe -- /ruta/salida.pdf".to_string())?;
    let output = PathBuf::from(output);
    let output = output.canonicalize().or_else(|_| {
        let parent = output
            .parent()
            .ok_or_else(|| "La ruta no tiene carpeta padre".to_string())?;
        Ok::<PathBuf, String>(
            parent
                .canonicalize()
                .map_err(|error| error.to_string())?
                .join(
                    output
                        .file_name()
                        .ok_or_else(|| "La ruta no tiene nombre de archivo".to_string())?,
                ),
        )
    })?;
    let parent = output
        .parent()
        .ok_or_else(|| "La ruta no tiene carpeta padre".to_string())?;
    if !parent.is_dir() {
        return Err(format!("La carpeta no existe: {}", parent.display()));
    }
    let uri = Url::from_file_path(&output)
        .map_err(|_| format!("Ruta inválida: {}", output.display()))?
        .to_string();
    if output.exists() {
        return Err(format!(
            "La salida ya existe; usa una ruta temporal nueva: {}",
            output.display()
        ));
    }

    let main_loop = glib::MainLoop::new(None, false);
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_default_size(900, 700);
    let webview = WebView::new();
    window.add(&webview);
    window.show_all();

    let result = Rc::new(RefCell::new(None::<Result<(), String>>));
    let result_for_load = Rc::clone(&result);
    let loop_for_load = main_loop.clone();
    let output_uri = uri.clone();
    let started = Rc::new(RefCell::new(false));
    let started_for_load = Rc::clone(&started);

    webview.connect_load_changed(move |webview, event| {
        if event != LoadEvent::Finished || *started_for_load.borrow() {
            return;
        }
        *started_for_load.borrow_mut() = true;

        let print_settings = gtk::PrintSettings::new();
        let printer = glib::dgettext(Some("gtk30"), "Print to File");
        print_settings.set_printer(&printer);
        print_settings.set("output-file-format", Some("pdf"));
        print_settings.set("output-uri", Some(output_uri.as_str()));

        let page_setup = gtk::PageSetup::new();
        let paper = gtk::PaperSize::new(Some("iso_a4"));
        page_setup.set_paper_size_and_default_margins(&paper);
        page_setup.set_top_margin(25.0, gtk::Unit::Mm);
        page_setup.set_bottom_margin(25.0, gtk::Unit::Mm);
        page_setup.set_left_margin(25.0, gtk::Unit::Mm);
        page_setup.set_right_margin(25.0, gtk::Unit::Mm);

        let operation = PrintOperation::new(webview);
        operation.set_print_settings(&print_settings);
        operation.set_page_setup(&page_setup);

        // `print()` is asynchronous. Keep a reference until finished/failed, then
        // drop it from the callback to avoid both premature cancellation and a cycle.
        let keepalive = Rc::new(RefCell::new(Some(operation.clone())));
        let keepalive_failed = Rc::clone(&keepalive);
        let keepalive_finished = Rc::clone(&keepalive);
        let result_failed = Rc::clone(&result_for_load);
        let result_finished = Rc::clone(&result_for_load);
        let loop_failed = loop_for_load.clone();
        let loop_finished = loop_for_load.clone();

        operation.connect_failed(move |_, error| {
            keepalive_failed.borrow_mut().take();
            *result_failed.borrow_mut() = Some(Err(error.to_string()));
            loop_failed.quit();
        });
        operation.connect_finished(move |_| {
            keepalive_finished.borrow_mut().take();
            *result_finished.borrow_mut() = Some(Ok(()));
            loop_finished.quit();
        });
        operation.print();
    });

    let loop_for_close = main_loop.clone();
    window.connect_delete_event(move |_, _| {
        loop_for_close.quit();
        glib::Propagation::Proceed
    });

    webview.load_html(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>body{font-family:sans-serif;margin:40px}h1{color:#17324d}</style></head><body><h1>meditor PrintOperation probe</h1><p>Contenido verificable generado por WebKitGTK.</p><p>PDF real de prueba.</p></body></html>",
        Some("about:blank"),
    );
    let result_for_timeout = Rc::clone(&result);
    let loop_for_timeout = main_loop.clone();
    glib::timeout_add_local_once(Duration::from_secs(90), move || {
        if result_for_timeout.borrow().is_none() {
            *result_for_timeout.borrow_mut() = Some(Err(
                "PrintOperation no terminó dentro del tiempo límite".to_string(),
            ));
            loop_for_timeout.quit();
        }
    });
    main_loop.run();

    let result = result
        .borrow_mut()
        .take()
        .unwrap_or_else(|| Err("PrintOperation terminó sin señal".to_string()));
    result?;

    let metadata = fs::metadata(&output).map_err(|error| error.to_string())?;
    if metadata.len() == 0 {
        return Err("PrintOperation creó un PDF vacío".to_string());
    }
    let header = fs::read(&output).map_err(|error| error.to_string())?;
    if !header.starts_with(b"%PDF-") {
        return Err("El archivo generado no tiene firma PDF".to_string());
    }
    println!(
        "PDF generado: {} ({} bytes)",
        output.display(),
        metadata.len()
    );
    Ok(())
}
