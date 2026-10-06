/**
 * Panta markets as pit material — server-only.
 *
 * Three jobs:
 *   1. Snapshot a Panta market (price, phase, resolution) for the keeper,
 *      cached briefly so every viewer's poll doesn't hit Panta.
 *   2. List Panta's live catalog for the host's "Panta market" picker.
 *   3. Keep the draft registry for markets created through The Pit.
 *
 * Why drafts: in Panta's sandbox every `createId` is the same constant and
 * `register` answers with the fixture market's title — not the question the
 * host wrote. So the question, rules and creator a host actually submitted
 * live here under a unique draft id bound to the creator's wallet; Panta
 * supplies the market id, the price and the resolution.
 */

import { randomBytes } from "node:crypto";
import { PANTA_KEY, PANTA_LIVE, pantaFetch } from "@/lib/panta";
import { mapPhase, toCents, type PantaLiveMarket } from "@/lib/panta-shape";

/** Panta's category enum for market creation. */
export const PANTA_CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
export type PantaCategory = (typeof PANTA_CATEGORIES)[number];

export const PANTA_SANDBOX = PANTA_KEY.startsWith("pk_test_");

export type PantaSnapshot = {
  id: string;
  question: string;
  category: string;
  /** Panta's YES price, cents. */
  yesCents: number;
  phase: "active" | "resolved" | "graduated" | "pending";
  resolved: boolean;
  /** Resolved outcome when Panta has ruled, else null. */
  outcome: "YES" | "NO" | null;
  endMs: number | null;
  resolutionMs: number | null;
  volumeUsdc: number;
};

type RawMarket = PantaLiveMarket & {
  startTime?: string | number;
  endTime?: string | number;
  resolutionTime?: string | number;
  status?: string;
  description?: string;
  volumeUsdc?: string;
};

/** Panta times arrive as unix seconds, ms, or ISO strings depending on endpoint. */
export function toMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null;
  const n = Number(v);
  if (Number.isFinite(n) && /^\d+$/.test(v.trim())) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function snapshotFrom(m: RawMarket): PantaSnapshot {
  const yes = toCents(m.yesPrice);
  const resolved = !!m.resolved || (m.phase ?? "").toLowerCase() === "resolved";
  // Panta reports a resolved market's price at the paid side; use an explicit
  // outcome when present, otherwise read it from a decisive price.
  const outcome = m.outcome === "YES" || m.outcome === "NO"
    ? m.outcome
    : resolved && yes >= 99 ? "YES" : resolved && yes <= 1 ? "NO" : null;
  return {
    id: m.marketId ?? m.id ?? "",
    question: (m.title ?? m.question ?? "").trim(),
    category: (m.category ?? "other").toLowerCase(),
    yesCents: Math.max(1, Math.min(99, yes)),
    phase: mapPhase(m.phase, m.resolved),
    resolved,
    outcome,
    endMs: toMs(m.endTime),
    resolutionMs: toMs(m.resolutionTime ?? m.resolveAt ?? m.resolutionTimestamp),
    volumeUsdc: Number.parseFloat(String(m.volumeUsdc ?? "0")) || 0
  };
}

// ── caches ─────────────────────────────────────────────────────────────

type Cache = {
  market: Map<string, { at: number; snap: PantaSnapshot | null }>;
  catalog?: { at: number; list: PantaSnapshot[] };
  drafts: Map<string, MarketDraft>;
};
const _g = globalThis as unknown as { __pit_markets?: Cache };
const cache: Cache = (_g.__pit_markets ??= { market: new Map(), drafts: new Map() });

const MARKET_TTL_MS = 8_000;
const CATALOG_TTL_MS = 30_000;

/** A single Panta market, or null when Panta is off or doesn't know the id. */
export async function getPantaMarket(id: string): Promise<PantaSnapshot | null> {
  if (!PANTA_LIVE || !id) return null;
  const hit = cache.market.get(id);
  if (hit && Date.now() - hit.at < MARKET_TTL_MS) return hit.snap;
  let snap: PantaSnapshot | null = null;
  try {
    const raw = await pantaFetch<RawMarket>(`/markets/${encodeURIComponent(id)}`);
    snap = snapshotFrom(raw);
    if (!snap.id) snap = null;
  } catch {
    // Keep serving the last good snapshot through a Panta blip.
    if (hit) return hit.snap;
  }
  cache.market.set(id, { at: Date.now(), snap });
  if (cache.market.size > 500) cache.market.delete(cache.market.keys().next().value!);
  return snap;
}

/** Open (unresolved, not yet closed) Panta markets a pit can run on. */
export async function listPantaMarkets(): Promise<PantaSnapshot[]> {
  if (!PANTA_LIVE) return [];
  if (cache.catalog && Date.now() - cache.catalog.at < CATALOG_TTL_MS) return cache.catalog.list;
  try {
    const data = await pantaFetch<{ items?: RawMarket[]; markets?: RawMarket[] } | RawMarket[]>("/markets");
    const raw = Array.isArray(data) ? data : (data.items ?? data.markets ?? []);
    const now = Date.now();
    const list = raw
      .map(snapshotFrom)
      .filter((m) => m.id && m.question && !m.resolved && (m.endMs === null || m.endMs > now))
      .sort((a, b) => b.volumeUsdc - a.volumeUsdc);
    cache.catalog = { at: Date.now(), list };
    return list;
  } catch {
    return cache.catalog?.list ?? [];
  }
}

// ── drafts (markets created through The Pit) ──────────────────────────

export type MarketDraft = {
  draftId: string;
  wallet: string;
  question: string;
  category: PantaCategory;
  resolutionRule: string;
  sourcesOfTruth: string[];
  endMs: number;
  breaking: boolean;
  createId: string;
  /** Creation fee Panta quoted, USDC. */
  feeUsdc: number;
  createdAt: number;
  marketId?: string;
  signature?: string;
};

const DRAFT_TTL_MS = 2 * 3_600_000;

function sweepDrafts(): void {
  const now = Date.now();
  for (const [k, d] of cache.drafts) if (now - d.createdAt > DRAFT_TTL_MS) cache.drafts.delete(k);
}

export function saveDraft(d: Omit<MarketDraft, "draftId" | "createdAt">): MarketDraft {
  sweepDrafts();
  const draft: MarketDraft = { ...d, draftId: `md_${randomBytes(9).toString("base64url")}`, createdAt: Date.now() };
  cache.drafts.set(draft.draftId, draft);
  return draft;
}

export function getDraft(draftId: string): MarketDraft | null {
  sweepDrafts();
  return cache.drafts.get(draftId) ?? null;
}

export function markDraftRegistered(draftId: string, marketId: string, signature: string): MarketDraft | null {
  const d = cache.drafts.get(draftId);
  if (!d) return null;
  d.marketId = marketId;
  d.signature = signature;
  return d;
}

/** Display label for a market category, e.g. "sports" → "SPORTS". */
export function categoryLabel(category: string): string {
  return (category || "other").toUpperCase().slice(0, 12);
}

export { mapPhase };
