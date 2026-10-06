/**
 * The Oracle read — market intelligence for a pit, computed from its data.
 *
 * Pure and deterministic: price action from the pit's tape, the room's
 * positioning, the gap to Panta's line (Panta pits) or the move from the open
 * (crypto pits), and the clock. The lean and confidence are computed here,
 * never by a language model; an LLM may only phrase the headline from these
 * exact numbers (lib/oracle-ai.ts).
 *
 * Privacy: opening calls are hidden while a pit enrolls, so positioning is
 * read only once the round is live.
 */

import type { Round } from "@/lib/royale";
import { bookCents } from "@/lib/room-book";

export type Tone = "up" | "down" | "flat";
export type ReadChip = { k: string; v: string; tone: Tone };

export type ReadSignals = {
  pit: "panta" | "crypto";
  status: Round["status"];
  question: string;
  sideYes: string;                 // "YES" or "UP"
  sideNo: string;                  // "NO" or "DOWN"
  yes: number;                     // current YES/UP price, cents
  open: number | null;             // first tape sample
  momentum: number | null;         // cents over the last minute
  high: number | null;
  low: number | null;
  line: number | null;             // Panta's YES price (Panta pits)
  gap: number | null;              // room − Panta, cents
  spotMovePct: number | null;      // crypto pits: % move from the open
  secondsLeft: number | null;
  /** Share of positioned vault value on YES, 0..1 (live only). */
  roomYesShare: number | null;
  longYes: number;
  longNo: number;
  flat: number;
};

export type MarketRead = {
  tilt: "YES" | "NO" | "neutral";
  tiltLabel: string;               // "YES" / "UP" / "Neutral"
  confidence: "low" | "medium" | "high";
  headline: string;
  chips: ReadChip[];
};

const MINUTE = 60_000;

export function computeSignals(round: Round, yesPrice: number, line: number | null, now = Date.now()): ReadSignals {
  const panta = round.config.marketSource === "panta";
  const yes = round.book ? (round.book.close ?? bookCents(round.book)) : yesPrice;
  const tape = round.tape ?? [];
  const vals = tape.map((p) => p[1]);
  const lastMin = tape.filter(([t]) => t >= now - MINUTE);
  const before = [...tape].reverse().find(([t]) => t < now - MINUTE);
  const ref = before?.[1] ?? lastMin[0]?.[1];
  const momentum = ref !== undefined && tape.length > 1 ? Math.round((yes - ref) * 10) / 10 : null;

  let longYes = 0, longNo = 0, flat = 0, yesVal = 0, noVal = 0;
  const live = round.status === "live" || round.status === "complete" || round.status === "advancing";
  if (live) {
    for (const e of round.entrants) {
      if (e.eliminatedRound !== null) continue;
      if (e.side === "YES" && e.shares > 0) { longYes++; yesVal += e.shares * (yes / 100); }
      else if (e.side === "NO" && e.shares > 0) { longNo++; noVal += e.shares * ((100 - yes) / 100); }
      else flat++;
    }
  }
  const asset = round.config.asset;
  const o = round.oracle?.open?.[asset];
  const c = round.oracle?.close?.[asset] ?? round.oracle?.last?.[asset];
  return {
    pit: panta ? "panta" : "crypto",
    status: round.status,
    question: round.config.marketQuestion,
    sideYes: panta ? "YES" : "UP",
    sideNo: panta ? "NO" : "DOWN",
    yes: Math.round(yes * 10) / 10,
    open: vals.length ? vals[0] : null,
    momentum,
    high: vals.length ? Math.max(...vals) : null,
    low: vals.length ? Math.min(...vals) : null,
    line: panta && line !== null ? Math.round(line * 10) / 10 : null,
    gap: panta && line !== null ? Math.round((yes - line) * 10) / 10 : null,
    spotMovePct: !panta && o && c ? Math.round(((c - o) / o) * 10_000) / 100 : null,
    secondsLeft: round.status === "live" ? Math.max(0, Math.round((round.liveDeadline - now) / 1000)) : null,
    roomYesShare: live && yesVal + noVal > 0 ? Math.round((yesVal / (yesVal + noVal)) * 100) / 100 : null,
    longYes, longNo, flat
  };
}

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
const tone = (n: number | null): Tone => (n === null || Math.abs(n) < 0.5 ? "flat" : n > 0 ? "up" : "down");

