# Claude Code Chat History

A fast, local, searchable browser for every Claude Code session on your machine.

`claude --resume` is a 10-item fuzzy picker — useless for finding *that one* conversation from two weeks ago about the deploy issue. This is a real two-pane UI: conversation list on the left, full transcript + metrics on the right, full-text search across everything.

![screenshot placeholder](docs/screenshot.png)

## Features

- **Full-text search** across every user and assistant message (SQLite FTS5, BM25 ranking, live-as-you-type).
- **Grouped by project.** Sessions appear under their actual working directory, not Claude's path-encoded gibberish.
- **Per-session metrics**: messages, tokens (input/output/cache), tool-call breakdown, files touched, hypothetical API cost.
- **On-demand AI TLDR** via `claude --model haiku -p`. Uses your Claude Code subscription — no API key required.
- **One-click resume.** Copies `claude --resume <id>` to your clipboard.
- **Markdown export** of any session.
- **Live re-indexing.** New sessions appear in the UI within a couple of seconds.
- **Offline, local-only.** Reads `~/.claude/projects/` directly. Nothing leaves your machine.

## Install

Grab the latest universal macOS build from the **[Releases page](https://github.com/palpen/claude-code-chat-history/releases/latest)** (Apple Silicon + Intel in one `.dmg`).

1. Download `Claude.Code.Chat.History_*_universal.dmg`.
2. Open the `.dmg` and drag the app into `/Applications`.
3. First launch: right-click the app → **Open**. macOS will warn that the developer is unidentified (the build isn't code-signed) — click **Open** once and it launches normally every time after.

If you prefer the terminal:

```bash
# Remove the quarantine flag so the app launches without the warning dialog
xattr -dr com.apple.quarantine "/Applications/Claude Code Chat History.app"
open "/Applications/Claude Code Chat History.app"
```

The index is stored at `~/.claude/history-ui/index.db`. Delete it any time — it rebuilds on next launch.

## Build from source

Prerequisites: [Rust](https://rustup.rs) (stable) + [Bun](https://bun.sh) or Node ≥ 20.

```bash
git clone https://github.com/palpen/claude-code-chat-history.git
cd claude-code-chat-history
bun install
bun run tauri dev      # run in dev mode
bun run tauri build    # build a standalone .app (drag into /Applications)
```

## Optional env vars

| Var | What it does |
|---|---|
| `CLAUDE_BIN` | Absolute path to the `claude` CLI. Set this if the app can't find it on PATH (common when launching the `.app` from Finder). |

## Architecture

- **Rust core** (`src-tauri/`) — JSONL stream parser → SQLite with FTS5, `notify`-based filesystem watcher, Tauri command surface.
- **React + Vite** webview — two-pane layout, virtualized transcript renderer, debounced search.
- **On-demand summarization** — shells out to `claude --model haiku --tools "" --disable-slash-commands --no-session-persistence -p "<prompt>"` so summaries use the same auth as Claude Code itself.

### Schema

```
sessions(session_id PK, project_dir, cwd, git_branch, custom_title,
         first_user_msg, ai_summary, started_at_ms, ended_at_ms,
         message_count, tool_calls_json, files_touched_json,
         models_used_json, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens,
         estimated_cost_usd, has_errors, file_path, file_mtime_ms)

sessions_fts(custom_title, first_user_msg, ai_summary, full_text)
  tokenize = "unicode61 remove_diacritics 2"
  prefix   = "2 3 4"

transcripts(session_id PK, turns_json)
```

## Notes on the cost column

The "Est. API cost" field is the **hypothetical** cost if every token in a session had been billed at pay-as-you-go Anthropic API rates. If you use Claude Code via a Max/Pro subscription, your actual spend is your subscription fee — not this number. Useful for curiosity, not accounting.

## What this doesn't do (yet)

- Semantic search. Keyword FTS covers the 80% case; [`sqlite-vec`](https://github.com/asg017/sqlite-vec) is the v2 path.
- Editing or deleting sessions — it's a read-only viewer.
- Cross-machine sync.
- Claude.ai web conversations (different data source).

## License

MIT.
