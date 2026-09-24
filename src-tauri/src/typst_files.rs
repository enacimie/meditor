//! The files a Typst document reads from beside it.
//!
//! A Typst document is more than its own text: `#include "chapter.typ"`,
//! `#image("figure.png")`, `json("data.json")`, `#bibliography("refs.bib")`.
//! Its compiler runs in the webview, which has no filesystem, so the frontend
//! asks for each file here, by the path the document wrote.
//!
//! The rules are stricter than an image's. A Typst document can `read()` a
//! file and set its text on the page, so what it may reach is kept to its own
//! folder: no `..`, nothing hidden, nothing a link leads out to. And to the
//! kinds of file Typst reads as a document's material — its own sources,
//! images, data, bibliographies and citation styles. Not a plugin (`.wasm`),
//! which is code, and not a font, which is the compiler's own business.

use crate::beside::{self, Refusal, Rules};
use crate::document::{metadata_stat, DocumentStat};
use crate::locale::{parse_locale, t};
use crate::location::{as_path, document_location, DocumentRegistry, Location};
use serde::Serialize;
use std::path::Path;

/// What a Typst document may read from beside it, by extension.
const TYPST_EXTENSIONS: [&str; 17] = [
    "typ", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "bib", "yml", "yaml", "json", "toml",
    "csv", "xml", "txt", "csl",
];

/// The most one file may weigh. The frontend also caps what one document
/// reads in all.
const MAX_TYPST_FILE_BYTES: u64 = 32 * 1024 * 1024;

const TYPST_RULES: Rules = Rules {
    extensions: &TYPST_EXTENSIONS,
    max_bytes: MAX_TYPST_FILE_BYTES,
    may_climb: false,
    may_be_hidden: false,
    must_stay_inside: true,
};

/// Why a file beside a Typst document may not be read.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefusedBecause {
    /// Not a path inside the document's folder: it climbs out, or goes
    /// through something hidden.
    Invalid,
    /// A link inside the folder that leads out of it.
    Outside,
    /// Not a kind of file a Typst document reads here.
    Unsupported,
    /// Over the ceiling.
    TooLarge,
}

/// What the frontend learns about one path, before it reads anything.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum TypstFileStat {
    /// There and readable, with the fingerprint that says whether the bytes
    /// the frontend holds are still the file's.
    Found { stat: DocumentStat },
    /// Nothing there, or a directory.
    Missing,
    /// The rules do not let it be read, whatever is there.
    Refused { reason: RefusedBecause },
    /// The document has no folder to look in: a content URI, as Android
    /// hands over one document and nothing around it.
    Unavailable,
}

fn file_stat(document: &Path, rel_path: &str) -> TypstFileStat {
    match beside::resolve(document, rel_path, &TYPST_RULES) {
        Ok(resolved) => match std::fs::metadata(&resolved) {
            Ok(metadata) => TypstFileStat::Found {
                stat: metadata_stat(&metadata),
            },
            Err(_) => TypstFileStat::Missing,
        },
        Err(Refusal::NotFound) => TypstFileStat::Missing,
        Err(Refusal::Invalid) => TypstFileStat::Refused {
            reason: RefusedBecause::Invalid,
        },
        Err(Refusal::Outside) => TypstFileStat::Refused {
            reason: RefusedBecause::Outside,
        },
        Err(Refusal::Unsupported) => TypstFileStat::Refused {
            reason: RefusedBecause::Unsupported,
        },
        Err(Refusal::TooLarge) => TypstFileStat::Refused {
            reason: RefusedBecause::TooLarge,
        },
    }
}

/// What the frontend learns about `rel_path` beside the document at `location`.
fn stat_beside(location: &Location, rel_path: &str) -> TypstFileStat {
    match as_path(location) {
        Some(document) => file_stat(document, rel_path),
        None => TypstFileStat::Unavailable,
    }
}

/// The bytes of `rel_path` beside the document at `location`, by the same
/// rules as its fingerprint, in case the file changed between the two calls.
fn bytes_beside(location: &Location, rel_path: &str) -> Option<Vec<u8>> {
    let resolved = beside::resolve(as_path(location)?, rel_path, &TYPST_RULES).ok()?;
    std::fs::read(resolved).ok()
}

/// Whether a file beside a Typst document can be read, and its fingerprint.
///
/// Asked on each compile, and again every few seconds while the preview is
/// open, so that a figure edited in another program shows up; the bytes are
/// read again only when the fingerprint moves.
#[tauri::command]
pub fn typst_file_stat(
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    rel_path: String,
    locale: Option<String>,
) -> Result<TypstFileStat, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    Ok(stat_beside(&location, &rel_path))
}

