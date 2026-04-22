import { isMac } from "@/lib/utils";

interface TabBarProps {
  tab: "sessions" | "stats";
  onChange: (t: "sessions" | "stats") => void;
}

export function TabBar({ tab, onChange }: TabBarProps) {
  const mod = isMac() ? "⌘" : "Ctrl+";
  return (
    <div
      className="flex gap-1 px-3 py-2 flex-shrink-0"
      style={{
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {(["sessions", "stats"] as const).map((t, i) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            background: tab === t ? "var(--accent)" : "var(--surface-3)",
            color: tab === t ? "#fff" : "var(--text)",
            border: "none",
            borderRadius: 6,
            padding: "4px 12px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {t === "sessions" ? "Sessions" : "Stats"}
          <span style={{ marginLeft: 6, opacity: 0.5, fontSize: 11 }}>
            {mod}{i + 1}
          </span>
        </button>
      ))}
    </div>
  );
}
