//! A file beside a document, reached by a path relative to it.
//!
//! More than one thing reads the files next to the document they belong to:
//! the images a Markdown document shows, and, after it, the files a Typst
//! document includes and the bibliography of either. Every question about such
//! a path has a security answer — never an absolute path, never a URL, never a
//! file of a kind the caller did not ask for, never one past a size — and the
//! answers live here, once. What varies from caller to caller is given as data
//! ([`Rules`]), and why a path was refused comes back as a [`Refusal`] for the
//! caller to put into words.
//!
//! The path arrives from the frontend and the document it is relative to comes
//! from the handle registry, so the frontend can name neither a base directory
//! nor anything outside what the rules let it reach.

use std::path::{Path, PathBuf};

/// What a caller lets a path beside the document reach.
pub struct Rules {
    /// The extensions that may be read, in lower case. Read from the file the
    /// path actually lands on, links followed, not from the path as written.
    pub extensions: &'static [&'static str],
    /// The most a file may weigh, in bytes.
    pub max_bytes: u64,
    /// Whether `..` may take the path above the document's folder. Images
    /// allow it (`../shared/logo.png` is how a folder of documents shares its
    /// pictures); what keeps that safe is what may come back through it.
    pub may_climb: bool,
    /// Whether a component of the path may be hidden: start with a dot, as
    /// `.git` does. `.` itself always may.
    pub may_be_hidden: bool,
    /// Whether the file, links followed, has to be inside the document's
    /// folder. The shape of the path cannot promise that on its own: a
    /// symbolic link inside the folder may lead anywhere.
    pub must_stay_inside: bool,
}

/// Why a path was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Not a relative path: empty, with a NUL in it, a URL, or absolute in any
    /// notation. Or one the rules do not let through: climbing out, or hidden.
    Invalid,
    /// Nothing to read there: no such file, or a directory.
    NotFound,
    /// A file of a kind the rules do not allow.
    Unsupported,
    /// A file heavier than the rules allow.
    TooLarge,
    /// A file that, links followed, lies outside the document's folder.
    Outside,
}

/// The file `rel_path` names beside `document`, if the rules let it be read.
///
/// The checks on the shape of the path come first, before the filesystem is
/// asked anything, so an absolute path or a URL is refused for what it is and
/// not merely because nothing happens to be there.
pub fn resolve(document: &Path, rel_path: &str, rules: &Rules) -> Result<PathBuf, Refusal> {
    if rel_path.is_empty() || rel_path.contains('\0') {
        return Err(Refusal::Invalid);
    }
    // A URL is not a relative path, whatever it looks like. Checked before
    // anything else so `file://…` and `https://…` cannot arrive as one.
    if rel_path.contains("://") {
        return Err(Refusal::Invalid);
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
        return Err(Refusal::Invalid);
    }
    // Split on both separators: `..\x` is a way up on Windows, and a Linux
    // build must refuse it just the same.
    for part in rel_path.split(['/', '\\']) {
        if part == ".." && !rules.may_climb {
            return Err(Refusal::Invalid);
        }
        if part.starts_with('.') && part != "." && part != ".." && !rules.may_be_hidden {
            return Err(Refusal::Invalid);
        }
    }

    let parent = document.parent().ok_or(Refusal::Invalid)?;
    // Canonicalising is what turns `a/../b` into `b` and follows any links,
    // so everything below is asked of the file that would actually be read.
    let resolved = parent
        .join(rel_path)
        .canonicalize()
        .map_err(|_| Refusal::NotFound)?;
    if rules.must_stay_inside {
        let folder = parent.canonicalize().map_err(|_| Refusal::NotFound)?;
        if !resolved.starts_with(&folder) {
            return Err(Refusal::Outside);
        }
    }

    let metadata = std::fs::metadata(&resolved).map_err(|_| Refusal::NotFound)?;
    if !metadata.is_file() {
        return Err(Refusal::NotFound);
    }
    if !has_extension(&resolved, rules.extensions) {
        return Err(Refusal::Unsupported);
    }
    if metadata.len() > rules.max_bytes {
        return Err(Refusal::TooLarge);
    }
    Ok(resolved)
}

