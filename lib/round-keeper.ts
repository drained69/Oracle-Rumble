/**
 * Round keeper — advances a round's state machine on every read.
 *
 * There's no separate cron process. Each `GET /api/round` runs `tick()`,
 * which fills empty slots with bots at lock, opens the trading window,
 * lets bots trade, and settles + advances when timers expire. Panta is the
 * price oracle (live YES price per market); in mock mode a seeded price is
 * used. Everything is idempotent and safe to run on concurrent reads.
 */

import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";
import { markets as directionMarkets, findMockMarket } from "@/lib/arena-data";
import { ASSET_SYMBOLS, assetOfMarketId, getAsset, type AssetSymbol } from "@/lib/assets";
import {
  advance,
  botTick,
  createRound,
  DEFAULT_CONFIG,
  fillWithBots,
  humanCount,
  markToMarket,
  normalizeConfig,
  settle,
  type PriceMap,
  type Round,
  type RoundConfig
} from "@/lib/royale";

/**
 * Normalize a Panta YES price to cents (0..100). Panta returns a decimal like
 * "0.50" (= 50%); some responses may already be in cents. Clamped to 1..99.
 */
export function pantaPriceToCents(raw: number | string | undefined): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "0.5"));
  const cents = n > 1 ? Math.round(n) : Math.round(n * 100);
  return Math.max(1, Math.min(99, cents));
}

/**
 * Live YES price (cents 0..100) for a market. Our own BTC/ETH/SOL board
 * markets are synthetic (not on Panta), so they're priced from the board —
 * querying the Panta sandbox for them returns a 50¢ fixture for ANY id, which
 * would flatten every asset. Only real Panta market ids hit Panta.
 */
export async function marketYesPrice(marketId: string): Promise<number> {
  const local = findMockMarket(marketId);
  if (local && assetOfMarketId(marketId)) return local.market.yesPrice;
  if (PANTA_LIVE) {
    try {
      const m = await pantaFetch<PantaMarket & { yesPrice?: number | string }>(`/markets/${encodeURIComponent(marketId)}`);
      return pantaPriceToCents((m as { yesPrice?: number | string }).yesPrice);
    } catch { /* fall through */ }
  }
  return local ? local.market.yesPrice : 50;
}

type MarketPick = { marketId: string; marketQuestion: string; category: string; asset: string };

/** Which of BTC/ETH/SOL does this market title/id describe, if any? */
function assetOfCandidate(id: string, question: string): AssetSymbol | null {
  const byId = assetOfMarketId(id);
  if (byId) return byId;
  const hay = `${question}`.toLowerCase();
  for (const sym of ASSET_SYMBOLS) {
    const a = getAsset(sym)!;
    if (hay.includes(sym.toLowerCase()) || hay.includes(a.name.toLowerCase())) return sym;
  }
  return null;
}

/**
 * Pick a market to run a round on. The universe is deliberately the three
 * assets only — BTC/ETH/SOL — so every candidate must resolve to one of them.
 * Live Panta markets are filtered to those three; the mock direction board is
 * the fallback. Optionally excludes the current market so rounds rotate assets.
 */
export async function pickMarket(excludeId?: string): Promise<MarketPick | null> {
  let candidates: Array<{ id: string; question: string; category: string; asset: AssetSymbol }> = [];
  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ items?: Array<{ marketId?: string; id?: string; title?: string; question?: string; category?: string }> }>("/markets");
      const items = data.items ?? [];
      candidates = items
        .map((m) => {
          const id = m.marketId ?? m.id ?? "";
          const question = m.title ?? m.question ?? "Market";
          const asset = assetOfCandidate(id, question);
          return asset ? { id, question, category: m.category ?? "crypto", asset } : null;
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
    } catch { /* fall through */ }
  }
  if (candidates.length === 0) {
    candidates = directionMarkets.map((m) => ({ id: m.id, question: m.question, category: m.category, asset: m.asset }));
  }
  // Rotate to a different asset than the one just played, not just a
  // different market on the same asset.
  const excludeAsset = excludeId ? assetOfCandidate(excludeId, "") : null;
  const pool = candidates.filter((c) => c.id !== excludeId && (!excludeAsset || c.asset !== excludeAsset));
  const chosen = (pool.length ? pool : candidates.filter((c) => c.id !== excludeId))[0] ?? candidates[0];
  if (!chosen) return null;
  return {
    marketId: chosen.id,
    marketQuestion: chosen.question,
    category: chosen.category,
    asset: chosen.asset
  };
}

