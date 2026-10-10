/**
 * Writes public/soundtrack.wav — an original score plus every interface sound,
 * synthesised from scratch (nothing to license). All timing comes from
 * src/timeline.ts, the same file that times the picture.
 *
 *   npx tsx scripts/build-audio.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEATS_PER_BAR, BPM, CUES, DURATION_SECONDS, SECTIONS, TOTAL_BARS, VO, beatToSeconds, type Cue, type SectionId } from "../src/timeline";

const SR = 48_000;
const N = Math.ceil(DURATION_SECONDS * SR);
const SPB = 60 / BPM; // seconds per beat
const TAU = Math.PI * 2;

// ── buses ─────────────────────────────────────────────────────────────
const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const music = bus();
const sfx = bus();
const verbSend = bus();
const delaySend = bus();
const voice1 = new Float32Array(N); // narration (mono)

// Deterministic noise.
let seedState = 0x9e3779b9;
const rnd = () => { seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0; let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const panGains = (p: number) => { const a = (Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; };

/** Add a mono voice into a bus. `fn(t, i)` returns the sample at time t (s) after `start`. */
function voice(b: { L: Float32Array; R: Float32Array }, start: number, dur: number, fn: (t: number, i: number) => number, gain = 1, pan = 0, send = 0, dsend = 0) {
  const [gl, gr] = panGains(pan);
  const i0 = Math.max(0, Math.round(start * SR));
  const n = Math.round(dur * SR);
  for (let i = 0; i < n; i++) {
    const k = i0 + i;
    if (k >= N) break;
    const s = fn(i / SR, i) * gain;
    b.L[k] += s * gl; b.R[k] += s * gr;
    if (send) { verbSend.L[k] += s * gl * send; verbSend.R[k] += s * gr * send; }
    if (dsend) { delaySend.L[k] += s * gl * dsend; delaySend.R[k] += s * gr * dsend; }
  }
}

// ── filters ───────────────────────────────────────────────────────────
class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  set(type: "lp" | "hp" | "bp", f: number, q = 0.707) {
    const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0: number, b1: number, b2: number;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; }
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
    return this;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// PolyBLEP saw for clean synth tones.
function makeSaw(freq: number, phase0 = rnd()) {
  let ph = phase0;
  const dt = freq / SR;
  return () => {
    ph += dt; if (ph >= 1) ph -= 1;
    let v = 2 * ph - 1;
    if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
    else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
    return v;
  };
}

// ── score ─────────────────────────────────────────────────────────────
type Chord = { root: number; notes: number[] };
const FM: Chord = { root: 41, notes: [53, 56, 60, 63] };   // F minor 7
const DB: Chord = { root: 37, notes: [49, 53, 56, 60] };   // D♭ maj7
const AB: Chord = { root: 44, notes: [56, 60, 63, 67] };   // A♭ maj7
const EB: Chord = { root: 39, notes: [51, 55, 58, 65] };   // E♭ add9
// One chord per bar, chosen by section mood.
const LOOP: Chord[] = [FM, DB, AB, EB];
const DARK: Chord[] = [FM, FM, DB, EB];
const secAt = (bar: number) => SECTIONS.find((x) => bar >= x.startBar && bar < x.startBar + x.bars)!;
const CHORDS: Chord[] = Array.from({ length: TOTAL_BARS }, (_, bar) => {
  const sec = secAt(bar);
  const k = bar - sec.startBar;
  if (sec.id === "problem" || sec.id === "intro") return DARK[k % 4];
  if (sec.id === "outro") return [FM, DB, EB, FM][Math.min(3, k)];
  return LOOP[k % 4];
});

const bs = (bar: number, beat = 0) => beatToSeconds(bar * BEATS_PER_BAR + beat);

