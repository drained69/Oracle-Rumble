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
};

export type RoundConfig = {
  marketId: string;
  marketQuestion: string;
  category: string;
  asset: string;          // display label, e.g. "SOL" / "BTC"
  entryUsdc: number;      // entry fee everyone pays
  startingBankroll: number;
  capacity: number;       // max entrants
  minEntrants: number;    // below this at lock → cancel/refund
  enrollmentSec: number;  // enrollment window
  liveSec: number;        // trading window per round
  roundLimit: number;     // max rounds before forced finish
};

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

export const DEFAULT_CONFIG: RoundConfig = {
  marketId: "",
  marketQuestion: "",
  category: "crypto",
  asset: "SOL",
  entryUsdc: 25,
  startingBankroll: 1000,
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
    rank: null
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
    round.championId = survivors[0]?.id ?? null;
    const champ = survivors[0];
    round.history.push(champ ? `${champ.nickname} wins the pool of ${round.prizePoolUsdc} USDC.` : `Round complete.`);
  } else {
    round.status = "advancing";
  }
}

/**
 * Promote survivors into a fresh round on a new market, resetting bankrolls
 * to the starting stack and carrying the prize pool forward.
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
      bankroll: round.config.startingBankroll,
      cash: round.config.startingBankroll,
      shares: 0,
      side: null,
      avgPrice: 0,
      rank: null
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
