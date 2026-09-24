//! Images that live beside the document, and the names they may take.
//!
//! A saved document links its images rather than embedding them, which means
//! two questions with security answers: which relative paths a document may
//! reach (never an absolute path, never a URL, only an image; the checks are
//! in `beside.rs`, with the rules below) and what a pasted image may be called
//! (not a Windows device name, not a trail of dots, nothing with a separator
//! in it).

use crate::beside::{self, Refusal, Rules};
use crate::document::{metadata_stat, DocumentStat};
use crate::locale::{parse_locale, t, tf, Locale};
use crate::location::{as_path, document_location, DocumentRegistry};
use serde::Serialize;
use std::path::{Path, PathBuf};

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
    beside::has_extension(path, &IMAGE_EXTENSIONS)
}

/// What an image link may reach: an image, by extension, below the ceiling,
/// anywhere a relative path leads, `..` included (see `resolve_image_path`).
const IMAGE_RULES: Rules = Rules {
    extensions: &IMAGE_EXTENSIONS,
    max_bytes: MAX_IMAGE_BYTES,
    may_climb: true,
    may_be_hidden: true,
    must_stay_inside: false,
};

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
    beside::resolve(document, rel_path, &IMAGE_RULES).map_err(|refusal| match refusal {
        // Images may lead outside the folder, so `Outside` cannot come back;
        // it is matched here only so that no refusal goes unworded.
        Refusal::Invalid | Refusal::Outside => t(locale, "image.invalidPath"),
        Refusal::NotFound => t(locale, "image.notFound"),
        Refusal::Unsupported => t(locale, "image.unsupportedType"),
        Refusal::TooLarge => tf(
            locale,
            "image.tooLarge",
            &(MAX_IMAGE_BYTES / (1024 * 1024)).to_string(),
        ),
    })
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
pub struct WrittenImage {
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
pub fn write_image(
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
pub fn image_stat(
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
pub fn read_image(
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
}