/** What plays in a bar: a light bed under narration, lifts at the reveals. */
type Prof = {
  kick: "four" | "half" | "none"; clap: boolean; hat8: boolean; hat16: boolean; openHat: boolean;
  bass: "none" | "8" | "16"; arp: 0 | 8 | 16; arpOpen: number; arpGain: number; stabs: boolean; pad: number; padBright: number;
};
function profile(id: SectionId, k: number, bars: number): Prof {
  const base: Prof = { kick: "four", clap: true, hat8: true, hat16: false, openHat: false, bass: "8", arp: 8, arpOpen: 2400, arpGain: 0.07, stabs: false, pad: 0.04, padBright: 1 };
  switch (id) {
    case "intro": return { ...base, kick: "none", clap: false, hat8: false, bass: "none", arp: 8, arpOpen: 700 + k * 700, arpGain: 0.09, pad: 0.06, padBright: 0.75 };
    case "problem": return { ...base, kick: k >= 2 ? "half" : "none", clap: false, hat8: k >= 1, bass: "none", arp: 8, arpOpen: 900, arpGain: 0.075, pad: 0.055, padBright: 0.6 };
    case "solution": return { ...base, hat16: true, openHat: true, bass: "16", arp: 16, arpOpen: 3800, stabs: k < 2, pad: 0.045, padBright: 1.5 };
    case "audience": return { ...base, hat16: true, openHat: true, bass: "8", arp: 16, arpOpen: 3400 };
    case "cut": return k === 0 ? { ...base, kick: "none", clap: false, bass: "none", hat16: true, arp: 16, arpOpen: 1600 }
      : k === 1 ? { ...base, kick: "half", clap: true, bass: "8", arp: 8, arpOpen: 1800 } : { ...base, hat16: true };
    case "bell": return { ...base, hat16: true, openHat: true, bass: "16", arp: 16, arpOpen: 4200, stabs: k === 0, padBright: 1.6 };
    case "payout": return { ...base, hat16: true, openHat: true, arp: 16, arpOpen: 4000, padBright: 1.4 };
    case "tech": return { ...base, kick: "half", clap: false, hat16: true, bass: "8", arp: 16, arpOpen: 2000, arpGain: 0.065, padBright: 0.9 };
    case "formats": return { ...base, hat16: true, openHat: true, bass: "16", arp: 16, arpOpen: 3600, stabs: true };
    case "outro": return k < bars - 2
      ? { ...base, hat16: true, openHat: true, bass: "16", arp: 16, arpOpen: 4200, stabs: k === 0, pad: 0.06, padBright: 1.4 }
      : { ...base, kick: "none", clap: false, hat8: false, bass: "none", arp: k === bars - 2 ? 8 : 0, arpOpen: 2500, pad: 0.06, padBright: 1.1 };
    default: return { ...base, hat16: id === "trade" || id === "host" };
  }
}

const kickTimes: number[] = [];

function kick(t0: number, gain = 0.95) {
  kickTimes.push(t0);
  let ph = 0;
  voice(music, t0, 0.5, (t) => {
    const f = 46 + 130 * Math.exp(-t * 32);
    ph += TAU * f / SR;
    const body = Math.sin(ph) * Math.exp(-t * 6.2) * Math.min(1, t * 900);
    const click = t < 0.004 ? noise() * (1 - t / 0.004) * 0.5 : 0;
    return Math.tanh((body + click) * 1.7);
  }, gain);
}

function clap(t0: number, gain = 0.42) {
  const bp = new Biquad().set("bp", 1350, 0.9);
  const hp = new Biquad().set("hp", 600);
  voice(music, t0, 0.32, (t) => {
    const bursts = [0, 0.011, 0.022].reduce((a, d) => a + (t >= d ? Math.exp(-(t - d) * 220) : 0), 0);
    const tail = Math.exp(-t * 17);
    return hp.run(bp.run(noise())) * (bursts * 0.9 + tail * 0.55) * 2.2;
  }, gain, 0, 0.22);
}

function hat(t0: number, open: boolean, gain: number, pan: number) {
  const hp = new Biquad().set("hp", open ? 7000 : 8200, 0.8);
  voice(music, t0, open ? 0.28 : 0.07, (t) => hp.run(noise()) * Math.exp(-t * (open ? 13 : 58)), gain, pan, open ? 0.08 : 0);
}

