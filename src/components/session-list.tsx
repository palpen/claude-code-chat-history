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

function titleFor(s: SessionRow): string {
  if (s.custom_title) return s.custom_title;
  const msg = s.first_user_msg?.trim();
  if (msg) {
    const firstLine = msg.split("\n")[0];
    return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
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
      <div className="p-3 space-y-2 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
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
          <div key={project}>
            <div
              className="px-3 py-2 text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--text-muted)", background: "var(--surface-2)" }}
            >
              {shortProject(project)}{" "}
              <span style={{ opacity: 0.6 }}>· {rows.length}</span>
            </div>
            {rows.map((s) => {
              const title = titleFor(s);
              const models = s.models_used.map(modelBadge);
              const uniqueModels = Array.from(new Set(models));
              const isSelected = s.session_id === props.selectedId;
              return (
                <button
                  key={s.session_id}
                  onClick={() => props.onSelect(s.session_id)}
                  className={cn(
                    "block w-full text-left px-3 py-2 text-sm border-b",
                    "hover:bg-[var(--surface-2)]",
                    isSelected && "bg-[var(--surface-3)]"
                  )}
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="truncate font-medium" title={title}>
                    {title}
                  </div>
                  {s.snippet && (
                    <div
                      className="truncate text-xs mt-0.5"
                      style={{ color: "var(--text-muted)" }}
                      dangerouslySetInnerHTML={{ __html: sanitizeSnippet(s.snippet) }}
                    />
                  )}
                  <div
                    className="mt-1 flex items-center gap-2 text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <span>{formatRelative(s.ended_at_ms || s.started_at_ms)}</span>
                    <span>·</span>
                    <span>{s.message_count} msgs</span>
                    {uniqueModels.length > 0 && (
                      <>
                        <span>·</span>
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
