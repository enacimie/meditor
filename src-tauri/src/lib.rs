mod document;
mod export;
mod image;
mod locale;
mod location;
mod paper;
mod recent;
mod recent_menu;
mod session;
mod startup;
mod system;

// Everything below is named only by the two desktop hand-offs in `run()`:
// a second launch and macOS's open-document event. A phone has neither.
#[cfg(desktop)]
use document::documents_from_locations;
// `Locale::En` is only named by the two hand-offs below, both desktop-only:
// a document arriving from a second launch or from the Finder has no
// interface to have asked a language of.
#[cfg(desktop)]
use locale::Locale;
use location::DocumentRegistry;
use std::collections::HashMap;
// Only the Apple open-document handler names it, and that block exists on
// no other platform -- which is why dropping this import compiled cleanly
// on Windows, on Linux and against the Android target, and failed on macOS.
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::sync::Mutex;

// `Manager` is the `app.state()` calls in the two hand-offs and in the
// setup, and a desktop is the only place any of that happens.
#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_fs::FilePath;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Second launches only happen where there is a command line to launch
    // from. On mobile the plugin does not exist at all (see Cargo.toml), so
    // the step is bound to the target rather than chained unconditionally.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        let registry = app.state::<DocumentRegistry>();
        let locations = startup::files_from_args(&args)
            .into_iter()
            .map(FilePath::Path);
        let documents = documents_from_locations(app, Locale::En, locations, &registry);
        startup::present_documents(app, documents);
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
            startup::cli_files,
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
                startup::queue_open_paths(paths);
                startup::present_documents(app_handle, documents);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (&app_handle, &event);
            }
        });
}
