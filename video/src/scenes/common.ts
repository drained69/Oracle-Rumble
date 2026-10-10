import { clock, keyframes, lerp, prog } from "../anim";
import {
  CUT_LINE_VAULT, FINAL, PIT, PLAYERS, PRIZES, R1, R1_CUT, R1_SETTLE, R1_SURVIVORS, R2, SURVIVORS, at, cueBeat, playerOf,
  r1StandingsAt, section, type PlayerId, type Standing
} from "../timeline";
import type { FeedItem } from "../ui/pit/Feed";
import { pinFor, type Pod, type PodState } from "../ui/pit/Stage";

const name = (id: PlayerId) => playerOf(id).name;

// ── Clocks (time-lapsed; seconds shown on screen) ─────────────────────
export function lockSecAt(beat: number): number {
  if (beat < at("seat")) return keyframes(beat, [[at("signin"), 91], [at("seat"), 79]], (t) => t);
  return keyframes(beat, [[at("seat"), 40], [at("trade") - 0.25, 1]], (t) => t);
}
export function settleSecAt(beat: number): number {
  if (beat < at("cut")) return keyframes(beat, [[at("trade"), 299], [at("cut"), 38]], (t) => t);
  return keyframes(beat, [[at("cut"), 4], [at("cut", 3.5), 0]], (t) => t);
}
export const r2SecAt = (beat: number) => keyframes(beat, [[cueBeat("cut.round2"), 299], [at("bell"), 261]], (t) => t);
export { clock };

// ── Activity feed lines (wording from lib/royale.ts + app/api/round/trade) ──
export function enrollFeed(): FeedItem[] {
  const pre = PLAYERS.slice(0, 5);
  const items: FeedItem[] = [{ id: "opened", text: "Round 1 opened for enrollment.", kind: "round", born: -10, ago: "2m" }];
  pre.forEach((p, i) => items.push({ id: `enter-${p.id}`, text: `${p.name} entered (${i + 1}/${PIT.capacity}).`, kind: "info", born: -9 + i, ago: `${5 - i}0s` }));
  items.push({ id: "enter-me", text: `${name("me")} entered (6/${PIT.capacity}).`, kind: "info", born: cueBeat("seat.seated") });
  items.push({ id: "enter-beto", text: `${name("beto")} entered (7/${PIT.capacity}).`, kind: "info", born: cueBeat("seat.join7") });
  items.push({ id: "enter-cam", text: `${name("cam")} entered (8/${PIT.capacity}).`, kind: "info", born: cueBeat("seat.join8") });
  return items;
}

export function tradeFeed(): FeedItem[] {
  const lock = at("trade");
  const items: FeedItem[] = [
    { id: "line", text: `Panta's line opened at ${PIT.line}¢ YES — the room trades its own odds from here.`, kind: "round", born: lock + 0.1 }
  ];
  R1.fills.filter((f) => f.opening).slice(0, 4).forEach((f, i) => items.push({
    id: `open-${f.who}`, text: `${name(f.who)} bought ${f.side} $${f.usdc.toFixed(2)} at ${f.avgCents}¢ (opening call).`, kind: "trade", born: lock + 0.3 + i * 0.12
  }));
  R1.fills.filter((f) => !f.opening).forEach((f) => items.push({
    id: `fill-${f.beat}`, text: `${name(f.who)} bought ${f.side} $${f.usdc.toFixed(2)} at ${f.avgCents.toFixed(1)}¢ — room now ${Math.round(f.afterCents)}¢ YES.`, kind: "trade", born: f.beat
  }));
  return items;
}

export function cutFeed(): FeedItem[] {
  const s = cueBeat("cut.sting");
  const items: FeedItem[] = [
    { id: "settle", text: `Settlement price ${R1_SETTLE}¢ YES — the room's average over the final ${PIT.closingMin} min.`, kind: "round", born: s - 0.4 },
    { id: "settled", text: `Round 1 settled — ${R1_SURVIVORS.length} advance, ${R1_CUT.length} eliminated.`, kind: "round", born: s }
  ];
  R1_CUT.forEach((id, i) => items.push({ id: `elim-${id}`, text: `${name(id)} was eliminated`, kind: "elim", born: s + 0.3 + i * 0.25 }));
  items.push({ id: "r2", text: "Round 2 begins", kind: "round", born: cueBeat("cut.round2") });
  items.push({ id: "r2open", text: `Panta's line opened at ${R2.open}¢ YES — the room trades its own odds from here.`, kind: "round", born: cueBeat("cut.round2") + 0.4 });
  return items;
}

// ── Pods ──────────────────────────────────────────────────────────────
const lerpPos = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Enrolling stage: players in seat order, re-pinned as each seat fills. */
export function enrollPods(beat: number, m: boolean): Pod[] {
  const joins: Array<[PlayerId, number]> = [
    ["kai", -99], ["vera", -99], ["mira", -99], ["omar", -99], ["yuki", -99],
    ["me", cueBeat("seat.seated")], ["beto", cueBeat("seat.join7")], ["cam", cueBeat("seat.join8")]
  ];
  const seated = joins.filter(([, b]) => b <= beat);
  const last = seated[seated.length - 1][1];
  const k = prog(beat, last, 0.5);
  const ry = m ? 38 : 37; const rx = m ? 38 : 41;
  return seated.map(([id, b], i) => {
    const now = pinFor(i, seated.length, rx, ry);
    const before = pinFor(i, Math.max(1, seated.length - (b === last ? 0 : 1)), rx, ry);
    const pos = b === last ? now : lerpPos(before, now, k);
    const pop = prog(beat, b, 0.45);
    return {
      key: id, name: name(id), seed: playerOf(id).seed, rank: `#${i + 1}`, bank: PIT.vault, pnl: 0, side: null,
      state: "ready" as PodState, x: pos.x, y: pos.y, me: id === "me", scale: b > -50 ? 0.6 + 0.4 * pop : 1, opacity: b > -50 ? pop : 1
    };
  });
}

