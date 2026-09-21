//! Where a document lives, and the safe ways to read and write it.
//!
//! A `Location` is a real path or an Android `content://` URI, and almost
//! every branch between those two lives here rather than in the commands.
//! `DocumentRegistry` hands the frontend an opaque handle instead of a path,
//! so nothing it sends back can name a file of its own choosing.

use crate::locale::{t, tf, Locale};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

pub fn max_file_mib() -> u64 {
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
pub type Location = FilePath;

pub struct DocumentRegistry(pub Mutex<HashMap<String, Location>>);

/// The filesystem path a location denotes, if it is one.
///
/// Every desktop caller gets `Some` and carries on as before; a content URI
/// is the only thing that yields `None`.
pub fn as_path(location: &Location) -> Option<&Path> {
    match location {
        FilePath::Path(path) => Some(path.as_path()),
        FilePath::Url(_) => None,
    }
}

/// What the frontend shows and stores in the session.
pub fn location_display(location: &Location) -> String {
    match location {
        FilePath::Path(path) => path.to_string_lossy().into_owned(),
        FilePath::Url(url) => url.to_string(),
    }
}

/// The document's own name.
///
/// A content URI carries no file name in its text — the name lives in the
/// provider's metadata, which is what `PathResolver::file_name` queries.
pub fn location_name(app: &tauri::AppHandle, locale: Locale, location: &Location) -> String {
    match location {
        FilePath::Path(path) => base_name(locale, path),
        FilePath::Url(url) => app
            .path()
            .file_name(url.as_str())
            .unwrap_or_else(|| t(locale, "doc.untitled")),
    }
}

/// Read a document, whatever it is stored behind.
pub fn read_location(
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
pub fn write_location(
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

pub fn next_handle() -> String {
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

pub fn normalize_path(locale: Locale, path: &Path) -> Result<PathBuf, String> {
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

pub fn register_normalized(
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
pub fn normalize_location(locale: Locale, location: Location) -> Result<Location, String> {
    match as_path(&location) {
        Some(path) => normalize_path(locale, path).map(FilePath::Path),
        None => Ok(location),
    }
}

pub fn write_atomic(locale: Locale, path: &Path, content: &str) -> Result<(), String> {
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

/// Look a document up by handle, as every command that touches one does.
pub fn document_location(
    registry: &tauri::State<'_, DocumentRegistry>,
    locale: Locale,
    handle: &str,
) -> Result<Location, String> {
    registry
        .0
        .lock()
        .map_err(|_| t(locale, "file.registryLock"))?
        .get(handle)
        .cloned()
        .ok_or_else(|| t(locale, "file.documentUnavailable"))
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
}
