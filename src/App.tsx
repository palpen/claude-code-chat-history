import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  generateSummary,
  listPinnedSessions,
  listProjects,
  listSessions,
  type SessionRow,
  type SortKey,
} from "@/lib/ipc";
import { SessionList } from "@/components/session-list";
import { SessionDetail } from "@/components/session-detail";
import { TabBar } from "@/components/tab-bar";
import { StatsView } from "@/components/stats-view";
import { TldrReadyBanner } from "@/components/tldr-ready-banner";
import { isMac } from "@/lib/utils";

const DEFAULT_LEFT_WIDTH = 380;

export default function App() {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pinnedSessions, setPinnedSessions] = useState<SessionRow[]>([]);
  const [projects, setProjects] = useState<Array<[string, number]>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Background TLDR generation state. Lives at the App level so the in-flight
  // state survives navigation and the completion handler can patch the correct
  // session by ID (not by stale closure).
  const [pendingTldrs, setPendingTldrs] = useState<Set<string>>(new Set());
  const [tldrErrors, setTldrErrors] = useState<Map<string, string>>(new Map());
  const [tldrReady, setTldrReady] = useState<
    { sessionId: string; title: string } | null
  >(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const [tab, setTab] = useState<"sessions" | "stats">("sessions");
  // Ref so keyboard handlers can read current tab without stale closures
  const tabRef = useRef<"sessions" | "stats">("sessions");
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        sortBy,
      });
      if (reqIdRef.current !== reqId) return;
      setSessions(rows);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }, [query, projectFilter, modelFilter, sortBy]);

  useEffect(() => {
    const t = setTimeout(fetchSessions, 150);
    return () => clearTimeout(t);
  }, [fetchSessions]);

  const fetchPinned = useCallback(() => {
    listPinnedSessions().then(setPinnedSessions);
  }, []);

  useEffect(() => {
    listProjects().then(setProjects);
    fetchPinned();
  }, [fetchPinned]);

  useEffect(() => {
    const un = listen("sessions-updated", () => {
      fetchSessions();
      fetchPinned();
      listProjects().then(setProjects);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, [fetchSessions, fetchPinned]);

  const pinnedIds = useMemo(
    () => new Set(pinnedSessions.map((s) => s.session_id)),
    [pinnedSessions]
  );

  const selected = useMemo(() => {
    const byId = (s: SessionRow) => s.session_id === selectedId;
    return pinnedSessions.find(byId) ?? sessions.find(byId) ?? null;
  }, [sessions, pinnedSessions, selectedId]);

  // Sessions in the order they are rendered on screen (pinned first, then
  // grouped by project, insertion-order-preserving). Arrow-key navigation
  // must follow this visual order.
  const visualOrder = useMemo(() => {
    const flat: SessionRow[] = [...pinnedSessions];
    const byProject = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      if (pinnedIds.has(s.session_id)) continue;
      const key = s.project_dir;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(s);
    }
    for (const rows of byProject.values()) flat.push(...rows);
    return flat;
  }, [sessions, pinnedSessions, pinnedIds]);

  // Auto-select first session when query changes and current selection falls off.
  useEffect(() => {
    if (!selected && visualOrder.length > 0) {
      setSelectedId(visualOrder[0].session_id);
    }
  }, [selected, visualOrder]);

  // Arrow-key navigation across the session list (visual order).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (tabRef.current !== "sessions") return;
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

  // Shortcuts to focus and clear the search input; also handles tab switching.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const input = searchInputRef.current;

      const modKey = isMac() ? e.metaKey : e.ctrlKey;

      // Tab switch shortcuts work on all tabs
      if (modKey && !e.shiftKey && !e.altKey && e.key === "1") {
        e.preventDefault();
        setTab("sessions");
        return;
      }
      if (modKey && !e.shiftKey && !e.altKey && e.key === "2") {
        e.preventDefault();
        setTab("stats");
        return;
      }

      if (tabRef.current !== "sessions") return;

      if (modKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input?.focus();
        input?.select();
        return;
      }

      if (e.key === "/") {
        if (target?.isContentEditable) return;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        input?.focus();
        input?.select();
        return;
      }

      if (e.key === "Escape") {
        // Only handle Esc when the search input is focused — otherwise leave
        // it alone so it can close dialogs, details, etc.
        if (target !== input) return;
        if (query.length > 0) {
          setQuery("");
        } else {
          input?.blur();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [query]);

  const generateTldr = useCallback(
    async (sessionId: string, title: string) => {
      setPendingTldrs((s) => {
        if (s.has(sessionId)) return s;
        const n = new Set(s);
        n.add(sessionId);
        return n;
      });
      setTldrErrors((m) => {
        if (!m.has(sessionId)) return m;
        const n = new Map(m);
        n.delete(sessionId);
        return n;
      });
      try {
        const summary = await generateSummary(sessionId);
        setSessions((rows) =>
          rows.map((r) =>
            r.session_id === sessionId ? { ...r, ai_summary: summary } : r
          )
        );
        setPinnedSessions((rows) =>
          rows.map((r) =>
            r.session_id === sessionId ? { ...r, ai_summary: summary } : r
          )
        );
        if (selectedIdRef.current !== sessionId) {
          setTldrReady({ sessionId, title });
        }
      } catch (e) {
        setTldrErrors((m) => {
          const n = new Map(m);
          n.set(sessionId, String(e));
          return n;
        });
      } finally {
        setPendingTldrs((s) => {
          if (!s.has(sessionId)) return s;
          const n = new Set(s);
          n.delete(sessionId);
          return n;
        });
      }
    },
    []
  );

  const dismissTldrReady = useCallback(() => setTldrReady(null), []);
  const jumpToTldrReady = useCallback(() => {
    setTldrReady((ready) => {
      if (ready) setSelectedId(ready.sessionId);
      return null;
    });
  }, []);

  const onPinToggled = useCallback(() => {
    fetchPinned();
    fetchSessions();
  }, [fetchPinned, fetchSessions]);

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
    <div
      className="flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: "var(--surface)" }}
    >
      <TabBar tab={tab} onChange={setTab} />
      {tab === "sessions" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div style={{ width: leftWidth, flex: "0 0 auto" }}>
            <SessionList
              sessions={sessions}
              pinnedSessions={pinnedSessions}
              projects={projects}
              selectedId={selectedId}
              onSelect={setSelectedId}
              query={query}
              onQueryChange={setQuery}
              projectFilter={projectFilter}
              onProjectFilterChange={setProjectFilter}
              modelFilter={modelFilter}
              onModelFilterChange={setModelFilter}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              loading={loading}
              searchInputRef={searchInputRef}
              onPinToggled={onPinToggled}
              pendingTldrs={pendingTldrs}
            />
          </div>
          <div
            onMouseDown={onDragStart}
            className="w-1 cursor-col-resize"
            style={{ background: "var(--border)" }}
          />
          <div className="flex-1 min-w-0">
            <SessionDetail
              session={selected}
              onPinToggled={onPinToggled}
              pendingTldrs={pendingTldrs}
              tldrErrors={tldrErrors}
              onGenerateTldr={generateTldr}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          <StatsView />
        </div>
      )}
      {tldrReady && tldrReady.sessionId !== selectedId && (
        <TldrReadyBanner
          title={tldrReady.title}
          onJump={jumpToTldrReady}
          onDismiss={dismissTldrReady}
        />
      )}
    </div>
  );
}