function snareRoll(t0: number, dur: number, rate: number) {
  const bp = new Biquad().set("bp", 1900, 0.7);
  const n = Math.floor(dur * rate);
  for (let i = 0; i < n; i++) {
    const t = t0 + i / rate;
    const g = 0.08 + 0.32 * (i / n);
    voice(music, t, 0.09, (x) => (bp.run(noise()) * 1.6 + Math.sin(TAU * 190 * x) * 0.4) * Math.exp(-x * 38), g, (i % 2 ? 0.15 : -0.15), 0.12);
  }
}

function bassNote(t0: number, dur: number, midi: number, gain = 0.34) {
  const f = mtof(midi);
  const saw = makeSaw(f);
  const saw2 = makeSaw(f * 1.004);
  const lp = new Biquad();
  voice(music, t0, dur + 0.03, (t, i) => {
    if (i % 16 === 0) lp.set("lp", 180 + 1100 * Math.exp(-t * 16), 3.2);
    const env = Math.min(1, t * 300) * (t < dur ? 1 - 0.25 * (t / dur) : Math.max(0, 1 - (t - dur) / 0.03));
    const sub = Math.sin(TAU * (f / 2) * t) * 0.55;
    return (lp.run((saw() + saw2()) * 0.5) * 0.85 + sub) * env;
  }, gain);
}

function padChord(t0: number, dur: number, ch: Chord, gain = 0.05, bright = 1) {
  ch.notes.forEach((m, k) => {
    [-1, 0, 1].forEach((d) => {
      const saw = makeSaw(mtof(m) * Math.pow(2, (d * 9) / 1200));
      const lp = new Biquad().set("lp", 1500 * bright, 0.6);
      voice(music, t0, dur + 0.5, (t) => {
        const env = Math.min(1, t / 0.35) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.5));
        return lp.run(saw()) * env;
      }, gain * (k === 0 ? 1 : 0.85), d * 0.55, 0.35);
    });
  });
}

function pluck(t0: number, midi: number, gain: number, pan: number, cutoff: number) {
  const f = mtof(midi);
  const lp = new Biquad();
  let ph = rnd();
  voice(music, t0, 0.22, (t, i) => {
    if (i % 16 === 0) lp.set("lp", 300 + cutoff * Math.exp(-t * 20), 1.4);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const sq = ph < 0.32 ? 1 : -1;
    return lp.run(sq) * Math.exp(-t * 11) * Math.min(1, t * 1500);
  }, gain, pan, 0.18, 0.32);
}

function stab(t0: number, ch: Chord, gain = 0.07) {
  ch.notes.forEach((m) => {
    [-1, 1].forEach((d) => {
      const saw = makeSaw(mtof(m + 12) * Math.pow(2, (d * 12) / 1200));
      const lp = new Biquad();
      voice(music, t0, 0.3, (t, i) => {
        if (i % 16 === 0) lp.set("lp", 600 + 4200 * Math.exp(-t * 14), 1.1);
        return lp.run(saw()) * Math.exp(-t * 7.5) * Math.min(1, t * 800);
      }, gain, d * 0.6, 0.25, 0.15);
    });
  });
}

function riser(t0: number, dur: number, gain = 0.22) {
  const bp = new Biquad();
  voice(music, t0, dur, (t, i) => {
    const p = t / dur;
    if (i % 32 === 0) bp.set("bp", 300 * Math.pow(22, p), 1.2);
    return (bp.run(noise()) * 1.6 + Math.sin(TAU * (200 + 900 * p * p) * t) * 0.12) * p * p;
  }, gain, 0, 0.3);
}

function impact(t0: number, gain = 0.75, b: { L: Float32Array; R: Float32Array } = music) {
  const lp = new Biquad().set("lp", 1400, 0.7);
  let ph = 0;
  voice(b, t0, 2.2, (t) => {
    const f = 30 + 55 * Math.exp(-t * 5);
    ph += TAU * f / SR;
    return Math.tanh(Math.sin(ph) * Math.exp(-t * 2.2) * 1.5) * 0.9 + lp.run(noise()) * Math.exp(-t * 7) * 0.6;
  }, gain, 0, 0.45);
}

