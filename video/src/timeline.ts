/**
 * The one clock for the whole film.
 *
 * Every section, every on-screen beat (taps, keystrokes, fills, the cut, the
 * bell) and every sound is placed here, in musical beats. The Remotion scenes
 * read frames from this file and scripts/build-audio.ts reads seconds from the
 * same file — so picture and sound can never drift apart.
 *
 * Tempo: one bar = exactly 58 frames at 30 fps (≈124.14 BPM), so every section
 * starts on a whole frame and on a downbeat.
 *
 * Section lengths come from the measured voice-over (public/vo/manifest.json):
 * each section is at least its planned length, and long enough for its lines.
 */

import manifest from "../public/vo/manifest.json";
import { NARRATION } from "./narration";

export const FPS = 30;
export const FRAMES_PER_BEAT = 14.5;
export const BEATS_PER_BAR = 4;
export const FRAMES_PER_BAR = FRAMES_PER_BEAT * BEATS_PER_BAR; // 58
export const BPM = (60 * FPS) / FRAMES_PER_BEAT; // ≈ 124.14
export const SEC_PER_BEAT = 60 / BPM;

export type SectionId =
  | "intro" | "problem" | "solution" | "audience"
  | "signin" | "seat" | "trade" | "cut" | "bell" | "payout" | "host"
  | "tech" | "formats" | "outro";

/** Minimum bars per section — the visuals need at least this long. */
const PLAN: Array<[SectionId, number]> = [
  ["intro", 3], ["problem", 6], ["solution", 6], ["audience", 3],
  ["signin", 4], ["seat", 6], ["trade", 5], ["cut", 5], ["bell", 4], ["payout", 4], ["host", 5],
  ["tech", 7], ["formats", 2], ["outro", 4]
];

/** Voice-over: lines play one after another from each section's start. */
const VO_LEAD = 0.7;  // beats from the section downbeat to the first word
const VO_GAP = 0.6;   // beats between lines
const VO_TAIL = 0.3;  // beats of air before the next section
const voSeconds = (manifest as { lines: Record<string, number> }).lines;
const voBeats = (id: string) => {
  const sec = voSeconds[id];
  if (sec === undefined) throw new Error(`No voice-over clip measured for ${id} — run npm run voiceover`);
  return sec / SEC_PER_BEAT;
};

export type Section = {
  id: SectionId;
  index: number;
  startBar: number;
  bars: number;
  startBeat: number;
  endBeat: number;
  startFrame: number;
  endFrame: number;
};

export type VoLine = { id: string; section: SectionId; text: string; startBeat: number; endBeat: number; seconds: number };

export const { SECTIONS, VO } = (() => {
  let bar = 0;
  const sections: Section[] = [];
  const vo: VoLine[] = [];
  PLAN.forEach(([id, minBars], index) => {
    const lines = NARRATION.filter((l) => l.section === id);
    let t = VO_LEAD;
    const placed = lines.map((l) => {
      t += (l.pause ?? 0) / SEC_PER_BEAT;
      const start = t;
      const len = voBeats(l.id);
      t = start + len + VO_GAP;
      return { l, start, len };
    });
    const need = lines.length ? t - VO_GAP + VO_TAIL : 0;
    const bars = Math.max(minBars, Math.ceil(need / BEATS_PER_BAR));
    const startBeat = bar * BEATS_PER_BAR;
    sections.push({
      id, index, startBar: bar, bars, startBeat, endBeat: startBeat + bars * BEATS_PER_BAR,
      startFrame: bar * FRAMES_PER_BAR, endFrame: (bar + bars) * FRAMES_PER_BAR
    });
    for (const { l, start, len } of placed) {
      vo.push({ id: l.id, section: id, text: l.text, startBeat: startBeat + start, endBeat: startBeat + start + len, seconds: voSeconds[l.id] });
    }
    bar += bars;
  });
  return { SECTIONS: sections, VO: vo };
})();

