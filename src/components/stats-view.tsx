import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { type GlobalStats, type WeeklyBucket, globalStats } from "@/lib/ipc";
import {
  formatNumber,
  formatCost,
  formatRelative,
  basename,
} from "@/lib/utils";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: "var(--text)" }}>
        {value}
      </div>
      {sub !== undefined ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

const CHART_W = 600;
const CHART_H = 100;

function WeeklyChart({ data }: { data: WeeklyBucket[] }) {
  const maxSessions = Math.max(...data.map((b) => b.sessions), 1);
  const slotW = CHART_W / data.length;
  const barW = Math.max(1, Math.floor(slotW) - 3);
  const labelIndices = [0, 4, 8];

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {data.map((b, i) => {
        const barH = Math.max(b.sessions > 0 ? 3 : 0, (b.sessions / maxSessions) * CHART_H);
        const x = i * slotW;
        const y = CHART_H - barH;
        const dateLabel = new Date(b.week_start_ms).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        const tooltipDate = new Date(b.week_start_ms).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        return (
          <g key={b.week_start_ms}>
            <rect
              x={x + 1}
              y={y}
              width={barW}
              height={barH}
              rx={2}
              fill={b.sessions > 0 ? "var(--accent)" : "var(--surface-3)"}
            >
              <title>{`${tooltipDate} · ${b.sessions} sessions · ${formatCost(b.cost_usd)}`}</title>
            </rect>
            {labelIndices.includes(i) ? (
              <text
                x={x + slotW / 2}
                y={CHART_H + 14}
                fontSize={9}
                textAnchor="middle"
                fill="var(--text-muted)"
              >
                {dateLabel}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function TopList({ title, items }: { title: string; items: [string, number][] }) {
  const max = items[0]?.[1] ?? 1;
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          marginBottom: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>—</div>
        ) : (
          items.map(([name, count]) => (
            <div key={name}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                  fontSize: 13,
                }}
              >
                <span
                  title={name}
                  style={{
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "82%",
                  }}
                >
                  {basename(name) || name}
                </span>
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  {count}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  background: "var(--surface-3)",
                  borderRadius: 2,
                }}
              >
                <div
                  style={{
                    height: 3,
                    background: "var(--accent)",
                    borderRadius: 2,
                    width: `${((count / max) * 100).toFixed(0)}%`,
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function StatsView() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    globalStats()
      .then((s) => {
        setStats(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const un = listen("sessions-updated", () => {
      globalStats().then(setStats).catch(() => {});
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (stats === null || stats.total_sessions === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        No sessions indexed yet.
      </div>
    );
  }

  // Derived during render — no effect needed
  const cacheHitRate =
    stats.total_input_tokens > 0
      ? `${((stats.total_cache_read_tokens / stats.total_input_tokens) * 100).toFixed(1)}%`
      : null;

  const allEmpty = stats.weekly_activity.every((b) => b.sessions === 0);

  const firstDate =
    stats.first_session_ms !== null
      ? new Date(stats.first_session_ms).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  const lastRelative =
    stats.last_session_ms !== null ? formatRelative(stats.last_session_ms) : "—";

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "24px 0" }}>
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Totals */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          <StatCard label="Sessions" value={formatNumber(stats.total_sessions)} />
          <StatCard
            label="Messages"
            value={formatNumber(stats.total_messages)}
            sub={`${formatNumber(stats.total_user_messages)} user · ${formatNumber(stats.total_assistant_messages)} assistant`}
          />
          <StatCard label="Est. API Cost" value={formatCost(stats.total_cost_usd)} />
          <StatCard
            label="Tokens"
            value={formatNumber(stats.total_input_tokens + stats.total_output_tokens)}
            sub={
              <>
                {formatNumber(stats.total_input_tokens)} in ·{" "}
                {formatNumber(stats.total_output_tokens)} out
                {stats.total_cache_read_tokens > 0 ? (
                  <> · {formatNumber(stats.total_cache_read_tokens)} cached</>
                ) : null}
                {cacheHitRate !== null ? (
                  <> · {cacheHitRate} cache hits</>
                ) : null}
              </>
            }
          />
        </div>

        {/* Activity row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          <StatCard
            label="This week"
            value={formatNumber(stats.sessions_this_week)}
          />
          <StatCard
            label="Today (UTC)"
            value={formatNumber(stats.sessions_today)}
          />
          <StatCard label="First session" value={firstDate} />
          <StatCard label="Most recent" value={lastRelative} />
        </div>

        {/* Weekly chart */}
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              marginBottom: 12,
            }}
          >
            Weekly activity — last 12 weeks
          </div>
          {allEmpty ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              No sessions in the last 12 weeks.
            </div>
          ) : (
            <WeeklyChart data={stats.weekly_activity} />
          )}
        </div>

        {/* Top projects / models */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <TopList title="Top projects" items={stats.top_projects} />
          <TopList title="Top models" items={stats.top_models} />
        </div>

        {/* Footer */}
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          Est. API cost is hypothetical — Max-subscription users don't actually pay this.
          Week boundaries and "Today" use UTC.
        </div>
      </div>
    </div>
  );
}