// ── arrange ───────────────────────────────────────────────────────────
for (let bar = 0; bar < TOTAL_BARS; bar++) {
  const sec = secAt(bar);
  const k = bar - sec.startBar;
  const pr = profile(sec.id, k, sec.bars);
  const ch = CHORDS[bar];
  const t = bs(bar);
  const barDur = SPB * BEATS_PER_BAR;
  const last = bar === TOTAL_BARS - 1;

  padChord(t, last ? barDur * 0.8 : barDur, ch, pr.pad, pr.padBright);

  for (let b = 0; b < 4; b++) {
    if (pr.kick === "four" || (pr.kick === "half" && (b === 0 || b === 2))) kick(bs(bar, b), pr.kick === "half" ? 0.8 : 0.9);
    if (pr.clap && (pr.kick === "half" ? b === 2 : b === 1 || b === 3)) clap(bs(bar, b), 0.36);
    if (pr.hat8) hat(bs(bar, b + 0.5), pr.openHat, pr.openHat ? 0.08 : 0.1, 0.18);
    if (pr.hat16) { hat(bs(bar, b + 0.25), false, 0.05, -0.25); hat(bs(bar, b + 0.75), false, 0.05, 0.25); }
  }

  if (pr.bass === "16") {
    for (let st = 0; st < 16; st++) if (st % 4 !== 0) bassNote(bs(bar, st / 4), (SPB / 4) * 0.85, ch.root + (st % 8 === 6 ? 12 : 0), 0.26);
  } else if (pr.bass === "8") {
    for (let b = 0; b < 4; b++) bassNote(bs(bar, b + 0.5), (SPB / 2) * 0.8, ch.root, 0.27);
  }

  if (pr.arp) {
    const tones = [...ch.notes.map((n) => n + 12), ch.notes[1] + 24];
    for (let st = 0; st < pr.arp; st++) pluck(t + (st * barDur) / pr.arp, tones[(st * 3) % tones.length], pr.arpGain, st % 2 ? 0.35 : -0.35, pr.arpOpen);
  }
  if (pr.stabs) for (const b of [0.5, 1.75, 2.5, 3.5]) stab(bs(bar, b), ch, 0.06);
}

// Section dressing: lifts into the reveals, a drum roll into the cut.
const startOf = (id: SectionId) => SECTIONS.find((x) => x.id === id)!.startBar;
riser(bs(startOf("solution") - 1), SPB * 4, 0.22);
riser(bs(startOf("signin") - 1), SPB * 4, 0.14);
snareRoll(bs(startOf("cut"), 0), SPB * 3.5, 6);
riser(bs(startOf("outro") - 1), SPB * 4, 0.2);
impact(bs(startOf("bell")), 0.42);
padChord(bs(TOTAL_BARS - 2), SPB * 7.2, FM, 0.07, 1.3);

// ── narration ─────────────────────────────────────────────────────────
function readWavMono(file: string): Float32Array {
  const b = readFileSync(file);
  let o = 12, fmtCh = 1, bits = 16, rate = SR, data: Buffer | null = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === "fmt ") { fmtCh = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === "data") data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  if (!data || bits !== 16 || rate !== SR) throw new Error(`${file}: expected 16-bit ${SR} Hz WAV`);
  const n = data.length / 2 / fmtCh;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * fmtCh) / 32768;
  return out;
}
const here0 = dirname(fileURLToPath(import.meta.url));
let voCount = 0;
for (const l of VO) {
  const f = join(here0, "..", "public", "vo", `${l.id}.wav`);
  if (!existsSync(f)) continue;
  const x = readWavMono(f);
  const i0 = Math.round(beatToSeconds(l.startBeat) * SR);
  for (let i = 0; i < x.length && i0 + i < N; i++) voice1[i0 + i] += x[i];
  voCount++;
}
// Ducking envelope: fast attack, slow release, from where the voice is speaking.
const duck = new Float32Array(N);
{
  const win = Math.round(0.02 * SR);
  let acc = 0;
  const att = Math.exp(-1 / (0.03 * SR)), rel = Math.exp(-1 / (0.35 * SR));
  let env = 0;
  for (let i = 0; i < N; i++) {
    acc += Math.abs(voice1[i]) - (i >= win ? Math.abs(voice1[i - win]) : 0);
    const level = Math.min(1, (acc / win) * 14);
    env = level > env ? att * env + (1 - att) * level : rel * env + (1 - rel) * level;
    duck[i] = env;
  }
}

