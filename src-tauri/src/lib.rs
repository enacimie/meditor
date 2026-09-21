mod document;
mod export;
mod locale;
mod location;
mod paper;
mod recent;
mod system;

use document::{
    document_from_location, documents_from_locations, kind_from_path, metadata_stat, DocumentKind,
    DocumentStat, NativeDocument,
};
use locale::{parse_locale, t, tf, Locale};
use location::{
    as_path, document_location, location_display, normalize_path, register_normalized,
    write_atomic, DocumentRegistry, Location, MAX_FILE_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

// `Emitter` only serves the single-instance hand-off, which is desktop-only;
// `Manager` is needed everywhere (`app.path()`, `app.state()`).
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_fs::FilePath;

const MAX_SESSION_BYTES: u64 = 25 * 1024 * 1024;
const SESSION_VERSION: u32 = 3;
const LEGACY_SESSION_VERSION: u32 = 2;

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
    /// The file as it was when this session was written.
    ///
    /// This is what tells a buffer that differs from its file because the
    /// writer had unsaved work from one that differs because something else
    /// wrote the file while meditor was closed. Optional, so a session saved
    /// by an older build still loads; it comes back as "no line to compare
    /// against", and the first watch tick reads the file and decides.
    #[serde(default)]
    stat: Option<DocumentStat>,
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
    #[serde(default)]
    stat: Option<DocumentStat>,
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

fn files_from_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(arg).ok())
        .filter(|path| path.is_file())
        .collect()
}

fn session_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

/// Where the recent list is kept, beside the session.
fn recent_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recent.json"))
}

/// The stored list, or an empty one for anything unreadable.
///
/// A missing, truncated or hand-edited file costs the user their recent list
/// and nothing else, so none of it is worth failing a startup over.
fn load_recent(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let Ok(path) = recent_file_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Note that a document was just opened or saved, and write the list out.
///
/// Only a real path: a `content://` URI cannot be reopened later (see
/// `recent.rs`), so remembering one would offer the user a door that does not
/// open. Failures are reported and swallowed — losing the recent list must
/// never be the reason an open fails.
pub(crate) fn remember_recent(app: &tauri::AppHandle, locale: Locale, location: &Location) {
    let Some(path) = as_path(location) else {
        return;
    };
    let state = app.state::<recent::RecentFiles>();
    let Some(paths) = state.remember(path.to_path_buf()) else {
        return;
    };
    persist_recent(app, locale, &paths);
}

/// The paths a restored session can offer the recent list.
///
/// Only the documents that came back attached to their file. A handle is
/// handed out by `restore_session_path` only when the path still resolves and
/// the content still matches the snapshot, so this reuses that test rather
/// than inventing a second one that could disagree with it — and it is what
/// keeps a moved file, a deleted one, and an Android `content://` URI that
/// never was a path out of a menu that promises to reopen things.
fn restorable_paths(docs: &[NativeDocument]) -> Vec<PathBuf> {
    docs.iter()
        .filter(|doc| doc.handle.is_some())
        .filter_map(|doc| doc.path.as_deref().map(PathBuf::from))
        .collect()
}

/// Write the recent list out.
///
/// Split from `remember_recent` because the startup backfill produces the same
/// list by a different route and has to store it the same way. Failures are
/// reported and swallowed: losing the recent list must never be the reason an
/// open, a save or a restore fails.
fn persist_recent(app: &tauri::AppHandle, locale: Locale, paths: &[PathBuf]) {
    let stored = match serde_json::to_string(paths) {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!("could not encode the recent list: {error}");
            return;
        }
    };
    match recent_file_path(app) {
        Ok(file) => {
            if let Err(error) = write_atomic(locale, &file, &stored) {
                eprintln!("could not write the recent list: {error}");
            }
        }
        Err(error) => eprintln!("could not find where to keep the recent list: {error}"),
    }
}

