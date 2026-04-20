import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelative(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

export function basename(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function shortProject(p: string): string {
  const home = "/Users/";
  if (p.startsWith(home)) {
    const parts = p.slice(home.length).split("/");
    if (parts.length >= 2) {
      return `~/${parts.slice(1).join("/")}`;
    }
  }
  return p;
}

/**
 * Renders a snippet string returned by sqlite's snippet() — which contains
 * literal <mark>…</mark> — as safe HTML. We trust the source because the input
 * strings originated from this user's own Claude Code JSONL files on disk.
 */
export function sanitizeSnippet(html: string): string {
  // Escape everything except our own <mark> / </mark> / &hellip;
  const withPlaceholders = html
    .replace(/<mark>/g, "\u0001")
    .replace(/<\/mark>/g, "\u0002");
  const escaped = withPlaceholders
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/\u0001/g, "<mark>")
    .replace(/\u0002/g, "</mark>");
}
