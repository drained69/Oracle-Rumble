/**
 * Every on-screen reveal in the pitch film and the sound that goes with it.
 *
 * PitchFilm reads the beats in `T`; scripts/build-pitch-audio.ts reads `CUES`.
 * Both come from the measured narration (via `vo()`), so if a line is
 * re-recorded the picture and the sound move with it.
 */
import type { Sfx } from "../timeline";
import { at, section, vo, type SectionId } from "./timeline";

export type { Sfx };
export type Cue = { id: string; beat: number; sfx?: Sfx; gain?: number; pan?: number; pitch?: number };

/** The ten public projects since July, in order (month, name, one-liner). */
export const PROJECTS: { m: "Jul" | "Aug" | "Sep" | "Oct"; name: string; what: string; star?: boolean }[] = [
  { m: "Jul", name: "Legwork", what: "job-market intelligence" },
  { m: "Aug", name: "Tacit", what: "confidential treasury", star: true },
  { m: "Aug", name: "DegenLens", what: "verifiable on-chain intel" },
  { m: "Aug", name: "Sotto", what: "private wealth" },
  { m: "Sep", name: "Covenant", what: "reputation-backed prediction market", star: true },
  { m: "Sep", name: "TaxPilot", what: "deterministic tax engine", star: true },
  { m: "Sep", name: "Praetor", what: "agent coordination" },
  { m: "Sep", name: "NIGHTWATCH AI", what: "trading research desk" },
  { m: "Sep", name: "The Pit", what: "social prediction markets" },
  { m: "Oct", name: "GrowthOS", what: "autonomous growth operator" },
];
/** Chains those projects run on. */
export const CHAINS = ["Solana", "Flare", "Starknet", "Somnia", "Base", "Arc"];
const CHIP_STEP = 0.36;

export const T = {
  // Intro: the speaker, then the product in one line
  name: vo("intro-1") - 0.15,
  pitName: vo("intro-2", 0.26),
  tagline: vo("intro-2", 0.36),
  // 01 · Who I am
  finance: vo("who-1", 0.0),
  risk: vo("who-1", 0.42),
  incentives: vo("who-1", 0.5),
  custody: vo("who-1", 0.68),
  security: vo("who-2", 0.0),
  readCode: vo("who-2", 0.6),
  breaks: vo("who-2", 0.82),
  builder: vo("who-3", 0.0),
  // 02 · What I've shipped
  chips: vo("ship-1", 0.08),
  chipStep: CHIP_STEP,
  covenant: vo("ship-2", 0.02),
  tacit: vo("ship-2", 0.42),
  taxpilot: vo("ship-2", 0.7),
  chains: vo("ship-3", 0.0),
  provable: vo("ship-3", 0.84),
  // 03 · The problem
  solo: vo("problem-1", 0.05),
  soloWord: vo("problem-1", 0.74),
  bubbles: [0.04, 0.28, 0.52, 0.74].map((f) => vo("problem-2", f)),
  noWay: vo("problem-3", 0.08),
  // 04 · The Pit
  fixes: at("pit", 0),
  step1: vo("pit-1", 0.32),
  panta: vo("pit-1", 0.7),
  step2: vo("pit-2", 0.06),
  step3: vo("pit-2", 0.28),
  escrow: vo("pit-2", 0.47),
  step4: vo("pit-2", 0.7),
  cut: vo("pit-3", 0.22),
  bell: vo("pit-3", 0.47),
  split: vo("pit-3", 0.64),
  // 05 · Why me
  format: vo("why-1", 0.1),
  formatItems: [0.43, 0.55, 0.74, 0.87].map((f) => vo("why-1", f)),
  escrowCol: vo("why-2", 0.0),
  shields: [vo("why-2", 0.28), vo("why-2", 0.41), vo("why-2", 0.71), vo("why-3", 0.42)],
  quote: vo("why-4") - 0.5,
  // Close
  live: vo("close-1", 0.05),
  url: vo("close-1", 0.55),
  qr: vo("close-1", 0.72),
  thanks: vo("close-2", 0.0),
  end: section("close").endBeat,
};

const CUES: Cue[] = [];
function cue(id: string, beat: number, sfx?: Sfx, opts: { gain?: number; pan?: number; pitch?: number } = {}) {
  CUES.push({ id, beat, sfx, ...opts });
}

