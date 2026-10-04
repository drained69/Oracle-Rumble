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
import { ASSET_SYMBOLS, assetOfMarketId, directionMarketId, getAsset, HORIZONS, type AssetSymbol, type Horizon } from "@/lib/assets";
import { answersFor, predictionQuestions, randomPicks, scorePicks } from "@/lib/predictions";
import { createStreak, currentLeg, normalizeLegSec, resolveLeg, runLeg, startStreak } from "@/lib/streak";
import { freshSpots, resolvedCents, spotPrices, spotPricesAt, upCents, type Spots } from "@/lib/oracle";
import {
  advance,
  botTick,
  createRound,
  DEFAULT_CONFIG,
  fillWithBots,
  humanCount,
  markToMarket,
  normalizeConfig,
  isPicksFormat,
  isPracticeArena,
  placeOpeningCalls,
  settle,
  settlePredictions,
  TRADE_CUTOFF_MS,
  type PriceMap,
  type Round,
  type RoundConfig,
  logEvent
} from "@/lib/royale";

/** How long a new hosted arena waits for the host's seat deposit to confirm. */
const HOST_SEAT_GRACE_MS = 3 * 60_000;
/** Max time to hold a lock or a settlement waiting for the price oracle. */
const ORACLE_WAIT_MS = 60_000;
/** Bots make one trading decision at most this often. */
const BOT_TICK_MS = 5_000;
/** A spot price read this soon after the deadline counts as the close. */
const CLOSE_FRESH_MS = 15_000;

/** Prices a keeper tick / trade runs at. */
export type Pricing = {
  yesPrice: number;      // the round market's UP (YES) price, cents
  priceMap: PriceMap;    // every board market's UP price, cents (values legacy parlay tickets)
  spots: Spots;          // latest USD spot per asset
  closeSpots?: Spots;    // USD per asset at the live deadline (late settles)
};

/** Is this round on one of our BTC/ETH/SOL direction markets (oracle-resolved)? */
export function isDirectionRound(round: Round): boolean {
  return !!assetOfMarketId(round.config.marketId);
}

/** Assets whose open and close a round needs: all three for predictions, else its own. */
function neededAssets(round: Round): AssetSymbol[] {
  if (round.streak) return currentLeg(round.streak).question.assets;
  return round.config.format === "predictions" ? ASSET_SYMBOLS : [round.config.asset as AssetSymbol];
}

/** Update every player's live score in a predictions round ("if it closed now"). */
function scoreLive(round: Round, spots: Spots): void {
  const st = round.predictions;
  const open = round.oracle?.open;
  if (!st || !open) return;
  const live = answersFor(st.questions, open, { ...(round.oracle?.last ?? {}), ...spots });
  for (const e of round.entrants) e.score = scorePicks(e.picks, live, e.locks);
}

/**
 * UP price of every direction market for a round right now: 50 before the
 * round opens, the live probability while trading, the resolved value once
 * the round has a close.
 */
export function oraclePriceMap(round: Round, spots: Spots, now = Date.now()): PriceMap {
  const map: PriceMap = {};
  const o = round.oracle;
  const secondsLeft = Math.max(0, (round.liveDeadline - now) / 1000);
  for (const m of directionMarkets) {
    const a = m.asset as AssetSymbol;
    if (!o?.open?.[a]) { map[m.id] = 50; continue; }
    if (o.close) { map[m.id] = resolvedCents(o.open[a], o.close[a]); continue; }
    map[m.id] = upCents(a, o.open[a], spots[a] ?? o.last?.[a], secondsLeft);
  }
  return map;
}

/** Record the opening prices when a direction round starts trading. */
function openOracle(round: Round, spots: Spots, now: number): void {
  const open: Record<string, number> = {};
  for (const [a, p] of Object.entries(spots)) if (p) open[a] = p;
  round.oracle = { source: "coinbase", open, openAt: now, last: open, lastAt: now };
}

const usdFmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