/** Lean, confidence, a plain headline and chips — all from the signals. */
export function deterministicRead(s: ReadSignals): MarketRead {
  const chips: ReadChip[] = [];
  let score = 0;
  // Price: on a crypto pit the UP price is already the probability.
  if (s.pit === "crypto") score += (s.yes - 50) / 12;
  // Value vs Panta's line: a room far richer than Panta makes YES look dear.
  if (s.gap !== null) {
    score += Math.max(-2, Math.min(2, -s.gap / 10));
    chips.push({ k: "vs Panta", v: `${sign(s.gap)}${Math.abs(s.gap).toFixed(0)}¢`, tone: tone(s.gap) });
  }
  if (s.momentum !== null) {
    score += Math.max(-1, Math.min(1, s.momentum / 10));
    chips.push({ k: "1-min move", v: `${sign(s.momentum)}${Math.abs(s.momentum).toFixed(1)}¢`, tone: tone(s.momentum) });
  }
  if (s.spotMovePct !== null) chips.push({ k: "vs open", v: `${sign(s.spotMovePct)}${Math.abs(s.spotMovePct).toFixed(2)}%`, tone: tone(s.spotMovePct) });
  // A crowded room: in a cut, being on the same side as everyone is a risk.
  if (s.roomYesShare !== null) {
    const share = s.roomYesShare;
    chips.push({ k: "Room money", v: `${Math.round(share * 100)}% ${s.sideYes}`, tone: share > 0.55 ? "up" : share < 0.45 ? "down" : "flat" });
    if (share >= 0.75) score -= 0.5;
    if (share <= 0.25) score += 0.5;
  }
  if (s.secondsLeft !== null) chips.push({ k: "Bell", v: `${Math.floor(s.secondsLeft / 60)}:${String(s.secondsLeft % 60).padStart(2, "0")}`, tone: "flat" });

  const tilt = score > 0.6 ? "YES" : score < -0.6 ? "NO" : "neutral";
  const mag = Math.abs(score);
  const confidence = mag > 1.6 ? "high" : mag > 0.9 ? "medium" : "low";
  const tiltLabel = tilt === "YES" ? s.sideYes : tilt === "NO" ? s.sideNo : "Neutral";

  const parts: string[] = [];
  if (s.status === "enrolling") {
    parts.push(s.pit === "panta"
      ? `Panta opens this at ${Math.round(s.line ?? s.yes)}¢ ${s.sideYes}; the room sets its own line once trading starts.`
      : `Opens at 50¢ — ${s.sideYes} wins if it closes above the opening price.`);
  } else if (s.status === "complete" || s.status === "cancelled") {
    parts.push(`Closed at ${Math.round(s.yes)}¢ ${s.sideYes}.`);
  } else {
    parts.push(`${s.sideYes} trades ${Math.round(s.yes)}¢`);
    if (s.gap !== null && Math.abs(s.gap) >= 3) parts[0] += `, ${Math.abs(Math.round(s.gap))}¢ ${s.gap > 0 ? "rich" : "cheap"} to Panta's ${Math.round(s.line!)}¢ line`;
    if (s.spotMovePct !== null) parts[0] += ` with the price ${s.spotMovePct >= 0 ? "up" : "down"} ${Math.abs(s.spotMovePct).toFixed(2)}% from the open`;
    parts[0] += ".";
    if (s.momentum !== null && Math.abs(s.momentum) >= 2) parts.push(`Momentum ${s.momentum > 0 ? "up" : "down"} ${Math.abs(s.momentum).toFixed(0)}¢ in the last minute.`);
    if (s.roomYesShare !== null && (s.roomYesShare >= 0.7 || s.roomYesShare <= 0.3)) {
      const crowd = s.roomYesShare >= 0.7 ? s.sideYes : s.sideNo;
      parts.push(`The room is crowded on ${crowd} — the other side is how you separate from the pack.`);
    }
  }
  return { tilt, tiltLabel, confidence, headline: parts.join(" "), chips: chips.slice(0, 4) };
}
