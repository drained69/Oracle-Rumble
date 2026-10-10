import { useCurrentFrame } from "remotion";
import { frameToBeat } from "./timeline";

/** Current absolute beat (fractional). */
export const useBeat = (): number => frameToBeat(useCurrentFrame());

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp(t), 3);
export const easeInOutCubic = (t: number) => { const x = clamp(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - clamp(t), 5);
export const easeInOutQuint = (t: number) => { const x = clamp(t); return x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2; };
/** Overshoot ease for pops. */
export const easeOutBack = (t: number, s = 1.70158) => { const x = clamp(t) - 1; return 1 + (s + 1) * x * x * x + s * x * x; };

/** 0→1 progress of a span that starts at `start` (beats) and lasts `dur` beats. */
export const prog = (beat: number, start: number, dur: number, ease: (t: number) => number = easeOutCubic) =>
  dur <= 0 ? (beat >= start ? 1 : 0) : ease(clamp((beat - start) / dur));

/** Fade in at `a`, fade out at `b` (each over `d` beats). */
export const window01 = (beat: number, a: number, b: number, d = 0.35) =>
  Math.min(prog(beat, a, d), 1 - prog(beat, b - d, d));

/** Smoothly interpolate between keyframes [{beat, value}] with an ease per segment. */
export function keyframes(beat: number, keys: Array<[number, number]>, ease: (t: number) => number = easeInOutCubic): number {
  if (beat <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [b0, v0] = keys[i];
    const [b1, v1] = keys[i + 1];
    if (beat <= b1) return lerp(v0, v1, ease((beat - b0) / Math.max(1e-6, b1 - b0)));
  }
  return keys[keys.length - 1][1];
}

/** Count a number up from `from` to `to` over a span. */
export const countUp = (beat: number, start: number, dur: number, from: number, to: number) =>
  lerp(from, to, prog(beat, start, dur, easeOutQuint));

export const usd2 = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const clock = (sec: number) => { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Deterministic pseudo-random in [0,1) from a number. */
export const hash01 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
