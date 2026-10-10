import React from "react";
import { hash01, prog } from "../anim";
import { COMP, type Layout } from "../device";
import { F } from "../fonts";
import { C, rgba } from "../theme";

/** Kick-synced pulse: 1 on every beat, decaying through it. */
export const beatPulse = (beat: number) => Math.exp(-((beat % 1 + 1) % 1) * 5);

/** The film's stage: deep base, brand glows, a pit-floor grid and drifting motes. */
export const Backdrop: React.FC<{ layout: Layout; beat: number; energy?: number }> = ({ layout, beat, energy = 1 }) => {
  const { w, h } = COMP[layout];
  const pulse = beatPulse(beat) * energy;
  const L = layout === "landscape";
  const motes = Array.from({ length: 34 }, (_, i) => {
    const x = hash01(i * 3.1) * w;
    const sp = 6 + hash01(i * 7.7) * 18;
    const y = ((hash01(i * 5.3) * h - beat * sp) % h + h) % h;
    const r = 1 + hash01(i * 9.1) * 2.2;
    return { x, y, r, a: 0.15 + hash01(i * 2.3) * 0.35, c: i % 3 === 0 ? C.plasma : C.neon };
  });
  return (
    <div style={{ position: "absolute", inset: 0, background: C.bg, overflow: "hidden" }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(${L ? "1100px 900px at 12% 8%" : "1100px 1000px at 10% 4%"}, ${rgba(C.neon, 0.17 + pulse * 0.04)}, transparent 62%),
          radial-gradient(${L ? "1000px 800px at 92% 70%" : "1000px 1100px at 95% 78%"}, ${rgba(C.plasma, 0.10 + pulse * 0.03)}, transparent 60%),
          radial-gradient(900px 600px at 50% 120%, ${rgba(C.neon, 0.10)}, transparent 70%)`
      }} />
      {/* pit floor grid in perspective */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h * 0.55, perspective: 700, overflow: "hidden", opacity: 0.55 }}>
        <div style={{
          position: "absolute", left: "-50%", right: "-50%", top: 0, height: "200%", transformOrigin: "50% 0%", transform: "rotateX(72deg)",
          backgroundImage: `linear-gradient(${rgba(C.neon, 0.22)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(C.neon, 0.22)} 1px, transparent 1px)`,
          backgroundSize: "90px 90px", backgroundPosition: `0px ${(beat * 22) % 90}px`,
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 35%, black 60%, transparent 100%)",
          maskImage: "linear-gradient(180deg, transparent 0%, black 35%, black 60%, transparent 100%)"
        }} />
      </div>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        {motes.map((m, i) => <circle key={i} cx={m.x} cy={m.y} r={m.r} fill={m.c} opacity={m.a * (0.7 + pulse * 0.3)} />)}
      </svg>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
    </div>
  );
};

/** Small persistent note. */
export const DevnetChip: React.FC<{ layout: Layout }> = ({ layout }) => {
  const L = layout === "landscape";
  return (
    <div style={{
      position: "absolute", ...(L ? { left: 104, bottom: 52 } : { right: 56, top: 64 }), display: "flex", alignItems: "center", gap: 10,
      padding: L ? "9px 16px" : "10px 18px", borderRadius: 999, background: "rgba(15,19,27,0.75)", border: `1px solid ${rgba(C.amber, 0.45)}`,
      fontFamily: F.mono
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, boxShadow: `0 0 8px ${C.amber}` }} />
      <span style={{ fontSize: L ? 19 : 24, fontWeight: 700, letterSpacing: 1.4, color: "#fcd9a0" }}>Devnet · test USDC</span>
    </div>
  );
};

export const flashAt = (beat: number, at: number, dur = 0.6) => (beat >= at ? 1 - prog(beat, at, dur) : 0);
