mod locale;

use locale::{t, tf, Locale};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
))]
use std::sync::mpsc;
// `Emitter` only serves the single-instance hand-off, which is desktop-only;
// `Manager` is needed everywhere (`app.path()`, `app.state()`).
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "windows"
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

#[cfg(target_os = "windows")]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_16, ICoreWebView2_7,
    COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
};
#[cfg(target_os = "windows")]
use webview2_com::PrintToPdfCompletedHandler;
#[cfg(target_os = "windows")]
use windows::core::{Interface, PCWSTR};

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SESSION_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PDF_BYTES: u64 = 128 * 1024 * 1024;
const SESSION_VERSION: u32 = 3;
const LEGACY_SESSION_VERSION: u32 = 2;
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

fn max_file_mib() -> u64 {
    MAX_FILE_BYTES / (1024 * 1024)
}

/// Where an open document lives.
///
/// On a desktop this is always a filesystem path and everything below is
/// ordinary file I/O. Android's picker hands back a `content://` URI from the
/// Storage Access Framework instead, and that is not a path in any useful
/// sense: there is no parent directory to put a temporary file in, nothing to
/// rename, nothing to canonicalise, and `FilePath::into_path()` rejects it
/// outright. Both shapes live in `FilePath`, so the branch happens once in
/// the four helpers below rather than in every command.
type Location = FilePath;

struct DocumentRegistry(Mutex<HashMap<String, Location>>);

/// The filesystem path a location denotes, if it is one.
///
/// Every desktop caller gets `Some` and carries on as before; a content URI
/// is the only thing that yields `None`.
fn as_path(location: &Location) -> Option<&Path> {
    match location {
        FilePath::Path(path) => Some(path.as_path()),
        FilePath::Url(_) => None,
    }
}

/// What the frontend shows and stores in the session.
fn location_display(location: &Location) -> String {
    match location {
        FilePath::Path(path) => path.to_string_lossy().into_owned(),
        FilePath::Url(url) => url.to_string(),
    }
}

/// The document's own name.
///
/// A content URI carries no file name in its text — the name lives in the
/// provider's metadata, which is what `PathResolver::file_name` queries.
fn location_name(app: &tauri::AppHandle, locale: Locale, location: &Location) -> String {
    match location {
        FilePath::Path(path) => base_name(locale, path),
        FilePath::Url(url) => app
            .path()
            .file_name(url.as_str())
            .unwrap_or_else(|| t(locale, "doc.untitled")),
    }
}

/// Read a document, whatever it is stored behind.
fn read_location(
    app: &tauri::AppHandle,
    locale: Locale,
    location: &Location,
) -> Result<String, String> {
    let Some(path) = as_path(location) else {
        // A path is checked against its metadata before being read; a content
        // URI has no metadata to consult, so the ceiling has to be enforced
        // while reading instead. One byte past the limit is enough to know it
        // is over — reading the whole thing first would let a phone run itself
        // out of memory on a file it was always going to refuse.
        use std::io::Read;
        let mut options = OpenOptions::new();
        options.read(true);
        let file = app
            .fs()
            .open(location.clone(), options)
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(tf(locale, "file.tooLarge", &max_file_mib().to_string()));
        }
        return String::from_utf8(bytes).map_err(|e| e.to_string());
    };
    read_path(locale, path)
}

