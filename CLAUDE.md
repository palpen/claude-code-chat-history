# CLAUDE.md

Instructions for Claude Code when working in this repo.

## What this project is

A local-only Tauri desktop app that indexes every Claude Code session on the user's machine and renders them in a two-pane browser. Rust core + React webview + SQLite FTS5.

Data source: `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. **Read-only.** Never mutate the user's JSONL files.

Index lives at `~/.claude/history-ui/index.db`. Safe to delete — rebuilds on next launch.

## Stack

- Tauri 2, Rust (`rusqlite` + FTS5, `notify`, `tokio`).
- React 19 + Vite 7 + Tailwind 3.
- `@tanstack/react-virtual` for the transcript viewer.
- `react-markdown` + `remark-gfm` for message rendering.

## Development

```bash
bun install            # once
bun run tauri dev      # dev server + Tauri app (hot-reload on both sides)
bun run tauri build    # production .app
```

TypeScript:

```bash
bun run tsc --noEmit
```

Rust:

```bash
cd src-tauri && cargo check    # fast
cd src-tauri && cargo clippy   # linting
```

## Source layout

```
src/                         React webview
  App.tsx                    shell: two-pane layout, splitter, state plumbing
  components/
    session-list.tsx         left pane: search, filters, grouped list
    session-detail.tsx       right pane: header, TLDR, metrics, transcript
    transcript.tsx           virtualized turn renderer
  lib/
    ipc.ts                   typed wrappers around Tauri invoke()
    utils.ts                 formatting helpers, cn(), safe snippet sanitizer

src-tauri/src/               Rust core
  lib.rs                     Tauri entrypoint; opens DB, runs full_scan, spawns watcher
  parser.rs                  streams JSONL → ParsedSession + Vec<Turn>
  indexer.rs                 full_scan, index_file, write_session, stale-row prune
  db.rs                      schema + connection setup (WAL, FTS5, triggers)
  cost.rs                    per-model pricing table; estimates hypothetical API cost
  watcher.rs                 `notify` + debouncer → incremental re-index
  summarize.rs               shells out to `claude --model haiku -p` for AI TLDRs
  commands.rs                #[tauri::command] surface
```

## Things easy to break, worth knowing

- **UTF-8 string slicing**: `&s[..n]` panics if `n` isn't on a char boundary. The parser has a `truncate_chars` helper — use it, not byte slicing, for any user-facing truncation.
- **`project_dir` comes from `cwd` in the JSONL**, not the encoded directory name. Claude Code's path encoding is lossy when dir names contain dashes (e.g. `platy--backend`). Always prefer the authoritative `cwd`.
- **The plugin-directory trap**: `~/.claude/projects/<project>/vercel-plugin/skill-injections.jsonl` is a plugin's internal log, not a session. The indexer filters to files whose parent is a direct child of the projects root; preserve that guard.
- **SessionStart hooks ≠ user content**: when building `full_text` for FTS, skip system-reminder text and attachments, otherwise every session matches "vercel" because of the plugin hook injection.
- **Cost number is a hypothetical**, not a bill. Labeled "Est. API cost" in the UI. Max-subscription users don't actually pay this.
- **The Anthropic model-pricing table** in `cost.rs` is the source of truth. Opus 4.5/4.6/4.7 are $5/$25 per million (NOT $15/$75 — that's Opus 4/4.1).
- **AI summary auth**: stays on the user's Claude Code OAuth/keychain, which is why we don't pass `--bare` (bare mode forces `ANTHROPIC_API_KEY`).

## Style

- Rust: idiomatic; `anyhow::Result` at boundaries, prefer streaming (`BufReader::lines()`) over loading whole files.
- React: function components, hooks, no class components. Inline CSS vars for theming (dark-mode via `prefers-color-scheme`), Tailwind utilities elsewhere.
- Keep comments minimal — only for non-obvious *why*s. Identifiers should speak for themselves.
- When fixing bugs or adding features, also update or add to the verification list below.

## Verification

If you change anything in the indexer, search, or transcript pipeline, manually spot-check:

1. `bun run tauri dev` launches the window.
2. Sidebar shows ~90 sessions, grouped by project (e.g. `/Users/pspenano/projects/platy` with 30).
3. Searching "vercel" surfaces relevant rows with highlighted snippets.
4. Clicking a session loads its transcript without visible jank, even for 700-turn sessions.
5. "Copy resume cmd" puts `claude --resume <id>` on the clipboard.
6. "Generate AI TLDR" returns a summary starting with **TLDR:** within ~10s.
7. Opening a fresh Claude Code session in another terminal causes the new row to appear in the UI within ~2s.

## Known non-goals

Explicitly out of scope — do not add without asking:

- Editing or deleting sessions.
- Sync across machines.
- Semantic / vector search (v2 candidate via `sqlite-vec`, not v1).
- Claude.ai web conversations (different data source).
- Batch AI summaries across all sessions.
