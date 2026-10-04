/**
 * Predictions arena — a call contest with nothing to trade.
 *
 * Before the round starts every player answers the same five questions on
 * how BTC, ETH and SOL move over it: each coin up or down, which of the
 * three does best, and one head-to-head. Picks stay hidden until the round
 * locks. At the close each right answer is a point; the highest scores take
 * the prize pool, and players who tie split the places they share.
 *
 * The three coins usually move together, so the two relative questions
 * (best of three, head-to-head) are what separate players who read the
 * market from players who call everything the same way.
 *
 * Pure logic, shared by the keeper (live scores, settlement) and the UI.
 */

import { ASSET_SYMBOLS, type AssetSymbol } from "@/lib/assets";

export type PickOption = { id: string; label: string };

export type PickQuestion = {
  id: string;
  kind: "direction" | "best" | "duel";
  /** Short prompt, e.g. "BTC up or down?" */
  text: string;
  /** How it's decided, in one line. */
  rule: string;
  /** Coins whose move decides the answer. */
  assets: AssetSymbol[];
  options: PickOption[];
};

/** Question id → chosen option id. */
export type Picks = Record<string, string>;

export type PredictionsState = {
  questions: PickQuestion[];
  /** Right option(s) per question once the round closes; [] = void, nobody scores it. */
  answers?: Record<string, string[]>;
};

/** Prices (USD) per asset symbol. */
export type AssetPrices = Partial<Record<string, number>>;

const DUELS: [AssetSymbol, AssetSymbol][] = [["SOL", "ETH"], ["ETH", "BTC"], ["BTC", "SOL"]];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function directionQuestion(a: AssetSymbol, id = a.toLowerCase()): PickQuestion {
  return {
    id,
    kind: "direction",
    text: `${a} up or down?`,
    rule: `Up if ${a} closes above its opening price.`,
    assets: [a],
    options: [{ id: "UP", label: "Up" }, { id: "DOWN", label: "Down" }]
  };
}

export function bestQuestion(id = "best"): PickQuestion {
  return {
    id,
    kind: "best",
    text: "Which does best?",
    rule: "The biggest % gain, or the smallest % drop.",
    assets: [...ASSET_SYMBOLS],
    options: ASSET_SYMBOLS.map((a) => ({ id: a, label: a }))
  };
}

export function duelQuestion(x: AssetSymbol, y: AssetSymbol, id = "duel"): PickQuestion {
  return {
    id,
    kind: "duel",
    text: `${x} or ${y}: which does better?`,
    rule: `Whichever of ${x} and ${y} has the better % change.`,
    assets: [x, y],
    options: [{ id: x, label: x }, { id: y, label: y }]
  };
}

/** A small deterministic hash, for picking question variants from a seed. */
export function seedHash(s: string): number {
  return hash(s);
}

/** The head-to-head pairs questions rotate through. */
export const DUEL_PAIRS: readonly [AssetSymbol, AssetSymbol][] = DUELS;

/** The five questions of a round. `seed` picks which head-to-head it plays. */
export function predictionQuestions(seed: string): PickQuestion[] {
  const [x, y] = DUELS[hash(seed) % DUELS.length];
  return [...ASSET_SYMBOLS.map((a) => directionQuestion(a)), bestQuestion(), duelQuestion(x, y)];
}

/** % change from open to `now` as a fraction, or null when a price is missing. */
export function changeOf(open: number | undefined, now: number | undefined): number | null {
  return open && now ? now / open - 1 : null;
}

// Two % changes this close count as equal.
const EPS = 1e-12;

/**
 * Right answer(s) to each question given open and current (or closing)
 * prices. A question is void ([]) when a price it needs is missing or the
 * result is a dead heat — nobody scores it.
 */
export function answersFor(questions: PickQuestion[], open: AssetPrices, now: AssetPrices): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const q of questions) {
    const moves = q.assets.map((a) => ({ a, c: changeOf(open[a], now[a]) }));
    if (moves.some((m) => m.c === null)) { out[q.id] = []; continue; }
    if (q.kind === "direction") {
      const c = moves[0].c!;
      out[q.id] = Math.abs(c) < EPS ? [] : [c > 0 ? "UP" : "DOWN"];
      continue;
    }
    const best = Math.max(...moves.map((m) => m.c!));
    const top = moves.filter((m) => best - m.c! < EPS).map((m) => m.a);
    // Everyone level → nobody did better.
    out[q.id] = top.length === moves.length ? [] : top;
  }
  return out;
}

/** Right answers in a set of picks (no lock bonus). */
export function rightCount(picks: Picks | undefined, answers: Record<string, string[]> | undefined): number {
  if (!picks || !answers) return 0;
  let n = 0;
  for (const [q, opt] of Object.entries(picks)) if (answers[q]?.includes(opt)) n++;
  return n;
}