/** Live round 1 with the survival cut drawn. */
export function liveR1Pods(beat: number, m: boolean, settled = false): { pods: Pod[]; standings: Standing[] } {
  const st = r1StandingsAt(beat, settled);
  const lastFill = [...R1.fills].reverse().find((f) => f.beat <= beat && !f.opening);
  const before = lastFill ? r1StandingsAt(lastFill.beat - 0.01, settled) : st;
  const k = lastFill ? prog(beat, lastFill.beat, 0.6) : 1;
  const ry = m ? 38 : 37; const rx = m ? 38 : 41;
  const pods = st.map((s, i) => {
    const j = before.findIndex((b) => b.id === s.id);
    const pos = lerpPos(pinFor(j < 0 ? i : j, st.length, rx, ry), pinFor(i, st.length, rx, ry), k);
    const state: PodState = i < SURVIVORS - 1 ? "safe" : i === SURVIVORS - 1 ? "line" : "below";
    const pulse = lastFill && lastFill.who === s.id ? 1 - prog(beat, lastFill.beat, 1) : 0;
    return { key: s.id, name: name(s.id), seed: playerOf(s.id).seed, rank: `#${i + 1}`, bank: s.vault, pnl: s.pnl, side: s.side, state, x: pos.x, y: pos.y, me: s.id === "me", pulse };
  });
  return { pods, standings: st };
}

/** The cut: the bottom half drops out, survivors re-form around the orb for round 2. */
export function cutPods(beat: number, m: boolean): Pod[] {
  const sting = cueBeat("cut.sting");
  const regroup = cueBeat("cut.regroup");
  const ry = m ? 38 : 37; const rx = m ? 38 : 41;
  const st = r1StandingsAt(section("trade").endBeat, true);
  const r2 = prog(beat, regroup, 0.8);
  return st.map((s, i) => {
    const out = i >= SURVIVORS;
    const from = pinFor(i, st.length, rx, ry);
    const surv = R1_SURVIVORS.indexOf(s.id);
    if (out) {
      const d = prog(beat, sting + (i - SURVIVORS) * 0.18, 0.9, (t) => t * t);
      const shown = beat >= sting;
      return {
        key: s.id, name: name(s.id), seed: playerOf(s.id).seed, rank: shown ? "OUT" : `#${i + 1}`, bank: s.vault, pnl: s.pnl, side: s.side,
        state: (shown ? "eliminated" : "below") as PodState, x: from.x, y: from.y, dy: d * (m ? 140 : 190), opacity: 1 - d, scale: 1 - d * 0.25, me: false
      };
    }
    const to = pinFor(surv, SURVIVORS, 36, ry * 0.95);
    const pos = lerpPos(from, to, r2);
    const state: PodState = beat < sting ? (i === SURVIVORS - 1 ? "line" : "safe") : "safe";
    return {
      key: s.id, name: name(s.id), seed: playerOf(s.id).seed, rank: `#${i + 1}`, bank: s.vault, pnl: s.pnl, side: beat < regroup ? s.side : null,
      state, x: pos.x, y: pos.y, me: s.id === "me", pulse: s.id === "me" ? 1 - prog(beat, regroup + 0.4, 1.2) : 0
    };
  });
}

/** Final standings around the orb, the champion in gold. */
export function finalPods(beat: number, m: boolean): Pod[] {
  const ry = m ? 38 : 37;
  const alive = FINAL.filter((s) => !s.out);
  return alive.map((s, i) => {
    const pos = pinFor(i, alive.length, 36, ry * 0.95);
    const win = i === 0 && beat >= cueBeat("bell.ring");
    return {
      key: s.id, name: name(s.id), seed: playerOf(s.id).seed, rank: `#${i + 1}`, bank: s.vault, pnl: s.vault - PIT.vault, side: null,
      state: (win ? "winner" : "safe") as PodState, x: pos.x, y: pos.y, me: s.id === "me"
    };
  });
}

export const cutLegend = () => `Top ${SURVIVORS} of ${PIT.capacity} survive · line $${CUT_LINE_VAULT.toFixed(2)}`;
export const CUT_ANGLE = -90 + ((SURVIVORS - 0.5) / PIT.capacity) * 360;
export const champPrize = () => `+$${(PRIZES.me ?? 0).toFixed(2)} prize`;

/** Where the room's money sits at a beat. */
export function moneyAt(beat: number, yesCents: number) {
  if (beat < at("trade")) return { yesShare: null as number | null, longYes: 0, longNo: 0, flat: 0 };
  let yv = 0, nv = 0, ly = 0, ln = 0, fl = 0;
  const pos = (() => { const p: Record<string, { yes: number; no: number }> = {}; for (const pl of PLAYERS) p[pl.id] = { yes: 0, no: 0 }; for (const f of R1.fills) { if (f.beat > beat) break; if (f.side === "YES") p[f.who].yes += f.shares; else p[f.who].no += f.shares; } return p; })();
  for (const pl of PLAYERS) {
    const p = pos[pl.id];
    if (p.yes > 0) { ly++; yv += p.yes * (yesCents / 100); } else if (p.no > 0) { ln++; nv += p.no * (1 - yesCents / 100); } else fl++;
  }
  return { yesShare: yv + nv > 0 ? yv / (yv + nv) : null, longYes: ly, longNo: ln, flat: fl };
}
