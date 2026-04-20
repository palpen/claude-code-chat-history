use anyhow::Result;
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::indexer::{index_file, projects_root};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

/// Watches ~/.claude/projects for JSONL changes and re-indexes touched files.
/// Emits `sessions-updated` on the Tauri app handle after any batch of updates.
pub fn spawn_watcher(app: AppHandle, conn: Arc<Mutex<Connection>>) -> Result<()> {
    let root = projects_root();
    if !root.exists() {
        return Ok(());
    }

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
        let mut debouncer = match new_debouncer(Duration::from_millis(750), None, tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("watcher init failed: {e:#}");
                return;
            }
        };
        if let Err(e) = debouncer.watch(&root, RecursiveMode::Recursive) {
            eprintln!("watcher watch failed: {e:#}");
            return;
        }

        while let Ok(res) = rx.recv() {
            let events = match res {
                Ok(v) => v,
                Err(errs) => {
                    for e in errs {
                        eprintln!("watcher event error: {e:#}");
                    }
                    continue;
                }
            };

            let mut changed: Vec<PathBuf> = Vec::new();
            for ev in events {
                for path in &ev.paths {
                    if path
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s == "jsonl")
                        .unwrap_or(false)
                    {
                        changed.push(path.clone());
                    }
                }
            }
            changed.sort();
            changed.dedup();

            if changed.is_empty() {
                continue;
            }

            let mut any = false;
            {
                let mut c = conn.lock();
                for p in &changed {
                    match index_file(&mut c, p) {
                        Ok(true) => any = true,
                        Ok(false) => {}
                        Err(e) => eprintln!("re-index failed for {}: {e:#}", p.display()),
                    }
                }
            }
            if any {
                let _ = app.emit("sessions-updated", ());
            }
        }
    });

    Ok(())
}