// ── interface sounds (from the same cues as the picture) ──────────────
function sfxVoice(c: Cue) {
  const t0 = beatToSeconds(c.beat);
  const g = c.gain ?? 1;
  const pan = c.pan ?? 0;
  const pitch = c.pitch ?? 1;
  switch (c.sfx) {
    case "tap": {
      const hp = new Biquad().set("hp", 2500);
      voice(sfx, t0, 0.06, (t) => (Math.sin(TAU * (2300 - 900 * t / 0.06) * pitch * t) * 0.8 + hp.run(noise()) * 0.5) * Math.exp(-t * 85), 0.32 * g, pan);
      break;
    }
    case "key": {
      const bp = new Biquad().set("bp", 3600 * pitch, 1.5);
      voice(sfx, t0, 0.05, (t) => (bp.run(noise()) * 1.4 + Math.sin(TAU * 170 * t) * 0.5) * Math.exp(-t * 110), 0.3 * g, pan);
      break;
    }
    case "tradeUp":
    case "tradeDown": {
      const [a, b] = c.sfx === "tradeUp" ? [880, 1320] : [990, 660];
      voice(sfx, t0, 0.18, (t) => {
        const f = t < 0.05 ? a : b;
        return Math.sin(TAU * f * t) * Math.exp(-(t < 0.05 ? t : t - 0.05) * 40) * 0.8;
      }, 0.16 * g, pan, 0.15);
      break;
    }
    case "fill": {
      [1046.5, 1318.5, 1568, 2093].forEach((f, k) => voice(sfx, t0 + k * 0.035, 0.6, (t) => (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2.01 * t) * 0.25) * Math.exp(-t * 7), 0.13 * g, (k - 1.5) * 0.2, 0.3));
      const hp = new Biquad().set("hp", 6000);
      voice(sfx, t0, 0.25, (t) => hp.run(noise()) * Math.exp(-t * 16), 0.12 * g, 0, 0.2);
      break;
    }
    case "tick": {
      const f = 1050 * pitch;
      voice(sfx, t0, 0.12, (t) => (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2.7 * t) * 0.3) * Math.exp(-t * 48), 0.26 * g, pan, 0.1);
      break;
    }
    case "sting": {
      // Elimination: a falling detuned brass cluster over a sub drop.
      [45, 48, 52].forEach((m) => [-1, 1].forEach((d) => {
        const lp = new Biquad();
        let ph = rnd();
        voice(sfx, t0, 1.6, (t, i) => {
          if (i % 32 === 0) lp.set("lp", 3200 * Math.exp(-t * 2.4) + 200, 1.2);
          const f = mtof(m + 12) * Math.pow(2, (d * 14) / 1200) * Math.pow(2, -t * 0.55);
          ph += f / SR; if (ph >= 1) ph -= 1;
          return lp.run(2 * ph - 1) * Math.min(1, t * 200) * Math.exp(-t * 1.6);
        }, 0.11 * g, d * 0.5, 0.4);
      }));
      impact(t0, 0.36 * g, sfx);
      break;
    }
    case "bell": {
      // Two strikes of a ring bell: inharmonic partials, long decays.
      const parts: Array<[number, number, number]> = [[1, 1, 1.1], [2.756, 0.6, 2.2], [5.404, 0.35, 3.4], [8.933, 0.2, 5], [13.34, 0.1, 7]];
      [0, 0.19].forEach((d, s) => {
        const f0 = 830 * pitch;
        parts.forEach(([r, a, dec]) => voice(sfx, t0 + d, 2.8, (t) => Math.sin(TAU * f0 * r * t + Math.sin(TAU * 3 * t) * 0.3) * a * Math.exp(-t * dec) * Math.min(1, t * 2000), 0.2 * g * (s ? 0.85 : 1), 0, 0.35));
      });
      break;
    }
    case "chime": {
      const f = 1046.5 * pitch;
      voice(sfx, t0, 1.3, (t) => (Math.sin(TAU * f * t) + Math.sin(TAU * f * 3 * t) * 0.18 + Math.sin(TAU * f * 4.2 * t) * 0.08) * Math.exp(-t * 3.6), 0.17 * g, pan, 0.35);
      break;
    }
    case "notify": {
      [1318.5, 1760].forEach((f, k) => voice(sfx, t0 + k * 0.07, 0.3, (t) => Math.sin(TAU * f * t) * Math.exp(-t * 18) * Math.min(1, t * 1200), 0.16 * g, 0.1, 0.2));
      break;
    }
    case "pop": {
      voice(sfx, t0, 0.09, (t) => Math.sin(TAU * (500 + 1300 * t / 0.09) * pitch * t) * Math.exp(-t * 40), 0.22 * g, pan, 0.1);
      break;
    }
    case "whoosh":
    case "swish": {
      const dur = c.sfx === "whoosh" ? 0.8 : 0.38;
      const bp = new Biquad();
      voice(sfx, t0 - dur * 0.45, dur, (t, i) => {
        const p = t / dur;
        if (i % 32 === 0) bp.set("bp", 400 + 3600 * Math.sin(Math.PI * p) * (c.sfx === "whoosh" ? 1 : 1.4), 0.9);
        return bp.run(noise()) * Math.sin(Math.PI * p) ** 2 * 1.6;
      }, 0.3 * g, pan, 0.2);
      break;
    }
    case "impact": impact(t0, 0.36 * g, sfx); break;
    case "lock": {
      const bp = new Biquad().set("bp", 2200, 2);
      voice(sfx, t0, 0.35, (t) => ((t * 220 % 1 < 0.5 ? 1 : -1) * 0.35 + bp.run(noise()) * 0.9) * Math.exp(-t * 18) + Math.sin(TAU * (90 - 40 * t) * t) * Math.exp(-t * 9) * 0.9, 0.4 * g, 0, 0.25);
      [1568, 2093].forEach((f, k) => voice(sfx, t0 + 0.08 + k * 0.06, 0.5, (t) => Math.sin(TAU * f * t) * Math.exp(-t * 9), 0.1 * g, k ? 0.3 : -0.3, 0.3));
      break;
    }
    case "coins": {
      [1046.5, 1318.5, 1568, 2093, 2637, 3136].forEach((f, k) => voice(sfx, t0 + k * 0.055, 1.1, (t) => (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2.4 * t) * 0.2) * Math.exp(-t * 5), 0.12 * g, (k % 2 ? 0.4 : -0.4), 0.35));
      const hp = new Biquad().set("hp", 7000);
      voice(sfx, t0, 0.7, (t) => hp.run(noise()) * Math.exp(-t * 6) * (0.5 + 0.5 * Math.sin(TAU * 22 * t)), 0.08 * g, 0, 0.3);
      break;
    }
    case "riser": riser(t0 - SPB * 0.5, SPB * 0.55, 0.25 * g); break;
    default: break;
  }
}
for (const c of CUES) if (c.sfx) sfxVoice(c);