// ── Lock: a parlay inside a predictions card ─────────────────────────
// A player may lock 2 or 3 of their picks together. If every locked pick
// is right, the lock lands and adds a bonus point per locked pick (so the
// locked picks count double). If any locked pick is wrong, every locked
// pick scores 0. A locked question that ends level (void) is left out of
// the lock; the rest decide it.

export const LOCK_MIN = 2;
export const LOCK_MAX = 3;

export type LockState = "none" | "pending" | "landed" | "missed";

export type CardScore = {
  /** Right answers, as if there were no lock. */
  right: number;
  /** Points from the lock: +bonus when it lands, −(locked rights) when it misses. */
  lockDelta: number;
  lock: LockState;
  /** right + lockDelta. */
  total: number;
};

/** Is this a usable lock (2–3 picked questions)? */
export function lockActive(locks: string[] | undefined, picks: Picks | undefined): boolean {
  const n = (locks ?? []).filter((q) => picks?.[q]).length;
  return n >= LOCK_MIN && n <= LOCK_MAX;
}

/**
 * Score a predictions card with its lock. With `answers` missing a locked
 * question (still running), the lock is "pending" and adds nothing yet.
 */
export function scoreCard(picks: Picks | undefined, locks: string[] | undefined, answers: Record<string, string[]> | undefined): CardScore {
  const right = rightCount(picks, answers);
  if (!picks || !answers || !lockActive(locks, picks)) return { right, lockDelta: 0, lock: "none", total: right };
  const locked = (locks ?? []).filter((q) => picks[q]);
  const live = locked.filter((q) => (answers[q] ?? []).length > 0); // void questions drop out
  if (live.length === 0) return { right, lockDelta: 0, lock: "none", total: right };
  const lockedRight = live.filter((q) => answers[q].includes(picks[q])).length;
  if (lockedRight === live.length) return { right, lockDelta: live.length, lock: "landed", total: right + live.length };
  return { right, lockDelta: -lockedRight, lock: "missed", total: right - lockedRight };
}

/** Points for a card: right answers plus the lock result. */
export function scorePicks(picks: Picks | undefined, answers: Record<string, string[]> | undefined, locks?: string[]): number {
  return scoreCard(picks, locks, answers).total;
}

/** Keep only valid locks: picked questions, no duplicates, at most LOCK_MAX. */
export function normalizeLocks(questions: PickQuestion[] | undefined, raw: unknown): string[] {
  if (!questions || !Array.isArray(raw)) return [];
  const ids = new Set(questions.map((q) => q.id));
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && ids.has(x)))].slice(0, LOCK_MAX);
}

/** Highest possible score for a round's card: every pick right and a full lock. */
export function maxScore(questions: PickQuestion[] | undefined): number {
  return (questions?.length ?? 0) + LOCK_MAX;
}

/** Keep only valid picks: known questions, known options. */
export function normalizePicks(questions: PickQuestion[] | undefined, raw: unknown): Picks {
  const out: Picks = {};
  if (!questions || !raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const q of questions) {
    const v = r[q.id];
    if (typeof v === "string" && q.options.some((o) => o.id === v)) out[q.id] = v;
  }
  return out;
}

/** How many of the round's questions are answered. */
export function pickCount(questions: PickQuestion[] | undefined, picks: Picks | undefined): number {
  if (!questions || !picks) return 0;
  return questions.filter((q) => picks[q.id]).length;
}

/** A full random set of picks (seat-filling bots). */
export function randomPicks(questions: PickQuestion[], rand: () => number = Math.random): Picks {
  const out: Picks = {};
  for (const q of questions) out[q.id] = q.options[Math.floor(rand() * q.options.length)].id;
  return out;
}

/** Label of an option, e.g. "Up" or "SOL". */
export function optionLabel(q: PickQuestion, id: string | undefined): string {
  return q.options.find((o) => o.id === id)?.label ?? "—";
}

/** One-line summary of the results, e.g. "BTC up · ETH down · SOL up · SOL did best · SOL beat ETH". */
export function resultsLine(questions: PickQuestion[], answers: Record<string, string[]>): string {
  return questions.map((q) => {
    const a = answers[q.id] ?? [];
    if (a.length === 0) return q.kind === "direction" ? `${q.assets[0]} flat` : q.kind === "best" ? "no clear best" : `${q.assets.join(" = ")}`;
    if (q.kind === "direction") return `${q.assets[0]} ${a[0] === "UP" ? "up" : "down"}`;
    if (q.kind === "best") return `${a.join(" & ")} did best`;
    const loser = q.assets.find((x) => !a.includes(x));
    return `${a[0]} beat ${loser}`;
  }).join(" · ");
}
