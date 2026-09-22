//! The recent documents list, and the file it is kept in.
//!
//! The frontend is handed names to draw and clicks them by position; it
//! never sees a path and cannot ask for one to be opened. That is the whole
//! design, and `open_recent` taking an index rather than a path is where it
//! is enforced.

use crate::document::{document_from_location, NativeDocument};
use crate::locale::{parse_locale, Locale};
use crate::location::{as_path, write_atomic, DocumentRegistry, Location};
use crate::recent;
use std::path::{Path, PathBuf};
use tauri::Manager;

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
#[cfg_attr(
    mobile,
    allow(dead_code, reason = "read at startup, and only desktop has that setup")
)]
pub fn load_recent(app: &tauri::AppHandle) -> Vec<PathBuf> {
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
pub fn remember_recent(app: &tauri::AppHandle, locale: Locale, location: &Location) {
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
pub fn persist_recent(app: &tauri::AppHandle, locale: Locale, paths: &[PathBuf]) {
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
pub fn recent_files(recent: tauri::State<'_, recent::RecentFiles>) -> Vec<recent::RecentEntry> {
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
pub fn open_recent(
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
}
