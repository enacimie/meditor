//! The tabs that come back when the application opens again.
//!
//! `session.json` holds what was open, what was in each buffer, and the
//! fingerprint each file had when it was last seen. That last part is what
//! lets a restart tell “you had unsaved work” from “something else rewrote
//! this while you were away”, and `restore_session_path` is what reattaches
//! a document to its file so the watch can look at it at all.

use crate::document::{kind_from_path, DocumentKind, DocumentStat, NativeDocument};
use crate::locale::{parse_locale, t, Locale};
use crate::location::{
    location_display, normalize_path, register_normalized, write_atomic, DocumentRegistry,
    MAX_FILE_BYTES,
};
use crate::recent;
use crate::recent_menu::persist_recent;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
pub struct SessionInput {
    docs: Vec<SessionDocumentInput>,
    active_id: String,
    split: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRestore {
    docs: Vec<NativeDocument>,
    active_id: String,
    split: f64,
}

fn default_session_version() -> u32 {
    0
}

fn session_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
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

#[tauri::command]
pub fn load_session(
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
     * still resolves to a file. Anything else — moved, deleted, or an Android
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
pub fn save_session(
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

#[cfg(test)]
mod tests {
    use super::*;
    // The registry is built by hand here, which is the one place outside
    // `location.rs` that needs its innards.
    use std::collections::HashMap;
    use std::sync::Mutex;

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
}
