/**
 * Market Royale — battle-royale round engine.
 *
 * A round is a survival competition over a single Panta market. Every
 * entrant deposits the same entry fee, receives the same isolated starting
 * bankroll, and trades YES/NO shares on the round's market. When the round
 * window closes the arena ranks entrants by final bankroll and eliminates
 * the bottom half. Survivors advance to a fresh round until one remains or
 * the round limit is hit. The funded entry pool pays out to survivors.
 *
 * This module is pure domain logic — no I/O. The store (lib/round-store.ts)
 * persists it; the API routes drive the state machine; the keeper advances
 * timers. Trading is scoped to each entrant's bankroll ledger; Panta is the
 * price oracle and the settlement source of truth.
 *
 * Trust model (current): entry pool + bankrolls are ledgered server-side.
 * The on-chain TraderVault escrow (Anchor program) is the next milestone —
 * until then the prize pool is an accounting figure, flagged as such in the UI.
 */

export type RoundStatus =
  | "enrolling"   // accepting entrants, before lock
  | "live"        // trading window open
  | "settling"    // window closed, computing ranks
  | "advancing"   // survivors promoted, next round spinning up
  | "complete"    // a champion remains (or round limit hit)
  | "cancelled";  // not enough entrants — pool refunded

export type Side = "YES" | "NO";

export type Entrant = {
  id: string;
  wallet: string;         // base58 pubkey, or bot:<name>
  nickname: string;
  isBot: boolean;
  joinedAt: number;       // ms — earlier entry wins ties
  bankroll: number;       // USDC, mark-to-market
  cash: number;           // uninvested USDC
  shares: number;         // outcome shares held
  side: Side | null;      // which side the shares are
  avgPrice: number;       // cents, cost basis of current position
  eliminatedRound: number | null;
  rank: number | null;    // filled at settlement
  prizeUsdc: number;      // prize-pool share won at the final (0 until then)
};

/**
 * Single Round is a quick match — one market, one settlement, pay the top
 * finishers. Royale is 2–4 rounds — each settlement cuts the bottom half and
 * survivors carry the bankroll they earned into the next round.
 */
export type RoundFormat = "single" | "royale";

export type RoundConfig = {
  marketId: string;
  marketQuestion: string;
  category: string;
  asset: string;          // display label, e.g. "SOL" / "BTC"
  format: RoundFormat;    // single quick match or multi-round royale
  host: string;           // wallet that configured the rumble, or "" (auto)
  entryUsdc: number;      // entry fee everyone pays → shared prize pool
  startingBankroll: number; // starting trading vault everyone gets
  capacity: number;       // max entrants (player limit)
  minEntrants: number;    // below this at lock → cancel/refund
  enrollmentSec: number;  // enrollment window
  liveSec: number;        // trading window per round
  roundLimit: number;     // rounds before forced finish (1 for single, 2–4 royale)
};

// Host-configurable bounds. The host picks values inside these; the engine
// clamps anything out of range so a malformed config can't grief the arena.
export const HOST_LIMITS = {
  entryUsdc: { min: 1, max: 100 },
  startingBankroll: { min: 5, max: 500 },
  capacity: { min: 2, max: 16 },
  royaleRounds: { min: 2, max: 4 },
  enrollmentSec: { min: 20, max: 300 },
  liveSec: { min: 60, max: 900 }
} as const;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/**
 * Sanitize a host-supplied config into a safe RoundConfig. Every player gets
 * the SAME entry and the SAME starting vault — a host can never hand anyone a
 * bigger vault, which is the core fairness rule of Market Royale.
 */
export function normalizeConfig(base: RoundConfig, patch: Partial<RoundConfig>): RoundConfig {
  const format: RoundFormat = patch.format === "single" ? "single" : patch.format === "royale" ? "royale" : base.format;
  const L = HOST_LIMITS;
  const capacity = clamp(patch.capacity ?? base.capacity, L.capacity.min, L.capacity.max);
  const roundLimit = format === "single"
    ? 1
    : clamp(patch.roundLimit ?? base.roundLimit, L.royaleRounds.min, L.royaleRounds.max);
  return {
    ...base,
    ...patch,
    format,
    entryUsdc: clamp(patch.entryUsdc ?? base.entryUsdc, L.entryUsdc.min, L.entryUsdc.max),
    startingBankroll: clamp(patch.startingBankroll ?? base.startingBankroll, L.startingBankroll.min, L.startingBankroll.max),
    capacity,
    minEntrants: clamp(patch.minEntrants ?? base.minEntrants, 2, capacity),
    enrollmentSec: clamp(patch.enrollmentSec ?? base.enrollmentSec, L.enrollmentSec.min, L.enrollmentSec.max),
    liveSec: clamp(patch.liveSec ?? base.liveSec, L.liveSec.min, L.liveSec.max),
    roundLimit
  };
}

