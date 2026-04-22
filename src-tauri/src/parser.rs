use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
}

impl Usage {
    fn add(&mut self, other: &Usage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_read_input_tokens += other.cache_read_input_tokens;
        self.cache_creation_input_tokens += other.cache_creation_input_tokens;
    }

    fn from_json(v: &Value) -> Self {
        let g = |k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
        Usage {
            input_tokens: g("input_tokens"),
            output_tokens: g("output_tokens"),
            cache_read_input_tokens: g("cache_read_input_tokens"),
            cache_creation_input_tokens: g("cache_creation_input_tokens"),
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ParsedSession {
    pub session_id: String,
    pub project_dir: String,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub claude_version: Option<String>,
    pub custom_title: Option<String>,
    pub recap_summary: Option<String>,
    pub first_user_msg: Option<String>,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub message_count: u32,
    pub user_message_count: u32,
    pub assistant_message_count: u32,
    pub tool_calls: BTreeMap<String, u32>,
    pub files_touched: BTreeSet<String>,
    pub models_used: BTreeSet<String>,
    pub usage: Usage,
    pub has_errors: bool,
    pub full_text: String,
}

/// A single turn we render in the transcript pane.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    pub uuid: String,
    pub parent_uuid: Option<String>,
    pub timestamp_ms: i64,
    pub role: String, // "user" | "assistant" | "system" | "attachment"
    pub text: String,
    pub tool_uses: Vec<ToolUse>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input_preview: String,
}

/// Extracts plain text from a `message.content` value (string or list of content blocks).
fn extract_text_and_tools(content: &Value, tool_uses: &mut Vec<ToolUse>) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut buf = String::new();
            for block in arr {
                let Some(ty) = block.get("type").and_then(|v| v.as_str()) else { continue };
                match ty {
                    "text" => {
                        if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                            if !buf.is_empty() {
                                buf.push('\n');
                            }
                            buf.push_str(t);
                        }
                    }
                    "tool_use" => {
                        let id = block
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let input = block.get("input").cloned().unwrap_or(Value::Null);
                        let input_str = serde_json::to_string(&input).unwrap_or_default();
                        let input_preview = truncate_chars(&input_str, 500);
                        tool_uses.push(ToolUse {
                            id,
                            name,
                            input_preview,
                        });
                    }
                    "tool_result" => {
                        if let Some(err) = block.get("is_error").and_then(|v| v.as_bool()) {
                            if err {
                                // marker pickup in caller via parent scan is too much;
                                // instead surface via text so indexer can grep? keep simple.
                            }
                        }
                    }
                    _ => {}
                }
            }
            buf
        }
        _ => String::new(),
    }
}

fn parse_ts(ts: Option<&str>) -> Option<i64> {
    let s = ts?;
    let dt = DateTime::parse_from_rfc3339(s).ok()?;
    Some(dt.with_timezone(&Utc).timestamp_millis())
}

/// Truncate at a char boundary, appending an ellipsis if truncated.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0;
    for c in s.chars() {
        if count >= max_chars {
            out.push('…');
            return out;
        }
        out.push(c);
        count += 1;
    }
    out
}

/// Turn the encoded project directory name back into an absolute path.
/// Claude Code encodes `/Users/pspenano/projects/platy` as
/// `-Users-pspenano-projects-platy`. The encoding is lossy for names containing
/// dashes, but it's what Claude Code ships; `cwd` from the records is
/// authoritative anyway.
pub fn decode_project_dir(encoded: &str) -> String {
    if encoded.starts_with('-') {
        let rest = &encoded[1..];
        format!("/{}", rest.replace('-', "/"))
    } else {
        encoded.to_string()
    }
}

