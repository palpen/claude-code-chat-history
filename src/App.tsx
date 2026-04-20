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

  // Auto-select first session when query changes and current selection falls off.
  useEffect(() => {
    if (!selected && sessions.length > 0) {
      setSelectedId(sessions[0].session_id);
    }
  }, [selected, sessions]);

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
