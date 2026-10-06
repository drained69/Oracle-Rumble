/**
 * Room book — the pit's own market maker for pits on a Panta market.
 *
 * A pit on a crypto direction market is priced by the spot oracle. A pit on
 * any other Panta market (sports, politics, a creator's question) needs a
 * price that MOVES while the room plays, even when the Panta market is thin
 * (or the sandbox, where every market quotes 50¢). So the room makes its own
 * line: a logarithmic market scoring rule (LMSR) seeded at Panta's price.
 * Every YES/NO trade moves the room's odds; Panta supplies the question, the
 * opening line and — once its AI resolver rules — the final outcome.
 *
 * Unresolved pits settle at the time-weighted average room price over the
 * closing period, not the last trade, so nobody can mark their own position
 * up by pumping the price right before the bell.
 *
 * Pure domain logic — no I/O. Prices are cents (0..100) like the rest of the
 * engine; the book itself works in probabilities.
 */

import type { Entrant, Side } from "@/lib/royale";

export type RoomBook = {
  /** LMSR liquidity — USDC needed to move the price meaningfully. */
  b: number;
  /** Outstanding YES / NO shares the book has issued (seed included). */
  qYes: number;
  qNo: number;
  /** Panta's YES price (cents) when trading opened — the opening line. */
  line: number;
  /** Panta's latest YES price (cents), refreshed by the keeper. */
  lastLine?: number;
  /** Settlement price (cents) once the round closes. */
  close?: number;
  /** What set `close`: Panta's resolved outcome, or the closing-period average. */
  settledBy?: "outcome" | "twap";
};

/** [ms epoch, YES cents] samples of the room price, oldest first. */
export type Tape = [number, number][];

const MIN_B = 20;
const MAX_B = 5_000;
/** Book prices never quote past these (cents) — the engine trades 1..99. */
const FLOOR = 1;
const CEIL = 99;

/** log(e^a + e^b) without overflow. */
function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

/** LMSR cost function C(q) = b·ln(e^{qY/b} + e^{qN/b}). */
function cost(b: number, qYes: number, qNo: number): number {
  return b * logSumExp(qYes / b, qNo / b);
}

/** Raw YES probability (0..1) of the book. */
export function bookProb(book: RoomBook): number {
  return 1 / (1 + Math.exp((book.qNo - book.qYes) / book.b));
}

/** YES price in cents, clamped to the tradable 1..99 range, one decimal. */
export function bookCents(book: RoomBook): number {
  const c = bookProb(book) * 100;
  return Math.round(Math.max(FLOOR, Math.min(CEIL, c)) * 10) / 10;
}

/** Liquidity for a room: about the money the seated players can trade. */
export function liquidityFor(totalVaultUsdc: number): number {
  return Math.max(MIN_B, Math.min(MAX_B, Math.round(totalVaultUsdc)));
}

/** A book seeded so its price equals `lineCents` (Panta's opening line). */
export function seedBook(lineCents: number, b: number): RoomBook {
  const p = Math.max(FLOOR, Math.min(CEIL, lineCents)) / 100;
  return { b, qYes: b * Math.log(p / (1 - p)), qNo: 0, line: Math.round(lineCents * 10) / 10 };
}

/**
 * Shares of `side` that `usdc` buys from the book right now. Closed form:
 * solve C(q + Δ) − C(q) = usdc for Δ.
 */
export function sharesForSpend(book: RoomBook, side: Side, usdc: number): number {
  if (usdc <= 0) return 0;
  const { b } = book;
  const own = side === "YES" ? book.qYes : book.qNo;
  const other = side === "YES" ? book.qNo : book.qYes;
  const c0 = cost(b, book.qYes, book.qNo);
  // e^{(own+Δ)/b} = e^{(c0+usdc)/b} − e^{other/b}
  const top = c0 + usdc;
  const delta = top + b * Math.log1p(-Math.exp((other - top) / b)) - own;
  return Math.max(0, delta);
}

/** USDC the book pays to buy back `shares` of `side` right now. */
export function proceedsForSell(book: RoomBook, side: Side, shares: number): number {
  if (shares <= 0) return 0;
  const before = cost(book.b, book.qYes, book.qNo);
  const after = side === "YES"
    ? cost(book.b, book.qYes - shares, book.qNo)
    : cost(book.b, book.qYes, book.qNo - shares);
  return Math.max(0, before - after);
}

function addShares(book: RoomBook, side: Side, shares: number): void {
  if (side === "YES") book.qYes += shares;
  else book.qNo += shares;
}

/** Mark a player's vault at the book price (cash + position value). */
export function markAtBook(entrant: Entrant, book: RoomBook): void {
  const yes = bookCents(book);
  const mark = entrant.side === "YES" ? yes : entrant.side === "NO" ? 100 - yes : 0;
  entrant.bankroll = entrant.cash + entrant.shares * (mark / 100);
}

/** USDC a player can put on `side`: cash, plus what selling an opposite position returns. */
export function bookAvailableFor(book: RoomBook, entrant: Entrant, side: Side): number {
  if (!entrant.side || entrant.side === side || entrant.shares <= 0) return entrant.cash;
  return entrant.cash + proceedsForSell(book, entrant.side, entrant.shares);
}

