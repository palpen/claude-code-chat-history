import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  listProjects,
  listSessions,
  type SessionRow,
} from "@/lib/ipc";
import { SessionList } from "@/components/session-list";
import { SessionDetail } from "@/components/session-detail";

const DEFAULT_LEFT_WIDTH = 380;

export default function App() {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [projects, setProjects] = useState<Array<[string, number]>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // debounced fetch
  const reqIdRef = useRef(0);
  const fetchSessions = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const rows = await listSessions({
        query: query.trim() || undefined,
        projectDir: projectFilter ?? undefined,
        modelContains: modelFilter ?? undefined,
      });
      if (reqIdRef.current !== reqId) return;
      setSessions(rows);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }, [query, projectFilter, modelFilter]);

  useEffect(() => {
    const t = setTimeout(fetchSessions, 150);
    return () => clearTimeout(t);
  }, [fetchSessions]);

  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  useEffect(() => {
    const un = listen("sessions-updated", () => {
      fetchSessions();
      listProjects().then(setProjects);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, [fetchSessions]);

  const selected = useMemo(
    () => sessions.find((s) => s.session_id === selectedId) ?? null,
    [sessions, selectedId]
  );

  // Sessions in the order they are rendered on screen (grouped by project,
  // insertion-order-preserving). Arrow-key navigation must follow this order,
  // not the raw chronological order from the backend.
  const visualOrder = useMemo(() => {
    const byProject = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const key = s.project_dir;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(s);
    }
    const flat: SessionRow[] = [];
    for (const rows of byProject.values()) flat.push(...rows);
    return flat;
  }, [sessions]);

  // Auto-select first session when query changes and current selection falls off.
  useEffect(() => {
    if (!selected && visualOrder.length > 0) {
      setSelectedId(visualOrder[0].session_id);
    }
  }, [selected, visualOrder]);

  // Arrow-key navigation across the session list (visual order).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target?.tagName === "TEXTAREA") return;
      if (target?.tagName === "SELECT") return;
      if (visualOrder.length === 0) return;

      const currentIdx = visualOrder.findIndex(
        (s) => s.session_id === selectedId
      );
      const start = currentIdx >= 0 ? currentIdx : 0;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.max(
        0,
        Math.min(visualOrder.length - 1, start + delta)
      );
      if (visualOrder[next].session_id !== selectedId) {
        setSelectedId(visualOrder[next].session_id);
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visualOrder, selectedId]);

  // Keep the selected row visible in the list.
  useEffect(() => {
    if (!selectedId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-session-id="${selectedId}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onSessionPatched = useCallback((patched: SessionRow) => {
    setSessions((rows) =>
      rows.map((r) => (r.session_id === patched.session_id ? patched : r))
    );
  }, []);

  const onDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startW: leftWidth };
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - dragRef.current!.startX;
      const next = Math.min(
        720,
        Math.max(260, dragRef.current!.startW + delta)
      );
      setLeftWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "var(--surface)" }}>
      <div style={{ width: leftWidth, flex: "0 0 auto" }}>
        <SessionList
          sessions={sessions}
          projects={projects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          query={query}
          onQueryChange={setQuery}
          projectFilter={projectFilter}
          onProjectFilterChange={setProjectFilter}
          modelFilter={modelFilter}
          onModelFilterChange={setModelFilter}
          loading={loading}
        />
      </div>
      <div
        onMouseDown={onDragStart}
        className="w-1 cursor-col-resize"
        style={{ background: "var(--border)" }}
      />
      <div className="flex-1 min-w-0">
        <SessionDetail session={selected} onSessionPatched={onSessionPatched} />
      </div>
    </div>
  );
}
