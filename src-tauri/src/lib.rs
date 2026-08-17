mod locale;

use locale::{t, tf, Locale};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use std::sync::mpsc;
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
use gtk::prelude::{DialogExt as GtkDialogExt, GtkWindowExt};

#[cfg(target_os = "windows")]
use winapi::um::winuser::{MessageBoxW, MB_ICONERROR, MB_OK, MB_SYSTEMMODAL};

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::ptr;

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SESSION_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PDF_BYTES: u64 = 128 * 1024 * 1024;
const SESSION_VERSION: u32 = 3;
const LEGACY_SESSION_VERSION: u32 = 2;
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

fn max_file_mib() -> u64 {
    MAX_FILE_BYTES / (1024 * 1024)
}

struct DocumentRegistry(Mutex<HashMap<String, PathBuf>>);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
enum DocumentKind {
    #[default]
    Markdown,
    Typst,
    Latex,
}

fn kind_from_path(path: &Path) -> DocumentKind {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if matches!(extension.to_ascii_lowercase().as_str(), "typ" | "typst") => {
            DocumentKind::Typst
        }
        Some(extension)
            if matches!(
                extension.to_ascii_lowercase().as_str(),
                "tex" | "latex" | "ltx"
            ) =>
        {
            DocumentKind::Latex
        }
        _ => DocumentKind::Markdown,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDocument {
    id: String,
    name: String,
    path: Option<String>,
    content: String,
    dirty: bool,
    handle: Option<String>,
    kind: DocumentKind,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDocument {
    id: String,
    name: String,
    path: Option<String>,
    content: String,
    dirty: bool,
    #[serde(default)]
    kind: Option<DocumentKind>,
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
    #[serde(default)]
    kind: Option<DocumentKind>,
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

fn base_name(locale: Locale, path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| t(locale, "doc.untitled"))
}

fn normalize_path(locale: Locale, path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || path.file_name().is_none() {
        return Err(t(locale, "file.emptyPath"));
    }
    if path.exists() {
        if path.is_dir() {
            return Err(t(locale, "file.isDirectory"));
        }
        return std::fs::canonicalize(path).map_err(|e| e.to_string());
    }
    let parent = path.parent().ok_or_else(|| t(locale, "file.noParent"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| t(locale, "file.noFileName"))?;
    let parent = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
    Ok(parent.join(file_name))
}

fn register_normalized(
    locale: Locale,
    registry: &DocumentRegistry,
    path: PathBuf,
) -> Result<String, String> {
    let handle = next_handle();
    registry
        .0
        .lock()
        .map_err(|_| t(locale, "file.registryLock"))?
        .insert(handle.clone(), path);
    Ok(handle)
}

fn read_path(locale: Locale, path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(t(locale, "file.notFound"));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(tf(locale, "file.tooLarge", &max_file_mib().to_string()));
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

fn document_from_path(
    locale: Locale,
    path: PathBuf,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_path(locale, &path)?;
    let content = read_path(locale, &normalized)?;
    let handle = register_normalized(locale, registry, normalized.clone())?;
    Ok(NativeDocument {
        id: next_handle(),
        name: base_name(locale, &normalized),
        path: Some(normalized.to_string_lossy().into_owned()),
        content,
        dirty: false,
        handle: Some(handle),
        kind: kind_from_path(&normalized),
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
    locale: Locale,
    paths: impl IntoIterator<Item = PathBuf>,
    registry: &DocumentRegistry,
) -> Vec<NativeDocument> {
    paths
        .into_iter()
        .filter_map(|path| match document_from_path(locale, path, registry) {
            Ok(document) => Some(document),
            Err(error) => {
                eprintln!("{}", tf(locale, "file.openFailed", &error));
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

fn write_atomic(locale: Locale, path: &Path, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(tf(
            locale,
            "file.contentTooLarge",
            &max_file_mib().to_string(),
        ));
    }
    write_atomic_bytes(locale, path, content.as_bytes())
}

fn write_atomic_bytes(locale: Locale, path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| t(locale, "file.noParent"))?;
    if !parent.is_dir() {
        return Err(t(locale, "file.directoryMissing"));
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
    locale: Locale,
    path: PathBuf,
    content: String,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_path(locale, &path)?;
    write_atomic(locale, &normalized, &content)?;
    let handle = register_normalized(locale, registry, normalized.clone())?;
    Ok(NativeDocument {
        id: next_handle(),
        name: base_name(locale, &normalized),
        path: Some(normalized.to_string_lossy().into_owned()),
        content,
        dirty: false,
        handle: Some(handle),
        kind: kind_from_path(&normalized),
    })
}

fn parse_locale(raw: Option<String>) -> Locale {
    raw.as_deref().map(Locale::from_str).unwrap_or(Locale::En)
}

/// Reattach a session document to its native save handle only when the path
/// still resolves to a regular file whose bytes match the session snapshot.
/// If the file changed or disappeared, keep the path for display but leave the
/// handle empty so the frontend routes the next save through Save As instead
/// of silently overwriting an external edit.
fn restore_session_path(
    locale: Locale,
    registry: &DocumentRegistry,
    raw_path: Option<&str>,
    expected_content: &str,
) -> (Option<String>, Option<String>) {
    let Some(raw_path) = raw_path else {
        return (None, None);
    };
    let path = match normalize_path(locale, Path::new(raw_path)) {
        Ok(path) => path,
        Err(_) => return (Some(raw_path.to_owned()), None),
    };
    let path_string = path.to_string_lossy().into_owned();
    let matches_snapshot = read_path(locale, &path)
        .map(|content| content == expected_content)
        .unwrap_or(false);
    if !matches_snapshot {
        return (Some(path_string), None);
    }
    let handle = register_normalized(locale, registry, path).ok();
    (Some(path_string), handle)
}

#[tauri::command]
fn open_files(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Result<Vec<NativeDocument>, String> {
    let loc = parse_locale(locale);
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "Markdown",
            &[
                "md", "markdown", "txt", "typ", "typst", "tex", "latex", "ltx",
            ],
        )
        .blocking_pick_files();
    let paths = match selected {
        Some(paths) => paths
            .into_iter()
            .map(|path| path.into_path().map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?,
        None => return Ok(Vec::new()),
    };
    Ok(documents_from_paths(loc, paths, &registry))
}

#[tauri::command]
fn save_as(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Result<Option<NativeDocument>, String> {
    let loc = parse_locale(locale);
    let selected = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(
            "Markdown",
            &[
                "md", "markdown", "txt", "typ", "typst", "tex", "latex", "ltx",
            ],
        )
        .blocking_save_file();
    let path = match selected {
        Some(path) => path.into_path().map_err(|e| e.to_string())?,
        None => return Ok(None),
    };
    saved_document(loc, path, content, &registry).map(Some)
}

#[tauri::command]
fn save_document(
    handle: String,
    content: String,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Result<(), String> {
    let loc = parse_locale(locale);
    let path = registry
        .0
        .lock()
        .map_err(|_| t(loc, "file.registryLock"))?
        .get(&handle)
        .cloned()
        .ok_or_else(|| t(loc, "file.documentUnavailable"))?;
    write_atomic(loc, &path, &content)
}

#[tauri::command]
fn load_session(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Result<Option<SessionRestore>, String> {
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
    if stored.version != SESSION_VERSION && stored.version != LEGACY_SESSION_VERSION
        || stored.docs.is_empty()
    {
        return Ok(None);
    }
    let loc = parse_locale(locale);
    let docs = stored
        .docs
        .into_iter()
        .map(|document| {
            let StoredDocument {
                id,
                name,
                path: raw_path,
                content,
                dirty,
                kind: raw_kind,
            } = document;
            let kind = raw_kind.unwrap_or_else(|| {
                raw_path
                    .as_deref()
                    .map(Path::new)
                    .map(kind_from_path)
                    .unwrap_or_default()
            });
            let (path, handle) =
                restore_session_path(loc, &registry, raw_path.as_deref(), &content);
            NativeDocument {
                id,
                name,
                path,
                content,
                dirty,
                handle,
                kind,
            }
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
    locale: Option<String>,
) -> Result<(), String> {
    let loc = parse_locale(locale);
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
            return Err(t(loc, "file.docTooLarge"));
        }
        let document_path = document.path.clone();
        let path = match document.handle {
            Some(handle) => {
                let path = registry
                    .0
                    .lock()
                    .map_err(|_| t(loc, "file.registryLock"))?
                    .get(&handle)
                    .cloned()
                    .ok_or_else(|| t(loc, "file.sessionUnavailable"))?;
                Some(path.to_string_lossy().into_owned())
            }
            None => document_path.clone(),
        };
        docs.push(StoredDocument {
            id: document.id,
            name: document.name,
            path,
            content: document.content,
            dirty: document.dirty,
            kind: Some(document.kind.unwrap_or_else(|| {
                document_path
                    .as_deref()
                    .map(Path::new)
                    .map(kind_from_path)
                    .unwrap_or_default()
            })),
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
        return Err(t(loc, "file.sessionTooLarge"));
    }
    let path = session_file_path(&app)?;
    write_atomic(loc, &path, &content)
}

#[tauri::command]
fn cli_files(
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Vec<NativeDocument> {
    let loc = parse_locale(locale);
    let args: Vec<String> = std::env::args().collect();
    documents_from_paths(loc, files_from_args(&args), &registry)
}

/// Save raw PDF bytes from the Typst WASM compiler.
#[tauri::command]
fn write_pdf_bytes(
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
    let path = match selected {
        Some(path) => path.into_path().map_err(|e| e.to_string())?,
        None => return Ok(()),
    };
    let path = normalize_path(loc, &path)?;
    if let Some(parent) = path.parent() {
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
    write_atomic_bytes(loc, &path, &pdf_bytes)
}

/// Save a self-contained HTML export produced by the frontend.
///
/// Returns whether a file was written: cancelling the dialog is a normal
/// outcome, not an error, and the caller must not claim success for it.
#[tauri::command]
fn write_html_file(
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
    let path = match selected {
        Some(path) => path.into_path().map_err(|e| e.to_string())?,
        None => return Ok(false),
    };
    let path = normalize_path(loc, &path)?;
    if let Some(parent) = path.parent() {
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
    write_atomic(loc, &path, &html)?;
    Ok(true)
}

/// Force-exit the application. The JS `window.close()`/`window.destroy()`
/// calls are unreliable on Linux/WebKitGTK once an `onCloseRequested` JS
/// listener is registered (Tauri auto-prevent_close's the request and the
/// destroy does not tear the window down), so the close guard finishes by
/// exiting the whole app instead.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn alert(message: String, locale: Option<String>) {
    let loc = parse_locale(locale);
    let title = t(loc, "alert.title");

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
        let _ = Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "display dialog \"{}\" with title \"{}\" buttons {{\"OK\"}} default button \"OK\" with icon stop",
                    message.replace('\"', "\\\""),
                    title.replace('\"', "\\\""),
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
    locale: Option<String>,
) -> Result<(), String> {
    let loc = parse_locale(locale);

    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = (app, window, default_name, loc);
        Err(t(loc, "pdf.notSupported"))
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
    let path = normalize_path(loc, &path)?;
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(t(loc, "pdf.directoryMissing"));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let registry = app.state::<DocumentRegistry>();
            let documents = documents_from_paths(Locale::En, files_from_args(&args), &registry);
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
            write_pdf_bytes,
            write_html_file,
            alert,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_directory_paths() {
        assert!(normalize_path(Locale::En, Path::new("")).is_err());
        assert!(normalize_path(Locale::En, Path::new(".")).is_err());
    }

    #[test]
    fn detects_document_kinds_from_paths() {
        assert_eq!(kind_from_path(Path::new("paper.typ")), DocumentKind::Typst);
        assert_eq!(kind_from_path(Path::new("paper.tex")), DocumentKind::Latex);
        assert_eq!(
            kind_from_path(Path::new("paper.md")),
            DocumentKind::Markdown
        );
    }

    #[test]
    fn atomic_write_replaces_content() {
        let root = std::env::temp_dir().join(format!("meditor-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("document.md");
        write_atomic(Locale::En, &path, "one").unwrap();
        write_atomic(Locale::En, &path, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn atomic_bytes_write_preserves_pdf_signature() {
        let root = std::env::temp_dir().join(format!("meditor-pdf-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("document.pdf");
        write_atomic_bytes(Locale::En, &path, b"%PDF-1.7").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.7");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn restores_a_handle_only_for_an_unchanged_file() {
        let root =
            std::env::temp_dir().join(format!("meditor-session-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("document.md");
        std::fs::write(&path, "same").unwrap();
        let registry = DocumentRegistry(Mutex::new(HashMap::new()));

        let (restored_path, handle) =
            restore_session_path(Locale::En, &registry, path.to_str(), "same");
        // `normalize_path` canonicalizes existing files, which resolves
        // symlinks (macOS /var → /private/var) and Windows `\\?\` prefixes.
        let expected = std::fs::canonicalize(&path).unwrap();
        assert_eq!(restored_path, Some(expected.to_string_lossy().into_owned()));
        assert!(handle.is_some());

        std::fs::write(&path, "changed").unwrap();
        let (_, changed_handle) =
            restore_session_path(Locale::En, &registry, path.to_str(), "same");
        assert!(changed_handle.is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