/**
 * Bootstrap a fresh enrolling round. A host can pass config overrides (asset,
 * format, entry, vault, capacity, rounds); they're clamped to safe bounds by
 * normalizeConfig. If the host picked an asset, we run on that asset's market;
 * otherwise the keeper picks one.
 */
export async function bootstrapRound(overrides?: Partial<RoundConfig>): Promise<Round | null> {
  const wantAsset = overrides?.asset ? String(overrides.asset).toUpperCase() : undefined;
  const market = await pickMarketForAsset(wantAsset);
  if (!market) return null;
  const base: RoundConfig = {
    ...DEFAULT_CONFIG,
    marketId: market.marketId,
    marketQuestion: market.marketQuestion,
    category: market.category,
    asset: market.asset
  };
  // Market fields are authoritative; host overrides shape the rules only.
  const { marketId: _m, marketQuestion: _q, category: _c, asset: _a, ...rules } = overrides ?? {};
  void _m; void _q; void _c; void _a;
  const config = normalizeConfig(base, rules);
  return createRound(config, 1);
}

/**
 * YES price (cents) for every board market, so multi-asset parlays can be
 * valued and settled. The round's own market gets the live price; the other
 * assets use the board's current prices. (A per-asset price oracle can enrich
 * this later; the shape stays the same.)
 */
export function buildPriceMap(liveOverride?: { marketId: string; yesPrice: number }): PriceMap {
  const map: PriceMap = {};
  for (const m of directionMarkets) map[m.id] = m.yesPrice;
  if (liveOverride) map[liveOverride.marketId] = liveOverride.yesPrice;
  return map;
}

/** Pick the market for a specific asset if asked, else any of the three. */
async function pickMarketForAsset(asset?: string): Promise<MarketPick | null> {
  if (!asset) return pickMarket();
  const want = asset.toUpperCase();
  // Prefer a live/mock market on the requested asset.
  const direct = directionMarkets.find((m) => m.asset === want);
  if (direct) {
    return { marketId: direct.id, marketQuestion: direct.question, category: direct.category, asset: direct.asset };
  }
  return pickMarket();
}

/**
 * Advance a round in place based on wall-clock time. Pure/synchronous — the
 * live YES price is passed in (fetched before the keeper lock) so this can
 * run safely inside a locked transaction. If it transitions to `advancing`,
 * the caller spins up the next round via `advanceToNext`.
 */
export function tick(round: Round, yesPrice: number, priceMap?: PriceMap): Round {
  const now = Date.now();

  if (round.status === "enrolling" && now >= round.enrollDeadline) {
    if (humanCount(round) === 0) {
      round.status = "cancelled";
      round.endedAt = now;
      round.history.push("Round cancelled — no players entered.");
      return round;
    }
    fillWithBots(round);
    if (round.entrants.length < round.config.minEntrants) {
      round.status = "cancelled";
      round.endedAt = now;
      round.history.push(`Round cancelled — only ${round.entrants.length} entrants. Entry pool refunded.`);
      return round;
    }
    round.status = "live";
    round.liveDeadline = now + round.config.liveSec * 1000;
    round.history.push(`Enrollment locked — ${round.entrants.length} entrants live on ${round.config.asset}.`);
  }

  if (round.status === "live") {
    for (const e of round.entrants) {
      if (e.isBot) botTick(e, yesPrice);
      markToMarket(e, yesPrice, priceMap);
    }
    if (now >= round.liveDeadline) {
      settle(round, yesPrice, priceMap);
    }
  }

  return round;
}

/** Build the next round from a settled `advancing` round on a pre-picked market. */
export function advanceToNext(round: Round, nextMarket: { marketId: string; marketQuestion: string; category: string; asset: string } | null): Round {
  return advance(round, nextMarket ?? {
    marketId: round.config.marketId,
    marketQuestion: round.config.marketQuestion,
    category: round.config.category,
    asset: round.config.asset
  });
}
