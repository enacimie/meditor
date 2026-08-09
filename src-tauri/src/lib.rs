use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use std::time::Duration;

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use gtk::prelude::DialogExt as GtkDialogExt;

#[cfg(target_os = "windows")]
use winapi::um::winuser::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_ICONWARNING, MB_OK, MB_SYSTEMMODAL, MB_YESNO,
};

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::ptr;

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SESSION_BYTES: u64 = 25 * 1024 * 1024;
const SESSION_VERSION: u32 = 2;
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

struct DocumentRegistry(Mutex<HashMap<String, PathBuf>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDocument {
    id: String,
    name: String,
    path: Option<String>,
    content: String,
    dirty: bool,
    handle: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDocument {
    id: String,
    name: String,
    path: Option<String>,
    content: String,
    dirty: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    #[serde(default = "default_session_version")]
    version: u32,
    docs: Vec<StoredDocument>,
    active_id: String,
    split: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionDocumentInput {
    id: String,
    name: String,
    path: Option<String>,
    content: String,
    dirty: bool,
    handle: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInput {
    docs: Vec<SessionDocumentInput>,
    active_id: String,
    split: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRestore {
    docs: Vec<NativeDocument>,
    active_id: String,
    split: f64,
}

fn default_session_version() -> u32 {
    0
}

fn next_handle() -> String {
    format!(
        "meditor-{}-{}",
        std::process::id(),
        NEXT_HANDLE.fetch_add(1, Ordering::Relaxed)
    )
}

fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Documento".to_string())
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || path.file_name().is_none() {
        return Err("Ruta de archivo vacía o inválida".to_string());
    }
    if path.exists() {
        if path.is_dir() {
            return Err("La ruta apunta a un directorio".to_string());
        }
        return std::fs::canonicalize(path).map_err(|e| e.to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "La ruta no tiene carpeta padre".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "La ruta no tiene nombre de archivo".to_string())?;
    let parent = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
    Ok(parent.join(file_name))
}

fn register_normalized(registry: &DocumentRegistry, path: PathBuf) -> Result<String, String> {
    let handle = next_handle();
    registry
        .0
        .lock()
        .map_err(|_| "No se pudo acceder al registro de documentos".to_string())?
        .insert(handle.clone(), path);
    Ok(handle)
}

fn read_path(path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("La ruta no apunta a un archivo".to_string());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "El archivo supera el límite de {} MiB",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

fn document_from_path(
    path: PathBuf,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_path(&path)?;
    let content = read_path(&normalized)?;
    let handle = register_normalized(registry, normalized.clone())?;
    Ok(NativeDocument {
        id: next_handle(),
        name: base_name(&normalized),
        path: Some(normalized.to_string_lossy().into_owned()),
        content,
        dirty: false,
        handle: Some(handle),
    })
}

fn files_from_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(arg).ok())
        .filter(|path| path.is_file())
        .collect()
}

fn documents_from_paths(
    paths: impl IntoIterator<Item = PathBuf>,
    registry: &DocumentRegistry,
) -> Vec<NativeDocument> {
    paths
        .into_iter()
        .filter_map(|path| match document_from_path(path, registry) {
            Ok(document) => Some(document),
            Err(error) => {
                eprintln!("No se pudo abrir el documento: {error}");
                None
            }
        })
        .collect()
}

fn session_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "El contenido supera el límite de {} MiB",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "La ruta no tiene carpeta padre".to_string())?;
    if !parent.is_dir() {
        return Err("La carpeta de destino no existe".to_string());
    }
    let mut temporary = path.to_path_buf();
    let extension = path
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();
    temporary.set_file_name(format!(
        ".{}.tmp{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        extension
    ));
    std::fs::write(&temporary, content).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        if path.exists() {
            let file_name = path.file_name().unwrap_or_default().to_string_lossy();
            let backup = parent.join(format!(
                ".{}.meditor-backup-{}",
                file_name,
                NEXT_HANDLE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::rename(path, &backup).map_err(|e| {
                let _ = std::fs::remove_file(&temporary);
                e.to_string()
            })?;
            if let Err(error) = std::fs::rename(&temporary, path) {
                let _ = std::fs::rename(&backup, path);
                let _ = std::fs::remove_file(&temporary);
                return Err(error.to_string());
            }
            let _ = std::fs::remove_file(backup);
            return Ok(());
        }
    }
    std::fs::rename(&temporary, path).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        e.to_string()
    })
}

fn saved_document(
    path: PathBuf,
    content: String,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_path(&path)?;
    write_atomic(&normalized, &content)?;
    let handle = register_normalized(registry, normalized.clone())?;
    Ok(NativeDocument {
        id: next_handle(),
        name: base_name(&normalized),
        path: Some(normalized.to_string_lossy().into_owned()),
        content,
        dirty: false,
        handle: Some(handle),
    })
}

#[tauri::command]
fn open_files(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
) -> Result<Vec<NativeDocument>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_files();
    let paths = match selected {
        Some(paths) => paths
            .into_iter()
            .map(|path| path.into_path().map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?,
        None => return Ok(Vec::new()),
    };
    Ok(documents_from_paths(paths, &registry))
}

#[tauri::command]
fn save_as(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    registry: tauri::State<'_, DocumentRegistry>,
) -> Result<Option<NativeDocument>, String> {
    let selected = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_save_file();
    let path = match selected {
        Some(path) => path.into_path().map_err(|e| e.to_string())?,
        None => return Ok(None),
    };
    saved_document(path, content, &registry).map(Some)
}

#[tauri::command]
fn save_document(
    handle: String,
    content: String,
    registry: tauri::State<'_, DocumentRegistry>,
) -> Result<(), String> {
    let path = registry
        .0
        .lock()
        .map_err(|_| "No se pudo acceder al registro de documentos".to_string())?
        .get(&handle)
        .cloned()
        .ok_or_else(|| "El documento ya no está disponible para guardar".to_string())?;
    write_atomic(&path, &content)
}

#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<Option<SessionRestore>, String> {
    let path = session_file_path(&app)?;
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if raw.len() as u64 > MAX_SESSION_BYTES {
        return Ok(None);
    }
    let stored: StoredSession = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if stored.version != SESSION_VERSION || stored.docs.is_empty() {
        return Ok(None);
    }
    let docs = stored
        .docs
        .into_iter()
        .map(|document| NativeDocument {
            id: document.id,
            name: document.name,
            path: document.path,
            content: document.content,
            dirty: document.dirty,
            handle: None,
        })
        .collect::<Vec<_>>();
    let active_id = if docs.iter().any(|doc| doc.id == stored.active_id) {
        stored.active_id
    } else {
        docs[0].id.clone()
    };
    Ok(Some(SessionRestore {
        docs,
        active_id,
        split: stored.split.clamp(20.0, 80.0),
    }))
}

