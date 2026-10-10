/**
 * The pitch film's timeline. Same grid as the demo (≈124 BPM, 58-frame bars),
 * but cut to the pitch voice-over: each section is at least its planned
 * length and long enough for its lines.
 */
import manifest from "../../public/pitch-vo/manifest.json";
import { NARRATION } from "./narration";

export const FPS = 30;
export const FRAMES_PER_BEAT = 14.5;
export const BEATS_PER_BAR = 4;
export const FRAMES_PER_BAR = FRAMES_PER_BEAT * BEATS_PER_BAR;
export const BPM = (60 * FPS) / FRAMES_PER_BEAT;
export const SEC_PER_BEAT = 60 / BPM;

export type SectionId = "intro" | "who" | "ship" | "problem" | "pit" | "why" | "close";

/** [section, minimum bars]. */
const PLAN: [SectionId, number][] = [
  ["intro", 3],
  ["who", 4],
  ["ship", 5],
  ["problem", 4],
  ["pit", 5],
  ["why", 7],
  ["close", 6],
];

/** Beats of air before the first line of a section, between lines, and after the last. */
const VO_LEAD = 0.8;
const VO_GAP = 0.8;
const VO_TAIL = 0.5;

const voSeconds = (manifest as { lines: Record<string, number> }).lines;
const voBeats = (id: string) => {
  const sec = voSeconds[id];
  if (sec === undefined) throw new Error(`No voice-over clip measured for ${id} — run npm run voiceover:pitch`);
  return sec / SEC_PER_BEAT;
};

export type Section = {
  id: SectionId; index: number; startBar: number; bars: number;
  startBeat: number; endBeat: number; startFrame: number; endFrame: number;
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
      startFrame: bar * FRAMES_PER_BAR, endFrame: (bar + bars) * FRAMES_PER_BAR,
    });
    for (const { l, start, len } of placed) {
      vo.push({ id: l.id, section: id, text: l.text, startBeat: startBeat + start, endBeat: startBeat + start + len, seconds: voSeconds[l.id] });
    }
    bar += bars;
  });
  return { SECTIONS: sections, VO: vo };
})();

export const TOTAL_BARS = SECTIONS.reduce((n, s) => n + s.bars, 0);
export const DURATION_IN_FRAMES = TOTAL_BARS * FRAMES_PER_BAR;
export const DURATION_SECONDS = DURATION_IN_FRAMES / FPS;

export const section = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;
/** Beat `rel` beats into a section. */
export const at = (id: SectionId, rel = 0) => section(id).startBeat + rel;
export const beatToFrame = (b: number) => b * FRAMES_PER_BEAT;
export const frameToBeat = (f: number) => f / FRAMES_PER_BEAT;
export const beatToSeconds = (b: number) => b * SEC_PER_BEAT;

/** Beat at fraction `f` (0–1) through a voice-over line. */
export function vo(id: string, f = 0): number {
  const l = VO.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown voice-over line: ${id}`);
  return l.startBeat + f * (l.endBeat - l.startBeat);
}
