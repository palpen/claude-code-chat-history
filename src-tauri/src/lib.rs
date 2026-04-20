use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;

mod commands;
mod cost;
mod db;
mod indexer;
mod parser;
mod summarize;
mod watcher;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = db::db_path();
            let mut conn = db::open(&path).expect("open db");
            // First-run full scan blocks startup briefly. This keeps startup simple
            // and guarantees the UI sees a populated DB immediately.
            if let Err(e) = indexer::full_scan(&mut conn) {
                eprintln!("initial index failed: {e:#}");
            }
            let shared = Arc::new(Mutex::new(conn));
            app.manage(AppState { db: shared.clone() });

            let app_handle = app.handle().clone();
            if let Err(e) = watcher::spawn_watcher(app_handle, shared) {
                eprintln!("watcher spawn failed: {e:#}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::list_projects,
            commands::get_session,
            commands::get_transcript,
            commands::generate_summary_for,
            commands::export_markdown,
            commands::resume_command,
            commands::write_text_file,
            commands::reindex,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