/// The bytes of a file beside a Typst document, raw, as `read_image` sends an
/// image's.
#[tauri::command]
pub fn read_typst_file(
    registry: tauri::State<'_, DocumentRegistry>,
    handle: String,
    rel_path: String,
    locale: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let loc = parse_locale(locale);
    let location = document_location(&registry, loc, &handle)?;
    let bytes = bytes_beside(&location, &rel_path).ok_or_else(|| t(loc, "file.notFound"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A Typst book: its main file, a chapter, a figure, data and a
    /// bibliography beside it, a plugin, a font, and a secret a level up.
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("meditor-typst-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = root.join("book");
        std::fs::create_dir_all(folder.join("chapters")).unwrap();
        std::fs::write(folder.join("main.typ"), "#include \"chapters/one.typ\"").unwrap();
        std::fs::write(folder.join("chapters").join("one.typ"), "= One").unwrap();
        std::fs::write(folder.join("figure.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        std::fs::write(folder.join("data.json"), "{\"a\": 1}").unwrap();
        std::fs::write(folder.join("refs.bib"), "@book{a, title={A}}").unwrap();
        std::fs::write(folder.join("plugin.wasm"), b"\0asm").unwrap();
        std::fs::write(folder.join("font.ttf"), b"\0\x01\0\0").unwrap();
        std::fs::write(root.join("secret.typ"), "#let key = 1").unwrap();
        (folder.join("main.typ"), root)
    }

    #[test]
    fn finds_what_a_typst_document_reads() {
        let (document, root) = fixture("found");
        for rel in ["chapters/one.typ", "figure.png", "data.json", "refs.bib"] {
            assert!(
                matches!(file_stat(&document, rel), TypstFileStat::Found { .. }),
                "{rel:?}",
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn keeps_a_typst_document_inside_its_folder() {
        let (document, root) = fixture("inside");
        // `../secret.typ` is there; an image could reach it, a Typst file may not.
        assert!(root.join("secret.typ").is_file());
        assert_eq!(
            file_stat(&document, "../secret.typ"),
            TypstFileStat::Refused {
                reason: RefusedBecause::Invalid
            },
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_code_and_fonts() {
        let (document, root) = fixture("kinds");
        for rel in ["plugin.wasm", "font.ttf"] {
            assert_eq!(
                file_stat(&document, rel),
                TypstFileStat::Refused {
                    reason: RefusedBecause::Unsupported
                },
                "{rel:?}",
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn tells_missing_from_refused() {
        let (document, root) = fixture("missing");
        assert_eq!(
            file_stat(&document, "chapters/two.typ"),
            TypstFileStat::Missing
        );
        assert_eq!(file_stat(&document, "chapters"), TypstFileStat::Missing);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_what_is_hidden_inside_the_folder() {
        let (document, root) = fixture("hidden");
        let folder = document.parent().unwrap();
        std::fs::create_dir_all(folder.join(".private")).unwrap();
        std::fs::write(folder.join(".private").join("notes.txt"), "kept").unwrap();
        std::fs::write(folder.join(".draft.typ"), "= Draft").unwrap();
        for rel in [".private/notes.txt", ".draft.typ"] {
            assert_eq!(
                file_stat(&document, rel),
                TypstFileStat::Refused {
                    reason: RefusedBecause::Invalid
                },
                "{rel:?}",
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_a_file_over_the_ceiling() {
        let (document, root) = fixture("ceiling");
        let folder = document.parent().unwrap();
        // Lengthened rather than written: the size is all that is looked at.
        let lengthened = |name: &str, len: u64| {
            std::fs::File::create(folder.join(name))
                .unwrap()
                .set_len(len)
                .unwrap();
        };
        lengthened("at.pdf", MAX_TYPST_FILE_BYTES);
        lengthened("over.pdf", MAX_TYPST_FILE_BYTES + 1);
        assert!(matches!(
            file_stat(&document, "at.pdf"),
            TypstFileStat::Found { .. }
        ));
        assert_eq!(
            file_stat(&document, "over.pdf"),
            TypstFileStat::Refused {
                reason: RefusedBecause::TooLarge
            },
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reads_only_what_its_fingerprint_would_allow() {
        let (document, root) = fixture("read");
        let location = Location::Path(document.clone());
        assert_eq!(
            bytes_beside(&location, "chapters/one.typ").as_deref(),
            Some(&b"= One"[..]),
        );
        // There, and still not to be read: the bytes follow the same rules.
        assert!(root.join("secret.typ").is_file());
        for rel in ["../secret.typ", "plugin.wasm", "chapters/two.typ"] {
            assert_eq!(bytes_beside(&location, rel), None, "{rel:?}");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn has_no_folder_behind_a_content_uri() {
        let uri = Location::Url(
            url::Url::parse("content://com.android.providers.downloads.documents/document/7")
                .unwrap(),
        );
        assert_eq!(stat_beside(&uri, "figure.png"), TypstFileStat::Unavailable);
        assert_eq!(bytes_beside(&uri, "figure.png"), None);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_link_that_leads_out_of_the_folder() {
        let (document, root) = fixture("link");
        let link = document.parent().unwrap().join("borrowed.typ");
        std::os::unix::fs::symlink(root.join("secret.typ"), &link).unwrap();
        assert_eq!(
            file_stat(&document, "borrowed.typ"),
            TypstFileStat::Refused {
                reason: RefusedBecause::Outside
            },
        );
        let _ = std::fs::remove_dir_all(root);
    }

    /// What the frontend reads: the state as a tag, the reason and the
    /// fingerprint's fields in camelCase.
    #[test]
    fn is_sent_in_the_shape_the_frontend_reads() {
        let found = TypstFileStat::Found {
            stat: DocumentStat {
                modified_ms: Some(5),
                size: Some(3),
            },
        };
        assert_eq!(
            serde_json::to_string(&found).unwrap(),
            r#"{"state":"found","stat":{"modifiedMs":5,"size":3}}"#,
        );
        let refused = TypstFileStat::Refused {
            reason: RefusedBecause::TooLarge,
        };
        assert_eq!(
            serde_json::to_string(&refused).unwrap(),
            r#"{"state":"refused","reason":"tooLarge"}"#,
        );
        assert_eq!(
            serde_json::to_string(&TypstFileStat::Unavailable).unwrap(),
            r#"{"state":"unavailable"}"#,
        );
    }
}
