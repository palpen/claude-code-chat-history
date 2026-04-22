import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

export interface SessionRow {
  session_id: string;
  project_dir: string;
  cwd: string | null;
  git_branch: string | null;
  custom_title: string | null;
  first_user_msg: string | null;
  ai_summary: string | null;
  started_at_ms: number;
  ended_at_ms: number;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  estimated_cost_usd: number;
  has_errors: boolean;
  models_used: string[];
  tool_calls: Record<string, number>;
  files_touched: string[];
  claude_version: string | null;
  pinned_at: number | null;
  snippet: string | null;
}

export interface Turn {
  uuid: string;
  parent_uuid: string | null;
  timestamp_ms: number;
  role: "user" | "assistant" | string;
  text: string;
  tool_uses: ToolUse[];
  model: string | null;
}

export interface ToolUse {
  id: string;
  name: string;
  input_preview: string;
}

export interface ListArgs {
  query?: string;
  projectDir?: string;
  modelContains?: string;
  startedAfterMs?: number;
  startedBeforeMs?: number;
  limit?: number;
}

export async function listSessions(args: ListArgs = {}): Promise<SessionRow[]> {
  return invoke<SessionRow[]>("list_sessions", { args });
}

export async function listProjects(): Promise<Array<[string, number]>> {
  return invoke<Array<[string, number]>>("list_projects");
}

export async function getSession(sessionId: string): Promise<SessionRow> {
  return invoke<SessionRow>("get_session", { sessionId });
}

export async function getTranscript(sessionId: string): Promise<Turn[]> {
  return invoke<Turn[]>("get_transcript", { sessionId });
}

export async function generateSummary(sessionId: string): Promise<string> {
  return invoke<string>("generate_summary_for", { sessionId });
}

export async function exportMarkdown(sessionId: string): Promise<string> {
  return invoke<string>("export_markdown", { sessionId });
}

export async function copyResumeCommand(sessionId: string): Promise<void> {
  const cmd = await invoke<string>("resume_command", { sessionId });
  await writeText(cmd);
}

export async function saveMarkdownToDisk(sessionId: string, md: string): Promise<string | null> {
  const path = await save({
    title: "Export session as Markdown",
    defaultPath: `${sessionId}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return null;
  await invoke("write_text_file", { path, contents: md });
  return path;
}

export async function reindex(): Promise<{ total: number; indexed: number; skipped: number }> {
  return invoke("reindex");
}

export async function setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
  return invoke("set_session_pinned", { sessionId, pinned });
}

export async function listPinnedSessions(): Promise<SessionRow[]> {
  return invoke<SessionRow[]>("list_pinned_sessions");
}

export interface WeeklyBucket {
  week_start_ms: number;
  sessions: number;
  messages: number;
  cost_usd: number;
}

export interface GlobalStats {
  total_sessions: number;
  total_messages: number;
  total_user_messages: number;
  total_assistant_messages: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost_usd: number;
  sessions_today: number;
  sessions_this_week: number;
  first_session_ms: number | null;
  last_session_ms: number | null;
  top_projects: [string, number][];
  top_models: [string, number][];
  weekly_activity: WeeklyBucket[];
}

export const globalStats = (): Promise<GlobalStats> => invoke<GlobalStats>("global_stats");