/**
 * Everything needed to price a round: live spots (direction rounds), the UP
 * price of every market, and — for a round whose deadline passed a while
 * ago — the prices at the deadline. Does the external I/O, so call it before
 * taking the arena lock.
 */
export async function livePricing(round: Round | null): Promise<Pricing> {
  if (!round) return { yesPrice: 50, priceMap: {}, spots: {} };
  const now = Date.now();
  if (!isDirectionRound(round)) {
    const yesPrice = await marketYesPrice(round.config.marketId);
    return { yesPrice, priceMap: { ...buildPriceMap(), [round.config.marketId]: yesPrice }, spots: {} };
  }
  const active = round.status !== "complete" && round.status !== "cancelled";
  const spots = active ? await spotPrices() : {};
  const closeSpots = round.status === "live" && round.liveDeadline && now - round.liveDeadline > CLOSE_FRESH_MS
    ? await spotPricesAt(round.liveDeadline)
    : undefined;
  const priceMap = oraclePriceMap(round, spots, now);
  return { yesPrice: priceMap[round.config.marketId] ?? 50, priceMap, spots, closeSpots };
}

/** A move bigger than this (fraction) since the last sample counts as a sharp jump. */
const JUMP = 0.003;
/** How recent that last sample must be for the jump check. */
const JUMP_WINDOW_MS = 10_000;

/**
 * Pricing for a trade, on quotes taken right now (not the few-seconds-old
 * cache), plus a reason to refuse the trade for a moment when the price
 * isn't settled: the exchanges disagree, or the asset just jumped since the
 * last sample. That's when someone watching a faster feed could otherwise
 * buy at a price that hasn't caught up with the move.
 */
export async function tradePricing(round: Round, assets: AssetSymbol[]): Promise<Pricing & { pause: string | null }> {
  if (!isDirectionRound(round)) return { ...(await livePricing(round)), pause: null };
  const now = Date.now();
  const { spots: fresh, divergent } = await freshSpots(assets);
  const spots: Spots = { ...(await spotPrices()), ...fresh };
  let pause: string | null = null;
  for (const a of assets) {
    if (!fresh[a]) { pause = `${a}'s price is unavailable for a moment`; break; }
    if (divergent.includes(a)) { pause = `${a} is moving fast and exchanges disagree`; break; }
    const last = round.oracle?.last?.[a];
    const lastAt = round.oracle?.lastAt ?? 0;
    if (last && now - lastAt < JUMP_WINDOW_MS && Math.abs(fresh[a]! - last) / last > JUMP) {
      pause = `${a} just moved sharply`;
      break;
    }
  }
  const priceMap = oraclePriceMap(round, spots, now);
  return { yesPrice: priceMap[round.config.marketId] ?? 50, priceMap, spots, pause };
}

/** The round market's UP price after a tick, for the response. */
export function yesAfterTick(round: Round, pricing: Pricing): number {
  return isDirectionRound(round)
    ? oraclePriceMap(round, pricing.spots)[round.config.marketId] ?? 50
    : pricing.yesPrice;
}

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
  // Royale rounds keep the timeframe of the round they follow ("up in 15
  // minutes" stays 15 minutes); only the asset rotates.
  const keepHorizon = excludeId ? findMockMarket(excludeId)?.market.horizon : undefined;
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
  if (keepHorizon) {
    const same = candidates.filter((c) => findMockMarket(c.id)?.market.horizon === keepHorizon);
    if (same.length) candidates = same;
  }
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
 * Bootstrap a fresh enrolling round IN AN ARENA. A host can pass config
 * overrides (asset, format, entry, vault, capacity, rounds); they're clamped
 * to safe bounds by normalizeConfig. If the host picked an asset, we run on
 * that asset's market; otherwise the keeper picks one.
 */