/// Whether `path` ends in one of `extensions`, in any case.
pub fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let lower = extension.to_ascii_lowercase();
            extensions.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rules the stricter callers will use: no climbing, nothing hidden,
    /// and inside the folder once links are followed.
    const STRICT: Rules = Rules {
        extensions: &["typ", "bib"],
        max_bytes: 64,
        may_climb: false,
        may_be_hidden: false,
        must_stay_inside: true,
    };

    /// The same, with every door open, to show which rule does the refusing.
    const LENIENT: Rules = Rules {
        extensions: &["typ", "bib"],
        max_bytes: 64,
        may_climb: true,
        may_be_hidden: true,
        must_stay_inside: false,
    };

    /// A document with a chapter beside it, a hidden folder, a bibliography a
    /// level up and a file too big for the rules.
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("meditor-beside-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = root.join("book");
        std::fs::create_dir_all(folder.join("chapters")).unwrap();
        std::fs::create_dir_all(folder.join(".cache")).unwrap();
        std::fs::write(folder.join("main.typ"), "= Book").unwrap();
        std::fs::write(folder.join("chapters").join("one.typ"), "= One").unwrap();
        std::fs::write(folder.join(".cache").join("old.typ"), "= Old").unwrap();
        std::fs::write(folder.join(".hidden.typ"), "= Hidden").unwrap();
        std::fs::write(folder.join("big.typ"), vec![b'x'; 65]).unwrap();
        std::fs::write(root.join("refs.bib"), "@book{a, title={A}}").unwrap();
        (folder.join("main.typ"), root)
    }

    #[test]
    fn resolves_a_file_in_a_folder_beside_the_document() {
        let (document, root) = fixture("beside");
        let resolved = resolve(&document, "chapters/one.typ", &STRICT).unwrap();
        assert!(resolved.ends_with("one.typ"));
        let with_dot = resolve(&document, "./chapters/one.typ", &STRICT).unwrap();
        assert_eq!(with_dot, resolved);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_a_way_up_only_when_the_rules_say_so() {
        let (document, root) = fixture("climb");
        for rel in [
            "../refs.bib",
            "chapters/../../refs.bib",
            r"chapters\..\..\refs.bib",
        ] {
            assert_eq!(
                resolve(&document, rel, &STRICT),
                Err(Refusal::Invalid),
                "{rel:?}"
            );
        }
        assert!(resolve(&document, "../refs.bib", &LENIENT).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_a_hidden_component_only_when_the_rules_say_so() {
        let (document, root) = fixture("hidden");
        for rel in [".cache/old.typ", ".hidden.typ", r"chapters\.x\y.typ"] {
            assert_eq!(
                resolve(&document, rel, &STRICT),
                Err(Refusal::Invalid),
                "{rel:?}"
            );
        }
        assert!(resolve(&document, ".cache/old.typ", &LENIENT).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    /// The shape of the path is inside; the file it lands on is not.
    #[cfg(unix)]
    #[test]
    fn refuses_a_link_that_leads_outside_only_when_the_rules_say_so() {
        let (document, root) = fixture("outside");
        let link = document.parent().unwrap().join("refs.bib");
        std::os::unix::fs::symlink(root.join("refs.bib"), &link).unwrap();
        assert_eq!(
            resolve(&document, "refs.bib", &STRICT),
            Err(Refusal::Outside)
        );
        assert!(resolve(&document, "refs.bib", &LENIENT).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn says_why_a_path_was_refused() {
        let (document, root) = fixture("why");
        assert_eq!(resolve(&document, "", &STRICT), Err(Refusal::Invalid));
        assert_eq!(
            resolve(&document, "https://example.com/a.typ", &STRICT),
            Err(Refusal::Invalid)
        );
        assert_eq!(
            resolve(&document, "/etc/passwd", &STRICT),
            Err(Refusal::Invalid)
        );
        assert_eq!(
            resolve(&document, r"C:\a.typ", &STRICT),
            Err(Refusal::Invalid)
        );
        assert_eq!(
            resolve(&document, "chapters/two.typ", &STRICT),
            Err(Refusal::NotFound)
        );
        assert_eq!(
            resolve(&document, "chapters", &STRICT),
            Err(Refusal::NotFound)
        );
        std::fs::write(document.parent().unwrap().join("notes.txt"), "text").unwrap();
        assert_eq!(
            resolve(&document, "notes.txt", &STRICT),
            Err(Refusal::Unsupported)
        );
        assert_eq!(
            resolve(&document, "big.typ", &STRICT),
            Err(Refusal::TooLarge)
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reads_the_extension_in_any_case() {
        assert!(has_extension(Path::new("Refs.BIB"), &["bib"]));
        assert!(!has_extension(Path::new("refs.bib.txt"), &["bib"]));
        assert!(!has_extension(Path::new("bib"), &["bib"]));
    }
}