// Market-Royale prize split of the shared pool among the top finishers.
// A 2-player game is a duel — winner takes the whole pool. With 3+ funded
// players the pool splits 62.5% / 23.4375% / 14.0625%, and 1st absorbs any
// rounding remainder. The arena takes no cut.
const SPLIT_3 = [0.625, 0.234375, 0.140625] as const;

/**
 * Distribute `prizePoolUsdc` across the ranked winners (rank 1 first).
 * `fundedPlayers` is how many real players funded the pool — it decides
 * whether this is a duel (1 paid place) or a 3-way split. Works in integer
 * micro-USDC so the parts always re-sum to the pool exactly.
 */
export function computePayouts(prizePoolUsdc: number, rankedWinnerIds: string[], fundedPlayers: number): Record<string, number> {
  const pool = Math.max(0, Math.round(prizePoolUsdc * 1e6)); // micro-USDC
  const out: Record<string, number> = {};
  if (pool === 0 || rankedWinnerIds.length === 0) return out;
  if (fundedPlayers <= 2) {
    out[rankedWinnerIds[0]] = pool / 1e6;
    return out;
  }
  const places = Math.min(3, rankedWinnerIds.length);
  let assigned = 0;
  for (let i = 1; i < places; i++) {
    const part = Math.floor(pool * SPLIT_3[i]);
    out[rankedWinnerIds[i]] = part / 1e6;
    assigned += part;
  }
  out[rankedWinnerIds[0]] = (pool - assigned) / 1e6; // 1st gets the remainder
  return out;
}

export type Round = {
  id: string;
  config: RoundConfig;
  roundNumber: number;    // 1-indexed
  status: RoundStatus;
  entrants: Entrant[];
  prizePoolUsdc: number;
  createdAt: number;
  enrollDeadline: number; // ms epoch
  liveDeadline: number;   // ms epoch — 0 until live
  endedAt: number;        // ms epoch — set when complete/cancelled, else 0
  championId: string | null;
  history: string[];      // human-readable event log
};

// ── defaults ──────────────────────────────────────────────────────────

// Market-Royale seat model: every player funds one combined deposit that
// splits into an ENTRY (→ shared prize pool) and a starting VAULT (their own
// real trading balance, withdrawn at the end). startingBankroll IS the vault.
export const DEFAULT_CONFIG: RoundConfig = {
  marketId: "",
  marketQuestion: "",
  category: "crypto",
  asset: "SOL",
  format: "royale",
  host: "",
  entryUsdc: 2,          // → shared prize pool
  startingBankroll: 10,  // → your isolated trading vault (real, withdrawable)
  capacity: 8,
  minEntrants: 2,
  enrollmentSec: 30,
  liveSec: 180,
  roundLimit: 3
};

const BOT_NAMES = ["SIGNAL", "FADE", "HORIZON", "WEDGE", "GRANITE", "SPIRE", "VERTEX", "EMBER", "KESTREL", "ONYX"];

let idCounter = 0;
function uid(prefix: string) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// ── construction ──────────────────────────────────────────────────────

export function createRound(config: RoundConfig, roundNumber = 1): Round {
  const now = Date.now();
  return {
    id: uid("round"),
    config,
    roundNumber,
    status: "enrolling",
    entrants: [],
    prizePoolUsdc: 0,
    createdAt: now,
    enrollDeadline: now + config.enrollmentSec * 1000,
    liveDeadline: 0,
    endedAt: 0,
    championId: null,
    history: [`Round ${roundNumber} opened for enrollment.`]
  };
}

export function makeEntrant(round: Round, wallet: string, nickname: string, isBot = false): Entrant {
  return {
    id: uid("ent"),
    wallet,
    nickname,
    isBot,
    joinedAt: Date.now(),
    bankroll: round.config.startingBankroll,
    cash: round.config.startingBankroll,
    shares: 0,
    side: null,
    avgPrice: 0,
    eliminatedRound: null,
    rank: null,
    prizeUsdc: 0
  };
}

export function enroll(round: Round, entrant: Entrant): { ok: boolean; reason?: string } {
  if (round.status !== "enrolling") return { ok: false, reason: "Enrollment is closed." };
  if (round.entrants.length >= round.config.capacity) return { ok: false, reason: "Round is full." };
  if (round.entrants.some((e) => e.wallet === entrant.wallet)) return { ok: false, reason: "Already enrolled." };
  round.entrants.push(entrant);
  // Only real players fund the pool. Bots are seat-fillers (sponsor-backed
  // per the Market Royale model) and never inflate the prize.
  if (!entrant.isBot) round.prizePoolUsdc += round.config.entryUsdc;
  round.history.push(`${entrant.nickname} entered (${round.entrants.length}/${round.config.capacity}).`);
  return { ok: true };
}