export async function bootstrapRound(overrides?: Partial<RoundConfig> & { horizon?: string }, arenaCode?: string): Promise<Round | null> {
  const predictions = isPicksFormat(overrides?.format);
  // Predictions and Streak cover all three coins; their clock runs on BTC's market.
  const wantAsset = predictions ? "BTC" : overrides?.asset ? String(overrides.asset).toUpperCase() : undefined;
  // A day-long market can't run as one arena round; it plays as the hour.
  const rawHorizon = overrides?.horizon ? String(overrides.horizon).toUpperCase() : undefined;
  const wantHorizon = rawHorizon === "DAY" ? "HOUR" : rawHorizon ?? (predictions ? "MIN5" : undefined);
  const market = await pickMarketForAsset(wantAsset, wantHorizon);
  if (!market) return null;

  // The trading window IS the market's horizon, so "Will SOL be up in the
  // next hour?" really runs (and resolves) over an hour.
  const horizonSec: Record<string, number> = { MIN5: 300, MIN15: 900, HOUR: 3_600, DAY: 3_600 };
  // The round lasts exactly its market's timeframe, whatever the caller asked.
  const marketHorizon = findMockMarket(market.marketId)?.market.horizon;
  const impliedLiveSec = marketHorizon ? horizonSec[marketHorizon] : wantHorizon ? horizonSec[wantHorizon] : undefined;

  const base: RoundConfig = {
    ...DEFAULT_CONFIG,
    marketId: market.marketId,
    marketQuestion: market.marketQuestion,
    category: market.category,
    asset: market.asset,
    ...(impliedLiveSec ? { liveSec: impliedLiveSec } : {})
  };
  // Market fields are authoritative; host overrides shape the rules only.
  const { marketId: _m, marketQuestion: _q, category: _c, asset: _a, horizon: _h, ...rules } = overrides ?? {};
  void _m; void _q; void _c; void _a; void _h;
  const config = normalizeConfig(base, rules);
  if (impliedLiveSec) config.liveSec = impliedLiveSec;
  if (config.format === "predictions") {
    const hz = HORIZONS.find((h) => h.id === (marketHorizon ?? wantHorizon)) ?? HORIZONS[0];
    config.marketId = directionMarketId("BTC", hz.id as Horizon);
    config.asset = "BTC";
    config.marketQuestion = `Predictions · BTC, ETH and SOL ${hz.label}`;
  }
  if (config.format === "streak") {
    // liveSec is the leg length (1, 2 or 5 minutes).
    config.liveSec = normalizeLegSec(overrides?.liveSec);
    config.marketQuestion = `Streak · last caller standing`;
  }
  const round = createRound(config, 1, arenaCode);
  if (config.format === "predictions") round.predictions = { questions: predictionQuestions(`${round.arenaCode}:${round.id}`) };
  if (config.format === "streak") round.streak = createStreak(`${round.arenaCode}:${round.id}`, config.liveSec);
  return round;
}

/**
 * YES price (cents) for every board market, so any legacy parlay ticket can
 * be valued and settled. The round's own market gets the live price; the other
 * assets use the board's current prices. (A per-asset price oracle can enrich
 * this later; the shape stays the same.)
 */
export function buildPriceMap(liveOverride?: { marketId: string; yesPrice: number }): PriceMap {
  const map: PriceMap = {};
  for (const m of directionMarkets) map[m.id] = m.yesPrice;
  if (liveOverride) map[liveOverride.marketId] = liveOverride.yesPrice;
  return map;
}

/**
 * Pick the market for a specific asset/horizon if asked, else the shortest
 * horizon for that asset, else any of the three.
 */
async function pickMarketForAsset(asset?: string, horizon?: string): Promise<MarketPick | null> {
  if (!asset) return pickMarket();
  const wantAsset = asset.toUpperCase();
  const wantHorizon = horizon?.toUpperCase();
  // Exact asset+horizon match first.
  if (wantHorizon) {
    const exact = directionMarkets.find((m) => m.asset === wantAsset && m.horizon === wantHorizon);
    if (exact) return { marketId: exact.id, marketQuestion: exact.question, category: exact.category, asset: exact.asset };
  }
  // Fall back to any market on the requested asset (shortest horizon first
  // since HORIZONS is ordered MIN5, MIN15, HOUR, DAY).
  const direct = directionMarkets.find((m) => m.asset === wantAsset);
  if (direct) return { marketId: direct.id, marketQuestion: direct.question, category: direct.category, asset: direct.asset };
  return pickMarket();
}

