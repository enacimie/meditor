//! The document as the frontend sees it, and the commands that open and
//! save one.
//!
//! `NativeDocument` is what crosses the IPC boundary; `DocumentStat` is the
//! cheap fingerprint the watch compares to notice a file rewritten behind
//! the application's back. Everything here goes through `location.rs` for
//! the path-or-content-URI branch rather than repeating it.

use crate::locale::{parse_locale, tf, Locale};
use crate::location::{
    as_path, document_location, location_display, location_name, max_file_mib, next_handle,
    normalize_location, read_location, register_normalized, write_location, DocumentRegistry,
    Location, MAX_FILE_BYTES,
};
use crate::recent_menu::remember_recent;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FsExt, OpenOptions};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    #[default]
    Markdown,
    Typst,
    Latex,
}

pub fn kind_from_path(path: &Path) -> DocumentKind {
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
pub struct NativeDocument {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub content: String,
    pub dirty: bool,
    pub handle: Option<String>,
    pub kind: DocumentKind,
    /// The file as it was when these bytes were read, so the frontend's
    /// external-change watch starts from a line it knows rather than from
    /// nothing. `None` where there is no file to fingerprint.
    #[serde(default)]
    pub stat: Option<DocumentStat>,
}

pub fn document_from_location(
    app: &tauri::AppHandle,
    locale: Locale,
    location: Location,
    registry: &DocumentRegistry,
) -> Result<NativeDocument, String> {
    let normalized = normalize_location(locale, location)?;
    let content = read_location(app, locale, &normalized)?;
    let name = location_name(app, locale, &normalized);
    let handle = register_normalized(locale, registry, normalized.clone())?;
    remember_recent(app, locale, &normalized);
    // Taken beside the read, so the watch begins from the file these bytes
    // came from rather than from whatever it is by the first tick.
    let stat = location_stat(app, &normalized);
    Ok(NativeDocument {
        id: next_handle(),
        // The extension is read off the name rather than the location: a
        // content URI's own text says nothing about the format.
        kind: kind_from_path(Path::new(&name)),
        name,
        path: Some(location_display(&normalized)),
        content,
        dirty: false,
        stat,
        handle: Some(handle),
    })
}

pub fn documents_from_locations(
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

pub fn saved_document(
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
    // "Save as" is how a document gets a path in the first place, so it counts
    // as having been opened from there.
    remember_recent(app, locale, &normalized);
    let stat = location_stat(app, &normalized);
    Ok(NativeDocument {
        id: next_handle(),
        kind: kind_from_path(Path::new(&name)),
        name,
        path: Some(location_display(&normalized)),
        content,
        dirty: false,
        handle: Some(handle),
        stat,
    })
}

#[tauri::command]
pub fn open_files(
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
pub fn save_as(
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
pub fn save_document(
    app: tauri::AppHandle,
    handle: String,
    content: String,
    registry: tauri::State<'_, DocumentRegistry>,
    locale: Option<String>,
) -> Result<Option<DocumentStat>, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(tf(loc, "file.contentTooLarge", &max_file_mib().to_string()));
    }
    write_location(&app, loc, &location, content.as_bytes())?;
    /*
     * The fingerprint of what was just written, taken here.
     *
     * The frontend used to ask for it in a second command, and between the
     * two another process could write the same file: its fingerprint would be
     * adopted as ours, and the watcher would then believe the disk matched a
     * buffer it no longer does — silently, until the file moved again. Taken
     * in the same function the window is a syscall wide instead of a round
     * trip through the webview's event loop.
     *
     * `None` when the location cannot be stat'ed at all, which some Android
     * content providers cannot; the frontend falls back to asking.
     */
    let stat = location_stat(&app, &location);
    // Saving is the other way a document says it is the one being worked on.
    // Without this a document opened once and edited all week slides off the
    // end of the list while ten it was never touched sit above it.
    remember_recent(&app, loc, &location);
    Ok(stat)
}

/// A cheap fingerprint of the file behind an open document.
///
/// Both fields are optional because not every filesystem answers every
/// question: some Android content providers report a size but a zeroed
/// timestamp, and either alone still detects the edits this exists for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentStat {
    pub modified_ms: Option<u64>,
    pub size: Option<u64>,
}

fn system_time_ms(time: std::time::SystemTime) -> Option<u64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

pub fn metadata_stat(metadata: &std::fs::Metadata) -> DocumentStat {
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
pub fn location_stat(app: &tauri::AppHandle, location: &Location) -> Option<DocumentStat> {
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
pub fn document_stat(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    locale: Option<String>,
) -> Result<Option<DocumentStat>, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    Ok(location_stat(&app, &location))
}

/// Read the current bytes of one open document, for reloading after an
/// external edit. Size-checked like any other read path.
#[tauri::command]
pub fn read_document(
    app: tauri::AppHandle,
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    locale: Option<String>,
) -> Result<String, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    read_location(&app, loc, &location)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