/// Write a document, whatever it is stored behind.
///
/// The desktop path keeps the write-and-rename dance unchanged. A content URI
/// cannot have one: the Storage Access Framework hands over a file descriptor
/// for that one document and nothing else, with no sibling to write beside
/// and no directory entry to swap. Writing is therefore in place, and an
/// interrupted save can leave a truncated file — a real difference in
/// durability, not a stylistic one, and the reason this is spelled out here.
fn write_location(
    app: &tauri::AppHandle,
    locale: Locale,
    location: &Location,
    bytes: &[u8],
) -> Result<(), String> {
    let Some(path) = as_path(location) else {
        use std::io::Write;
        let mut options = OpenOptions::new();
        options.write(true).truncate(true).create(true);
        let mut file = app
            .fs()
            .open(location.clone(), options)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        return file.flush().map_err(|e| e.to_string());
    };
    write_atomic_bytes(locale, path, bytes)
}

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
    location: Location,
) -> Result<String, String> {
    let handle = next_handle();
    registry
        .0
        .lock()
        .map_err(|_| t(locale, "file.registryLock"))?
        .insert(handle.clone(), location);
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

/// Canonicalise a location, where that means anything.
///
/// A path gets the usual treatment — resolved, symlinks followed, directories
/// rejected. A content URI is already the provider's own opaque identifier
/// for one document; there is nothing to resolve and nothing to check until
/// it is opened.
fn normalize_location(locale: Locale, location: Location) -> Result<Location, String> {
    match as_path(&location) {
        Some(path) => normalize_path(locale, path).map(FilePath::Path),
        None => Ok(location),
    }
}

fn document_from_location(
    app: &tauri::AppHandle,
    locale: Locale,
    location: Location,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_location(locale, location)?;
    let content = read_location(app, locale, &normalized)?;
    let name = location_name(app, locale, &normalized);
    let handle = register_normalized(locale, registry, normalized.clone())?;
    Ok(NativeDocument {
        id: next_handle(),
        // The extension is read off the name rather than the location: a
        // content URI's own text says nothing about the format.
        kind: kind_from_path(Path::new(&name)),
        name,
        path: Some(location_display(&normalized)),
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

fn documents_from_locations(
    app: &tauri::AppHandle,
    locale: Locale,
    locations: impl IntoIterator<Item = Location>,
    registry: &DocumentRegistry,
) -> Vec<NativeDocument> {
    locations
        .into_iter()
        .filter_map(
            |location| match document_from_location(app, locale, location, registry) {
                Ok(document) => Some(document),
                Err(error) => {
                    eprintln!("{}", tf(locale, "file.openFailed", &error));
                    None
                }
            },
        )
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
    app: &tauri::AppHandle,
    locale: Locale,
    location: Location,
    content: String,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_location(locale, location)?;
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(tf(
            locale,
            "file.contentTooLarge",
            &max_file_mib().to_string(),
        ));
    }
    write_location(app, locale, &normalized, content.as_bytes())?;
    let name = location_name(app, locale, &normalized);
    let handle = register_normalized(locale, registry, normalized.clone())?;
    Ok(NativeDocument {
        id: next_handle(),
        kind: kind_from_path(Path::new(&name)),
        name,
        path: Some(location_display(&normalized)),
        content,
        dirty: false,
        handle: Some(handle),
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
///
/// Paths only, deliberately. A stored `content://` URI is not reattachable:
/// the picker grants access for the life of the process, so after a restart
/// the URI is a string the app is no longer allowed to open. It comes back as
/// a display value with no handle, which is exactly the "save routes through
/// Save As" behaviour this function already has for a file that moved.
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
    let handle = register_normalized(locale, registry, FilePath::Path(path)).ok();
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
    // Taken as they come. Converting to a path here was what made every open
    // fail on Android: the picker returns a content:// URI and `into_path()`
    // rejects one outright.
    let locations = match selected {
        Some(locations) => locations,
        None => return Ok(Vec::new()),
    };
    Ok(documents_from_locations(&app, loc, locations, &registry))
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
    let location = match selected {
        Some(location) => location,
        None => return Ok(None),
    };
    saved_document(&app, loc, location, content, &registry).map(Some)
}

#[tauri::command]
fn save_document(
    app: tauri::AppHandle,
    handle: String,
    content: String,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Result<(), String> {
    let loc = parse_locale(locale);
    let location = registry
        .0
        .lock()
        .map_err(|_| t(loc, "file.registryLock"))?
        .get(&handle)
        .cloned()
        .ok_or_else(|| t(loc, "file.documentUnavailable"))?;
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(tf(loc, "file.contentTooLarge", &max_file_mib().to_string()));
    }
    write_location(&app, loc, &location, content.as_bytes())
}

/// A cheap fingerprint of the file behind an open document.
///
/// Both fields are optional because not every filesystem answers every
/// question: some Android content providers report a size but a zeroed
/// timestamp, and either alone still detects the edits this exists for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentStat {
    modified_ms: Option<u64>,
    size: Option<u64>,
}

fn system_time_ms(time: std::time::SystemTime) -> Option<u64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn metadata_stat(metadata: &std::fs::Metadata) -> DocumentStat {
    DocumentStat {
        modified_ms: metadata.modified().ok().and_then(system_time_ms),
        size: Some(metadata.len()),
    }
}

/// Stat a location, whatever kind it is.
///
/// Desktop paths go through plain metadata. A content URI has none — the fs
/// plugin's own stat command refuses them — but its open hands back a real
/// file descriptor over the Storage Access Framework, and an fstat on that
/// descriptor answers the same questions.
fn location_stat(app: &tauri::AppHandle, location: &Location) -> Option<DocumentStat> {
    match as_path(location) {
        Some(path) => std::fs::metadata(path).ok().map(|m| metadata_stat(&m)),
        None => {
            let mut options = OpenOptions::new();
            options.read(true);
            let file = app.fs().open(location.clone(), options).ok()?;
            file.metadata().ok().map(|m| metadata_stat(&m))
        }
    }
}

/// Fingerprint of one open document, or `null` when it cannot be watched
/// (deleted, provider gone). The frontend treats `null` as "skip": deletion
/// surfaces on the next save, where it can be explained.
#[tauri::command]
fn document_stat(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    locale: Option<String>,
) -> Result<Option<DocumentStat>, String> {
    let loc = parse_locale(locale);
    let location = registry
        .0
        .lock()
        .map_err(|_| t(loc, "file.registryLock"))?
        .get(&handle)
        .cloned()
        .ok_or_else(|| t(loc, "file.documentUnavailable"))?;
    Ok(location_stat(&app, &location))
}

/// Read the current bytes of one open document, for reloading after an
/// external edit. Size-checked like any other read path.
#[tauri::command]
fn read_document(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    locale: Option<String>,
) -> Result<String, String> {
    let loc = parse_locale(locale);
    let location = registry
        .0
        .lock()
        .map_err(|_| t(loc, "file.registryLock"))?
        .get(&handle)
        .cloned()
        .ok_or_else(|| t(loc, "file.documentUnavailable"))?;
    read_location(&app, loc, &location)
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
                let location = registry
                    .0
                    .lock()
                    .map_err(|_| t(loc, "file.registryLock"))?
                    .get(&handle)
                    .cloned()
                    .ok_or_else(|| t(loc, "file.sessionUnavailable"))?;
                Some(location_display(&location))
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

/// Files the operating system asked us to open, parked until the frontend
/// comes to collect them.
///
/// Windows and Linux hand the path over as a process argument, so the
/// frontend's single startup pull through `cli_files` sees it. macOS instead
/// delivers an Apple event surfaced as `RunEvent::Opened`, which can fire
/// before the webview has registered its `open-documents` listener — and an
/// emitted event nobody hears is gone. Every batch is therefore queued here
/// too and drained by `cli_files`; on the happy path the document is already
/// open by then and the registry hands back the same handle, so nothing
/// duplicates. The one cost: a file opened live and closed again reappears
/// on the next launch — acceptable next to losing the open request outright.
static PENDING_OPEN_PATHS: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();

/// Only Apple platforms produce open requests outside argv; the function
/// stays compiled everywhere so the parking-lot test can exercise it.
#[cfg_attr(
    not(target_os = "macos"),
    allow(dead_code, reason = "exercised by tests off macOS")
)]
fn queue_open_paths<I: IntoIterator<Item = PathBuf>>(paths: I) {
    PENDING_OPEN_PATHS
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .expect("pending open paths mutex poisoned")
        .extend(paths);
}

fn drain_pending_paths() -> Vec<PathBuf> {
    match PENDING_OPEN_PATHS.get() {
        Some(pending) => pending
            .lock()
            .expect("pending open paths mutex poisoned")
            .drain(..)
            .collect(),
        None => Vec::new(),
    }
}

/// Hand documents to the webview and bring the window forward.
#[cfg(desktop)]
fn present_documents(app: &tauri::AppHandle, documents: Vec<NativeDocument>) {
    if !documents.is_empty() {
        let _ = app.emit("open-documents", documents);
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn cli_files(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Vec<NativeDocument> {
    let loc = parse_locale(locale);
    let args: Vec<String> = std::env::args().collect();
    let mut paths = files_from_args(&args);
    paths.extend(drain_pending_paths());
    let locations = paths.into_iter().map(FilePath::Path);
    documents_from_locations(&app, loc, locations, &registry)
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

/// Which operating system this is, so the interface can stop offering what
/// the backend cannot do.
///
/// PDF export and printing exist on Linux and Windows and nowhere else; on
/// Android they would open a menu entry that fails. The frontend asks once at
/// startup rather than guessing from the user agent, which on Android says
/// "Linux" and would guess wrong.
#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
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

/// Show a native error dialog.
///
/// This is the only channel the frontend has for reporting a failed file
/// operation, so a platform without a branch here does not merely look
/// different — it swallows every save, open and export error in silence.
///
/// Desktop blocks until the dialog is dismissed; mobile does not (see below).
#[tauri::command]
fn alert(app: tauri::AppHandle, message: String, locale: Option<String>) {
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

/// Open the native print dialog for the live webview.
///
/// Unlike `export_pdf`, nothing is saved to a file: the document is handed to
/// the OS print dialog so the user can pick a printer (or "Save as PDF").
#[tauri::command]
async fn print_document(
    window: tauri::WebviewWindow,
    locale: Option<String>,
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
        let _ = &window;
        Err(t(parse_locale(locale), "pdf.notSupported"))
    }

    #[cfg(target_os = "windows")]
    {
        let _ = &locale;
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
#[tauri::command]
async fn export_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    default_name: String,
    locale: Option<String>,
    paged: Option<bool>,
) -> Result<(), String> {
    let loc = parse_locale(locale);

    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd",
        target_os = "windows"
    )))]
    {
        let _ = (app, window, default_name, loc, paged);
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
        const A4_WIDTH_IN: f64 = 8.268;
        const A4_HEIGHT_IN: f64 = 11.693;
        // 25 mm, matching the GTK path — but only when the page still needs
        // them. See the `paged` parameter.
        const MARGIN_IN: f64 = 0.984;
        let margin = if paged.unwrap_or(true) {
            0.0
        } else {
            MARGIN_IN
        };

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
                        settings
                            .SetPageWidth(A4_WIDTH_IN)
                            .map_err(|e| e.to_string())?;
                        settings
                            .SetPageHeight(A4_HEIGHT_IN)
                            .map_err(|e| e.to_string())?;
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
        /*
         * Left alone on purpose. The GTK page setup below asks for the same
         * 25 mm margins the paginated preview already draws inside each of its
         * pages, so this path very likely doubles them exactly as the Windows
         * one did — but that could not be verified here, and changing print
         * behaviour blind on the platform that has been shipping is worse than
         * reporting it. Measured on Windows: 7 preview pages came out as 9.
         */
        let _ = paged;
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
    let builder = tauri::Builder::default();

    // Second launches only happen where there is a command line to launch
    // from. On mobile the plugin does not exist at all (see Cargo.toml), so
    // the step is bound to the target rather than chained unconditionally.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        let registry = app.state::<DocumentRegistry>();
        let locations = files_from_args(&args).into_iter().map(FilePath::Path);
        let documents = documents_from_locations(app, Locale::En, locations, &registry);
        present_documents(app, documents);
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Registered for its Rust API only — `app.fs()` panics without it.
        // Its JS commands stay unreachable: capabilities/default.json does not
        // grant `fs:default`, so the frontend gains no new access to the disk.
        .plugin(tauri_plugin_fs::init())
        .manage(DocumentRegistry(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            open_files,
            save_as,
            save_document,
            document_stat,
            read_document,
            load_session,
            save_session,
            cli_files,
            export_pdf,
            print_document,
            write_pdf_bytes,
            write_html_file,
            alert,
            platform,
            exit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Finder and the "Open With" menu reach us through Apple events,
            // not argv. The variant only exists on Apple platforms; elsewhere
            // there is nothing to do.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths: Vec<PathBuf> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect();
                if paths.is_empty() {
                    return;
                }
                let registry = app_handle.state::<DocumentRegistry>();
                let locations = paths.iter().cloned().map(FilePath::Path);
                let documents =
                    documents_from_locations(app_handle, Locale::En, locations, &registry);
                queue_open_paths(paths);
                present_documents(app_handle, documents);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (&app_handle, &event);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_directory_paths() {
        assert!(normalize_path(Locale::En, Path::new("")).is_err());
        assert!(normalize_path(Locale::En, Path::new(".")).is_err());
    }

    /// The whole Android file story turns on this one branch: everything the
    /// desktop does must still be recognised as a path, and a content URI
    /// must not be. Getting it backwards would either break every desktop
    /// save or silently route Android writes into the atomic-rename code that
    /// cannot work there.
    #[test]
    fn tells_a_path_from_a_content_uri() {
        let path = FilePath::Path(PathBuf::from("/home/someone/notes.md"));
        assert_eq!(as_path(&path), Some(Path::new("/home/someone/notes.md")));

        let uri: FilePath = "content://com.android.providers.downloads/document/42"
            .parse()
            .expect("a content URI should parse as a FilePath");
        assert!(
            as_path(&uri).is_none(),
            "a content URI is not a path, whatever it looks like"
        );
    }

    #[test]
    fn shows_a_location_as_itself() {
        let path = FilePath::Path(PathBuf::from("/home/someone/notes.md"));
        assert_eq!(location_display(&path), "/home/someone/notes.md");

        let raw = "content://com.android.providers.downloads/document/42";
        let uri: FilePath = raw.parse().unwrap();
        assert_eq!(location_display(&uri), raw);
    }

    /// A content URI is the provider's own identifier for one document.
    /// Canonicalising it is not merely unnecessary, it is not possible — so
    /// normalisation has to let it through untouched rather than fail.
    #[test]
    fn leaves_a_content_uri_alone_when_normalising() {
        let raw = "content://com.android.providers.downloads/document/42";
        let uri: FilePath = raw.parse().unwrap();
        let normalized = normalize_location(Locale::En, uri).expect("should pass through");
        assert_eq!(location_display(&normalized), raw);
    }

    /// Document kind used to be read off the full path and is now read off
    /// the name, because a content URI's text says nothing about the format.
    /// The two must agree for every desktop case.
    #[test]
    fn kind_from_the_name_matches_kind_from_the_path() {
        for full in [
            "/home/someone/paper.typ",
            "/home/someone/paper.tex",
            "/home/someone/notes.md",
            "/home/someone/plain",
            "/home/someone/.md",
        ] {
            let path = Path::new(full);
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            assert_eq!(
                kind_from_path(path),
                kind_from_path(Path::new(&name)),
                "{full} should have the same kind by name as by path"
            );
        }
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

    /// The macOS parking lot: everything queued before the webview listens
    /// must come out of the next drain exactly once, in order.
    #[test]
    fn parks_and_drains_open_paths() {
        let first = PathBuf::from("/tmp/first.md");
        let second = PathBuf::from("/tmp/second.typ");
        queue_open_paths([first.clone()]);
        queue_open_paths([second.clone()]);
        assert_eq!(drain_pending_paths(), vec![first, second]);
        assert!(drain_pending_paths().is_empty());
    }
}