/**
 * Advance a round in place based on wall-clock time. Synchronous — prices
 * are fetched before the keeper lock (`livePricing`) and passed in, so this
 * can run safely inside a locked transaction. If it transitions to
 * `advancing`, the caller spins up the next round via `advanceToNext`.
 */
export function tick(round: Round, pricing: Pricing): Round {
  const now = Date.now();
  const direction = isDirectionRound(round);
  const asset = round.config.asset as AssetSymbol;
  // The sample from the previous tick — the close may be closer to it.
  const prevSample = round.oracle?.last && round.oracle.lastAt ? { spots: round.oracle.last, at: round.oracle.lastAt } : null;
  if (direction && round.oracle && !round.oracle.close && Object.keys(pricing.spots).length) {
    round.oracle.last = { ...(round.oracle.last ?? {}), ...(pricing.spots as Record<string, number>) };
    round.oracle.lastAt = now;
  }

  // The walk-in practice arena never cancels for being empty: it waits for
  // its first player, whose seat starts a fresh enrollment clock.
  // (A leftover round with older practice settings is retired instead.)
  if (round.status === "enrolling" && humanCount(round) === 0 && isPracticeArena(round.arenaCode) && now >= round.enrollDeadline
      && round.config.format !== "royale") {
    round.enrollDeadline = now + round.config.enrollmentSec * 1000;
  }

  // A hosted arena starts empty while the host approves their seat deposit
  // in the wallet. Hold it open for that instead of cancelling on the first
  // deadline; the enroll route restarts the clock once the host is seated.
  if (round.status === "enrolling" && humanCount(round) === 0 && !isPracticeArena(round.arenaCode)) {
    const graceEnd = round.createdAt + HOST_SEAT_GRACE_MS;
    if (now < graceEnd && round.enrollDeadline < graceEnd) round.enrollDeadline = graceEnd;
  }

  const full = humanCount(round) >= round.config.capacity;
  if (round.status === "enrolling" && (now >= round.enrollDeadline || full)) {
    if (humanCount(round) === 0) {
      round.status = "cancelled";
      round.endedAt = now;
      logEvent(round, "Round cancelled — no players entered.");
      return round;
    }
    // The open price is the whole bet — wait (briefly) for the oracle
    // rather than open a round nobody can resolve.
    const need = neededAssets(round);
    if (direction && !round.streak && need.some((a) => !pricing.spots[a]) && now < round.enrollDeadline + ORACLE_WAIT_MS) return round;
    // Thin backfill: only add bots to reach the minimum to run a game, and
    // never pad beyond the number of real players. A 5-human lobby runs
    // 5-handed; a solo host gets one opponent so the game can start. Real
    // rooms are never mostly bots.
    const humans = humanCount(round);
    const backfillTarget = Math.max(round.config.minEntrants, humans);
    fillWithBots(round, backfillTarget);
    if (round.predictions) {
      for (const e of round.entrants) if (e.isBot && !e.picks) { e.picks = randomPicks(round.predictions.questions); e.score = 0; }
    }
    if (round.entrants.length < round.config.minEntrants) {
      round.status = "cancelled";
      round.endedAt = now;
      logEvent(round, `Round cancelled — only ${round.entrants.length} entrants. Entry pool refunded.`);
      return round;
    }
    round.status = "live";
    round.liveDeadline = now + round.config.liveSec * 1000;
    logEvent(round, round.predictions
      ? `Enrollment locked — ${round.entrants.length} players, picks revealed.`
      : round.streak
        ? `Enrollment locked — ${round.entrants.length} players in. Wrong pick and you're out.`
        : `Enrollment locked — ${round.entrants.length} entrants live on ${round.config.asset}.`);
    if (round.streak) {
      // Keep sampling all three coins for the live view; each leg opens itself.
      if (pricing.spots.BTC || pricing.spots.ETH || pricing.spots.SOL) openOracle(round, pricing.spots, now);
      startStreak(round, now);
    } else if (round.predictions) {
      if (pricing.spots.BTC || pricing.spots.ETH || pricing.spots.SOL) {
        openOracle(round, pricing.spots, now);
        logEvent(round, `Picks locked. Opening prices: ${need.map((a) => `${a} ${pricing.spots[a] ? usdFmt(pricing.spots[a]!) : "unavailable"}`).join(", ")}.`);
      }
    } else {
      if (direction && pricing.spots[asset]) {
        openOracle(round, pricing.spots, now);
        logEvent(round, `${asset} opened at ${usdFmt(pricing.spots[asset]!)} — UP wins if it closes higher.`);
      }
      // UP/DOWN calls picked at the seat go in at the opening price.
      placeOpeningCalls(round, direction ? 50 : pricing.yesPrice);
    }
  }

  if (round.status === "live" && round.streak) {
    const st = round.streak;
    if (!round.oracle?.open && (pricing.spots.BTC || pricing.spots.ETH || pricing.spots.SOL)) openOracle(round, pricing.spots, now);
    if (st.phase === "picking" && now >= st.phaseEndsAt) {
      // Picks are locked from phaseEndsAt (the picks route checks the time).
      // Open the leg on the coins it asks about — waiting briefly for prices.
      const need = neededAssets(round);
      if (need.some((a) => !pricing.spots[a]) && now < st.phaseEndsAt + ORACLE_WAIT_MS) return round;
      runLeg(round, pricing.spots, now);
      return round;
    }
    if (st.phase === "running" && now >= st.phaseEndsAt) {
      const close = closeSample(round, pricing, prevSample, now);
      if (!close && now < st.phaseEndsAt + ORACLE_WAIT_MS) return round;
      resolveLeg(round, close ?? {}, now);
    }
    return round;
  }

  if (round.status === "live" && round.predictions) {
    // Nothing to trade: keep the live scores current, then settle at the close.
    if (!round.oracle?.open && (pricing.spots.BTC || pricing.spots.ETH || pricing.spots.SOL)) openOracle(round, pricing.spots, now);
    scoreLive(round, pricing.spots);
    if (now < round.liveDeadline) return round;
    const close = closeSample(round, pricing, prevSample, now);
    if (!close && now < round.liveDeadline + ORACLE_WAIT_MS) return round;
    const closeRec: Record<string, number> = {};
    for (const [a, p] of Object.entries(close ?? {})) if (p) closeRec[a] = p;
    round.oracle = { ...(round.oracle ?? { source: "coinbase", open: {}, openAt: now }), close: closeRec, closeAt: round.liveDeadline };
    logEvent(round, `Closing prices: ${ASSET_SYMBOLS.map((a) => `${a} ${closeRec[a] ? usdFmt(closeRec[a]) : "unavailable"}`).join(", ")}.`);
    settlePredictions(round, closeRec);
    return round;
  }

  if (round.status === "live") {
    // Rounds that went live without an open (advanced royale rounds, or an
    // oracle outage at the lock) open on the first priced tick.
    if (direction && !round.oracle?.open?.[asset] && pricing.spots[asset]) {
      openOracle(round, pricing.spots, now);
      logEvent(round, `${asset} opened at ${usdFmt(pricing.spots[asset]!)} — UP wins if it closes higher.`);
    }
    const priceMap = direction ? oraclePriceMap(round, pricing.spots, now) : pricing.priceMap;
    const yesPrice = direction ? priceMap[round.config.marketId] ?? 50 : pricing.yesPrice;
    // The keeper runs on every page poll; pace the bots so how often they
    // trade doesn't depend on how many people are watching.
    const botsAct = (!round.botTickAt || now - round.botTickAt >= BOT_TICK_MS) && now < round.liveDeadline - TRADE_CUTOFF_MS;
    if (botsAct) round.botTickAt = now;
    for (const e of round.entrants) {
      if (e.isBot && botsAct) botTick(e, yesPrice);
      markToMarket(e, yesPrice, priceMap);
    }
    if (now >= round.liveDeadline) {
      if (!direction) {
        settle(round, yesPrice, priceMap);
        return round;
      }
      // Close = the price sample nearest the deadline: this tick's spot, the
      // previous tick's (polls run every few seconds while anyone watches),
      // or the 1-minute candle when the arena went unwatched.
      const after = now - round.liveDeadline;
      const before = prevSample && prevSample.at <= round.liveDeadline ? round.liveDeadline - prevSample.at : Infinity;
      const close: Spots =
        pricing.spots[asset] && after <= CLOSE_FRESH_MS && after <= before ? pricing.spots
        : prevSample?.spots[asset] && before <= CLOSE_FRESH_MS ? (prevSample.spots as Spots)
        : pricing.spots[asset] && after <= CLOSE_FRESH_MS ? pricing.spots
        : (pricing.closeSpots ?? {});
      if (!close[asset] && round.oracle?.open?.[asset] && now < round.liveDeadline + ORACLE_WAIT_MS) return round;
      const open = round.oracle?.open ?? {};
      const closeRec: Record<string, number> = {};
      for (const [a, p] of Object.entries(close)) if (p) closeRec[a] = p;
      round.oracle = { ...(round.oracle ?? { source: "coinbase", open: {}, openAt: now }), close: closeRec, closeAt: round.liveDeadline };
      const finalMap: PriceMap = {};
      for (const m of directionMarkets) finalMap[m.id] = resolvedCents(open[m.asset], closeRec[m.asset]);
      const o = open[asset], c = closeRec[asset];
      logEvent(round, o && c
        ? `${asset} closed at ${usdFmt(c)} vs ${usdFmt(o)} open — ${c > o ? "UP wins" : c < o ? "DOWN wins" : "flat, both sides pay 50¢"}.`
        : `${asset} price unavailable at the close — both sides settle at 50¢.`);
      settle(round, finalMap[round.config.marketId] ?? 50, finalMap);
    }
  }

  return round;
}