/// Reattach a session document to its native save handle whenever the path
/// still resolves to a regular file. A path that no longer resolves keeps its
/// display value and comes back with no handle, so the next save routes
/// through Save As rather than writing somewhere that is not there.
///
/// It used to reattach only when the file's bytes still matched the session
/// snapshot, and that was worse than it sounds. A file edited by anything else
/// while meditor was closed came back with its path but no handle: the tab
/// looked attached and was not, and the external-change watch skips a document
/// with no handle — so it was never watched again. Not for three seconds, not
/// for an hour, not after a restart, because the same comparison failed every
/// time. The only way out was to close the tab and open the file afresh.
///
/// The reason for it is sound and is now somebody else's job. It was written
/// to avoid silently overwriting an edit made behind the app's back; the watch
/// that arrived later does that properly, by reading the file and either
/// reloading a clean buffer or asking. Dropping the handle put the document
/// somewhere neither could help it.
///
/// Paths only, deliberately. A stored `content://` URI is not reattachable:
/// the picker grants access for the life of the process, so after a restart
/// the URI is a string the app is no longer allowed to open. It comes back as
/// a display value with no handle, which is the same "save routes through
/// Save As" behaviour a file that moved gets.
fn restore_session_path(
    locale: Locale,
    registry: &DocumentRegistry,
    raw_path: Option<&str>,
) -> (Option<String>, Option<String>) {
    let Some(raw_path) = raw_path else {
        return (None, None);
    };
    let path = match normalize_path(locale, Path::new(raw_path)) {
        Ok(path) => path,
        Err(_) => return (Some(raw_path.to_owned()), None),
    };
    let path_string = path.to_string_lossy().into_owned();
    if !path.is_file() {
        return (Some(path_string), None);
    }
    let handle = register_normalized(locale, registry, FilePath::Path(path)).ok();
    (Some(path_string), handle)
}

/// The recent documents, for the menu to draw.
///
/// Names and paths to show. The frontend never sends one of these paths back:
/// see `open_recent`, which takes the position instead.
#[tauri::command]
fn recent_files(recent: tauri::State<'_, recent::RecentFiles>) -> Vec<recent::RecentEntry> {
    recent.entries()
}

/// Open the recent document the menu drew at `index`.
///
/// An index and not a path, deliberately. A command that opened whatever path
/// the webview named would let anything running in the web layer read any file
/// the user can, which is the one thing the rest of this file is careful not to
/// allow. What this grants instead is reopening something the user opened
/// before, from a list the backend keeps.
///
/// `Ok(None)` when there is nothing to open: the position no longer exists —
/// the list was pruned between the menu being drawn and being clicked — or the
/// file itself has gone. Both are the same event to the person who clicked, and
/// the frontend says so by name.
///
/// An error, by contrast, means the file is there and would not open, and the
/// frontend hands those details over rather than guessing.
#[tauri::command]
fn open_recent(
    app: tauri::AppHandle,
    index: usize,
    registry: tauri::State<'_, DocumentRegistry>,
    recent: tauri::State<'_, recent::RecentFiles>,
    locale: Option<String>,
) -> Result<Option<NativeDocument>, String> {
    let loc = parse_locale(locale);
    let Some(path) = recent.path_at(index) else {
        return Ok(None);
    };
    if path_is_missing(&path) {
        return Ok(None);
    }
    document_from_location(&app, loc, Location::Path(path), &registry).map(Some)
}

/// Whether a path is gone, as opposed to merely unreadable.
///
/// `Path::is_file` cannot tell the two apart: it answers false for a file that
/// has been deleted and for one on a share that is not mounted this morning,
/// and treating those alike is what made a permission problem report itself as
/// "no longer where it was". `NotFound` is the one answer that means the row
/// has gone.
fn path_is_missing(path: &Path) -> bool {
    matches!(
        std::fs::metadata(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    )
}

/// The most an image may weigh before it is refused.
///
/// Generous next to the 10 MiB the editor accepts on paste, because a
/// document may point at a photograph nobody put there through meditor.
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

/// What may be served to an `<img>`, by extension.
///
/// An allow-list rather than a deny-list, and the reason this command cannot
/// be used to read the user's documents: only these are ever handed back, and
/// only ever into an image element.
const IMAGE_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico",
];

fn has_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let lower = extension.to_ascii_lowercase();
            IMAGE_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

