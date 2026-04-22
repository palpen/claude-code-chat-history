use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub fn db_path() -> PathBuf {
    let mut p = dirs::home_dir().expect("no home dir");
    p.push(".claude");
    p.push("history-ui");
    std::fs::create_dir_all(&p).ok();
    p.push("index.db");
    p
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).context("open sqlite db")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA).context("init schema")?;
    // Additive migrations for columns introduced after the initial schema.
    // SQLite returns an error if the column already exists; we swallow it.
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN pinned_at INTEGER", []);
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned_at) WHERE pinned_at IS NOT NULL",
        [],
    );
    // ALTER returns Ok only on the first launch after the column is added.
    // Use that as the one-shot trigger to invalidate cached mtimes so the next
    // full_scan re-parses every JSONL and backfills recap_summary.
    // ai_summary and pinned_at are preserved — the upsert UPDATE clause doesn't
    // touch them.
    if conn
        .execute("ALTER TABLE sessions ADD COLUMN recap_summary TEXT", [])
        .is_ok()
    {
        let _ = conn.execute("UPDATE sessions SET file_mtime_ms = 0", []);
    }
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
    session_id              TEXT PRIMARY KEY,
    project_dir             TEXT NOT NULL,
    cwd                     TEXT,
    git_branch              TEXT,
    claude_version          TEXT,
    custom_title            TEXT,
    first_user_msg          TEXT,
    ai_summary              TEXT,
    recap_summary           TEXT,
    started_at_ms           INTEGER NOT NULL,
    ended_at_ms             INTEGER NOT NULL,
    message_count           INTEGER NOT NULL,
    user_message_count      INTEGER NOT NULL,
    assistant_message_count INTEGER NOT NULL,
    tool_calls_json         TEXT NOT NULL,
    files_touched_json      TEXT NOT NULL,
    models_used_json        TEXT NOT NULL,
    input_tokens            INTEGER NOT NULL,
    output_tokens           INTEGER NOT NULL,
    cache_read_tokens       INTEGER NOT NULL,
    cache_creation_tokens   INTEGER NOT NULL,
    estimated_cost_usd      REAL NOT NULL,
    has_errors              INTEGER NOT NULL,
    file_path               TEXT NOT NULL,
    file_mtime_ms           INTEGER NOT NULL,
    pinned_at               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_dir, started_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_file     ON sessions(file_path);

CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    session_id UNINDEXED,
    custom_title,
    first_user_msg,
    ai_summary,
    full_text,
    tokenize = "unicode61 remove_diacritics 2",
    prefix = "2 3 4"
);

CREATE TABLE IF NOT EXISTS transcripts (
    session_id TEXT PRIMARY KEY,
    turns_json TEXT NOT NULL
);
"#;
