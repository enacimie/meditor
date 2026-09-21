mod document;
mod export;
mod image;
mod locale;
mod location;
mod paper;
mod recent;
mod recent_menu;
mod session;
mod system;

use document::{documents_from_locations, NativeDocument};
use locale::parse_locale;
// `Locale::En` is only named by the two hand-offs below, both desktop-only:
// a document arriving from a second launch or from the Finder has no
// interface to have asked a language of.
#[cfg(desktop)]
use locale::Locale;
use location::DocumentRegistry;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

// Both serve the desktop hand-offs and nothing else now that the commands
// have modules of their own: `Emitter` the single-instance one, `Manager`
// the `app.state()` calls in it and in the setup.
#[cfg(desktop)]
use tauri::Emitter;
#[cfg(desktop)]
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
            .restore(recent_menu::load_recent(app.handle()));
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
            recent_menu::open_recent,
            recent_menu::recent_files,
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