/// The file a document-relative image link points at.
///
/// `![](assets/shot.png)` in a saved document means "next to this file", the
/// same as it does in every other Markdown tool, and the frontend cannot
/// resolve that itself: a webview has no filesystem, and the app deliberately
/// grants it none.
///
/// So the resolving happens here, and the argument that arrives from the
/// frontend is a *relative* path — never an absolute one, and never a URL.
/// The document it is relative to comes from the handle registry, so the
/// frontend cannot name a base directory either.
///
/// Going up with `..` is allowed on purpose: `../shared/logo.png` is how
/// people lay out a folder of documents, and refusing it would make meditor
/// the only editor that cannot open such a file. What keeps that safe is not
/// the shape of the path but what may come back through it — an image, by
/// extension, below the size ceiling, and only ever into an `<img>`.
fn resolve_image_path(locale: Locale, document: &Path, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.is_empty() || rel_path.contains('\0') {
        return Err(t(locale, "image.invalidPath"));
    }
    // A URL is not a relative path, whatever it looks like. Checked before
    // anything else so `file://…` and `https://…` cannot arrive as one.
    if rel_path.contains("://") {
        return Err(t(locale, "image.invalidPath"));
    }
    // Absolute in any notation, including the ones this platform does not use
    // itself: a Linux build must still refuse `C:\` and `\server\share`.
    let bytes = rel_path.as_bytes();
    let windows_drive =
        bytes.len() >= 2 && bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic();
    if rel_path.starts_with('/')
        || rel_path.starts_with('\\')
        || windows_drive
        || Path::new(rel_path).is_absolute()
    {
        return Err(t(locale, "image.invalidPath"));
    }

    let parent = document
        .parent()
        .ok_or_else(|| t(locale, "image.invalidPath"))?;
    let joined = parent.join(rel_path);
    // Canonicalising is what turns `a/../b` into `b` and follows any links,
    // so everything below is asked of the file that would actually be read.
    let resolved = joined
        .canonicalize()
        .map_err(|_| t(locale, "image.notFound"))?;

    let metadata = std::fs::metadata(&resolved).map_err(|_| t(locale, "image.notFound"))?;
    if !metadata.is_file() {
        return Err(t(locale, "image.notFound"));
    }
    if !has_image_extension(&resolved) {
        return Err(t(locale, "image.unsupportedType"));
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(tf(
            locale,
            "image.tooLarge",
            &(MAX_IMAGE_BYTES / (1024 * 1024)).to_string(),
        ));
    }
    Ok(resolved)
}

/// The folder a document's own images live in, beside it.
///
/// `assets/` rather than `<document>.assets/`, because a document gets
/// renamed (F2) and saved elsewhere (Save As), and a folder named after it
/// would have to follow or be orphaned. `assets/` survives both, and is what
/// people already write by hand.
const IMAGE_FOLDER: &str = "assets";

/// Characters Windows refuses in a file name, plus the path separators.
const UNSAFE_NAME_CHARS: [char; 9] = ['<', '>', ':', '"', '|', '?', '*', '/', '\\'];

/// Device names Windows still reserves, whatever the extension.
const RESERVED_STEMS: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A file name that is safe to create, from whatever the frontend proposed.
///
/// The name comes from a pasted file, which means it comes from wherever that
/// file came from. Everything up to the last separator is dropped rather than
/// escaped — a name is a name, not a path — and what is left is stripped of
/// the characters Windows refuses and the leading dots that would hide it.
///
/// Returns `None` when nothing usable is left, in which case the caller names
/// the file itself.
fn sanitize_image_name(proposed: &str) -> Option<String> {
    // Any path in front of the name is not part of the name.
    let base = proposed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(proposed)
        .trim();

    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control() && !UNSAFE_NAME_CHARS.contains(c))
        .collect();
    // Windows drops trailing dots and spaces silently, so a name ending in one
    // would not be the name that was created.
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if cleaned.is_empty() {
        return None;
    }

    let path = Path::new(cleaned);
    if !has_image_extension(path) {
        return None;
    }
    let stem = path.file_stem()?.to_str()?.to_ascii_lowercase();
    if RESERVED_STEMS.contains(&stem.as_str()) {
        return Some(format!("image-{cleaned}"));
    }
    Some(cleaned.to_string())
}

/// Where an image was written, as the document should refer to it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WrittenImage {
    rel_path: String,
}