// ── sidechain the music to the kick ───────────────────────────────────
kickTimes.sort((a, b) => a - b);
{
  let k = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    while (k + 1 < kickTimes.length && kickTimes[k + 1] <= t) k++;
    const dt = kickTimes.length && kickTimes[k] <= t ? t - kickTimes[k] : 99;
    const duck = 1 - 0.5 * Math.exp(-dt * 9);
    // The kick itself is in the music bus too; it peaks before the duck bites.
    music.L[i] *= dt < 0.012 ? 1 : duck;
    music.R[i] *= dt < 0.012 ? 1 : duck;
  }
}

// ── effects ───────────────────────────────────────────────────────────
function pingPong(src: { L: Float32Array; R: Float32Array }, delaySec: number, fb: number, wet: number) {
  const d = Math.round(delaySec * SR);
  const bufL = new Float32Array(N), bufR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const tapL = i >= d ? bufL[i - d] : 0;
    const tapR = i >= d ? bufR[i - d] : 0;
    bufL[i] = (src.L[i] + src.R[i]) * 0.5 + tapR * fb;
    bufR[i] = tapL;
    music.L[i] += tapL * wet;
    music.R[i] += tapR * wet;
  }
}
pingPong(delaySend, SPB * 0.75, 0.38, 0.55);

