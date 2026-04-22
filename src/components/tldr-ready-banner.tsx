import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  onJump: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 10000;

export function TldrReadyBanner({ title, onJump, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg"
      style={{
        background: "var(--surface-2)",
        borderColor: "var(--border)",
        color: "var(--text)",
      }}
    >
      <div className="min-w-0 flex-1">
        <div
          className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "var(--accent)" }}
        >
          TLDR ready
        </div>
        <div className="truncate text-sm" title={title}>
          {title}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onJump}
          className="rounded-md px-2.5 py-1 text-xs font-medium"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Jump
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md p-1"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
