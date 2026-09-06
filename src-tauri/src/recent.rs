//! The documents opened lately, remembered so they can be reopened.
//!
//! The list lives here and not in the frontend, and that is the whole point of
//! the module. Reopening by name would mean a command that takes a path from
//! the webview and reads it, which hands the web layer the one power the rest
//! of this file is careful never to give it. Instead the webview is told names
//! to draw and asks for an *index*; which file that is, is decided here.
//!
//! Only real paths are remembered. Android hands the app a `content://` URI
//! whose permission does not outlive the process that was granted it, so
//! putting one in a list called "recent" would promise something that cannot
//! be delivered.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// How many to keep. Enough to cover a working session, short enough that the
/// menu stays a menu.
const MAX_RECENT: usize = 10;

/// One entry, as the menu needs it: something to show, and where it is.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    /// The file's own name, for the menu label.
    pub name: String,
    /// The full path, for the tooltip that tells two `notes.md` apart.
    pub path: String,
}

/// The remembered paths, most recently opened first.
#[derive(Default)]
pub struct RecentFiles(Mutex<Vec<PathBuf>>);

/// Put `path` at the front, with no duplicate behind it, capped at `MAX_RECENT`.
///
/// Free of the mutex and of the disk so the ordering rules can be tested for
/// what they are.
fn promote(paths: &mut Vec<PathBuf>, path: PathBuf) {
    paths.retain(|existing| existing != &path);
    paths.insert(0, path);
    paths.truncate(MAX_RECENT);
}

/// Drop what is no longer there, and any duplicate that slipped in.
///
/// A recent list that offers a file which has been moved or deleted is worse
/// than a short one, and the check is a `stat` per entry on a list of ten.
fn prune(paths: &mut Vec<PathBuf>) {
    let mut seen = HashSet::new();
    paths.retain(|path| path.is_file() && seen.insert(path.clone()));
    paths.truncate(MAX_RECENT);
}

/// The name to show for a path, falling back to the whole path.
fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

impl RecentFiles {
    /// Remember a path, and hand back the list to store.
    ///
    /// Returns `None` when nothing changed in a way worth writing — which is
    /// never, today, but keeps the caller from having to know that.
    pub fn remember(&self, path: PathBuf) -> Option<Vec<PathBuf>> {
        let mut paths = self.0.lock().ok()?;
        promote(&mut paths, path);
        Some(paths.clone())
    }

    /// What the menu should draw, freshest first, with the gone ones removed.
    ///
    /// This is the only place that prunes, and it is what fixes the indices
    /// the menu then uses: whatever this returns is the list a later
    /// [`Self::path_at`] indexes into.
    pub fn entries(&self) -> Vec<RecentEntry> {
        let Ok(mut paths) = self.0.lock() else {
            return Vec::new();
        };
        prune(&mut paths);
        paths
            .iter()
            .map(|path| RecentEntry {
                name: display_name(path),
                path: path.to_string_lossy().into_owned(),
            })
            .collect()
    }

    /// The path the menu's nth entry stands for.
    ///
    /// Deliberately does *not* prune. The menu was drawn from the list
    /// [`Self::entries`] left behind, and a file deleted in between would
    /// shift every index after it — so pruning here would open the document
    /// that slid up into the clicked row rather than the one aimed at. A path
    /// that has gone fails on the read instead, which says so, and the next
    /// [`Self::entries`] drops it.
    pub fn path_at(&self, index: usize) -> Option<PathBuf> {
        self.0.lock().ok()?.get(index).cloned()
    }

