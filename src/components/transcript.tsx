import {
  cloneElement,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isMac } from "@/lib/utils";
import type { Turn } from "@/lib/ipc";

interface Props {
  turns: Turn[];
  hideToolCalls?: boolean;
}

interface Match {
  turnIndex: number;
  /** Ordinal of this match within its turn's text (0-indexed). */
  localIdx: number;
}

interface HighlightState {
  count: number;
  currentInTurn: number | null;
}

function countMatches(text: string, q: string): number {
  if (!q) return 0;
  const lt = text.toLowerCase();
  const lq = q.toLowerCase();
  let i = 0;
  let n = 0;
  while (i < lt.length) {
    const f = lt.indexOf(lq, i);
    if (f === -1) break;
    n += 1;
    i = f + lq.length;
  }
  return n;
}

function highlightText(
  text: string,
  q: string,
  state: HighlightState
): ReactNode {
  if (!q) return text;
  const parts: ReactNode[] = [];
  const lq = q.toLowerCase();
  const lt = text.toLowerCase();
  let i = 0;
  while (i <= text.length) {
    const found = lt.indexOf(lq, i);
    if (found === -1) {
      if (i < text.length) parts.push(text.slice(i));
      break;
    }
    if (found > i) parts.push(text.slice(i, found));
    const matchText = text.slice(found, found + q.length);
    const isCurrent = state.count === state.currentInTurn;
    parts.push(
      <mark
        key={`m-${state.count}`}
        data-find-current={isCurrent ? "true" : undefined}
        style={
          isCurrent
            ? {
                background: "var(--accent)",
                color: "white",
                padding: "0 2px",
                borderRadius: "2px",
              }
            : {
                background: "var(--accent-soft)",
                color: "var(--text)",
                padding: "0 2px",
                borderRadius: "2px",
              }
        }
      >
        {matchText}
      </mark>
    );
    state.count += 1;
    i = found + q.length;
  }
  return <>{parts}</>;
}

function highlightNode(
  node: ReactNode,
  q: string,
  state: HighlightState
): ReactNode {
  if (typeof node === "string") return highlightText(node, q, state);
  if (typeof node === "number" || node == null || typeof node === "boolean")
    return node;
  if (Array.isArray(node)) {
    return node.map((c, i) => (
      <Fragment key={i}>{highlightNode(c, q, state)}</Fragment>
    ));
  }
  if (isValidElement(node)) {
    // Skip code blocks — wrapping <mark> inside monospace blocks tends to
    // break layout, and matches in code are niche for v1.
    if (node.type === "code" || node.type === "pre") return node;
    const props = node.props as { children?: ReactNode };
    return cloneElement(
      node,
      {},
      highlightNode(props.children, q, state)
    );
  }
  return node;
}

function makeMarkdownComponents(
  query: string,
  currentInTurn: number | null
): Components | undefined {
  if (!query) return undefined;
  const state: HighlightState = { count: 0, currentInTurn };
  const hl = (children: ReactNode) => highlightNode(children, query, state);
  return {
    p: ({ children, node: _n, ...rest }) => <p {...rest}>{hl(children)}</p>,
    li: ({ children, node: _n, ...rest }) => <li {...rest}>{hl(children)}</li>,
    em: ({ children, node: _n, ...rest }) => <em {...rest}>{hl(children)}</em>,
    strong: ({ children, node: _n, ...rest }) => (
      <strong {...rest}>{hl(children)}</strong>
    ),
    a: ({ children, node: _n, ...rest }) => <a {...rest}>{hl(children)}</a>,
    blockquote: ({ children, node: _n, ...rest }) => (
      <blockquote {...rest}>{hl(children)}</blockquote>
    ),
    h1: ({ children, node: _n, ...rest }) => <h1 {...rest}>{hl(children)}</h1>,
    h2: ({ children, node: _n, ...rest }) => <h2 {...rest}>{hl(children)}</h2>,
    h3: ({ children, node: _n, ...rest }) => <h3 {...rest}>{hl(children)}</h3>,
    h4: ({ children, node: _n, ...rest }) => <h4 {...rest}>{hl(children)}</h4>,
    h5: ({ children, node: _n, ...rest }) => <h5 {...rest}>{hl(children)}</h5>,
    h6: ({ children, node: _n, ...rest }) => <h6 {...rest}>{hl(children)}</h6>,
    td: ({ children, node: _n, ...rest }) => <td {...rest}>{hl(children)}</td>,
    th: ({ children, node: _n, ...rest }) => <th {...rest}>{hl(children)}</th>,
  };
}

