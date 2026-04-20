import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Turn } from "@/lib/ipc";

interface Props {
  turns: Turn[];
}

function TurnCard({ turn }: { turn: Turn }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const isUser = turn.role === "user";
  const isAssistant = turn.role === "assistant";

  return (
    <div
      className="px-4 py-3 border-b"
      style={{
        borderColor: "var(--border)",
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
        <div
          className="md max-w-none"
          style={{ color: "var(--text)" }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
        </div>
      )}

      {turn.tool_uses.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setToolsOpen((o) => !o)}
            className="text-xs underline-offset-2 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            {toolsOpen ? "Hide" : "Show"} {turn.tool_uses.length} tool call
            {turn.tool_uses.length === 1 ? "" : "s"}
          </button>
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

export function Transcript({ turns }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

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

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const turn = turns[vi.index];
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
              <TurnCard turn={turn} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