/// Write an image into `assets/` beside a document.
///
/// The frontend proposes a name and never a path: the folder comes from the
/// document's own location, looked up by handle. Nothing here can write
/// outside that folder — the name is reduced to a single component, and the
/// folder is canonicalised and checked to be under the document's own
/// directory before anything is created, which is what stops an `assets`
/// symlink pointing somewhere else.
///
/// Returns `None` where there is nowhere to write: a document that has never
/// been saved, or an Android content URI, which is one file and no folder.
#[tauri::command]
fn write_image(
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    name: String,
    bytes: Vec<u8>,
    locale: Option<String>,
) -> Result<Option<WrittenImage>, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    let Some(document) = as_path(&location) else {
        return Ok(None);
    };
    let Some(parent) = document.parent() else {
        return Ok(None);
    };
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(tf(
            loc,
            "image.tooLarge",
            &(MAX_IMAGE_BYTES / (1024 * 1024)).to_string(),
        ));
    }
    let file_name = sanitize_image_name(&name).ok_or_else(|| t(loc, "image.unsupportedType"))?;

    let folder = parent.join(IMAGE_FOLDER);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    // Canonicalised after creating it, so a symlink is followed and seen.
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    let root = parent.canonicalize().map_err(|e| e.to_string())?;
    if !folder.starts_with(&root) {
        return Err(t(loc, "image.invalidPath"));
    }

    // `create_new` rather than a check followed by a write: two pastes of the
    // same name in the same second would both see the name free.
    let mut attempt = 0;
    loop {
        let candidate = if attempt == 0 {
            file_name.clone()
        } else {
            let path = Path::new(&file_name);
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
            match path.extension().and_then(|e| e.to_str()) {
                Some(extension) => format!("{stem}-{attempt}.{extension}"),
                None => format!("{stem}-{attempt}"),
            }
        };
        let target = folder.join(&candidate);
        // `std::fs`, not the plugin's: this is a real path on the desktop,
        // and the plugin's OpenOptions has no `create_new`.
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                file.flush().map_err(|e| e.to_string())?;
                return Ok(Some(WrittenImage {
                    rel_path: format!("{IMAGE_FOLDER}/{candidate}"),
                }));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                attempt += 1;
                if attempt > 999 {
                    return Err(t(loc, "image.invalidPath"));
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

/// Fingerprint of an image beside a document, or `null` when there is none to
/// read — which includes every case where relative images cannot work at all.
///
/// The preview asks for this on each render and only re-reads the bytes when
/// the answer changes, so editing a document does not re-read its images on
/// every keystroke, and editing an image in another program still shows up.
#[tauri::command]
fn image_stat(
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    rel_path: String,
    locale: Option<String>,
) -> Result<Option<DocumentStat>, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    // A content URI has no parent directory to be relative to — the Storage
    // Access Framework hands over one document and nothing around it — so on
    // Android there is nothing to resolve and nothing to report.
    let Some(document) = as_path(&location) else {
        return Ok(None);
    };
    let Ok(resolved) = resolve_image_path(loc, document, &rel_path) else {
        return Ok(None);
    };
    Ok(std::fs::metadata(&resolved).ok().map(|m| metadata_stat(&m)))
}

/// The bytes of an image beside a document.
///
/// Returned raw rather than base64: the preview turns them into a blob URL,
/// and encoding a photograph into a string to cross the IPC boundary would
/// cost a third more of everything for nothing.
#[tauri::command]
fn read_image(
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    rel_path: String,
    locale: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    let Some(document) = as_path(&location) else {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    let Ok(resolved) = resolve_image_path(loc, document, &rel_path) else {
        // A missing or unreadable image is not an error the user needs told
        // about: the document simply shows a broken image where it says one
        // should be, exactly as it would in any other renderer.
        return Ok(tauri::ipc::Response::new(Vec::new()));
    };
    let bytes = std::fs::read(&resolved).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
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
                stat,
            } = document;
            let kind = raw_kind.unwrap_or_else(|| {
                raw_path
                    .as_deref()
                    .map(Path::new)
                    .map(kind_from_path)
                    .unwrap_or_default()
            });
            let (path, handle) = restore_session_path(loc, &registry, raw_path.as_deref());
            NativeDocument {
                id,
                name,
                path,
                content,
                dirty,
                handle,
                kind,
                // The file as this session last saw it, handed back so the
                // watch can tell "the writer had unsaved work" from "something
                // else wrote this file while we were away".
                stat,
            }
        })
        .collect::<Vec<_>>();

    /*
     * The documents a restored session brings back belong in the recent list.
     * Until now nothing put them there: the list was only fed by the open
     * dialog, the command line and Save as, so someone who never uses the
     * dialog — because the session already reopens everything — had a menu
     * section that stayed empty forever.
     *
     * `handle.is_some()` is the test, and deliberately not a second one of
     * its own: `restore_session_path` hands back a handle only when the path
     * still resolves and the file still matches the snapshot byte for byte.
     * Anything else — moved, deleted, edited underneath us, or an Android
     * `content://` URI that never was a path — is exactly what the list must
     * not offer.
     *
     * They go behind whatever is already remembered, so a restart never
     * reshuffles the menu under a habit.
     */
    let restored = restorable_paths(&docs);
    if !restored.is_empty() {
        if let Some(paths) = app.state::<recent::RecentFiles>().backfill(restored) {
            persist_recent(&app, loc, &paths);
        }
    }

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
                // Not `document_location`: this one answers with
                // `file.sessionUnavailable`, which is different text in every
                // locale and is pinned by `all_file_keys_translate`. Folding it
                // into the helper would change a message a reader sees.
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
            // Whatever the frontend last saw of the file. It is the frontend's
            // to keep — the watch is there — so it travels through rather than
            // being taken again here, which would record the file as it is at
            // shutdown instead of as the buffer knew it.
            stat: document.stat,
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

    // Bound to the target for the same reason: neither crate exists on a phone.
    //
    // Registered in `setup` rather than on the builder, because the updater
    // refuses to initialise when `plugins.updater` is absent from the config —
    // and absent is how it ships, since it stays switched off behind
    // conf/updater-enabled.json until the signing keys exist. On the builder
    // that refusal takes the whole application down before it draws anything:
    // v0.1.9 and v0.2.0 both went out unable to start for exactly this.
    //
    // Here the error is a value instead of a panic. Without the config the
    // updater simply is not there, which is what the menu already assumes:
    // __UPDATER_ENABLED__ hides the entry in the same builds.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_process::init()).setup(|app| {
        if let Err(error) = app
            .handle()
            .plugin(tauri_plugin_updater::Builder::new().build())
        {
            eprintln!("the updater is not configured in this build: {error}");
        }
        // Read once, here rather than at `manage` time: finding the file needs
        // an app handle, and this is the first place there is one.
        app.state::<recent::RecentFiles>()
            .restore(load_recent(app.handle()));
        Ok(())
    });

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Registered for its Rust API only — `app.fs()` panics without it.
        // Its JS commands stay unreachable: capabilities/default.json does not
        // grant `fs:default`, so the frontend gains no new access to the disk.
        .plugin(tauri_plugin_fs::init())
        .manage(DocumentRegistry(Mutex::new(HashMap::new())))
        .manage(recent::RecentFiles::default())
        .invoke_handler(tauri::generate_handler![
            document::open_files,
            open_recent,
            recent_files,
            document::save_as,
            document::save_document,
            document::document_stat,
            image_stat,
            read_image,
            write_image,
            document::read_document,
            load_session,
            save_session,
            cli_files,
            export::export_pdf,
            export::print_document,
            export::write_pdf_bytes,
            export::write_html_file,
            system::alert,
            system::platform,
            system::exit_app
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

    /// A tree with a document, an image beside it and one a level up.
    ///
    /// Returns the document's path; everything hangs off its parent.
    fn image_fixture(name: &str) -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("meditor-img-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let notes = root.join("notes");
        std::fs::create_dir_all(notes.join("assets")).unwrap();
        std::fs::create_dir_all(root.join("shared")).unwrap();
        std::fs::write(notes.join("document.md"), "# Doc").unwrap();
        std::fs::write(notes.join("assets").join("shot.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        std::fs::write(root.join("shared").join("logo.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        std::fs::write(notes.join("secret.txt"), "not an image").unwrap();
        (notes.join("document.md"), root)
    }

    #[test]
    fn keeps_an_ordinary_image_name() {
        assert_eq!(sanitize_image_name("shot.png").as_deref(), Some("shot.png"));
        assert_eq!(
            sanitize_image_name("Captura de pantalla.PNG").as_deref(),
            Some("Captura de pantalla.PNG"),
        );
    }

    /// The name arrives from a pasted file, so it arrives from wherever that
    /// file did. Everything before the last separator is not part of it.
    #[test]
    fn takes_only_the_name_out_of_a_path() {
        for proposed in [
            "../../../etc/shot.png",
            r"..\..\windows\shot.png",
            "/absolute/shot.png",
            r"C:\Users\someone\shot.png",
        ] {
            assert_eq!(
                sanitize_image_name(proposed).as_deref(),
                Some("shot.png"),
                "{proposed:?}",
            );
        }
    }

    #[test]
    fn refuses_a_name_that_is_not_an_image() {
        assert_eq!(sanitize_image_name("notes.txt"), None);
        assert_eq!(sanitize_image_name("script.exe"), None);
        assert_eq!(sanitize_image_name("shot"), None);
        assert_eq!(sanitize_image_name(""), None);
        assert_eq!(sanitize_image_name("   "), None);
        // Nothing left once the separators are gone.
        assert_eq!(sanitize_image_name("../"), None);
    }

    #[test]
    fn steps_around_the_names_windows_reserves() {
        // `con.png` cannot be created on Windows at all.
        assert_eq!(
            sanitize_image_name("con.png").as_deref(),
            Some("image-con.png"),
        );
        assert_eq!(
            sanitize_image_name("LPT1.png").as_deref(),
            Some("image-LPT1.png"),
        );
        // A name that merely starts like one is left alone.
        assert_eq!(
            sanitize_image_name("console.png").as_deref(),
            Some("console.png"),
        );
    }

    #[test]
    fn drops_trailing_dots_and_the_characters_windows_refuses() {
        // Windows drops these silently, so the file created would not have the
        // name that was asked for.
        assert_eq!(
            sanitize_image_name("shot.png. ").as_deref(),
            Some("shot.png")
        );
        assert_eq!(
            sanitize_image_name("sh<o>t:\"|?*.png").as_deref(),
            Some("shot.png"),
        );
    }

    /// The naming and collision logic of `write_image`, without a Tauri app.
    ///
    /// The command itself needs an `AppHandle` and a registry, which a unit
    /// test has no way to build; what it does once it has a folder is this,
    /// and this is where the decisions are.
    fn write_into(folder: &Path, name: &str) -> String {
        let file_name = sanitize_image_name(name).expect("a usable name");
        std::fs::create_dir_all(folder).unwrap();
        let mut attempt = 0;
        loop {
            let candidate = if attempt == 0 {
                file_name.clone()
            } else {
                let path = Path::new(&file_name);
                let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
                match path.extension().and_then(|e| e.to_str()) {
                    Some(extension) => format!("{stem}-{attempt}.{extension}"),
                    None => format!("{stem}-{attempt}"),
                }
            };
            let target = folder.join(&candidate);
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
            {
                Ok(_) => return candidate,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => attempt += 1,
                Err(error) => panic!("{error}"),
            }
        }
    }

    #[test]
    fn gives_a_repeated_name_a_suffix_rather_than_overwriting() {
        let (document, root) = image_fixture("collide");
        let folder = document.parent().unwrap().join("assets");
        assert_eq!(write_into(&folder, "photo.png"), "photo.png");
        assert_eq!(write_into(&folder, "photo.png"), "photo-1.png");
        assert_eq!(write_into(&folder, "photo.png"), "photo-2.png");
        // And the first one is still there, with its own bytes.
        assert!(folder.join("photo.png").is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    /// The check that stops `assets` being a way out of the document's folder.
    ///
    /// Creating the directory and canonicalising it is what makes a symlink
    /// visible; comparing against the document's own canonical directory is
    /// what refuses it.
    #[cfg(unix)]
    #[test]
    fn refuses_an_assets_folder_that_leads_outside() {
        let (document, root) = image_fixture("escape");
        let parent = document.parent().unwrap();
        let outside = root.join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        let link = parent.join("assets-link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();

        let folder = link.canonicalize().unwrap();
        let confined = parent.canonicalize().unwrap();
        assert!(
            !folder.starts_with(&confined),
            "a symlinked assets folder must not count as being inside the document's own",
        );

        // And the real one does.
        let real = parent.join("assets").canonicalize().unwrap();
        assert!(real.starts_with(&confined));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_an_image_beside_the_document() {
        let (document, root) = image_fixture("beside");
        let resolved = resolve_image_path(Locale::En, &document, "assets/shot.png").unwrap();
        assert!(resolved.ends_with("shot.png"));
        assert!(resolved.is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    /// `../shared/logo.png` is how a folder of documents shares its pictures,
    /// and refusing it would make meditor the only editor that cannot open
    /// such a file. What keeps it safe is what may come back — an image, by
    /// extension, under the ceiling — not the shape of the path.
    #[test]
    fn resolves_an_image_a_level_up() {
        let (document, root) = image_fixture("levelup");
        let resolved = resolve_image_path(Locale::En, &document, "../shared/logo.png").unwrap();
        assert!(resolved.ends_with("logo.png"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_anything_that_is_not_a_relative_path() {
        let (document, root) = image_fixture("absolute");
        for rel in [
            "",
            "/etc/passwd",
            r"\\server\share\x.png",
            r"C:\Windows\x.png",
            "file:///etc/passwd",
            "https://example.com/x.png",
        ] {
            assert!(
                resolve_image_path(Locale::En, &document, rel).is_err(),
                "should have refused {rel:?}",
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    /// Refused because it is absolute, not because it happens not to exist.
    ///
    /// The list above proves less than it looks: `join` on an absolute path
    /// throws the base away, so those paths are also refused by the file
    /// simply not being there. This one points at a real image outside the
    /// document's tree, which resolves perfectly well the moment the check
    /// on the shape of the path is gone.
    #[test]
    fn refuses_an_absolute_path_that_would_otherwise_resolve() {
        let (document, root) = image_fixture("absolute-real");
        let outside = root.join("outside.png");
        std::fs::write(&outside, b"\x89PNG\r\n\x1a\n").unwrap();
        let absolute = outside.canonicalize().unwrap();
        let as_text = absolute.to_string_lossy().into_owned();

        // It is genuinely there, and genuinely an image.
        assert!(absolute.is_file());
        assert!(has_image_extension(&absolute));

        assert!(
            resolve_image_path(Locale::En, &document, &as_text).is_err(),
            "an absolute path must be refused even when it points at a real image",
        );
        let _ = std::fs::remove_dir_all(root);
    }

    /// The allow-list is what stops this command being a way to read the
    /// user's documents: only an image ever comes back through it.
    #[test]
    fn refuses_a_file_that_is_not_an_image() {
        let (document, root) = image_fixture("notimage");
        assert!(resolve_image_path(Locale::En, &document, "secret.txt").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_an_image_that_is_not_there() {
        let (document, root) = image_fixture("missing");
        assert!(resolve_image_path(Locale::En, &document, "assets/nope.png").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_a_directory_named_like_an_image() {
        let (document, root) = image_fixture("directory");
        std::fs::create_dir_all(document.parent().unwrap().join("folder.png")).unwrap();
        assert!(resolve_image_path(Locale::En, &document, "folder.png").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    /// The extension is read from the canonical path, so a link that reaches
    /// a non-image through a symlink with an image's name is still refused.
    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_lands_on_a_non_image() {
        let (document, root) = image_fixture("symlink");
        let link = document.parent().unwrap().join("innocent.png");
        std::os::unix::fs::symlink(document.parent().unwrap().join("secret.txt"), &link).unwrap();
        assert!(resolve_image_path(Locale::En, &document, "innocent.png").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_an_image_over_the_ceiling() {
        let (document, root) = image_fixture("toobig");
        let big = document.parent().unwrap().join("huge.png");
        std::fs::write(&big, vec![0u8; (MAX_IMAGE_BYTES + 1) as usize]).unwrap();
        assert!(resolve_image_path(Locale::En, &document, "huge.png").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_an_extension_in_any_case() {
        let (document, root) = image_fixture("case");
        std::fs::write(document.parent().unwrap().join("Shot.PNG"), b"\x89PNG").unwrap();
        assert!(resolve_image_path(Locale::En, &document, "Shot.PNG").is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_missing_path_is_missing_and_a_present_one_is_not() {
        // The distinction the recent list rests on: a row that has gone is
        // said by name, and anything else keeps its own error. `is_file` was
        // the old test and answers false for both.
        let root = std::env::temp_dir().join(format!("meditor-missing-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let there = root.join("there.md");
        std::fs::write(&there, "x").unwrap();
        assert!(
            !path_is_missing(&there),
            "a file that exists is not missing"
        );
        assert!(
            path_is_missing(&root.join("never-written.md")),
            "a path with nothing at it is missing"
        );
        // A directory is not missing either — it is the wrong kind of thing,
        // which `normalize_path` refuses further along with a message of its
        // own rather than a name and a shrug.
        assert!(
            !path_is_missing(&root),
            "a directory is present, just not a file"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    /// A document as the session restore builds them, with only the two
    /// fields `restorable_paths` reads spelled out.
    fn restored_doc(path: Option<&str>, handle: Option<&str>) -> NativeDocument {
        NativeDocument {
            id: "1".into(),
            name: "document.md".into(),
            path: path.map(str::to_owned),
            content: String::new(),
            dirty: false,
            handle: handle.map(str::to_owned),
            kind: DocumentKind::Markdown,
            stat: None,
        }
    }

    #[test]
    fn only_a_document_still_attached_to_its_file_is_worth_remembering() {
        // A restored tab whose file moved, changed or was deleted comes back
        // without a handle. Offering it in a menu that promises to reopen
        // things is offering a door that does not open.
        let docs = [
            restored_doc(Some("/work/attached.md"), Some("h1")),
            restored_doc(Some("/work/moved.md"), None),
            restored_doc(None, None),
        ];
        assert_eq!(
            restorable_paths(&docs),
            [PathBuf::from("/work/attached.md")],
        );
    }

    #[test]
    fn a_document_with_no_path_is_not_remembered_even_with_a_handle() {
        // Belt and braces: a handle without a path cannot name a file, and
        // unwrapping one would be the bug this asserts against.
        let docs = [restored_doc(None, Some("h1"))];
        assert!(restorable_paths(&docs).is_empty());
    }

    #[test]
    fn a_session_carries_the_file_fingerprint_both_ways() {
        /*
         * The join between the two halves of the fix.
         *
         * Reattaching the file is what lets the watch see it at all; the
         * fingerprint is what lets the watch tell "the writer had unsaved
         * work" from "something else wrote this while we were away". The
         * second only works if it survives the session file, and nothing else
         * here would notice if it stopped.
         */
        let stat = DocumentStat {
            modified_ms: Some(1_726_000_000_000),
            size: Some(4096),
        };
        let stored = StoredSession {
            version: default_session_version(),
            docs: vec![StoredDocument {
                id: "1".into(),
                name: "document.md".into(),
                path: Some("/tmp/document.md".into()),
                content: "hello".into(),
                dirty: true,
                kind: Some(DocumentKind::Markdown),
                stat: Some(stat.clone()),
            }],
            active_id: "1".into(),
            split: 50.0,
        };

        let json = serde_json::to_string(&stored).unwrap();
        let back: StoredSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.docs[0].stat, Some(stat));

        // And a session written by a build that kept none still loads, with
        // nothing to compare against rather than a refusal.
        let older = r#"{"version":1,"docs":[{"id":"1","name":"d.md","path":null,
            "content":"hello","dirty":false}],"activeId":"1","split":50.0}"#;
        let older: StoredSession = serde_json::from_str(older).unwrap();
        assert_eq!(older.docs[0].stat, None);
    }

    #[test]
    fn restores_a_handle_for_a_file_that_is_there_however_it_changed() {
        let root =
            std::env::temp_dir().join(format!("meditor-session-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("document.md");
        std::fs::write(&path, "same").unwrap();
        let registry = DocumentRegistry(Mutex::new(HashMap::new()));

        let (restored_path, handle) = restore_session_path(Locale::En, &registry, path.to_str());
        // `normalize_path` canonicalizes existing files, which resolves
        // symlinks (macOS /var → /private/var) and Windows `\\?\` prefixes.
        let expected = std::fs::canonicalize(&path).unwrap();
        assert_eq!(restored_path, Some(expected.to_string_lossy().into_owned()));
        assert!(handle.is_some());

        /*
         * The assertion that used to say the opposite, and is the whole of
         * this change.
         *
         * A file edited by something else while meditor was closed came back
         * with its path and no handle — and the external-change watch skips a
         * document that has none, so it was never watched again. Not after
         * three seconds, not after a restart, because the comparison that
         * dropped the handle failed identically every time. Reattaching is
         * what lets the watch see the file and either reload it or ask.
         */
        std::fs::write(&path, "changed by somebody else").unwrap();
        let (_, changed_handle) = restore_session_path(Locale::En, &registry, path.to_str());
        assert!(
            changed_handle.is_some(),
            "a file that is still there is still ours to watch"
        );

        // Gone is a different thing: there is nothing to attach to, and the
        // next save has to ask where to put it.
        std::fs::remove_file(&path).unwrap();
        let (gone_path, gone_handle) = restore_session_path(Locale::En, &registry, path.to_str());
        assert!(
            gone_handle.is_none(),
            "a file that is gone cannot be saved to"
        );
        assert!(gone_path.is_some(), "but its name is still worth showing");

        // A directory is not a document either, however well it resolves.
        let (_, dir_handle) = restore_session_path(Locale::En, &registry, root.to_str());
        assert!(
            dir_handle.is_none(),
            "a directory is not a file to reattach"
        );

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