function TurnCard({
  turn,
  query,
  currentInTurn,
  hideToolCalls = false,
}: {
  turn: Turn;
  query: string;
  currentInTurn: number | null;
  hideToolCalls?: boolean;
}) {
  const [toolsOpen, setToolsOpen] = useState(!hideToolCalls);
  const isUser = turn.role === "user";
  const isAssistant = turn.role === "assistant";
  const hasText = turn.text.trim().length > 0;
  const isToolOnly = !hasText && turn.tool_uses.length > 0;

  const components = useMemo(
    () => makeMarkdownComponents(query, currentInTurn),
    [query, currentInTurn]
  );

  if (hideToolCalls && isToolOnly && !toolsOpen) {
    const names = turn.tool_uses.slice(0, 4).map((t) => t.name).join(", ");
    const extra =
      turn.tool_uses.length > 4 ? ` +${turn.tool_uses.length - 4}` : "";
    return (
      <button
        onClick={() => setToolsOpen(true)}
        className="flex w-full items-center gap-2 px-5 py-1 text-left text-xs"
        style={{ background: "var(--surface)", color: "var(--text-muted)" }}
        title="Click to expand tool call"
      >
        <span aria-hidden>🔧</span>
        <span className="truncate font-mono">
          {names}
          {extra}
        </span>
      </button>
    );
  }

  return (
    <div
      className="px-5 py-4"
      style={{
        background: isUser ? "var(--surface-2)" : "var(--surface)",
      }}
    >
      <div
        className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="font-semibold">
          {isUser ? "You" : isAssistant ? "Claude" : turn.role}
        </span>
        {turn.model && <span>· {turn.model}</span>}
      </div>

      {turn.text.trim().length > 0 && (
        <div className="md max-w-none" style={{ color: "var(--text)" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {turn.text}
          </ReactMarkdown>
        </div>
      )}

      {turn.tool_uses.length > 0 && (
        <div className="mt-2">
          {hideToolCalls ? (
            <button
              onClick={() => setToolsOpen((o) => !o)}
              className="rounded px-2 py-1 text-xs"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
              }}
            >
              🔧 {turn.tool_uses.length} tool call
              {turn.tool_uses.length === 1 ? "" : "s"}
            </button>
          ) : (
            <button
              onClick={() => setToolsOpen((o) => !o)}
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              {toolsOpen ? "Hide" : "Show"} {turn.tool_uses.length} tool call
              {turn.tool_uses.length === 1 ? "" : "s"}
            </button>
          )}
          {toolsOpen && (
            <div className="mt-2 space-y-2">
              {turn.tool_uses.map((tu) => (
                <details
                  key={tu.id}
                  className="rounded-md border px-3 py-2 text-xs"
                  style={{
                    background: "var(--surface-2)",
                    borderColor: "var(--border)",
                  }}
                >
                  <summary className="cursor-pointer font-mono">
                    {tu.name}
                  </summary>
                  <pre
                    className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {tu.input_preview}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Transcript({ turns, hideToolCalls = false }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCur, setFindCur] = useState(0);

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Build the flat list of matches across all turns.
  const matches: Match[] = useMemo(() => {
    const q = findQuery.trim();
    if (!q) return [];
    const out: Match[] = [];
    for (let i = 0; i < turns.length; i++) {
      const n = countMatches(turns[i].text, q);
      for (let k = 0; k < n; k++) {
        out.push({ turnIndex: i, localIdx: k });
      }
    }
    return out;
  }, [turns, findQuery]);

  // Reset transcript-local find state when the session (turns identity) changes.
  useEffect(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindCur(0);
  }, [turns]);

  // Clamp current match index to the valid range when matches change.
  useEffect(() => {
    if (matches.length === 0) {
      if (findCur !== 0) setFindCur(0);
      return;
    }
    if (findCur >= matches.length) setFindCur(matches.length - 1);
  }, [matches, findCur]);

  const scrollToMatch = useCallback(
    (idx: number) => {
      const m = matches[idx];
      if (!m) return;
      virtualizer.scrollToIndex(m.turnIndex, { align: "center" });
      // After the virtualizer measures + paints, center the specific <mark>.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          parentRef.current
            ?.querySelector<HTMLElement>('[data-find-current="true"]')
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      });
    },
    [matches, virtualizer]
  );

  const cycleMatch = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const next = (findCur + delta + matches.length) % matches.length;
      setFindCur(next);
      scrollToMatch(next);
    },
    [matches.length, findCur, scrollToMatch]
  );

  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
  }, []);

  // Cmd+F / Ctrl+F to open the find bar when the transcript is visible.
  useEffect(() => {
    if (turns.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const modKey = isMac() ? e.metaKey : e.ctrlKey;
      if (modKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [turns.length, openFind]);

  const onFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    } else if (e.key === "Enter") {
      e.preventDefault();
      cycleMatch(e.shiftKey ? -1 : 1);
    }
  };

  // When query changes, jump to first match.
  useEffect(() => {
    if (!findOpen) return;
    if (matches.length > 0 && findCur === 0) {
      scrollToMatch(0);
    }
  }, [matches, findOpen, findCur, scrollToMatch]);

  if (turns.length === 0) {
    return (
      <div
        className="p-6 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        No turns in this session.
      </div>
    );
  }

  const currentMatch = matches[findCur] ?? null;

  return (
    <div className="relative flex h-full flex-col">
      {findOpen && (
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{
            background: "var(--surface-2)",
            borderColor: "var(--border)",
          }}
        >
          <input
            ref={findInputRef}
            type="text"
            placeholder="Find in messages…"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              setFindCur(0);
            }}
            onKeyDown={onFindKeyDown}
            className="flex-1 rounded-md px-2 py-1 text-sm outline-none focus:ring-2"
            style={{
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          />
          <span
            className="min-w-[64px] text-right text-xs tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {findQuery.trim()
              ? matches.length === 0
                ? "No matches"
                : `${findCur + 1} of ${matches.length}`
              : ""}
          </span>
          <button
            onClick={() => cycleMatch(-1)}
            disabled={matches.length === 0}
            aria-label="Previous match"
            title="Previous (Shift+Enter)"
            className="rounded px-2 py-1 text-xs disabled:opacity-40"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            ↑
          </button>
          <button
            onClick={() => cycleMatch(1)}
            disabled={matches.length === 0}
            aria-label="Next match"
            title="Next (Enter)"
            className="rounded px-2 py-1 text-xs disabled:opacity-40"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            ↓
          </button>
          <button
            onClick={closeFind}
            aria-label="Close find"
            title="Close (Esc)"
            className="rounded px-2 py-1 text-xs"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const turn = turns[vi.index];
            const currentInTurn =
              currentMatch && currentMatch.turnIndex === vi.index
                ? currentMatch.localIdx
                : null;
            return (
              <div
                key={vi.key}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <TurnCard
                  turn={turn}
                  query={findQuery.trim()}
                  currentInTurn={currentInTurn}
                  hideToolCalls={hideToolCalls}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
