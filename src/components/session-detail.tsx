import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Star } from "lucide-react";
import {
  copyResumeCommand,
  exportMarkdown,
  generateSummary,
  getTranscript,
  saveMarkdownToDisk,
  setSessionPinned,
  type SessionRow,
  type Turn,
} from "@/lib/ipc";
import {
  formatCost,
  formatDateTime,
  formatDuration,
  formatNumber,
  shortProject,
} from "@/lib/utils";
import { openPath } from "@tauri-apps/plugin-opener";
import { Transcript } from "./transcript";

interface Props {
  session: SessionRow | null;
  onSessionPatched: (s: SessionRow) => void;
  onPinToggled: () => void;
}

function heuristicTldr(s: SessionRow): string {
  if (s.custom_title) return s.custom_title;
  if (s.first_user_msg) return s.first_user_msg;
  return "(no user prompts in this session)";
}

export function SessionDetail({ session, onSessionPatched, onPinToggled }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [resumeCopied, setResumeCopied] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    setTurns([]);
    setSummaryError(null);
    setResumeCopied(false);
    setExportStatus(null);
    if (!session) return;
    let cancelled = false;
    getTranscript(session.session_id).then((t) => {
      if (!cancelled) setTurns(t);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.session_id]);

  const durationMs = session ? Math.max(0, session.ended_at_ms - session.started_at_ms) : 0;
  const totalTokens = session
    ? session.input_tokens +
      session.output_tokens +
      session.cache_read_tokens +
      session.cache_creation_tokens
    : 0;

  const toolEntries = useMemo(() => {
    if (!session) return [];
    return Object.entries(session.tool_calls as Record<string, number>).sort(
      (a, b) => b[1] - a[1]
    );
  }, [session?.tool_calls]);

  const onCopyResume = useCallback(async () => {
    if (!session) return;
    await copyResumeCommand(session.session_id);
    setResumeCopied(true);
    setTimeout(() => setResumeCopied(false), 2000);
  }, [session?.session_id]);

  const onGenerateSummary = useCallback(async () => {
    if (!session) return;
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const summary = await generateSummary(session.session_id);
      onSessionPatched({ ...session, ai_summary: summary });
    } catch (e) {
      setSummaryError(String(e));
    } finally {
      setSummaryBusy(false);
    }
  }, [session, onSessionPatched]);

  const onExport = useCallback(async () => {
    if (!session) return;
    setExportStatus(null);
    try {
      const md = await exportMarkdown(session.session_id);
      const path = await saveMarkdownToDisk(session.session_id, md);
      if (path) setExportStatus(`Saved to ${path}`);
    } catch (e) {
      setExportStatus(`Failed: ${e}`);
    }
  }, [session?.session_id]);

  const onOpenCwd = useCallback(async () => {
    if (!session?.cwd) return;
    try {
      await openPath(session.cwd);
    } catch (e) {
      console.error("Open cwd failed:", e);
    }
  }, [session?.cwd]);

  const onTogglePin = useCallback(async () => {
    if (!session) return;
    const nextPinned = session.pinned_at === null;
    await setSessionPinned(session.session_id, nextPinned);
    onPinToggled();
  }, [session, onPinToggled]);

  if (!session) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        Select a conversation from the list.
      </div>
    );
  }

  const title =
    session.custom_title ||
    session.first_user_msg?.split("\n")[0]?.slice(0, 120) ||
    `Session ${session.session_id.slice(0, 8)}`;

  return (
    <div className="flex h-full flex-col">
      <div
        className="px-5 py-4"
        style={{ background: "var(--surface-2)" }}
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <h2
            className="leading-tight"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "20px",
              fontWeight: 500,
              letterSpacing: "-0.005em",
            }}
          >
            {title}
          </h2>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onTogglePin}
              aria-label={session.pinned_at === null ? "Pin session" : "Unpin session"}
              title={session.pinned_at === null ? "Pin" : "Unpin"}
              className="rounded-md border px-2 py-1.5 text-xs font-medium"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                color: session.pinned_at === null ? "var(--text-muted)" : "var(--accent)",
              }}
            >
              <Star
                size={14}
                fill={session.pinned_at === null ? "none" : "currentColor"}
                strokeWidth={1.75}
              />
            </button>
            <button
              onClick={onCopyResume}
              className="rounded-md px-3 py-1.5 text-xs font-medium"
              style={{
                background: "var(--accent)",
                color: "white",
              }}
            >
              {resumeCopied ? "Copied ✓" : "Copy resume cmd"}
            </button>
            <button
              onClick={onExport}
              className="rounded-md border px-3 py-1.5 text-xs font-medium"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            >
              Export .md
            </button>
            {session.cwd && (
              <button
                onClick={onOpenCwd}
                className="rounded-md border px-3 py-1.5 text-xs font-medium"
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }}
              >
                Open cwd
              </button>
            )}
          </div>
        </div>
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <span>
            <strong style={{ color: "var(--text)" }}>Session:</strong>{" "}
            <code>{session.session_id}</code>
          </span>
          <span>
            <strong style={{ color: "var(--text)" }}>Project:</strong>{" "}
            {shortProject(session.project_dir)}
          </span>
          {session.git_branch && (
            <span>
              <strong style={{ color: "var(--text)" }}>Branch:</strong>{" "}
              {session.git_branch}
            </span>
          )}
          <span>
            <strong style={{ color: "var(--text)" }}>Started:</strong>{" "}
            {formatDateTime(session.started_at_ms)}
          </span>
          <span>
            <strong style={{ color: "var(--text)" }}>Duration:</strong>{" "}
            {formatDuration(durationMs)}
          </span>
        </div>
        {exportStatus && (
          <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            {exportStatus}
          </div>
        )}
      </div>

      <div className="px-5 pt-4 pb-3">
        <div
          className="mb-1.5 font-semibold uppercase tracking-[0.08em]"
          style={{
            color: "var(--text-muted)",
            opacity: 0.85,
            fontSize: "10.5px",
          }}
        >
          TLDR
        </div>
        <p className="whitespace-pre-wrap text-sm">{heuristicTldr(session)}</p>

        <div className="mt-3">
          {session.ai_summary ? (
            <div
              className="rounded-md border p-3 text-sm"
              style={{
                background: "var(--surface-2)",
                borderColor: "var(--border)",
              }}
            >
              <div
                className="mb-1 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--accent)" }}
              >
                AI summary
              </div>
              <div className="md max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{session.ai_summary}</ReactMarkdown>
              </div>
            </div>
          ) : session.recap_summary ? (
            <>
              <div
                className="rounded-md border p-3 text-sm"
                style={{
                  background: "var(--surface-2)",
                  borderColor: "var(--border)",
                }}
              >
                <div
                  className="mb-1 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--accent)" }}
                >
                  Session recap
                  <span
                    className="text-[10px] font-normal normal-case tracking-normal"
                    style={{ color: "var(--text-muted)", opacity: 0.85 }}
                  >
                    Auto-generated by Claude Code on return
                  </span>
                </div>
                <div className="md max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{session.recap_summary}</ReactMarkdown>
                </div>
              </div>
              <button
                onClick={onGenerateSummary}
                disabled={summaryBusy}
                className="mt-2 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }}
              >
                {summaryBusy ? "Generating…" : "Generate fresh summary (Haiku)"}
              </button>
            </>
          ) : (
            <button
              onClick={onGenerateSummary}
              disabled={summaryBusy}
              className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            >
              {summaryBusy ? "Generating…" : "Generate AI TLDR (Haiku)"}
            </button>
          )}
          {summaryError && (
            <div
              className="mt-2 text-xs"
              style={{ color: "var(--danger)" }}
            >
              {summaryError}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-5 py-3 text-xs md:grid-cols-4">
        <Metric label="Messages" value={formatNumber(session.message_count)} />
        <Metric
          label="Tokens (total)"
          value={formatNumber(totalTokens)}
          sub={`${formatNumber(session.input_tokens)} in / ${formatNumber(session.output_tokens)} out`}
        />
        <Metric label="Est. API cost" value={formatCost(session.estimated_cost_usd)} />
        <Metric
          label="Models"
          value={session.models_used.join(", ") || "—"}
        />
      </div>

      {toolEntries.length > 0 && (
        <div className="px-5 py-3">
          <div
            className="mb-2 font-semibold uppercase tracking-[0.08em]"
            style={{
              color: "var(--text-muted)",
              opacity: 0.85,
              fontSize: "10.5px",
            }}
          >
            Tool calls
          </div>
          <div className="flex flex-wrap gap-1.5">
            {toolEntries.map(([name, count]) => (
              <span
                key={name}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                {name} ·{" "}
                <span style={{ color: "var(--text-muted)" }}>{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {session.files_touched.length > 0 && (
        <details className="px-5 py-3">
          <summary
            className="cursor-pointer font-semibold uppercase tracking-[0.08em]"
            style={{
              color: "var(--text-muted)",
              opacity: 0.85,
              fontSize: "10.5px",
            }}
          >
            Files touched ({session.files_touched.length})
          </summary>
          <ul className="mt-2 space-y-0.5 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
            {session.files_touched.map((p) => (
              <li key={p} className="truncate" title={p}>
                {p}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex-1 min-h-0">
        <Transcript turns={turns} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{
        background: "var(--surface-2)",
        borderColor: "var(--border)",
      }}
    >
      <div
        className="font-semibold uppercase tracking-[0.08em]"
        style={{
          color: "var(--text-muted)",
          opacity: 0.85,
          fontSize: "10px",
        }}
      >
        {label}
      </div>
      <div className="mt-1 text-base font-medium leading-tight">{value}</div>
      {sub && (
        <div
          className="mt-0.5 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

