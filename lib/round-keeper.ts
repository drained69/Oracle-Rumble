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
import { arenas as mockArenas, findMockMarket } from "@/lib/arena-data";
import {
  advance,
  botTick,
  createRound,
  DEFAULT_CONFIG,
  fillWithBots,
  humanCount,
  markToMarket,
  settle,
  type Round,
  type RoundConfig
} from "@/lib/royale";

/** Live YES price (cents 0..100) for a market. Panta first, then mock. */
export async function marketYesPrice(marketId: string): Promise<number> {
  if (PANTA_LIVE) {
    try {
      const m = await pantaFetch<PantaMarket & { yesPrice?: number | string }>(`/markets/${encodeURIComponent(marketId)}`);
      const raw = (m as { yesPrice?: number | string }).yesPrice;
      const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? "0.5"));
      return Math.max(1, Math.min(99, n > 1 ? Math.round(n) : Math.round(n * 100)));
    } catch { /* fall through */ }
  }
  const hit = findMockMarket(marketId);
  return hit ? hit.market.yesPrice : 50;
}

/** Pick a market to run a round on — first live/mock market, optionally excluding one. */
export async function pickMarket(excludeId?: string): Promise<{ marketId: string; marketQuestion: string; category: string; asset: string } | null> {
  let candidates: Array<{ id: string; question: string; category: string }> = [];
  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ items?: Array<{ marketId?: string; id?: string; title?: string; question?: string; category?: string }> }>("/markets");
      const items = data.items ?? [];
      candidates = items.map((m) => ({ id: m.marketId ?? m.id ?? "", question: m.title ?? m.question ?? "Market", category: m.category ?? "crypto" }));
    } catch { /* fall through */ }
  }
  if (candidates.length === 0) {
    candidates = mockArenas.flatMap((a) => a.markets.map((m) => ({ id: m.id, question: m.question, category: m.category })));
  }
  const pool = excludeId ? candidates.filter((c) => c.id !== excludeId) : candidates;
  const chosen = (pool.length ? pool : candidates)[0];
  if (!chosen) return null;
  return {
    marketId: chosen.id,
    marketQuestion: chosen.question,
    category: chosen.category,
    asset: chosen.category.toUpperCase().slice(0, 8)
  };
}

/** Bootstrap a fresh enrolling round on a chosen market. */
export async function bootstrapRound(overrides?: Partial<RoundConfig>): Promise<Round | null> {
  const market = await pickMarket();
  if (!market) return null;
  const config: RoundConfig = {
    ...DEFAULT_CONFIG,
    marketId: market.marketId,
    marketQuestion: market.marketQuestion,
    category: market.category,
    asset: market.asset,
    ...overrides
  };
  return createRound(config, 1);
}

/**
 * Advance a round in place based on wall-clock time. Pure/synchronous — the
 * live YES price is passed in (fetched before the keeper lock) so this can
 * run safely inside a locked transaction. If it transitions to `advancing`,
 * the caller spins up the next round via `advanceToNext`.
 */
export function tick(round: Round, yesPrice: number): Round {
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
      markToMarket(e, yesPrice);
    }
    if (now >= round.liveDeadline) {
      settle(round, yesPrice);
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