#[tauri::command]
fn save_session(
    app: tauri::AppHandle,
    input: SessionInput,
    registry: tauri::State<'_, DocumentRegistry>,
) -> Result<(), String> {
    if input.docs.is_empty() {
        return Ok(());
    }
    let active_id = if input.docs.iter().any(|doc| doc.id == input.active_id) {
        input.active_id
    } else {
        input.docs[0].id.clone()
    };
    let mut docs = Vec::with_capacity(input.docs.len());
    for document in input.docs {
        if document.content.len() as u64 > MAX_FILE_BYTES {
            return Err("Un documento supera el límite permitido".to_string());
        }
        let path = match document.handle {
            Some(handle) => {
                let path = registry
                    .0
                    .lock()
                    .map_err(|_| "No se pudo acceder al registro de documentos".to_string())?
                    .get(&handle)
                    .cloned()
                    .ok_or_else(|| "Un documento ya no está disponible".to_string())?;
                Some(path.to_string_lossy().into_owned())
            }
            None => document.path,
        };
        docs.push(StoredDocument {
            id: document.id,
            name: document.name,
            path,
            content: document.content,
            dirty: document.dirty,
        });
    }
    let stored = StoredSession {
        version: SESSION_VERSION,
        docs,
        active_id,
        split: input.split.clamp(20.0, 80.0),
    };
    let content = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    if content.len() as u64 > MAX_SESSION_BYTES {
        return Err("La sesión supera el límite permitido".to_string());
    }
    let path = session_file_path(&app)?;
    write_atomic(&path, &content)
}