/** Fill the round with bots up to `target` entrants (default: capacity). */
export function fillWithBots(round: Round, target = round.config.capacity): void {
  if (round.status !== "enrolling" && round.status !== "live") return;
  const used = new Set(round.entrants.map((e) => e.nickname));
  const cap = Math.min(target, round.config.capacity);
  let i = 0;
  while (round.entrants.length < cap && i < BOT_NAMES.length) {
    const name = BOT_NAMES[i++];
    if (used.has(name)) continue;
    const bot = makeEntrant(round, `bot:${name.toLowerCase()}`, name, true);
    round.entrants.push(bot);           // bots don't fund the pool
    round.history.push(`${name} entered (${round.entrants.length}/${round.config.capacity}).`);
    used.add(name);
  }
}

export function humanCount(round: Round): number {
  return round.entrants.filter((e) => !e.isBot).length;
}

// ── bankroll / trading ────────────────────────────────────────────────

/**
 * Buy `usdc` worth of `side` shares at `priceCents` (0..100). Shares are
 * `usdc / (price/100)`. A player may hold only one side at a time; buying
 * the opposite side first liquidates the current position at `markPrice`.
 */
export function buyShares(entrant: Entrant, side: Side, usdc: number, priceCents: number, markYesPrice: number): { ok: boolean; reason?: string } {
  if (entrant.eliminatedRound !== null) return { ok: false, reason: "Eliminated." };
  if (usdc <= 0) return { ok: false, reason: "Amount must be positive." };
  if (usdc > entrant.cash) return { ok: false, reason: "Insufficient bankroll." };
  const price = Math.max(1, Math.min(99, priceCents));

  if (entrant.side && entrant.side !== side && entrant.shares > 0) {
    liquidate(entrant, markYesPrice);
  }
  const newShares = usdc / (price / 100);
  const prevCost = entrant.avgPrice * entrant.shares;
  entrant.shares += newShares;
  entrant.side = side;
  entrant.avgPrice = entrant.shares > 0 ? (prevCost + price * newShares) / entrant.shares : price;
  entrant.cash -= usdc;
  markToMarket(entrant, markYesPrice);
  return { ok: true };
}

/** Sell the entire current position at the live mark. */
export function liquidate(entrant: Entrant, markYesPrice: number): void {
  if (!entrant.side || entrant.shares <= 0) return;
  const mark = entrant.side === "YES" ? markYesPrice : 100 - markYesPrice;
  entrant.cash += entrant.shares * (mark / 100);
  entrant.shares = 0;
  entrant.side = null;
  entrant.avgPrice = 0;
  markToMarket(entrant, markYesPrice);
}

/** Recompute bankroll = cash + mark value of open position. */
export function markToMarket(entrant: Entrant, markYesPrice: number): void {
  const mark = entrant.side === "YES" ? markYesPrice : entrant.side === "NO" ? 100 - markYesPrice : 0;
  entrant.bankroll = entrant.cash + entrant.shares * (mark / 100);
}

// ── bots ──────────────────────────────────────────────────────────────

/**
 * One bot decision tick. Bots keep ~40-70% of bankroll deployed, flip sides
 * on momentum, and occasionally take profit. Deterministic-ish randomness
 * keeps the roster lively without a real strategy.
 */
export function botTick(entrant: Entrant, markYesPrice: number): void {
  if (!entrant.isBot || entrant.eliminatedRound !== null) return;
  markToMarket(entrant, markYesPrice);
  const r = Math.random();
  if (entrant.shares > 0 && r < 0.25) {
    liquidate(entrant, markYesPrice); // take profit / cut
    return;
  }
  if (r < 0.55 && entrant.cash > 10) {
    const side: Side = Math.random() > 0.5 ? "YES" : "NO";
    const price = side === "YES" ? markYesPrice : 100 - markYesPrice;
    const spend = Math.min(entrant.cash, entrant.cash * (0.3 + Math.random() * 0.4));
    buyShares(entrant, side, spend, price, markYesPrice);
  }
}

// ── settlement ────────────────────────────────────────────────────────

/**
 * Settle the round at the given YES price (0..100). If the market has a
 * hard outcome, pass 100 for YES-win or 0 for NO-win; otherwise the live
 * mark is used (mark-to-market settlement). Ranks entrants by final
 * bankroll, breaking ties by earlier entry, and eliminates the bottom half.
 */
