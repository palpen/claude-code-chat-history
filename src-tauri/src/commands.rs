use parking_lot::Mutex;
use rusqlite::{params, types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

use crate::indexer::full_scan;
use crate::parser::Turn;
use crate::summarize::generate_summary;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionRow {
    pub session_id: String,
    pub project_dir: String,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub custom_title: Option<String>,
    pub first_user_msg: Option<String>,
    pub ai_summary: Option<String>,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub message_count: i64,
    pub user_message_count: i64,
    pub assistant_message_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub estimated_cost_usd: f64,
    pub has_errors: bool,
    pub models_used: Vec<String>,
    pub tool_calls: serde_json::Value,
    pub files_touched: Vec<String>,
    pub claude_version: Option<String>,
    pub pinned_at: Option<i64>,
    #[serde(default)]
    pub snippet: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListArgs {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default)]
    pub model_contains: Option<String>,
    #[serde(default)]
    pub started_after_ms: Option<i64>,
    #[serde(default)]
    pub started_before_ms: Option<i64>,
    #[serde(default)]
    pub limit: Option<u32>,
}

fn row_from_raw(
    session_id: String,
    project_dir: String,
    cwd: Option<String>,
    git_branch: Option<String>,
    custom_title: Option<String>,
    first_user_msg: Option<String>,
    ai_summary: Option<String>,
    started_at_ms: i64,
    ended_at_ms: i64,
    message_count: i64,
    user_message_count: i64,
    assistant_message_count: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    estimated_cost_usd: f64,
    has_errors: i64,
    models_used_json: String,
    tool_calls_json: String,
    files_touched_json: String,
    claude_version: Option<String>,
    pinned_at: Option<i64>,
    snippet: Option<String>,
) -> SessionRow {
    let models_used: Vec<String> = serde_json::from_str(&models_used_json).unwrap_or_default();
    let tool_calls: serde_json::Value =
        serde_json::from_str(&tool_calls_json).unwrap_or(serde_json::json!({}));
    let files_touched: Vec<String> = serde_json::from_str(&files_touched_json).unwrap_or_default();
    SessionRow {
        session_id,
        project_dir,
        cwd,
        git_branch,
        custom_title,
        first_user_msg,
        ai_summary,
        started_at_ms,
        ended_at_ms,
        message_count,
        user_message_count,
        assistant_message_count,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        estimated_cost_usd,
        has_errors: has_errors != 0,
        models_used,
        tool_calls,
        files_touched,
        claude_version,
        pinned_at,
        snippet,
    }
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>, args: ListArgs) -> std::result::Result<Vec<SessionRow>, String> {
    let conn = state.db.lock();
    let limit = args.limit.unwrap_or(500) as i64;

    // Two query shapes — with or without FTS match.
    let has_query = args
        .query
        .as_ref()
        .map(|q| !q.trim().is_empty())
        .unwrap_or(false);

    let mut rows: Vec<SessionRow> = Vec::new();

    if has_query {
        let raw = args.query.unwrap();
        let match_expr = build_match_expression(&raw);

        let sql = format!(
            r#"
            SELECT s.session_id, s.project_dir, s.cwd, s.git_branch,
                   s.custom_title, s.first_user_msg, s.ai_summary,
                   s.started_at_ms, s.ended_at_ms,
                   s.message_count, s.user_message_count, s.assistant_message_count,
                   s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_creation_tokens,
                   s.estimated_cost_usd, s.has_errors,
                   s.models_used_json, s.tool_calls_json, s.files_touched_json,
                   s.claude_version, s.pinned_at,
                   snippet(sessions_fts, 4, '<mark>', '</mark>', '…', 12) AS snippet
            FROM sessions_fts
            JOIN sessions s USING(session_id)
            WHERE sessions_fts MATCH ?1
                  {proj_filter}
                  {model_filter}
                  {started_after}
                  {started_before}
            ORDER BY bm25(sessions_fts, 10.0, 8.0, 6.0, 5.0, 1.0)
            LIMIT ?2
            "#,
            proj_filter = if args.project_dir.is_some() { "AND s.project_dir = ?3" } else { "" },
            model_filter = if args.model_contains.is_some() {
                if args.project_dir.is_some() { "AND s.models_used_json LIKE ?4" } else { "AND s.models_used_json LIKE ?3" }
            } else { "" },
            started_after = "",
            started_before = "",
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut params_vec: Vec<SqlValue> = vec![SqlValue::Text(match_expr), SqlValue::Integer(limit)];
        if let Some(pd) = args.project_dir.clone() {
            params_vec.push(SqlValue::Text(pd));
        }
        if let Some(mc) = args.model_contains.clone() {
            params_vec.push(SqlValue::Text(format!("%{}%", mc)));
        }

        let param_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|v| v as &dyn rusqlite::ToSql).collect();

        let rows_iter = stmt
            .query_map(param_refs.as_slice(), |r| {
                Ok(row_from_raw(
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                    r.get(14)?, r.get(15)?, r.get(16)?, r.get(17)?, r.get(18)?, r.get(19)?, r.get(20)?,
                    r.get(21)?, r.get(22)?, r.get(23)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows_iter {
            rows.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut clauses: Vec<String> = Vec::new();
        let mut params_vec: Vec<SqlValue> = Vec::new();
        if let Some(pd) = args.project_dir.clone() {
            clauses.push(format!("project_dir = ?{}", params_vec.len() + 1));
            params_vec.push(SqlValue::Text(pd));
        }
        if let Some(mc) = args.model_contains.clone() {
            clauses.push(format!("models_used_json LIKE ?{}", params_vec.len() + 1));
            params_vec.push(SqlValue::Text(format!("%{}%", mc)));
        }
        if let Some(a) = args.started_after_ms {
            clauses.push(format!("started_at_ms >= ?{}", params_vec.len() + 1));
            params_vec.push(SqlValue::Integer(a));
        }
        if let Some(b) = args.started_before_ms {
            clauses.push(format!("started_at_ms <= ?{}", params_vec.len() + 1));
            params_vec.push(SqlValue::Integer(b));
        }
        let where_clause = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };

        params_vec.push(SqlValue::Integer(limit));
        let limit_idx = params_vec.len();

        let sql = format!(
            r#"
            SELECT session_id, project_dir, cwd, git_branch,
                   custom_title, first_user_msg, ai_summary,
                   started_at_ms, ended_at_ms,
                   message_count, user_message_count, assistant_message_count,
                   input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                   estimated_cost_usd, has_errors,
                   models_used_json, tool_calls_json, files_touched_json,
                   claude_version, pinned_at
            FROM sessions
            {where_clause}
            ORDER BY started_at_ms DESC
            LIMIT ?{limit_idx}
            "#
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|v| v as &dyn rusqlite::ToSql).collect();

        let rows_iter = stmt
            .query_map(param_refs.as_slice(), |r| {
                Ok(row_from_raw(
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                    r.get(14)?, r.get(15)?, r.get(16)?, r.get(17)?, r.get(18)?, r.get(19)?, r.get(20)?,
                    r.get(21)?, r.get(22)?, None,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows_iter {
            rows.push(row.map_err(|e| e.to_string())?);
        }
    }

    Ok(rows)
}

/// Convert a freeform search query into a safe FTS5 MATCH expression.
/// - whitespace-separated tokens
/// - non-alphanumeric stripped from each token
/// - last token gets a trailing `*` so "live-as-you-type" shows prefix matches
fn build_match_expression(raw: &str) -> String {
    let tokens: Vec<String> = raw
        .split_whitespace()
        .map(|t| t.chars().filter(|c| c.is_alphanumeric() || *c == '_').collect::<String>())
        .filter(|s| !s.is_empty())
        .collect();
    if tokens.is_empty() {
        return "\"\"".to_string();
    }
    let mut out: Vec<String> = tokens.iter().map(|t| format!("\"{}\"", t)).collect();
    // Prefix-match the last token so partial words still surface results.
    if let Some(last) = out.last_mut() {
        let token = last.trim_matches('"').to_string();
        *last = format!("\"{}\"*", token);
    }
    out.join(" AND ")
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> std::result::Result<Vec<(String, i64)>, String> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT project_dir, COUNT(*) FROM sessions GROUP BY project_dir ORDER BY MAX(started_at_ms) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_transcript(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<Vec<Turn>, String> {
    let conn = state.db.lock();
    let json: String = conn
        .query_row(
            "SELECT turns_json FROM transcripts WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let turns: Vec<Turn> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(turns)
}

#[tauri::command]
pub fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<SessionRow, String> {
    let args = ListArgs {
        query: None,
        project_dir: None,
        model_contains: None,
        started_after_ms: None,
        started_before_ms: None,
        limit: Some(500),
    };
    // Reuse list with a direct ID filter — cheaper to write a targeted query.
    drop(args);
    let conn = state.db.lock();
    let row = conn
        .query_row(
            r#"
            SELECT session_id, project_dir, cwd, git_branch,
                   custom_title, first_user_msg, ai_summary,
                   started_at_ms, ended_at_ms,
                   message_count, user_message_count, assistant_message_count,
                   input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                   estimated_cost_usd, has_errors,
                   models_used_json, tool_calls_json, files_touched_json,
                   claude_version, pinned_at
            FROM sessions WHERE session_id = ?1
            "#,
            params![session_id],
            |r| {
                Ok(row_from_raw(
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                    r.get(14)?, r.get(15)?, r.get(16)?, r.get(17)?, r.get(18)?, r.get(19)?, r.get(20)?,
                    r.get(21)?, r.get(22)?, None,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub async fn generate_summary_for(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<String, String> {
    let turns: Vec<Turn> = {
        let conn = state.db.lock();
        let json: String = conn
            .query_row(
                "SELECT turns_json FROM transcripts WHERE session_id = ?1",
                params![&session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| e.to_string())?
    };

    let summary = generate_summary(&turns).await.map_err(|e| e.to_string())?;

    {
        let conn = state.db.lock();
        conn.execute(
            "UPDATE sessions SET ai_summary = ?1 WHERE session_id = ?2",
            params![summary, &session_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sessions_fts SET ai_summary = ?1 WHERE session_id = ?2",
            params![summary, &session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(summary)
}

#[tauri::command]
pub fn export_markdown(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<String, String> {
    let (meta, turns) = {
        let conn = state.db.lock();
        let row = conn
            .query_row(
                "SELECT custom_title, first_user_msg, cwd, started_at_ms, project_dir FROM sessions WHERE session_id = ?1",
                params![&session_id],
                |r| Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                )),
            )
            .map_err(|e| e.to_string())?;
        let turns_json: String = conn
            .query_row(
                "SELECT turns_json FROM transcripts WHERE session_id = ?1",
                params![&session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let turns: Vec<Turn> = serde_json::from_str(&turns_json).map_err(|e| e.to_string())?;
        (row, turns)
    };

    let (title, first_user, cwd, started_ms, project_dir) = meta;
    let heading = title
        .clone()
        .or_else(|| first_user.as_ref().map(|s| {
            let line = s.lines().next().unwrap_or("");
            let chars: String = line.chars().take(80).collect();
            if line.chars().count() > 80 { format!("{}…", chars) } else { chars }
        }))
        .unwrap_or_else(|| format!("Session {}", session_id));

    let started_iso = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(started_ms)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();

    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", heading));
    out.push_str(&format!("- **Session ID:** `{}`\n", session_id));
    out.push_str(&format!("- **Project:** `{}`\n", project_dir));
    if let Some(c) = cwd {
        out.push_str(&format!("- **CWD:** `{}`\n", c));
    }
    out.push_str(&format!("- **Started:** {}\n\n---\n\n", started_iso));

    for t in turns {
        let role = match t.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            other => other,
        };
        out.push_str(&format!("## {}\n\n", role));
        if !t.text.trim().is_empty() {
            out.push_str(t.text.trim_end());
            out.push_str("\n\n");
        }
        for tu in t.tool_uses {
            out.push_str(&format!("*Tool: `{}`*\n\n```json\n{}\n```\n\n", tu.name, tu.input_preview));
        }
    }

    Ok(out)
}

#[tauri::command]
pub fn resume_command(session_id: String) -> std::result::Result<String, String> {
    Ok(format!("claude --resume {}", session_id))
}

#[tauri::command]
pub fn set_session_pinned(
    state: State<'_, AppState>,
    session_id: String,
    pinned: bool,
) -> std::result::Result<(), String> {
    let conn = state.db.lock();
    if pinned {
        conn.execute(
            "UPDATE sessions SET pinned_at = ?1 WHERE session_id = ?2",
            params![
                chrono::Utc::now().timestamp_millis(),
                session_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE sessions SET pinned_at = NULL WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_pinned_sessions(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<SessionRow>, String> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT session_id, project_dir, cwd, git_branch,
                   custom_title, first_user_msg, ai_summary,
                   started_at_ms, ended_at_ms,
                   message_count, user_message_count, assistant_message_count,
                   input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                   estimated_cost_usd, has_errors,
                   models_used_json, tool_calls_json, files_touched_json,
                   claude_version, pinned_at
            FROM sessions
            WHERE pinned_at IS NOT NULL
            ORDER BY pinned_at DESC
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows_iter = stmt
        .query_map([], |r| {
            Ok(row_from_raw(
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                r.get(14)?, r.get(15)?, r.get(16)?, r.get(17)?, r.get(18)?, r.get(19)?, r.get(20)?,
                r.get(21)?, r.get(22)?, None,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows_iter {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> std::result::Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{e}"))
}

#[tauri::command]
pub async fn reindex(state: State<'_, AppState>) -> std::result::Result<serde_json::Value, String> {
    let progress = {
        let mut conn = state.db.lock();
        full_scan(&mut conn).map_err(|e| e.to_string())?
    };
    Ok(serde_json::json!({
        "total": progress.total,
        "indexed": progress.indexed,
        "skipped": progress.skipped,
    }))
}

#[derive(Serialize)]
pub struct WeeklyBucket {
    pub week_start_ms: i64,
    pub sessions: i64,
    pub messages: i64,
    pub cost_usd: f64,
}

#[derive(Serialize)]
pub struct GlobalStats {
    pub total_sessions: i64,
    pub total_messages: i64,
    pub total_user_messages: i64,
    pub total_assistant_messages: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_cost_usd: f64,
    pub sessions_today: i64,
    pub sessions_this_week: i64,
    pub first_session_ms: Option<i64>,
    pub last_session_ms: Option<i64>,
    pub top_projects: Vec<(String, i64)>,
    pub top_models: Vec<(String, i64)>,
    pub weekly_activity: Vec<WeeklyBucket>,
}

#[tauri::command]
#[allow(clippy::type_complexity)]
pub fn global_stats(state: State<'_, AppState>) -> std::result::Result<GlobalStats, String> {
    let conn = state.db.lock();

    // Totals — COALESCE handles zero-sessions case where SUM returns NULL
    let (
        total_sessions, total_messages, total_user_messages, total_assistant_messages,
        total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_creation_tokens, total_cost_usd, first_session_ms, last_session_ms,
    ): (i64, i64, i64, i64, i64, i64, i64, i64, f64, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(message_count), 0),
                    COALESCE(SUM(user_message_count), 0),
                    COALESCE(SUM(assistant_message_count), 0),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cache_read_tokens), 0),
                    COALESCE(SUM(cache_creation_tokens), 0),
                    COALESCE(SUM(estimated_cost_usd), 0.0),
                    MIN(started_at_ms),
                    MAX(started_at_ms)
             FROM sessions",
            [],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                    r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    // UTC cutoffs — midnight UTC today and rolling 7-day window
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let today_start_ms = now_ms - (now_ms % 86_400_000);
    let week_ago_ms = now_ms - 7 * 86_400_000;

    let sessions_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE started_at_ms >= ?1",
            [today_start_ms],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let sessions_this_week: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE started_at_ms >= ?1",
            [week_ago_ms],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Top projects via SQL GROUP BY
    let mut stmt = conn
        .prepare(
            "SELECT project_dir, COUNT(*) c FROM sessions
             GROUP BY project_dir ORDER BY c DESC LIMIT 5",
        )
        .map_err(|e| e.to_string())?;
    let top_projects: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Top models via json_each — SQL unnests models_used_json arrays, no row-fetching to Rust
    let mut stmt = conn
        .prepare(
            "SELECT j.value, COUNT(*) c
             FROM sessions, json_each(models_used_json) j
             GROUP BY j.value ORDER BY c DESC LIMIT 5",
        )
        .map_err(|e| e.to_string())?;
    let top_models: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Weekly activity: SQL computes Monday-midnight-UTC epoch-ms for each session via
    // integer day arithmetic. Epoch day 0 = Jan 1 1970 = Thursday.
    // monday_day = d - (d+3)%7  (verified: Mon→same, Tue-Sun→preceding Mon)
    // Rust zero-fills the 12-slot array; matching is exact integer equality.
    let twelve_weeks_ago_ms = now_ms - 12 * 7 * 86_400_000;
    let mut stmt = conn
        .prepare(
            "WITH s AS (
               SELECT started_at_ms / 86400000 AS d,
                      message_count, estimated_cost_usd
               FROM sessions WHERE started_at_ms >= ?1
             )
             SELECT (d - (d + 3) % 7) * 86400000 AS week_ms,
                    COUNT(*) AS sessions,
                    COALESCE(SUM(message_count), 0) AS msgs,
                    COALESCE(SUM(estimated_cost_usd), 0.0) AS cost
             FROM s
             GROUP BY week_ms
             ORDER BY week_ms ASC",
        )
        .map_err(|e| e.to_string())?;
    let sql_buckets: Vec<(i64, i64, i64, f64)> = stmt
        .query_map([twelve_weeks_ago_ms], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Build 12-slot array using chrono for Monday-of-current-week (matches SQL formula)
    let now_dt =
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms).unwrap_or_default();
    let days_since_monday = {
        use chrono::Datelike;
        now_dt.weekday().num_days_from_monday() as i64
    };
    let this_monday_ms = (now_dt - chrono::Duration::days(days_since_monday))
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    let mut weekly_activity: Vec<WeeklyBucket> = (0_i64..12)
        .map(|i| WeeklyBucket {
            week_start_ms: this_monday_ms - (11 - i) * 7 * 86_400_000,
            sessions: 0,
            messages: 0,
            cost_usd: 0.0,
        })
        .collect();

    for (week_ms, sessions, messages, cost_usd) in sql_buckets {
        if let Some(slot) = weekly_activity.iter_mut().find(|s| s.week_start_ms == week_ms) {
            slot.sessions = sessions;
            slot.messages = messages;
            slot.cost_usd = cost_usd;
        }
    }

    Ok(GlobalStats {
        total_sessions,
        total_messages,
        total_user_messages,
        total_assistant_messages,
        total_input_tokens,
        total_output_tokens,
        total_cache_read_tokens,
        total_cache_creation_tokens,
        total_cost_usd,
        sessions_today,
        sessions_this_week,
        first_session_ms,
        last_session_ms,
        top_projects,
        top_models,
        weekly_activity,
    })
}
