/**
 * Shape adapter — converts Panta's wire responses into the stable
 * PantaMarket shape the rest of the app expects. Used by /api/markets
 * (list) and /api/markets/[id] (single) so both endpoints emit the same
 * fields regardless of which Panta variant returned them.
 *
 * Panta's live-api response evolves per phase — a primary-market row has
 * different field names than a resolved-market row. This normalizer is
 * intentionally forgiving.
 */

import type { PantaMarket } from "@/lib/panta";

export type PantaLiveMarket = {
  marketId?: string;
  id?: string;
  title?: string;
  question?: string;
  category?: string;
  yesPrice?: number | string;
  noPrice?: number | string;
  volumeUsdc?: string;
  volume?: string;
  /** Unix seconds, ms, or ISO string — Panta varies by endpoint. */
  endTime?: string | number;
  closes?: string;
  phase?: string;
  resolved?: boolean;
  outcome?: "YES" | "NO" | null;
  resolvedAt?: string;
  resolutionTime?: string | number;
  resolveAt?: string | number;
  resolutionTimestamp?: string | number;
};

/** A Panta time (unix seconds, ms, or ISO string) as ms epoch, else NaN. */
function timeMs(v: string | number | undefined): number {
  if (v === undefined || v === null || v === "") return NaN;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (/^\d+$/.test(v.trim())) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
  return Date.parse(v);
}

function isoOrNull(v: string | number | undefined): string | null {
  const t = timeMs(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function toCents(v: number | string | undefined): number {
  if (v === undefined || v === null) return 50;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n > 1 ? Math.round(n) : Math.round(n * 100)));
}

export function formatVolume(v: string | undefined): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return v;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function formatCloses(endTime: string | number | undefined): string {
  const t = timeMs(endTime);
  if (Number.isNaN(t)) return "—";
  const ms = t - Date.now();
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  if (d > 0) return `Closes in ${d}d`;
  if (h > 0) return `Closes in ${h}h`;
  return "Closes soon";
}

export function mapPhase(p: string | undefined, resolved: boolean | undefined): "active" | "resolved" | "graduated" | "pending" {
  if (resolved) return "resolved";
  switch ((p ?? "").toLowerCase()) {
    case "primary": return "active";
    case "graduated": return "graduated";
    case "resolved": return "resolved";
    case "pending": return "pending";
    default: return "active";
  }
}

export function pantaMarketToUi(m: PantaLiveMarket): PantaMarket {
  return {
    id: m.marketId ?? m.id ?? "",
    question: m.title ?? m.question ?? "(untitled market)",
    category: m.category ?? "General",
    yesPrice: toCents(m.yesPrice),
    change: 0,
    volume: m.volume ?? formatVolume(m.volumeUsdc),
    closes: m.closes ?? formatCloses(m.endTime),
    phase: mapPhase(m.phase, m.resolved),
    outcome: m.outcome ?? null,
    resolvedAt: m.resolvedAt ?? null,
    resolutionTime: isoOrNull(m.resolutionTime ?? m.resolveAt ?? m.resolutionTimestamp)
  };
}