export function settle(round: Round, finalYesPrice: number): void {
  round.status = "settling";
  const alive = round.entrants.filter((e) => e.eliminatedRound === null);
  for (const e of alive) {
    liquidate(e, finalYesPrice);     // redeem all shares at settlement price
    markToMarket(e, finalYesPrice);
  }
  // Rank: higher bankroll first; tie → earlier joinedAt.
  const ranked = [...alive].sort((a, b) => (b.bankroll - a.bankroll) || (a.joinedAt - b.joinedAt));
  ranked.forEach((e, i) => { e.rank = i + 1; });

  const survivorCount = Math.max(1, Math.ceil(ranked.length / 2));
  const survivors = ranked.slice(0, survivorCount);
  const cut = ranked.slice(survivorCount);
  for (const e of cut) e.eliminatedRound = round.roundNumber;

  round.history.push(
    `Round ${round.roundNumber} settled at ${finalYesPrice}¢. ` +
    `${cut.length} eliminated, ${survivors.length} advance.`
  );

  if (survivors.length <= 1 || round.roundNumber >= round.config.roundLimit) {
    round.status = "complete";
    round.endedAt = Date.now();
    // Overall finishing order across ALL entrants, then split the shared pool
    // among the top HUMAN finishers (bots are sponsor-backed seat fillers and
    // never take real prize money).
    const order = finishingOrder(round);
    const humanWinners = order.filter((e) => !e.isBot).map((e) => e.id);
    const funded = round.config.entryUsdc > 0
      ? Math.round(round.prizePoolUsdc / round.config.entryUsdc)
      : humanWinners.length;
    const payouts = computePayouts(round.prizePoolUsdc, humanWinners.slice(0, 3), funded);
    for (const e of round.entrants) e.prizeUsdc = payouts[e.id] ?? 0;
    round.championId = humanWinners[0] ?? survivors[0]?.id ?? null;
    const champ = round.entrants.find((e) => e.id === round.championId);
    const champPrize = champ ? (payouts[champ.id] ?? 0) : 0;
    round.history.push(champ
      ? `${champ.nickname} takes ${champPrize.toFixed(2)} USDC of the ${round.prizePoolUsdc} USDC pool.`
      : `Round complete.`);
  } else {
    round.status = "advancing";
  }
}

/**
 * Overall finishing order across every entrant: survivors first, then whoever
 * was cut later, then higher final bankroll, then earlier entry. Used to award
 * the prize split at the final.
 */
export function finishingOrder(round: Round): Entrant[] {
  return [...round.entrants].sort((a, b) => {
    const aAlive = a.eliminatedRound === null;
    const bAlive = b.eliminatedRound === null;
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    if (!aAlive && !bAlive && a.eliminatedRound !== b.eliminatedRound) {
      return b.eliminatedRound! - a.eliminatedRound!; // cut later = better finish
    }
    return (b.bankroll - a.bankroll) || (a.joinedAt - b.joinedAt);
  });
}

/**
 * What a player can withdraw from escrow. Mid-game: nothing. At the final:
 * their remaining vault plus any prize share. On recovery (cancelled): their
 * entry back plus whatever vault remains — the Market Royale fair-play rule.
 */
export function entitlementUsdc(round: Round, e: Entrant): number {
  if (e.isBot) return 0;
  if (round.status === "cancelled") return round.config.entryUsdc + e.cash;
  if (round.status === "complete") return e.cash + e.prizeUsdc;
  return 0;
}

/**
 * Promote survivors into a fresh round on a new market. Survivors CARRY the
 * bankroll they earned into the next round (Market Royale rule) — they do not
 * reset to the starting stack. The prize pool carries forward untouched.
 */
export function advance(round: Round, nextMarket: { marketId: string; marketQuestion: string; category: string; asset: string }): Round {
  const survivors = round.entrants.filter((e) => e.eliminatedRound === null);
  const next: Round = {
    id: uid("round"),
    config: { ...round.config, ...nextMarket },
    roundNumber: round.roundNumber + 1,
    status: "live",
    entrants: survivors.map((e) => ({
      ...e,
      bankroll: e.cash,   // carry forward the vault they earned
      cash: e.cash,
      shares: 0,
      side: null,
      avgPrice: 0,
      rank: null,
      prizeUsdc: 0
    })),
    prizePoolUsdc: round.prizePoolUsdc,
    createdAt: Date.now(),
    enrollDeadline: Date.now(),
    liveDeadline: Date.now() + round.config.liveSec * 1000,
    endedAt: 0,
    championId: null,
    history: [`Round ${round.roundNumber + 1} live — ${survivors.length} survivors on ${nextMarket.asset}.`]
  };
  return next;
}

// ── standings ─────────────────────────────────────────────────────────

export function standings(round: Round): Entrant[] {
  return [...round.entrants].sort((a, b) => {
    if ((a.eliminatedRound === null) !== (b.eliminatedRound === null)) {
      return a.eliminatedRound === null ? -1 : 1; // alive first
    }
    return (b.bankroll - a.bankroll) || (a.joinedAt - b.joinedAt);
  });
}

export function cutLine(round: Round): number {
  const alive = round.entrants.filter((e) => e.eliminatedRound === null).length;
  return Math.max(1, Math.ceil(alive / 2)); // survivors after this round
}
