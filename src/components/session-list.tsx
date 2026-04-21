import { useMemo } from "react";
import type { SessionRow } from "@/lib/ipc";
import {
  cn,
  formatRelative,
  sanitizeSnippet,
  shortProject,
} from "@/lib/utils";

interface Props {
  sessions: SessionRow[];
  projects: Array<[string, number]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  projectFilter: string | null;
  onProjectFilterChange: (p: string | null) => void;
  modelFilter: string | null;
  onModelFilterChange: (m: string | null) => void;
  loading: boolean;
}

function stripCaveat(raw: string): string {
  // Claude Code injects a <local-command-caveat>Caveat: The messages below…</local-command-caveat>
  // wrapper ahead of the real prompt. Strip it (and any whitespace) so the
  // visible title is the user's actual first sentence.
  let s = raw.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, "").trim();
  // Some sessions leave a bare "Caveat: …" paragraph with no tags.
  if (/^caveat:/i.test(s)) {
    const nl = s.indexOf("\n");
    s = nl === -1 ? "" : s.slice(nl + 1).trim();
  }
  return s;
}

function titleFor(s: SessionRow): string {
  if (s.custom_title) return s.custom_title;
  const cleaned = stripCaveat(s.first_user_msg ?? "");
  if (cleaned) {
    const firstLine = cleaned.split("\n").find((l) => l.trim().length > 0) ?? "";
    if (firstLine) {
      return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
    }
  }
  return `Session ${s.session_id.slice(0, 8)}`;
}

function modelBadge(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "Opus";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return model.slice(0, 10);
}

const MODEL_OPTIONS = ["opus", "sonnet", "haiku"];

export function SessionList(props: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of props.sessions) {
      const k = s.project_dir;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return Array.from(map.entries());
  }, [props.sessions]);

  return (
    <div className="flex h-full flex-col border-r" style={{ borderColor: "var(--border)" }}>
      <div className="p-3 space-y-2" style={{ background: "var(--surface-2)" }}>
        <input
          type="text"
          placeholder="Search conversations…"
          value={props.query}
          onChange={(e) => props.onQueryChange(e.target.value)}
          className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2"
          style={{
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
        />
        <div className="flex gap-2 text-xs">
          <select
            value={props.projectFilter ?? ""}
            onChange={(e) => props.onProjectFilterChange(e.target.value || null)}
            className="flex-1 rounded-md px-2 py-1 outline-none"
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            <option value="">All projects ({props.projects.reduce((a, [, c]) => a + c, 0)})</option>
            {props.projects.map(([p, c]) => (
              <option key={p} value={p}>
                {shortProject(p)} ({c})
              </option>
            ))}
          </select>
          <select
            value={props.modelFilter ?? ""}
            onChange={(e) => props.onModelFilterChange(e.target.value || null)}
            className="rounded-md px-2 py-1 outline-none"
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            <option value="">All models</option>
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {props.loading && (
          <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Loading…
          </div>
        )}
        {!props.loading && props.sessions.length === 0 && (
          <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>
            No sessions match.
          </div>
        )}
        {grouped.map(([project, rows]) => (
          <div key={project} className="pb-2">
            <div
              className="sticky top-0 z-10 px-3 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
              style={{
                color: "var(--accent)",
                background: "var(--surface-2)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {shortProject(project)}{" "}
              <span style={{ color: "var(--text-muted)", opacity: 0.8 }}>
                · {rows.length}
              </span>
            </div>
            {rows.map((s) => {
              const title = titleFor(s);
              const models = s.models_used.map(modelBadge);
              const uniqueModels = Array.from(new Set(models));
              const isSelected = s.session_id === props.selectedId;
              return (
                <button
                  key={s.session_id}
                  data-session-id={s.session_id}
                  onClick={() => props.onSelect(s.session_id)}
                  className={cn(
                    "block w-full text-left pr-3 py-2 text-sm",
                    "transition-colors",
                    !isSelected && "hover:bg-[var(--surface-2)]"
                  )}
                  style={{
                    paddingLeft: "20px",
                    borderLeft: `2px solid ${isSelected ? "var(--accent)" : "transparent"}`,
                    background: isSelected ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <div
                    className="truncate font-medium"
                    style={{ fontSize: "14px" }}
                    title={title}
                  >
                    {title}
                  </div>
                  {s.snippet && (
                    <div
                      className="truncate mt-1"
                      style={{ color: "var(--text-muted)", fontSize: "12px" }}
                      dangerouslySetInnerHTML={{ __html: sanitizeSnippet(s.snippet) }}
                    />
                  )}
                  <div
                    className="mt-1 flex items-center gap-2"
                    style={{ color: "var(--text-muted)", fontSize: "11px" }}
                  >
                    <span>{formatRelative(s.ended_at_ms || s.started_at_ms)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{s.message_count} msgs</span>
                    {uniqueModels.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        {uniqueModels.map((m) => (
                          <span
                            key={m}
                            className="rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                              background: "var(--surface-3)",
                              color: "var(--text)",
                            }}
                          >
                            {m}
                          </span>
                        ))}
                      </>
                    )}
                    {s.has_errors && (
                      <span style={{ color: "var(--danger)" }}>· errors</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