    /// Take on what was read from disk, at startup.
    ///
    /// Separate from [`Self::from_stored`] because the state is managed before
    /// there is an app handle to find the file with.
    pub fn restore(&self, stored: Vec<PathBuf>) {
        let Ok(mut paths) = self.0.lock() else { return };
        *paths = stored;
        prune(&mut paths);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of real files, since pruning asks the filesystem.
    fn scratch(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("meditor-recent-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    /// A store holding `paths`, built the way the app builds it at startup.
    fn restored(paths: Vec<PathBuf>) -> RecentFiles {
        let recent = RecentFiles::default();
        recent.restore(paths);
        recent
    }

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn the_newest_goes_first() {
        let mut paths = vec![PathBuf::from("/a"), PathBuf::from("/b")];
        promote(&mut paths, PathBuf::from("/c"));
        assert_eq!(
            paths,
            [
                PathBuf::from("/c"),
                PathBuf::from("/a"),
                PathBuf::from("/b")
            ]
        );
    }

    #[test]
    fn reopening_moves_it_up_rather_than_listing_it_twice() {
        let mut paths = vec![
            PathBuf::from("/a"),
            PathBuf::from("/b"),
            PathBuf::from("/c"),
        ];
        promote(&mut paths, PathBuf::from("/c"));
        assert_eq!(
            paths,
            [
                PathBuf::from("/c"),
                PathBuf::from("/a"),
                PathBuf::from("/b")
            ]
        );
    }

    #[test]
    fn the_list_stops_at_ten() {
        let mut paths = Vec::new();
        for i in 0..15 {
            promote(&mut paths, PathBuf::from(format!("/f{i}")));
        }
        assert_eq!(paths.len(), MAX_RECENT);
        assert_eq!(paths[0], PathBuf::from("/f14"), "the newest should survive");
        assert_eq!(
            paths[9],
            PathBuf::from("/f5"),
            "the oldest should have fallen off"
        );
    }

    #[test]
    fn a_file_that_is_gone_is_dropped() {
        let dir = scratch("gone");
        let kept = touch(&dir, "kept.md");
        let removed = touch(&dir, "removed.md");
        std::fs::remove_file(&removed).unwrap();
        let mut paths = vec![kept.clone(), removed, dir.clone()];
        prune(&mut paths);
        assert_eq!(paths, [kept], "only the file that is still a file survives");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_menu_and_the_index_see_the_same_list() {
        let dir = scratch("agree");
        let first = touch(&dir, "first.md");
        let doomed = touch(&dir, "doomed.md");
        let last = touch(&dir, "last.md");
        let recent = restored(vec![first.clone(), doomed.clone(), last.clone()]);

        std::fs::remove_file(&doomed).unwrap();
        let entries = recent.entries();
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["first.md", "last.md"],
        );
        assert_eq!(recent.path_at(0), Some(first));
        assert_eq!(
            recent.path_at(1),
            Some(last),
            "index 1 is what the menu drew there"
        );
        assert_eq!(
            recent.path_at(2),
            None,
            "past the end is nothing, not a panic"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_click_opens_the_row_it_was_aimed_at() {
        // The menu is a snapshot. If a file disappears after it is drawn, the
        // rows below the hole must not slide up underneath the pointer: the
        // click has to reach the document the user could see there.
        let dir = scratch("aimed");
        let first = touch(&dir, "first.md");
        let doomed = touch(&dir, "doomed.md");
        let last = touch(&dir, "last.md");
        let recent = restored(vec![first, doomed.clone(), last.clone()]);

        let drawn = recent.entries();
        assert_eq!(drawn.len(), 3, "all three are there when the menu opens");
        std::fs::remove_file(&doomed).unwrap();

        assert_eq!(
            recent.path_at(2),
            Some(last),
            "row 2 was last.md when it was drawn and must still be last.md",
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn entries_are_named_by_their_file() {
        let dir = scratch("named");
        let path = touch(&dir, "Mi documento.md");
        let recent = restored(vec![path.clone()]);
        let entries = recent.entries();
        assert_eq!(entries[0].name, "Mi documento.md");
        assert_eq!(entries[0].path, path.to_string_lossy());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remembering_hands_back_what_to_store() {
        let recent = RecentFiles::default();
        let stored = recent.remember(PathBuf::from("/a")).unwrap();
        assert_eq!(stored, [PathBuf::from("/a")]);
        let stored = recent.remember(PathBuf::from("/b")).unwrap();
        assert_eq!(stored, [PathBuf::from("/b"), PathBuf::from("/a")]);
    }
}
