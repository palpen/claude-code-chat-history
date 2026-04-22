use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::cost::estimate_cost;
use crate::parser::{decode_project_dir, parse_session_file, ParsedSession, Turn};

pub fn projects_root() -> PathBuf {
    let mut p = dirs::home_dir().expect("no home dir");
    p.push(".claude");
    p.push("projects");
    p
}

fn file_mtime_ms(path: &Path) -> i64 {
    path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct IndexProgress {
    pub total: usize,
    pub indexed: usize,
    pub skipped: usize,
}

/// Full incremental scan. Safe to call repeatedly.
pub fn full_scan(conn: &mut Connection) -> Result<IndexProgress> {
    let root = projects_root();
    let mut progress = IndexProgress::default();
    if !root.exists() {
        return Ok(progress);
    }

    // Only real session files sit *directly* inside a per-project directory at
    // depth=2 from the root. Plugins (e.g. the Vercel plugin) park their own
    // JSONL bookkeeping at depth=3 under subdirectories like `vercel-plugin/`
    // and `memory/`. Those are not sessions; filter them out.
    let files: Vec<PathBuf> = WalkDir::new(&root)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if !e.file_type().is_file() {
                return false;
            }
            if e.path()
                .extension()
                .and_then(|s| s.to_str())
                != Some("jsonl")
            {
                return false;
            }
            // Extra guard: parent of the file must itself be a direct child of
            // the projects root, not a nested plugin subdirectory.
            let parent_ok = e
                .path()
                .parent()
                .and_then(|p| p.parent())
                .map(|gp| gp == root)
                .unwrap_or(false);
            parent_ok
        })
        .map(|e| e.into_path())
        .collect();

    progress.total = files.len();

    for path in &files {
        match index_file(conn, path) {
            Ok(true) => progress.indexed += 1,
            Ok(false) => progress.skipped += 1,
            Err(e) => eprintln!("index failed for {}: {e:#}", path.display()),
        }
    }

    // Prune rows whose file_path no longer corresponds to a file we'd index.
    let valid: std::collections::HashSet<String> = files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    let stale: Vec<String> = {
        let mut stmt = conn.prepare("SELECT session_id, file_path FROM sessions")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.filter_map(|r| r.ok())
            .filter(|(_, fp)| !valid.contains(fp))
            .map(|(id, _)| id)
            .collect()
    };
    for id in stale {
        conn.execute("DELETE FROM sessions WHERE session_id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM sessions_fts WHERE session_id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM transcripts WHERE session_id = ?1", rusqlite::params![id])?;
    }

    Ok(progress)
}

/// Returns Ok(true) if the file was (re)indexed, Ok(false) if skipped (unchanged).
pub fn index_file(conn: &mut Connection, path: &Path) -> Result<bool> {
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if session_id.is_empty() {
        return Ok(false);
    }
    let mtime = file_mtime_ms(path);

    // Skip if unchanged.
    let prior: Option<i64> = conn
        .query_row(
            "SELECT file_mtime_ms FROM sessions WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .ok();
    if let Some(prev) = prior {
        if prev == mtime {
            return Ok(false);
        }
    }

    let project_enc = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let fallback_project_dir = decode_project_dir(&project_enc);

    let (mut sess, turns) = parse_session_file(path, &fallback_project_dir)?;
    // Prefer the authoritative `cwd` captured by Claude Code itself — the
    // path-encoded project directory is lossy for names containing dashes.
    if let Some(cwd) = &sess.cwd {
        sess.project_dir = cwd.clone();
    }

    write_session(conn, &sess, &turns, path, mtime).context("write session row")?;
    Ok(true)
}

fn write_session(
    conn: &mut Connection,
    s: &ParsedSession,
    turns: &[Turn],
    path: &Path,
    mtime: i64,
) -> Result<()> {
    let models: Vec<String> = s.models_used.iter().cloned().collect();
    let cost = estimate_cost(&s.usage, &models);
    let tool_calls_json = serde_json::to_string(&s.tool_calls)?;
    let files_touched_json = serde_json::to_string(&s.files_touched)?;
    let models_used_json = serde_json::to_string(&models)?;
    let turns_json = serde_json::to_string(turns)?;

    let tx = conn.transaction()?;

    tx.execute(
        r#"
        INSERT INTO sessions (
            session_id, project_dir, cwd, git_branch, claude_version,
            custom_title, first_user_msg, ai_summary, recap_summary,
            started_at_ms, ended_at_ms,
            message_count, user_message_count, assistant_message_count,
            tool_calls_json, files_touched_json, models_used_json,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            estimated_cost_usd, has_errors, file_path, file_mtime_ms
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
        ON CONFLICT(session_id) DO UPDATE SET
            project_dir=excluded.project_dir,
            cwd=excluded.cwd,
            git_branch=excluded.git_branch,
            claude_version=excluded.claude_version,
            custom_title=excluded.custom_title,
            first_user_msg=excluded.first_user_msg,
            recap_summary=excluded.recap_summary,
            started_at_ms=excluded.started_at_ms,
            ended_at_ms=excluded.ended_at_ms,
            message_count=excluded.message_count,
            user_message_count=excluded.user_message_count,
            assistant_message_count=excluded.assistant_message_count,
            tool_calls_json=excluded.tool_calls_json,
            files_touched_json=excluded.files_touched_json,
            models_used_json=excluded.models_used_json,
            input_tokens=excluded.input_tokens,
            output_tokens=excluded.output_tokens,
            cache_read_tokens=excluded.cache_read_tokens,
            cache_creation_tokens=excluded.cache_creation_tokens,
            estimated_cost_usd=excluded.estimated_cost_usd,
            has_errors=excluded.has_errors,
            file_path=excluded.file_path,
            file_mtime_ms=excluded.file_mtime_ms
        "#,
        params![
            s.session_id,
            s.project_dir,
            s.cwd,
            s.git_branch,
            s.claude_version,
            s.custom_title,
            s.first_user_msg,
            s.recap_summary,
            s.started_at_ms,
            s.ended_at_ms,
            s.message_count as i64,
            s.user_message_count as i64,
            s.assistant_message_count as i64,
            tool_calls_json,
            files_touched_json,
            models_used_json,
            s.usage.input_tokens as i64,
            s.usage.output_tokens as i64,
            s.usage.cache_read_input_tokens as i64,
            s.usage.cache_creation_input_tokens as i64,
            cost,
            s.has_errors as i64,
            path.to_string_lossy(),
            mtime,
        ],
    )?;

    // Refresh FTS: delete old, insert new.
    tx.execute(
        "DELETE FROM sessions_fts WHERE session_id = ?1",
        params![s.session_id],
    )?;
    // We preserve any existing ai_summary only if not re-generated elsewhere.
    let ai_summary: Option<String> = tx
        .query_row(
            "SELECT ai_summary FROM sessions WHERE session_id = ?1",
            params![s.session_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    tx.execute(
        "INSERT INTO sessions_fts(session_id, custom_title, first_user_msg, ai_summary, full_text)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            s.session_id,
            s.custom_title.clone().unwrap_or_default(),
            s.first_user_msg.clone().unwrap_or_default(),
            ai_summary.unwrap_or_default(),
            s.full_text,
        ],
    )?;

    tx.execute(
        "INSERT INTO transcripts(session_id, turns_json) VALUES (?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET turns_json=excluded.turns_json",
        params![s.session_id, turns_json],
    )?;

    tx.commit()?;
    Ok(())
}
