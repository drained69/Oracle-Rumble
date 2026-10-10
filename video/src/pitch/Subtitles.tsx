import React from "react";
import { prog } from "../anim";
import { F } from "../fonts";
import { C } from "../theme";
import { VO } from "./timeline";

type Chunk = { text: string; start: number; end: number };

/** Split each voice-over line into readable chunks, timed by character share. */
const CHUNKS: Chunk[] = VO.flatMap((l) => {
  // Sentence breaks only where punctuation is followed by a space; short lines stay whole.
  const parts = l.text.length <= 44 ? [l.text] : l.text.split(/(?<=[.!?:])\s+/).map((p) => p.trim()).filter(Boolean);
  // Break anything still long at the comma nearest its middle.
  const pieces = parts.flatMap((p) => {
    if (p.length <= 64) return [p];
    const mid = p.length / 2;
    let best = -1;
    for (let i = 0; i < p.length; i++) if (p[i] === "," && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best > 0 ? [p.slice(0, best + 1), p.slice(best + 1).trim()] : [p];
  });
  const total = pieces.reduce((n, p) => n + p.length, 0);
  let t = l.startBeat;
  return pieces.map((p) => {
    const len = ((l.endBeat - l.startBeat) * p.length) / total;
    const c = { text: p, start: t, end: t + len };
    t += len;
    return c;
  });
});

/** Burned-in captions of the narration, for viewers watching muted. */
export const Subtitles: React.FC<{ beat: number; cx: number }> = ({ beat, cx }) => {
  const c = CHUNKS.find((x) => beat >= x.start - 0.05 && beat < x.end + 0.35);
  if (!c) return null;
  const o = Math.min(prog(beat, c.start - 0.05, 0.12), 1 - prog(beat, c.end + 0.2, 0.15));
  return (
    <div style={{ position: "absolute", left: cx - 640, width: 1280, bottom: 88, display: "flex", justifyContent: "center", opacity: o, zIndex: 40 }}>
      <span style={{
        fontFamily: F.text, fontWeight: 600, fontSize: 31, lineHeight: 1.3, color: C.text, textAlign: "center",
        padding: "8px 20px", borderRadius: 12, background: "rgba(5,7,11,0.72)", boxShadow: "0 8px 30px rgba(0,0,0,0.35)"
      }}>{c.text}</span>
    </div>
  );
};
