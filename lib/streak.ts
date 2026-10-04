/**
 * Streak arena — a parlay across time. Last caller standing wins.
 *
 * The game is a chain of short legs. Each leg asks one question about BTC,
 * ETH or SOL (a coin up or down, a head-to-head, or which of the three does
 * best). Players get a short window to pick; picks stay hidden until it
 * closes, then the leg runs for the host's leg length on live prices.
 * A wrong pick — or no pick — knocks a player out. If everyone still in gets
 * it wrong, or the leg ends level, nobody goes out.
 *
 * The game ends when one player is left, when no real player is left, or
 * after MAX_LEGS legs. Players are ranked by how many legs they survived;
 * the best human finishers split the pool, ties sharing their places.
 *
 * Short-term moves are close to random, so much of the skill is reading the
 * room: going against the crowd is how you end up the only one standing.
 */

import { answersFor, bestQuestion, directionQuestion, duelQuestion, DUEL_PAIRS, randomPicks, seedHash, type AssetPrices, type PickQuestion } from "@/lib/predictions";
import { computeGroupPayouts, logEvent, standings, type Entrant, type Round } from "@/lib/royale";

/** How long players have to pick before each leg runs. */
export const PICK_MS = 20_000;
/** Legs before the game ends with whoever is left. */
export const MAX_LEGS = 6;
/** Leg lengths a host can choose (seconds). */
export const LEG_LENGTHS = [60, 120, 300] as const;
export const DEFAULT_LEG_SEC = 120;

export type StreakLeg = {
  /** 1-based leg number. */
  n: number;
  question: PickQuestion;
  /** Entrant id → option id. Others' picks are hidden while picking. */
  picks: Record<string, string>;
  openAt?: number;
  endsAt?: number;
  open?: AssetPrices;
  close?: AssetPrices;
  /** Right option(s); [] = level or unpriced, nobody goes out. Set once resolved. */
  answer?: string[];
  /** Entrant ids knocked out on this leg. */
  out?: string[];
  /** Everyone still in got it wrong, so nobody went out. */
  allMissed?: boolean;
};

export type StreakState = {
  legs: StreakLeg[];
  maxLegs: number;
  legMs: number;
  /** "picking": the current leg's window is open. "running": it's live. "done": game over. */
  phase: "picking" | "running" | "done";
  /** End of the current phase (ms); 0 before the game starts. */
  phaseEndsAt: number;
  seed: string;
};

/** Normalize a host's leg length to one of the offered lengths. */
export function normalizeLegSec(v: unknown): number {
  const n = Number(v);
  return (LEG_LENGTHS as readonly number[]).includes(n) ? n : DEFAULT_LEG_SEC;
}

/**
 * The question for leg `index` (0-based): a seeded order of the three coins'
 * up/down, the three head-to-heads, and "which does best" once.
 */
export function streakQuestion(seed: string, index: number): PickQuestion {
  const id = `leg${index + 1}`;
  const deck: Array<() => PickQuestion> = [
    () => directionQuestion("BTC", id),
    () => duelQuestion(DUEL_PAIRS[0][0], DUEL_PAIRS[0][1], id),
    () => directionQuestion("SOL", id),
    () => bestQuestion(id),
    () => directionQuestion("ETH", id),
    () => duelQuestion(DUEL_PAIRS[1][0], DUEL_PAIRS[1][1], id),
    () => duelQuestion(DUEL_PAIRS[2][0], DUEL_PAIRS[2][1], id)
  ];
  const offset = seedHash(seed) % deck.length;
  return deck[(offset + index) % deck.length]();
}

/** A fresh streak, before the arena locks (leg 1 can already be picked). */
export function createStreak(seed: string, legSec: number): StreakState {
  return {
    legs: [{ n: 1, question: streakQuestion(seed, 0), picks: {} }],
    maxLegs: MAX_LEGS,
    legMs: normalizeLegSec(legSec) * 1000,
    phase: "picking",
    phaseEndsAt: 0,
    seed
  };
}

export function currentLeg(st: StreakState): StreakLeg {
  return st.legs[st.legs.length - 1];
}

/** Players still in (not knocked out). */
export function aliveEntrants(round: Round): Entrant[] {
  return round.entrants.filter((e) => e.eliminatedRound === null);
}

/** Can this entrant pick in the current leg right now? */
export function canPick(round: Round, e: Entrant, now = Date.now()): boolean {
  const st = round.streak;
  if (!st || e.eliminatedRound !== null) return false;
  if (round.status === "enrolling") return st.legs.length === 1;
  return round.status === "live" && st.phase === "picking" && now < st.phaseEndsAt;
}

/** The arena locked: open leg 1's pick window. */
export function startStreak(round: Round, now: number): void {
  const st = round.streak!;
  st.phase = "picking";
  st.phaseEndsAt = now + PICK_MS;
  round.liveDeadline = st.phaseEndsAt;
  logEvent(round, `Leg 1 · ${currentLeg(st).question.text} Picks lock in ${PICK_MS / 1000}s.`);
}

/**
 * The pick window closed: lock picks (bots pick at random), take the opening
 * prices of the coins this leg is about, and start the leg.
 */