#[tauri::command]
fn cli_files(registry: tauri::State<'_, DocumentRegistry>) -> Vec<NativeDocument> {
    let args: Vec<String> = std::env::args().collect();
    documents_from_paths(files_from_args(&args), &registry)
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
        let (tx, rx) = mpsc::channel();
        gtk::glib::MainContext::default().invoke(move || {
            let dlg = gtk::MessageDialog::new(
                None::<&gtk::Window>,
                gtk::DialogFlags::MODAL,
                gtk::MessageType::Warning,
                gtk::ButtonsType::YesNo,
                &message,
            );
            let resp = dlg.run();
            let _ = tx.send(resp == gtk::ResponseType::Yes);
        });
        let ctx = gtk::glib::MainContext::default();
        while rx.try_recv().is_err() {
            ctx.iteration(true);
        }
        rx.recv().unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        let title: Vec<u16> = OsStr::new("Confirmar")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let text: Vec<u16> = OsStr::new(&message).encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            MessageBoxW(
                ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_YESNO | MB_ICONWARNING | MB_SYSTEMMODAL,
            )
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
        return match output {
            Ok(out) => String::from_utf8_lossy(&out.stdout).contains("Yes"),
            Err(_) => false,
        };
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
        let (tx, rx) = mpsc::channel();
        gtk::glib::MainContext::default().invoke(move || {
            let dlg = gtk::MessageDialog::new(
                None::<&gtk::Window>,
                gtk::DialogFlags::MODAL,
                gtk::MessageType::Error,
                gtk::ButtonsType::Ok,
                &message,
            );
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
        let title: Vec<u16> = OsStr::new("Error").encode_wide().chain(Some(0)).collect();
        let text: Vec<u16> = OsStr::new(&message).encode_wide().chain(Some(0)).collect();
        unsafe {
            MessageBoxW(
                ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR | MB_SYSTEMMODAL,
            );
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
async fn export_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    default_name: String,
) -> Result<(), String> {
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = (app, window, default_name);
        return Err("Exportar PDF solo está soportado en Linux por ahora".to_string());
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
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
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    let path = normalize_path(&path)?;
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err("La carpeta de destino no existe".to_string());
        }
    }
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let url = url::Url::from_file_path(&path)
            .map_err(|_| format!("Ruta inválida para exportar: {}", path.display()))?;
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
                let page_setup = gtk::PageSetup::new();
                let paper = gtk::PaperSize::new(Some("iso_a4"));
                page_setup.set_paper_size_and_default_margins(&paper);
                page_setup.set_top_margin(25.0, gtk::Unit::Mm);
                page_setup.set_bottom_margin(25.0, gtk::Unit::Mm);
                page_setup.set_left_margin(25.0, gtk::Unit::Mm);
                page_setup.set_right_margin(25.0, gtk::Unit::Mm);
                let operation = webkit2gtk::PrintOperation::new(&wv);
                operation.set_print_settings(&print_settings);
                operation.set_page_setup(&page_setup);

                // `print()` es asíncrono: conservar la operación hasta que WebKitGTK
                // emita `finished` o `failed`, y liberarla después para evitar ciclos.
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
        let completion = tauri::async_runtime::spawn_blocking(move || {
            result_rx.recv_timeout(Duration::from_secs(60))
        })
        .await
        .map_err(|error| format!("La espera de exportación PDF falló: {error}"))?;
        let result =
            completion.map_err(|_| "La exportación PDF no terminó a tiempo".to_string())?;
        result?;
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() == 0 {
            return Err("La exportación PDF produjo un archivo vacío".to_string());
        }
        let mut header = [0_u8; 5];
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        use std::io::Read;
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        if &header != b"%PDF-" {
            return Err("La exportación no produjo un archivo PDF válido".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_directory_paths() {
        assert!(normalize_path(Path::new("")).is_err());
        assert!(normalize_path(Path::new(".")).is_err());
    }

    #[test]
    fn atomic_write_replaces_content() {
        let root = std::env::temp_dir().join(format!("meditor-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("document.md");
        write_atomic(&path, "uno").unwrap();
        write_atomic(&path, "dos").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "dos");
        let _ = std::fs::remove_dir_all(root);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let registry = app.state::<DocumentRegistry>();
            let documents = documents_from_paths(files_from_args(&args), &registry);
            if !documents.is_empty() {
                let _ = app.emit("open-documents", documents);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DocumentRegistry(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            open_files,
            save_as,
            save_document,
            load_session,
            save_session,
            cli_files,
            export_pdf,
            confirm,
            alert
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
