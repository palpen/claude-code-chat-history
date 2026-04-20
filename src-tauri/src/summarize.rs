use anyhow::{anyhow, Context, Result};
use std::path::Path;
use tokio::process::Command;

use crate::parser::Turn;

const MAX_TURNS: usize = 20;
const MAX_CHARS_PER_TURN: usize = 2_000;

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

fn render_transcript(turns: &[Turn]) -> String {
    let mut out = String::new();
    for t in turns.iter().take(MAX_TURNS) {
        let snippet = truncate(&t.text, MAX_CHARS_PER_TURN);
        if snippet.trim().is_empty() {
            continue;
        }
        out.push_str(&format!("=== {} ===\n{}\n\n", t.role, snippet));
    }
    out
}

fn build_prompt(turns: &[Turn]) -> String {
    let transcript = render_transcript(turns);
    format!(
        "Summarize this Claude Code session transcript.\n\
         Respond with ONLY:\n\
         1) A 2-3 sentence TLDR, starting with the literal bold prefix **TLDR:**\n\
         2) A blank line.\n\
         3) Up to 5 bullets under a bold heading **What happened:** — each bullet \
         one short concrete outcome (file changed, decision made, bug investigated, \
         question answered). Skip fluff, no meta-commentary, no closing remarks.\n\n\
         TRANSCRIPT:\n\n{}",
        transcript
    )
}

/// Locate the `claude` CLI. Tries, in order:
/// 1. `CLAUDE_BIN` env var.
/// 2. `claude` via inherited PATH.
/// 3. Common install paths on macOS.
async fn find_claude_bin() -> Result<String> {
    if let Ok(p) = std::env::var("CLAUDE_BIN") {
        if Path::new(&p).exists() {
            return Ok(p);
        }
    }

    // Try raw PATH lookup.
    if Command::new("claude")
        .arg("--version")
        .output()
        .await
        .is_ok()
    {
        return Ok("claude".to_string());
    }

    // Common install locations.
    let mut candidates: Vec<String> = vec![
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{}/.claude/local/claude", home));
        candidates.push(format!("{}/.local/bin/claude", home));
    }
    for c in candidates {
        if Path::new(&c).exists() {
            return Ok(c);
        }
    }

    Err(anyhow!(
        "could not find the `claude` CLI. Set CLAUDE_BIN to the binary path \
         or ensure `claude` is on your PATH (common: /opt/homebrew/bin/claude)."
    ))
}

/// Shell out to `claude --model haiku -p <prompt>` and return stdout.
pub async fn generate_summary(turns: &[Turn]) -> Result<String> {
    let prompt = build_prompt(turns);
    if prompt.trim().is_empty() {
        return Ok("(empty session)".to_string());
    }

    let bin = find_claude_bin().await?;
    // Keep the user's Max subscription auth (so --bare is out) but strip
    // everything else that bloats a one-shot summary:
    //   --tools ""                  no tool calls
    //   --disable-slash-commands    no skill injection (no Vercel/etc. dumps)
    //   --no-session-persistence    do not write this run into ~/.claude/projects
    //                                (otherwise the indexer would pick it up)
    let output = Command::new(&bin)
        .arg("--model")
        .arg("haiku")
        .arg("--tools")
        .arg("")
        .arg("--disable-slash-commands")
        .arg("--no-session-persistence")
        .arg("-p")
        .arg(&prompt)
        .output()
        .await
        .with_context(|| format!("failed to spawn {}", bin))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "claude CLI exited with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("claude CLI returned empty output"));
    }
    Ok(trimmed.to_string())
}
