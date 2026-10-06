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
import { dbPool, STORE_ENABLED } from "@/lib/round-store";

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

/** An unregistered draft (quoted, not yet paid) lasts this long. */
const DRAFT_TTL_MS = 2 * 3_600_000;
/** A registered draft is the creator's market: kept so they can host on it again. */
const REGISTERED_TTL_MS = 30 * 24 * 3_600_000;

const expired = (d: MarketDraft, now = Date.now()) =>
  now - d.createdAt > (d.marketId ? REGISTERED_TTL_MS : DRAFT_TTL_MS);

function sweepDrafts(): void {
  const now = Date.now();
  for (const [k, d] of cache.drafts) if (expired(d, now)) cache.drafts.delete(k);
}

// Drafts outlive a restart in Postgres: a creator who paid Panta's fee must
// still be able to open their pit after a deploy. Memory-only without a DB.
const _gd = globalThis as unknown as { __pit_draftsReady?: Promise<void> };
function draftsReady(): Promise<void> {
  if (!STORE_ENABLED) return Promise.resolve();
  _gd.__pit_draftsReady ??= dbPool().query(`
    CREATE TABLE IF NOT EXISTS market_drafts (
      draft_id    TEXT PRIMARY KEY,
      wallet      TEXT NOT NULL,
      data        JSONB NOT NULL,
      created_at  BIGINT NOT NULL
    );
  `).then(() => undefined);
  return _gd.__pit_draftsReady;
}

async function persistDraft(d: MarketDraft): Promise<void> {
  if (!STORE_ENABLED) return;
  await draftsReady();
  await dbPool().query(
    `INSERT INTO market_drafts (draft_id, wallet, data, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (draft_id) DO UPDATE SET data = EXCLUDED.data`,
    [d.draftId, d.wallet, JSON.stringify(d), d.createdAt]
  );
}

export async function saveDraft(d: Omit<MarketDraft, "draftId" | "createdAt">): Promise<MarketDraft> {
  sweepDrafts();
  const draft: MarketDraft = { ...d, draftId: `md_${randomBytes(9).toString("base64url")}`, createdAt: Date.now() };
  cache.drafts.set(draft.draftId, draft);
  await persistDraft(draft);
  return draft;
}

export async function getDraft(draftId: string): Promise<MarketDraft | null> {
  sweepDrafts();
  const hit = cache.drafts.get(draftId);
  if (hit) return hit;
  if (!STORE_ENABLED || !/^md_[A-Za-z0-9_-]{6,32}$/.test(draftId)) return null;
  await draftsReady();
  const { rows } = await dbPool().query<{ data: MarketDraft }>("SELECT data FROM market_drafts WHERE draft_id = $1", [draftId]);
  const d = rows[0]?.data ?? null;
  if (!d || expired(d)) return null;
  cache.drafts.set(d.draftId, d);
  return d;
}

export async function markDraftRegistered(draftId: string, marketId: string, signature: string): Promise<MarketDraft | null> {
  const d = await getDraft(draftId);
  if (!d) return null;
  d.marketId = marketId;
  d.signature = signature;
  await persistDraft(d);
  return d;
}

/** Display label for a market category, e.g. "sports" → "SPORTS". */
export function categoryLabel(category: string): string {
  return (category || "other").toUpperCase().slice(0, 12);
}

export { mapPhase };