/**
 * Closing prices of every coin a predictions round needs: the sample nearest
 * the deadline (this tick, the previous tick, or the 1-minute candle when the
 * arena went unwatched). Null when none of them has all the prices yet.
 */
function closeSample(round: Round, pricing: Pricing, prevSample: { spots: Record<string, number>; at: number } | null, now: number): Spots | null {
  const need = neededAssets(round);
  const full = (s: Spots | Record<string, number> | undefined) => !!s && need.every((a) => (s as Record<string, number | undefined>)[a]);
  const after = now - round.liveDeadline;
  const before = prevSample && prevSample.at <= round.liveDeadline ? round.liveDeadline - prevSample.at : Infinity;
  if (full(pricing.spots) && after <= CLOSE_FRESH_MS && after <= before) return pricing.spots;
  if (prevSample && full(prevSample.spots) && before <= CLOSE_FRESH_MS) return prevSample.spots as Spots;
  if (full(pricing.spots) && after <= CLOSE_FRESH_MS) return pricing.spots;
  if (full(pricing.closeSpots)) return pricing.closeSpots!;
  // Past the oracle wait: settle on whatever is known (missing coins void their questions).
  return now >= round.liveDeadline + ORACLE_WAIT_MS ? (pricing.closeSpots ?? pricing.spots) : null;
}

/** Build the next round from a settled `advancing` round on a pre-picked market. */
export function advanceToNext(round: Round, nextMarket: { marketId: string; marketQuestion: string; category: string; asset: string } | null, spots: Spots = {}): Round {
  const next = advance(round, nextMarket ?? {
    marketId: round.config.marketId,
    marketQuestion: round.config.marketQuestion,
    category: round.config.category,
    asset: round.config.asset
  });
  const a = next.config.asset as AssetSymbol;
  if (isDirectionRound(next) && spots[a]) {
    openOracle(next, spots, Date.now());
    logEvent(next, `${a} opened at ${usdFmt(spots[a]!)} — UP wins if it closes higher.`);
  }
  return next;
}
