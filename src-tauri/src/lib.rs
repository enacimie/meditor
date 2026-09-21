mod document;
mod export;
mod image;
mod locale;
mod location;
mod paper;
mod recent;
mod system;

use document::{
    document_from_location, documents_from_locations, kind_from_path, DocumentKind, DocumentStat,
    NativeDocument,
};
use locale::{parse_locale, t, Locale};
use location::{
    as_path, location_display, normalize_path, register_normalized, write_atomic, DocumentRegistry,
    Location, MAX_FILE_BYTES,
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
            image::image_stat,
            image::read_image,
            image::write_image,
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