/** Sell a player's whole position back to the book. Returns the USDC received. */
export function bookSell(book: RoomBook, entrant: Entrant): number {
  if (!entrant.side || entrant.shares <= 0) return 0;
  const proceeds = proceedsForSell(book, entrant.side, entrant.shares);
  addShares(book, entrant.side, -entrant.shares);
  entrant.cash += proceeds;
  entrant.shares = 0;
  entrant.side = null;
  entrant.avgPrice = 0;
  markAtBook(entrant, book);
  return proceeds;
}

export type BookFill = { ok: true; shares: number; avgCents: number; priceAfter: number } | { ok: false; reason: string };

/**
 * Buy `usdc` of `side` from the book. Switching sides sells the current
 * position back to the book first, so its value counts towards the buy.
 * Validates before mutating anything — a refused trade changes nothing.
 */
export function bookBuy(book: RoomBook, entrant: Entrant, side: Side, usdc: number): BookFill {
  if (entrant.eliminatedRound !== null) return { ok: false, reason: "Eliminated." };
  if (!(usdc > 0)) return { ok: false, reason: "Amount must be positive." };
  if (usdc > bookAvailableFor(book, entrant, side) + 1e-9) return { ok: false, reason: "Insufficient bankroll." };
  if (entrant.side && entrant.side !== side && entrant.shares > 0) bookSell(book, entrant);
  const spend = Math.min(usdc, entrant.cash);
  const shares = sharesForSpend(book, side, spend);
  if (!(shares > 0)) return { ok: false, reason: "The book couldn't fill that size." };
  addShares(book, side, shares);
  const prevCost = entrant.avgPrice * entrant.shares;
  entrant.shares += shares;
  entrant.side = side;
  entrant.avgPrice = (prevCost + spend * 100) / entrant.shares;
  entrant.cash -= spend;
  markAtBook(entrant, book);
  return { ok: true, shares, avgCents: (spend * 100) / shares, priceAfter: bookCents(book) };
}

/**
 * Opening auction: calls picked at the seat all fill at the opening line (so
 * seat order never matters), then the book absorbs their net demand — the
 * room's first move reflects how the table leaned.
 */
export function absorbOpening(book: RoomBook, entrants: Entrant[]): void {
  for (const e of entrants) if (e.side && e.shares > 0) addShares(book, e.side, e.shares);
}

/**
 * One bot decision on a room book. Bots here act as liquidity: small sizes,
 * and a lean back toward Panta's line when the room drifts far from it, so a
 * near-empty pit still has a counterparty without bots running the price.
 */
export function bookBotTick(book: RoomBook, entrant: Entrant, rand: () => number = Math.random): void {
  if (!entrant.isBot || entrant.eliminatedRound !== null) return;
  const r = rand();
  if (entrant.shares > 0 && r < 0.2) { bookSell(book, entrant); return; }
  if (r >= 0.6 || entrant.cash <= 1) { markAtBook(entrant, book); return; }
  const gap = bookCents(book) - (book.lastLine ?? book.line); // + : room richer on YES than Panta
  const pYes = Math.max(0.15, Math.min(0.85, 0.5 - gap / 60));
  const side: Side = rand() < pYes ? "YES" : "NO";
  const spend = entrant.cash * (0.08 + rand() * 0.12);
  bookBuy(book, entrant, side, spend);
}

// ── tape ───────────────────────────────────────────────────────────────

const TAPE_MAX = 480;

/** Append a price sample, thinning the oldest half when the tape is full. */
export function recordTape(tape: Tape, at: number, yesCents: number, minGapMs = 0): Tape {
  const last = tape[tape.length - 1];
  const v = Math.round(yesCents * 10) / 10;
  if (last && at - last[0] < minGapMs && last[1] === v) return tape;
  if (last && at - last[0] < minGapMs) { last[1] = v; return tape; }
  tape.push([at, v]);
  if (tape.length > TAPE_MAX) {
    const half = Math.floor(tape.length / 2);
    const older = tape.slice(0, half).filter((_, i) => i % 2 === 0);
    tape.splice(0, tape.length, ...older, ...tape.slice(half));
  }
  return tape;
}

/** How long the settlement average looks back: the final 20% of the window, 30s–10min. */
export function closingWindowMs(liveSec: number): number {
  return Math.max(30_000, Math.min(600_000, liveSec * 1000 * 0.2));
}

/**
 * Time-weighted average of the tape's step function over [from, to]. The
 * price in force at `from` is the last sample at or before it. Falls back to
 * `fallback` when the tape has nothing in or before the window.
 */
export function twap(tape: Tape, from: number, to: number, fallback: number): number {
  if (!(to > from)) return fallback;
  let i = 0;
  let price: number | null = null;
  for (; i < tape.length && tape[i][0] <= from; i++) price = tape[i][1];
  let start = from;
  if (price === null) {
    // Nothing before the window — average from the first sample inside it.
    if (i >= tape.length || tape[i][0] >= to) return fallback;
    start = tape[i][0];
    price = tape[i][1];
    i++;
  }
  let area = 0;
  let at = start;
  for (; i < tape.length && tape[i][0] < to; i++) {
    area += price * (tape[i][0] - at);
    at = tape[i][0];
    price = tape[i][1];
  }
  area += price * (to - at);
  const span = to - start;
  return span > 0 ? Math.round((area / span) * 10) / 10 : price;
}