// Section changes
for (const s of ["who", "ship", "problem", "why", "close"] as SectionId[]) cue(`${s}.in`, at(s) - 0.5, "whoosh", { gain: 0.5 });

// Intro
cue("intro.name", T.name, "pop", { gain: 0.42, pitch: 1.0 });
cue("intro.pit", T.pitName, "chime", { gain: 0.5, pitch: 1.0 });

// 01 · Who I am
cue("who.finance", T.finance - 0.1, "pop", { gain: 0.4, pitch: 1.0 });
[T.risk, T.incentives, T.custody].forEach((b, i) => cue(`who.fin${i}`, b, "tick", { gain: 0.32, pitch: 1 + i * 0.08 }));
cue("who.security", T.security - 0.1, "pop", { gain: 0.4, pitch: 1.1 });
cue("who.read", T.readCode, "key", { gain: 0.6 });
cue("who.breaks", T.breaks, "tradeDown", { gain: 0.35 });
cue("who.builder", T.builder - 0.1, "pop", { gain: 0.42, pitch: 1.22 });

// 02 · What I've shipped
PROJECTS.forEach((_, i) => cue(`ship.chip${i}`, T.chips + i * CHIP_STEP, "tick", { gain: 0.28, pitch: 0.9 + i * 0.035, pan: -0.4 + (i / 9) * 0.8 }));
cue("ship.covenant", T.covenant, "pop", { gain: 0.42, pitch: 1.0 });
cue("ship.tacit", T.tacit, "pop", { gain: 0.42, pitch: 1.1 });
cue("ship.taxpilot", T.taxpilot, "pop", { gain: 0.42, pitch: 1.2 });
cue("ship.chains", T.chains, "swish", { gain: 0.35 });
cue("ship.provable", T.provable, "chime", { gain: 0.5, pitch: 1.0 });

// 03 · The problem
cue("problem.solo", T.solo, "pop", { gain: 0.35, pitch: 0.85 });
T.bubbles.forEach((b, i) => cue(`problem.bubble${i}`, b, "notify", { gain: 0.38, pitch: 1 + i * 0.06, pan: i % 2 ? 0.35 : -0.35 }));
cue("problem.noWay", T.noWay, "swish", { gain: 0.4 });

// 04 · The Pit (the music lands an impact on the downbeat)
[T.step1, T.step2, T.step3, T.step4].forEach((b, i) => cue(`pit.step${i}`, b, "pop", { gain: 0.4, pitch: 1 + i * 0.08 }));
cue("pit.escrow", T.escrow, "lock", { gain: 0.8 });
cue("pit.trade", T.step4 + 0.35, "fill", { gain: 0.6 });
cue("pit.cut", T.cut, "sting", { gain: 0.75 });
cue("pit.bell", T.bell, "bell", { gain: 0.8 });
[1, 0.84, 0.75].forEach((p, i) => cue(`pit.split${i}`, T.split + i * 0.45, "chime", { gain: 0.5, pitch: p }));
cue("pit.coins", T.split + 1.6, "coins", { gain: 0.55 });

// 05 · Why me
cue("why.format", T.format, "pop", { gain: 0.4, pitch: 1.0 });
T.formatItems.forEach((b, i) => cue(`why.item${i}`, b, "tick", { gain: 0.32, pitch: 1 + i * 0.07 }));
cue("why.escrow", T.escrowCol, "pop", { gain: 0.4, pitch: 1.1 });
T.shields.forEach((b, i) => cue(`why.shield${i}`, b, i === 0 ? "lock" : "pop", i === 0 ? { gain: 0.7 } : { gain: 0.4, pitch: 1.05 + i * 0.07 }));
cue("why.quote", T.quote, "swish", { gain: 0.45 });

// Close
cue("close.live", T.live, "pop", { gain: 0.4, pitch: 1.1 });
cue("close.url", T.url, "notify", { gain: 0.5 });
cue("close.qr", T.qr, "pop", { gain: 0.4, pitch: 1.25 });
cue("close.thanks", T.thanks + 0.2, "chime", { gain: 0.45, pitch: 0.84 });

CUES.sort((a, b) => a.beat - b.beat);
export { CUES };
