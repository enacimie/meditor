mod document;
mod export;
mod image;
mod locale;
mod location;
mod paper;
mod recent;
mod session;
mod system;

use document::{document_from_location, documents_from_locations, NativeDocument};
use locale::{parse_locale, Locale};
use location::{as_path, write_atomic, DocumentRegistry, Location};
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

fn files_from_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| std::fs::canonicalize(arg).ok())
        .filter(|path| path.is_file())
        .collect()
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

/// Write the recent list out.
///
/// Split from `remember_recent` because the startup backfill produces the same
/// list by a different route and has to store it the same way. Failures are
/// reported and swallowed: losing the recent list must never be the reason an
/// open, a save or a restore fails.
pub(crate) fn persist_recent(app: &tauri::AppHandle, locale: Locale, paths: &[PathBuf]) {
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
            session::load_session,
            session::save_session,
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