export function runLeg(round: Round, spots: AssetPrices, now: number): void {
  const st = round.streak!;
  const leg = currentLeg(st);
  for (const e of aliveEntrants(round)) {
    if (e.isBot && !leg.picks[e.id]) leg.picks[e.id] = randomPicks([leg.question])[leg.question.id];
  }
  leg.open = Object.fromEntries(leg.question.assets.filter((a) => spots[a]).map((a) => [a, spots[a]!]));
  leg.openAt = now;
  leg.endsAt = now + st.legMs;
  st.phase = "running";
  st.phaseEndsAt = leg.endsAt;
  round.liveDeadline = leg.endsAt;
  const alive = aliveEntrants(round);
  const picked = alive.filter((e) => leg.picks[e.id]).length;
  logEvent(round, `Leg ${leg.n} is live — ${picked}/${alive.length} picked. ${leg.question.assets.map((a) => `${a} ${spots[a] ? usd(spots[a]!) : "unavailable"}`).join(", ")} at the start.`);
}

/**
 * The leg ended: judge it at `close`, knock out wrong (or missing) picks,
 * and either open the next leg's pick window or end the game.
 */
export function resolveLeg(round: Round, close: AssetPrices, now: number): void {
  const st = round.streak!;
  const leg = currentLeg(st);
  leg.close = Object.fromEntries(leg.question.assets.filter((a) => close[a]).map((a) => [a, close[a]!]));
  const answer = answersFor([leg.question], leg.open ?? {}, close)[leg.question.id] ?? [];
  leg.answer = answer;
  const alive = aliveEntrants(round);
  const wrong = answer.length === 0 ? [] : alive.filter((e) => !answer.includes(leg.picks[e.id]));
  leg.allMissed = wrong.length > 0 && wrong.length === alive.length;
  leg.out = leg.allMissed ? [] : wrong.map((e) => e.id);
  for (const e of alive) {
    if (leg.out.includes(e.id)) e.eliminatedRound = leg.n;
    else e.score = leg.n; // legs survived
  }
  const answerText = answer.length === 0 ? "level — nobody is out" : `${answer.map((a) => optionWord(leg.question, a)).join(" & ")}`;
  logEvent(round, leg.allMissed
    ? `Leg ${leg.n}: ${answerText}. Everyone missed, so nobody is out.`
    : answer.length === 0
      ? `Leg ${leg.n}: ${answerText}.`
      : `Leg ${leg.n}: ${answerText}. ${leg.out.length} out, ${alive.length - leg.out.length} still in.`);

  const left = aliveEntrants(round);
  const humansLeft = left.filter((e) => !e.isBot).length;
  if (left.length <= 1 || humansLeft === 0 || leg.n >= st.maxLegs) {
    settleStreak(round, now);
    return;
  }
  st.legs.push({ n: leg.n + 1, question: streakQuestion(st.seed, leg.n), picks: {} });
  st.phase = "picking";
  st.phaseEndsAt = now + PICK_MS;
  round.liveDeadline = st.phaseEndsAt;
  logEvent(round, `Leg ${leg.n + 1} · ${currentLeg(st).question.text} Picks lock in ${PICK_MS / 1000}s.`);
}

/** Game over: rank by legs survived and split the pool among the best humans. */
export function settleStreak(round: Round, now: number): void {
  const st = round.streak!;
  st.phase = "done";
  st.phaseEndsAt = 0;
  const order = standings(round);
  const humans = order.filter((e) => !e.isBot);
  for (const e of round.entrants) e.rank = 1 + round.entrants.filter((x) => (x.score ?? 0) > (e.score ?? 0)).length;
  const groups: Entrant[][] = [];
  for (const e of humans) {
    const last = groups[groups.length - 1];
    if (last && (last[0].score ?? 0) === (e.score ?? 0)) last.push(e);
    else groups.push([e]);
  }
  const funded = round.config.entryUsdc > 0 ? Math.round(round.prizePoolUsdc / round.config.entryUsdc) : humans.length;
  const payouts = computeGroupPayouts(round.prizePoolUsdc, groups.map((g) => g.map((e) => e.id)), funded);
  for (const e of round.entrants) e.prizeUsdc = payouts[e.id] ?? 0;
  round.status = "complete";
  round.endedAt = now;
  const top = groups[0] ?? [];
  round.championId = top[0]?.id ?? order[0]?.id ?? null;
  const won = top.reduce((s, e) => s + e.prizeUsdc, 0);
  const legs = (e: Entrant) => `${e.score ?? 0} leg${(e.score ?? 0) === 1 ? "" : "s"}`;
  if (humans.length === 1) {
    logEvent(round, `${humans[0].nickname} lasted ${legs(humans[0])} — the only player who paid in, so their $${won.toFixed(2)} entry comes back.`);
  } else if (top.length === 1) {
    logEvent(round, top[0].eliminatedRound === null
      ? `${top[0].nickname} is the last caller standing after ${legs(top[0])} and wins $${won.toFixed(2)}.`
      : `${top[0].nickname} lasted longest of the players, ${legs(top[0])}, and wins $${won.toFixed(2)}.`);
  } else if (top.length > 1) {
    const names = top.length === 2 ? `${top[0].nickname} and ${top[1].nickname}` : `${top.length} players`;
    logEvent(round, `${names} survive ${legs(top[0])} and split $${won.toFixed(2)}.`);
  }
}

/** "Up" / "Down" / a coin. */
export function optionWord(q: PickQuestion, id: string): string {
  if (q.kind === "direction") return `${q.assets[0]} ${id === "UP" ? "up" : "down"}`;
  if (q.kind === "best") return `${id} did best`;
  return `${id} did better`;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

/** Longest a streak game can run (s), for the escrow's recovery deadline. */
export function streakSpanSec(legSec: number): number {
  return MAX_LEGS * (normalizeLegSec(legSec) + PICK_MS / 1000 + 60);
}