export const TOTAL_BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);
export const TOTAL_BEATS = TOTAL_BARS * BEATS_PER_BAR;
export const DURATION_IN_FRAMES = TOTAL_BARS * FRAMES_PER_BAR;
export const DURATION_SECONDS = DURATION_IN_FRAMES / FPS;

export const section = (id: SectionId): Section => SECTIONS.find((s) => s.id === id)!;
/** Absolute beat of `rel` beats into a section. */
export const at = (id: SectionId, rel = 0): number => section(id).startBeat + rel;
export const beatToFrame = (beat: number): number => beat * FRAMES_PER_BEAT;
export const frameToBeat = (frame: number): number => frame / FRAMES_PER_BEAT;
export const beatToSeconds = (beat: number): number => beat * SEC_PER_BEAT;

/** Start beat of a voice-over line, or a point `f` (0..1) of the way through it. */
export function vo(id: string, f = 0): number {
  const l = VO.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown voice-over line: ${id}`);
  return l.startBeat + f * (l.endBeat - l.startBeat);
}

// ─────────────────────────────────────────────────────────────────────
// Example data. Every player, handle, amount and price below is made up.
// ─────────────────────────────────────────────────────────────────────

export type Side = "YES" | "NO";
export type PlayerId = "me" | "kai" | "vera" | "mira" | "omar" | "yuki" | "beto" | "cam";

export const PIT = {
  code: "K7Q2XM",
  hostedCode: "R9V3PQ",
  hostedQuestion: "Will the home team win tonight's final?",
  question: "Will SOL close above $300 on Friday?",
  category: "crypto",
  line: 62, // Panta's YES price when the pit locks (¢)
  entry: 2,
  vault: 10,
  capacity: 8,
  rounds: 2,
  liveMin: 5,
  closingMin: 1, // 20% of a 5-minute window
  claimFeeBps: 10,
  walletShort: "7xKp…3fQa",
  usdcBefore: 30
} as const;

export const SEAT = PIT.entry + PIT.vault;

export type Player = { id: PlayerId; name: string; seed: string };
/** Seat order: five players are in when you arrive; you take seat 6. */
export const PLAYERS: Player[] = [
  { id: "kai", name: "kai_calls", seed: "seed-kai-0f3a" },
  { id: "vera", name: "vault_vera", seed: "seed-vera-91c2" },
  { id: "mira", name: "moonmira", seed: "seed-mira-77d1" },
  { id: "omar", name: "omar_odds", seed: "seed-omar-2b8e" },
  { id: "yuki", name: "yes_yuki", seed: "seed-yuki-c4e9" },
  { id: "me", name: "pit_rookie", seed: "seed-rookie-5aa0" },
  { id: "beto", name: "bellbeto", seed: "seed-beto-e1f7" },
  { id: "cam", name: "cam_cutline", seed: "seed-cam-3d62" }
];
export const ME = PLAYERS.find((p) => p.id === "me")!;
export const playerOf = (id: PlayerId) => PLAYERS.find((p) => p.id === id)!;

/** Hidden opening calls (share of the vault), filled at Panta's line at the lock. */
const OPENING_CALLS: Partial<Record<PlayerId, { side: Side; pct: number }>> = {
  me: { side: "YES", pct: 50 },
  kai: { side: "NO", pct: 50 },
  vera: { side: "YES", pct: 50 },
  mira: { side: "YES", pct: 25 },
  omar: { side: "NO", pct: 50 },
  yuki: { side: "YES", pct: 50 },
  beto: { side: "NO", pct: 25 }
};

/** Round 1 trades, in beats after the lock (the "trade" section start). */
const MY_TRADE_REL = 16.6;
const R1_TRADES: Array<[number, PlayerId, Side, number]> = [
  [4.4, "kai", "NO", 3.0],
  [5.1, "vera", "YES", 2.5],
  [5.8, "omar", "NO", 3.0],
  [6.5, "mira", "YES", 4.0],
  [7.3, "cam", "NO", 2.0],
  [9.6, "yuki", "YES", 4.0],
  [10.4, "vera", "YES", 2.5],
  [11.2, "beto", "NO", 1.5],
  [12.0, "mira", "YES", 3.0],
  [MY_TRADE_REL, "me", "YES", 4.5],
  [17.3, "yuki", "YES", 1.0],
  [17.9, "beto", "NO", 1.0],
  [18.5, "mira", "YES", 0.5],
  [19.0, "kai", "NO", 1.0],
  [19.5, "omar", "NO", 1.0]
];

// ── LMSR room book (same maths as lib/room-book.ts) ───────────────────
type Book = { b: number; qYes: number; qNo: number };
const logSumExp = (a: number, b: number) => { const m = Math.max(a, b); return m + Math.log(Math.exp(a - m) + Math.exp(b - m)); };
const cost = (bk: Book) => bk.b * logSumExp(bk.qYes / bk.b, bk.qNo / bk.b);
const prob = (bk: Book) => 1 / (1 + Math.exp((bk.qNo - bk.qYes) / bk.b));
const seed = (cents: number, b: number): Book => { const p = cents / 100; return { b, qYes: b * Math.log(p / (1 - p)), qNo: 0 }; };
function sharesForSpend(bk: Book, side: Side, usdc: number): number {
  const own = side === "YES" ? bk.qYes : bk.qNo;
  const other = side === "YES" ? bk.qNo : bk.qYes;
  const top = cost(bk) + usdc;
  return Math.max(0, top + bk.b * Math.log1p(-Math.exp((other - top) / bk.b)) - own);
}

export type Position = { cash: number; yes: number; no: number; cost: number };
export type TapePoint = { beat: number; cents: number };
export type Fill = {
  beat: number; who: PlayerId; side: Side; usdc: number; shares: number;
  avgCents: number; afterCents: number; opening?: boolean;
};

function buildRound1() {
  const b = Math.max(20, Math.min(5000, PIT.vault * PIT.capacity)); // liquidity = Σ vaults
  const book = seed(PIT.line, b);
  const pos: Record<PlayerId, Position> = Object.fromEntries(
    PLAYERS.map((p) => [p.id, { cash: PIT.vault, yes: 0, no: 0, cost: 0 }])
  ) as Record<PlayerId, Position>;
  const lockBeat = at("trade", 0);
  const fills: Fill[] = [];
  const tape: TapePoint[] = [{ beat: lockBeat, cents: PIT.line }];

  // Opening calls fill at the line and don't move the book.
  for (const p of PLAYERS) {
    const c = OPENING_CALLS[p.id];
    if (!c) continue;
    const stake = Math.floor(PIT.vault * c.pct) / 100;
    const price = c.side === "YES" ? PIT.line : 100 - PIT.line;
    const shares = stake / (price / 100);
    const ps = pos[p.id];
    ps.cash -= stake; ps.cost += stake;
    if (c.side === "YES") ps.yes += shares; else ps.no += shares;
    fills.push({ beat: lockBeat, who: p.id, side: c.side, usdc: stake, shares, avgCents: price, afterCents: PIT.line, opening: true });
  }

  for (const [rel, who, side, usdc] of R1_TRADES) {
    if (usdc <= 0) continue;
    const ps = pos[who];
    const spend = Math.min(usdc, ps.cash);
    const shares = sharesForSpend(book, side, spend);
    if (side === "YES") book.qYes += shares; else book.qNo += shares;
    ps.cash -= spend; ps.cost += spend;
    if (side === "YES") ps.yes += shares; else ps.no += shares;
    const after = Math.round(prob(book) * 1000) / 10;
    const beat = at("trade", rel);
    fills.push({ beat, who, side, usdc: spend, shares, avgCents: Math.round((spend / shares) * 1000) / 10, afterCents: after });
    tape.push({ beat, cents: after });
  }
  return { b, book, pos, fills, tape };
}

export const R1 = buildRound1();

/** Room YES price (¢, one decimal) at an absolute beat during round 1. */
export function r1PriceAt(beat: number): number {
  let c: number = PIT.line;
  for (const t of R1.tape) if (t.beat <= beat) c = t.cents;
  return c;
}

/** Positions as of an absolute beat (fills applied in order). */
export function r1PositionsAt(beat: number): Record<PlayerId, Position> {
  const pos = Object.fromEntries(PLAYERS.map((p) => [p.id, { cash: PIT.vault, yes: 0, no: 0, cost: 0 }])) as Record<PlayerId, Position>;
  for (const f of R1.fills) {
    if (f.beat > beat) break;
    const ps = pos[f.who];
    ps.cash -= f.usdc; ps.cost += f.usdc;
    if (f.side === "YES") ps.yes += f.shares; else ps.no += f.shares;
  }
  return pos;
}

/** The room book as of an absolute beat (round 1). */
export function r1BookAt(beat: number): Book {
  const bk = seed(PIT.line, R1.b);
  for (const f of R1.fills) {
    if (f.opening || f.beat > beat) continue;
    if (f.side === "YES") bk.qYes += f.shares; else bk.qNo += f.shares;
  }
  return bk;
}

/** What `usdc` of `side` buys right now: shares, average fill and the room price after. */
export function quoteBuy(beat: number, side: Side, usdc: number) {
  const bk = r1BookAt(beat);
  if (usdc <= 0) return { shares: 0, avgCents: 0, afterCents: Math.round(prob(bk) * 1000) / 10 };
  const shares = sharesForSpend(bk, side, usdc);
  const after = side === "YES" ? { ...bk, qYes: bk.qYes + shares } : { ...bk, qNo: bk.qNo + shares };
  return { shares, avgCents: (usdc / shares) * 100, afterCents: Math.round(prob(after) * 1000) / 10 };
}

export const vaultValue = (p: Position, yesCents: number) => p.cash + p.yes * (yesCents / 100) + p.no * (1 - yesCents / 100);

/** Round 1 settles at the room's average over its closing window (last 20%). */
export const R1_SETTLE = (() => {
  const len = section("trade").endBeat - section("trade").startBeat;
  const from = at("trade", len * 0.8);
  const to = at("trade", len);
  let acc = 0;
  let prev = from;
  let c = r1PriceAt(from);
  for (const t of R1.tape) {
    if (t.beat <= from) continue;
    acc += c * (t.beat - prev);
    prev = t.beat; c = t.cents;
  }
  acc += c * (to - prev);
  return Math.round(acc / (to - from));
})();

export type Standing = { id: PlayerId; vault: number; pnl: number; side: Side | null; out: boolean };

export function rank(values: Array<{ id: PlayerId; vault: number; side: Side | null; out?: boolean }>): Standing[] {
  return values
    .map((v) => ({ id: v.id, vault: v.vault, pnl: v.vault - PIT.vault, side: v.side, out: !!v.out }))
    .sort((a, b) => (a.out === b.out ? b.vault - a.vault : a.out ? 1 : -1));
}

export function r1StandingsAt(beat: number, settled = false): Standing[] {
  const pos = r1PositionsAt(beat);
  const price = settled ? R1_SETTLE : r1PriceAt(beat);
  return rank(PLAYERS.map((p) => {
    const ps = pos[p.id];
    const side: Side | null = ps.yes > 0 ? "YES" : ps.no > 0 ? "NO" : null;
    return { id: p.id, vault: Math.round(vaultValue(ps, price) * 100) / 100, side };
  }));
}

export const R1_FINAL = r1StandingsAt(section("trade").endBeat, true);
export const SURVIVORS = Math.ceil(PIT.capacity / 2);
export const R1_SURVIVORS = R1_FINAL.slice(0, SURVIVORS).map((s) => s.id);
export const R1_CUT = R1_FINAL.slice(SURVIVORS).map((s) => s.id);
export const CUT_LINE_VAULT = R1_FINAL[SURVIVORS - 1].vault;

/** Round 2 (time-lapsed on screen): the book re-opens at R1's settlement. */
export const R2 = {
  open: R1_SETTLE,
  oracle: { yes: 64, panta: 74, momentum: 3, roomYesShare: 0.52, bell: "4:21" },
  settle: 71,
  /** Survivors' final vaults after round 2 (example values). */
  finals: { me: 12.86, vera: 11.04, mira: 10.12, yuki: 9.47 } as Partial<Record<PlayerId, number>>
};

export const FINAL: Standing[] = (() => {
  const survivors = rank(R1_SURVIVORS.map((id) => ({ id, vault: R2.finals[id] ?? 0, side: "YES" as Side })));
  const cut = R1_FINAL.slice(SURVIVORS).map((s) => ({ ...s, out: true }));
  return [...survivors, ...cut];
})();

// Payouts — the same integer micro-USDC rules as lib/royale.ts.
export const POOL = PIT.entry * PIT.capacity;
export const POT = (PIT.entry + PIT.vault) * PIT.capacity;
export const SPLIT = [0.625, 0.234375, 0.140625];
export const PRIZES: Partial<Record<PlayerId, number>> = (() => {
  const pool = Math.round(POOL * 1e6);
  const ids = FINAL.filter((s) => !s.out).slice(0, 3).map((s) => s.id);
  const out: Partial<Record<PlayerId, number>> = {};
  let assigned = 0;
  for (let i = 1; i < ids.length; i++) { const part = Math.floor(pool * SPLIT[i]); out[ids[i]] = part / 1e6; assigned += part; }
  out[ids[0]] = (pool - assigned) / 1e6;
  return out;
})();
export const PAYOUTS: Record<PlayerId, number> = (() => {
  const pot = Math.round(POT * 1e6);
  const prizes = FINAL.map((s) => Math.floor((PRIZES[s.id] ?? 0) * 1e6));
  const vaultPot = pot - prizes.reduce((a, b) => a + b, 0);
  const weights = FINAL.map((s) => Math.max(0, s.vault));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor(vaultPot * (w / wsum)));
  shares[weights.indexOf(Math.max(...weights))] += vaultPot - shares.reduce((a, b) => a + b, 0);
  return Object.fromEntries(FINAL.map((s, i) => [s.id, (prizes[i] + shares[i]) / 1e6])) as Record<PlayerId, number>;
})();
export const MY_GROSS = Math.round(PAYOUTS.me * 100) / 100;
export const MY_FEE = Math.floor(Math.round(PAYOUTS.me * 1e6) * PIT.claimFeeBps / 10_000) / 1e6;
export const MY_NET = Math.round((PAYOUTS.me - MY_FEE) * 100) / 100;
export const USDC_AFTER = PIT.usdcBefore - SEAT + MY_NET;

// ─────────────────────────────────────────────────────────────────────
// Cues — what happens on which beat. `sfx` cues are rendered to audio.
// ─────────────────────────────────────────────────────────────────────

export type Sfx =
  | "tap" | "key" | "fill" | "tradeUp" | "tradeDown" | "tick" | "sting" | "bell"
  | "chime" | "notify" | "whoosh" | "pop" | "impact" | "lock" | "coins" | "riser" | "swish";

export type Cue = { id: string; beat: number; sfx?: Sfx; gain?: number; pan?: number; pitch?: number };

const CUES: Cue[] = [];
function cue(id: string, beat: number, sfx?: Sfx, opts: { gain?: number; pan?: number; pitch?: number } = {}) {
  CUES.push({ id, beat, sfx, ...opts });
}

// Hook — the cover is frame 0; on "solo sport" the room empties out.
cue("intro.hit", at("intro", 0), "impact", { gain: 0.8 });
cue("intro.lonely", vo("hook-2", 0.15), "swish", { gain: 0.35 });
cue("intro.out", at("problem") - 0.6, "whoosh", { gain: 0.7 });

// The problem — three cards, one per line
cue("problem.card1", vo("problem-1") - 0.1, "pop", { gain: 0.45, pitch: 0.9 });
cue("problem.card2", vo("problem-2") - 0.1, "pop", { gain: 0.45, pitch: 1.0 });
cue("problem.card3", vo("problem-3") - 0.1, "pop", { gain: 0.45, pitch: 1.12 });
cue("problem.out", at("solution") - 0.5, "riser", { gain: 0.6 });

// The Pit — logo, the two layers, the four steps
cue("solution.hit", at("solution", 0), "impact", { gain: 0.85 });
cue("solution.layer1", vo("solution-1", 0.2), "tick", { gain: 0.5, pitch: 1.0 });
cue("solution.layer2", vo("solution-1", 0.78), "tick", { gain: 0.5, pitch: 0.9 });
cue("solution.step1", vo("solution-2", 0.0), "pop", { gain: 0.4, pitch: 1.0 });
cue("solution.step2", vo("solution-2", 0.24), "pop", { gain: 0.4, pitch: 1.08 });
cue("solution.step3", vo("solution-2", 0.45), "pop", { gain: 0.4, pitch: 1.16 });
cue("solution.step4", vo("solution-2", 0.69), "pop", { gain: 0.4, pitch: 1.26 });

// Who it's for
cue("audience.card1", vo("audience-1", 0.02), "pop", { gain: 0.4, pitch: 1.0 });
cue("audience.card2", vo("audience-1", 0.5), "pop", { gain: 0.4, pitch: 1.12 });
cue("audience.card3", vo("audience-1", 0.8), "pop", { gain: 0.4, pitch: 1.26 });
cue("audience.out", at("signin") - 0.5, "whoosh", { gain: 0.6 });

// 01 · Sign in with X → the live pits directory
cue("signin.tap", vo("signin-1", 0.28), "tap");
cue("signin.done", vo("signin-1", 0.55), "notify");
cue("signin.scroll", vo("signin-2") - 0.6, "swish", { gain: 0.5 });
cue("signin.ring", vo("signin-2", 0.6), "pop", { gain: 0.5, pitch: 1.2 });
cue("signin.takeSeat", at("seat") - 1.2, "tap");

// 02 · Take a seat — entry + vault into escrow, hidden call
cue("seat.enter", at("seat", 1.2), "tap");
cue("seat.modal", at("seat", 1.7), "swish", { gain: 0.5 });
cue("seat.yes", at("seat", 3.0), "tap");
cue("seat.entry", vo("seat-1", 0.4));
cue("seat.vault", vo("seat-1", 0.78));
cue("seat.deposit", vo("seat-2") + 0.2, "tap");
cue("seat.sheet", vo("seat-2") + 0.7, "swish", { gain: 0.45 });
cue("seat.approve", vo("seat-2", 0.28), "tap");
cue("seat.confirming", vo("seat-2", 0.33), "tick", { gain: 0.6 });
cue("seat.seated", vo("seat-2", 0.52), "notify");
cue("seat.join7", vo("seat-2", 0.85), "pop", { gain: 0.5, pitch: 1.1 });
cue("seat.join8", at("trade") - 1.4, "pop", { gain: 0.5, pitch: 1.25 });

// 03 · Lock at Panta's line, trade live
cue("trade.lock", at("trade", 0), "lock");
cue("trade.lockNote", at("trade", 0.5), "notify", { gain: 0.6 });
for (const f of R1.fills) {
  if (f.opening || f.who === "me") continue;
  cue(`trade.fill.${f.beat}`, f.beat, f.side === "YES" ? "tradeUp" : "tradeDown", { gain: 0.5, pan: f.side === "YES" ? 0.25 : -0.25 });
}
cue("trade.focus", at("trade", 13.9), "tap");
const STAKE_KEYS = ["4", ".", "5", "0"];
STAKE_KEYS.forEach((_, i) => cue(`trade.key.${i}`, at("trade", 14.5 + i * 0.25), "key", { pitch: 1 + i * 0.04 }));
cue("trade.buy", at("trade", MY_TRADE_REL - 0.5), "tap");
cue("trade.myFill", at("trade", MY_TRADE_REL), "fill");
export const STAKE_TEXT = STAKE_KEYS.join("");

// 04 · Royale — the cut, carry-forward, the Oracle read
cue("cut.t3", at("cut", 0.5), "tick", { gain: 0.7 });
cue("cut.t2", at("cut", 1.5), "tick", { gain: 0.7 });
cue("cut.t1", at("cut", 2.5), "tick", { gain: 0.8 });
cue("cut.settle", at("cut", 3.5), "riser", { gain: 0.6 });
cue("cut.sting", at("cut", 4), "sting");
cue("cut.regroup", vo("cut-1", 0.55), "swish", { gain: 0.5 });
cue("cut.round2", vo("cut-1", 0.62), "notify", { gain: 0.7 });
cue("cut.oracle", vo("cut-2") - 0.2, "notify");

// 05 · The bell
cue("bell.ring", at("bell", 0), "bell");
cue("bell.split1", vo("bell-2", 0.05), "chime", { pitch: 1 });
cue("bell.split2", vo("bell-2", 0.4), "chime", { pitch: 0.84 });
cue("bell.split3", vo("bell-2", 0.75), "chime", { pitch: 0.75 });

// 06 · Payout — your own signature
cue("payout.withdraw", vo("payout-1", 0.12), "tap");
cue("payout.sheet", vo("payout-1", 0.16), "swish", { gain: 0.45 });
cue("payout.approve", vo("payout-1", 0.42), "tap");
cue("payout.done", vo("payout-1", 0.5), "coins");
cue("payout.guard", vo("payout-1", 0.62), "pop", { gain: 0.4, pitch: 0.95 });

// 07 · Host & creator mode
cue("host.next", at("host", 0.3), "tap");
cue("host.panta", vo("host-1", 0.34), "tap");
cue("host.pick", vo("host-1", 0.5), "tap");
cue("host.create", vo("host-1", 0.74), "tap");
cue("host.kit", vo("host-2") - 0.4, "swish", { gain: 0.45 });
cue("host.copy", vo("host-2", 0.55), "tap");
cue("host.copied", vo("host-2", 0.6), "notify", { gain: 0.6 });
cue("host.overlay", vo("host-2", 0.7), "whoosh", { gain: 0.7 });

// Under the hood
cue("tech.in", at("tech") - 0.4, "whoosh", { gain: 0.6 });
cue("tech.panta", vo("tech-1", 0.3), "tick", { gain: 0.5, pitch: 1.0 });
cue("tech.markets", vo("tech-1", 0.55), "pop", { gain: 0.35, pitch: 1.0 });
cue("tech.line", vo("tech-1", 0.72), "pop", { gain: 0.35, pitch: 1.1 });
cue("tech.resolution", vo("tech-1", 0.88), "pop", { gain: 0.35, pitch: 1.2 });
cue("tech.book", vo("tech-2", 0.05), "tick", { gain: 0.5, pitch: 1.1 });
cue("tech.escrow", vo("tech-2", 0.45), "tick", { gain: 0.5, pitch: 0.95 });
cue("tech.guarantee", vo("tech-2", 0.7), "chime", { gain: 0.45, pitch: 1.0 });

// Formats & fees
cue("formats.card1", at("formats", 0.6), "pop", { gain: 0.4, pitch: 1.0 });
cue("formats.card2", at("formats", 1.1), "pop", { gain: 0.4, pitch: 1.08 });
cue("formats.card3", at("formats", 1.6), "pop", { gain: 0.4, pitch: 1.16 });
cue("formats.card4", at("formats", 2.1), "pop", { gain: 0.4, pitch: 1.26 });
cue("formats.fees", vo("formats-1", 0.45), "tick", { gain: 0.5 });

// Close — the three words land on the voice
cue("outro.hit", at("outro", 0), "impact");
cue("outro.host", vo("outro-1", 0.36), "tick", { gain: 0.7, pitch: 1 });
cue("outro.trade", vo("outro-1", 0.6), "tick", { gain: 0.7, pitch: 1.12 });
cue("outro.split", vo("outro-1", 0.82), "tick", { gain: 0.7, pitch: 1.26 });
cue("outro.cta", vo("outro-2") - 0.1, "chime", { gain: 0.6, pitch: 1 });

export { CUES };

export function cueBeat(id: string): number {
  const c = CUES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown cue: ${id}`);
  return c.beat;
}
export const cueFrame = (id: string): number => beatToFrame(cueBeat(id));