/// Stream-parse one JSONL session file.
pub fn parse_session_file(path: &Path, project_dir: &str) -> Result<(ParsedSession, Vec<Turn>)> {
    let file = File::open(path)
        .with_context(|| format!("open {}", path.display()))?;
    let reader = BufReader::new(file);

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let mut sess = ParsedSession {
        session_id: session_id.clone(),
        project_dir: project_dir.to_string(),
        started_at_ms: i64::MAX,
        ended_at_ms: i64::MIN,
        ..Default::default()
    };
    let mut turns: Vec<Turn> = Vec::new();
    let mut full_text = String::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue, // tolerate malformed lines
        };

        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

        // Metadata picked off any record that has it.
        if sess.cwd.is_none() {
            if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) {
                if !c.is_empty() {
                    sess.cwd = Some(c.to_string());
                }
            }
        }
        if sess.git_branch.is_none() {
            if let Some(b) = v.get("gitBranch").and_then(|x| x.as_str()) {
                if !b.is_empty() {
                    sess.git_branch = Some(b.to_string());
                }
            }
        }
        if sess.claude_version.is_none() {
            if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                sess.claude_version = Some(ver.to_string());
            }
        }

        let ts_ms = parse_ts(v.get("timestamp").and_then(|x| x.as_str()));
        if let Some(ms) = ts_ms {
            if ms < sess.started_at_ms {
                sess.started_at_ms = ms;
            }
            if ms > sess.ended_at_ms {
                sess.ended_at_ms = ms;
            }
        }

        match ty {
            "custom-title" => {
                if let Some(t) = v.get("customTitle").and_then(|x| x.as_str()) {
                    sess.custom_title = Some(t.to_string());
                }
            }
            // Claude Code writes `type: "system", subtype: "away_summary"` when the user
            // returns to a session after a gap — the "※ recap" blurb. JSONL is append-only
            // so overwriting yields the latest recap.
            "system" => {
                if v.get("subtype").and_then(|x| x.as_str()) == Some("away_summary") {
                    if let Some(c) = v.get("content").and_then(|x| x.as_str()) {
                        if !c.is_empty() {
                            sess.recap_summary = Some(c.to_string());
                        }
                    }
                }
            }
            "user" => {
                let msg = v.get("message").cloned().unwrap_or(Value::Null);
                let role = msg
                    .get("role")
                    .and_then(|x| x.as_str())
                    .unwrap_or("user")
                    .to_string();
                let content = msg.get("content").cloned().unwrap_or(Value::Null);
                let mut tool_uses = Vec::new();
                let text = extract_text_and_tools(&content, &mut tool_uses);

                // Skip synthetic/tool-result-only user turns (no visible text, no tool call)
                // and skip turns that look like injected system reminders to keep the corpus clean.
                let trimmed = text.trim();
                let is_real_prompt =
                    !trimmed.is_empty() && !trimmed.starts_with("<system-reminder>");

                if is_real_prompt {
                    sess.user_message_count += 1;
                    sess.message_count += 1;
                    if sess.first_user_msg.is_none() {
                        sess.first_user_msg = Some(truncate_chars(&text, 300));
                    }
                    full_text.push_str(&text);
                    full_text.push('\n');

                    turns.push(Turn {
                        uuid: v
                            .get("uuid")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        parent_uuid: v
                            .get("parentUuid")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        timestamp_ms: ts_ms.unwrap_or(0),
                        role,
                        text,
                        tool_uses,
                        model: None,
                    });
                }
            }
            "assistant" => {
                let msg = v.get("message").cloned().unwrap_or(Value::Null);
                let content = msg.get("content").cloned().unwrap_or(Value::Null);
                let model = msg
                    .get("model")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                if let Some(ref m) = model {
                    sess.models_used.insert(m.clone());
                }
                if let Some(u) = msg.get("usage") {
                    sess.usage.add(&Usage::from_json(u));
                }

                let mut tool_uses = Vec::new();
                let text = extract_text_and_tools(&content, &mut tool_uses);

                for tu in &tool_uses {
                    *sess.tool_calls.entry(tu.name.clone()).or_insert(0) += 1;
                    // Extract file paths from Edit/Write/Read/MultiEdit tool inputs.
                    if matches!(
                        tu.name.as_str(),
                        "Edit" | "Write" | "MultiEdit" | "NotebookEdit"
                    ) {
                        if let Ok(val) = serde_json::from_str::<Value>(&tu.input_preview) {
                            if let Some(p) = val.get("file_path").and_then(|v| v.as_str()) {
                                sess.files_touched.insert(p.to_string());
                            }
                        }
                    }
                }

                if !text.trim().is_empty() || !tool_uses.is_empty() {
                    sess.assistant_message_count += 1;
                    sess.message_count += 1;
                    if !text.trim().is_empty() {
                        full_text.push_str(&text);
                        full_text.push('\n');
                    }
                    turns.push(Turn {
                        uuid: v
                            .get("uuid")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        parent_uuid: v
                            .get("parentUuid")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string()),
                        timestamp_ms: ts_ms.unwrap_or(0),
                        role: "assistant".to_string(),
                        text,
                        tool_uses,
                        model,
                    });
                }
            }
            // Error detection: tool_use_error anywhere in the file signals a failed tool call.
            _ => {
                if line.contains("\"tool_use_error\"") || line.contains("\"is_error\":true") {
                    sess.has_errors = true;
                }
            }
        }
    }

    if sess.started_at_ms == i64::MAX {
        sess.started_at_ms = 0;
    }
    if sess.ended_at_ms == i64::MIN {
        sess.ended_at_ms = 0;
    }
    sess.full_text = full_text;

    Ok((sess, turns))
}