function reverb(src: { L: Float32Array; R: Float32Array }, wet: number) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((n) => Math.round(n * SR / 44100));
  const aps = [556, 441, 341, 225].map((n) => Math.round(n * SR / 44100));
  const run = (x: Float32Array, spread: number) => {
    const out = new Float32Array(N);
    for (const cl of combs) {
      const len = cl + spread;
      const buf = new Float32Array(len);
      let idx = 0, store = 0;
      for (let i = 0; i < N; i++) {
        const y = buf[idx];
        store = y * 0.8 + store * 0.2; // damping
        buf[idx] = x[i] + store * 0.84;
        out[i] += y;
        idx = (idx + 1) % len;
      }
    }
    for (const al of aps) {
      const len = al + spread;
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const b = buf[idx];
        const y = -out[i] + b;
        buf[idx] = out[i] + b * 0.5;
        out[i] = y;
        idx = (idx + 1) % len;
      }
    }
    return out;
  };
  const L = run(src.L, 0), R = run(src.R, 23);
  for (let i = 0; i < N; i++) { music.L[i] += L[i] * wet * 0.12; music.R[i] += R[i] * wet * 0.12; }
}
reverb(verbSend, 1);

// ── master ────────────────────────────────────────────────────────────
const outL = new Float32Array(N), outR = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const d = duck[i];
  const mg = 0.78 * (1 - 0.76 * d); // the bed sits well under the voice
  const sg = 0.95 * (1 - 0.25 * d);
  const v = voice1[i] * 1.4;
  outL[i] = music.L[i] * mg + sfx.L[i] * sg + v;
  outR[i] = music.R[i] * mg + sfx.R[i] * sg + v;
}
{
  // Report how far the bed sits under the voice while it speaks.
  let ve = 0, me = 0, n = 0;
  for (let i = 0; i < N; i++) if (duck[i] > 0.6) { ve += (voice1[i] * 1.4) ** 2; me += (music.L[i] * 0.78 * (1 - 0.76 * duck[i])) ** 2; n++; }
  if (n) console.log(`voice vs music while speaking: ${(10 * Math.log10(ve / Math.max(1e-12, me))).toFixed(1)} dB`);
}
// Level to a near-peak target, then a soft knee above it so hits never clip
// and the voice is never saturated.
const mags: number[] = [];
for (let i = 0; i < N; i += 7) mags.push(Math.max(Math.abs(outL[i]), Math.abs(outR[i])));
mags.sort((x, y) => x - y);
const p999 = mags[Math.floor(mags.length * 0.999)] || 1;
const pre = 0.8 / p999;
const knee = 0.8;
const soft = (x: number) => {
  const a = Math.abs(x);
  if (a <= knee) return x;
  return Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
};
let peak2 = 0;
for (let i = 0; i < N; i++) {
  outL[i] = soft(outL[i] * pre);
  outR[i] = soft(outR[i] * pre);
  peak2 = Math.max(peak2, Math.abs(outL[i]), Math.abs(outR[i]));
}
const norm = 0.84 / peak2;
const fadeIn = Math.round(0.004 * SR);
const fadeOut = Math.round(0.9 * SR);
for (let i = 0; i < N; i++) {
  let g = norm;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > N - fadeOut) g *= Math.max(0, (N - i) / fadeOut);
  outL[i] *= g; outR[i] *= g;
}

// ── write 16-bit PCM WAV ──────────────────────────────────────────────
const bytes = 44 + N * 4;
const buf = Buffer.alloc(bytes);
buf.write("RIFF", 0); buf.writeUInt32LE(bytes - 8, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outL[i])) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outR[i])) * 32767), 46 + i * 4);
}
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "soundtrack.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
const sfxCount = CUES.filter((c) => c.sfx).length;
console.log(`soundtrack.wav · ${DURATION_SECONDS.toFixed(2)}s · ${BPM.toFixed(2)} BPM · ${TOTAL_BARS} bars · ${voCount} narration lines · ${sfxCount} interface sounds`);
