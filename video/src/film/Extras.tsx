import React from "react";
import { clamp, easeOutBack, easeOutCubic, easeOutQuint, keyframes, prog, usd2 } from "../anim";
import type { Layout } from "../device";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { FINAL, POOL, PRIZES, SPLIT, at, cueBeat, playerOf } from "../timeline";
import { Avatar, BrandMark, Wordmark } from "../ui/brand";
import { PitOverlayCard } from "../ui/pit/CreatorKit";
import { beatPulse } from "./Backdrop";

/** Ripple the three tiers of the mark outward-in on every beat. */
const tiers = (beat: number): [number, number, number] => {
  const ph = ((beat % 1) + 1) % 1;
  const t = (d: number) => Math.max(0, 1 - Math.abs(ph - d) * 5);
  return [t(0.02), t(0.14), t(0.26)];
};

/** Frame 0 is a finished cover: mark, wordmark, tagline. */
export const IntroLockup: React.FC<{ layout: Layout; beat: number }> = ({ layout, beat }) => {
  const L = layout === "landscape";
  const out = prog(beat, at("intro", 10.2), 1.2, (t) => t * t);
  if (out >= 1) return null;
  const pulse = beatPulse(beat);
  const glow = 0.5 + pulse * 0.5;
  return (
    <div style={{
      position: "absolute", ...(L ? { left: 104, top: 0, bottom: 0, width: 600, justifyContent: "center" } : { left: 60, right: 60, top: 130, alignItems: "center", textAlign: "center" as const }),
      display: "flex", flexDirection: "column", opacity: 1 - out, transform: L ? `translateX(${-out * 80}px)` : `translateY(${-out * 80}px)`
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: L ? 26 : 26, justifyContent: L ? "flex-start" : "center" }}>
        <div style={{ filter: `drop-shadow(0 0 ${24 + glow * 20}px ${rgba(C.neon, 0.35 + glow * 0.2)})`, transform: `scale(${1 + pulse * 0.025})` }}>
          <BrandMark size={L ? 132 : 128} id="intro" glow={1} tierPulse={tiers(beat)} />
        </div>
        <Wordmark size={L ? 60 : 60} />
      </div>
      <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: L ? 66 : 78, lineHeight: 1.04, letterSpacing: L ? -2.4 : -2.8, color: C.text, marginTop: L ? 40 : 46 }}>
        Trading pits on any{L ? " " : <br />}
        <span style={{ background: `linear-gradient(90deg, ${C.neon}, ${C.plasma})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>prediction market.</span>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: L ? 30 : 30, justifyContent: L ? "flex-start" : "center", fontFamily: F.mono, fontWeight: 700, fontSize: L ? 22 : 27, letterSpacing: 2, color: C.text2, textTransform: "uppercase" }}>
        <span>Built on <span style={{ color: C.gold }}>Panta</span></span><span style={{ color: C.text3 }}>·</span><span>Solana</span>
      </div>
    </div>
  );
};

/** Close: mark, "Host. Trade. Split.", and the call to action. */
export const OutroLockup: React.FC<{ layout: Layout; beat: number }> = ({ layout, beat }) => {
  const L = layout === "landscape";
  const s = at("outro");
  if (beat < s - 0.2) return null;
  const inP = prog(beat, s, 0.7, easeOutQuint);
  const pulse = beatPulse(beat);
  const words = [["Host.", cueBeat("outro.host")], ["Trade.", cueBeat("outro.trade")], ["Split.", cueBeat("outro.split")]] as const;
  const cta = prog(beat, cueBeat("outro.cta"), 0.6, (t) => easeOutBack(t, 1.4));
  const fadeEnd = 1;
  const credits = prog(beat, cueBeat("outro.cta") + 1.6, 0.8, easeOutQuint);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: fadeEnd }}>
      <div style={{ position: "absolute", left: "50%", top: L ? "34%" : "33%", width: L ? 900 : 1000, height: L ? 900 : 1000, transform: `translate(-50%,-50%) scale(${0.7 + inP * 0.3})`, borderRadius: "50%",
        background: `radial-gradient(circle, ${rgba(C.neon, 0.22 + pulse * 0.06)}, transparent 62%)`, opacity: inP }} />
      <div style={{ display: "flex", alignItems: "center", gap: 30, opacity: inP, transform: `scale(${0.85 + inP * 0.15})`, flexDirection: L ? "row" : "column" }}>
        <div style={{ filter: `drop-shadow(0 0 ${30 + pulse * 20}px ${rgba(C.neon, 0.5)})` }}>
          <BrandMark size={L ? 150 : 210} id="outro" glow={1} tierPulse={tiers(beat)} />
        </div>
        <Wordmark size={L ? 72 : 84} />
      </div>
      <div style={{ display: "flex", gap: L ? 30 : 24, marginTop: L ? 54 : 70, flexDirection: L ? "row" : "column", alignItems: "center" }}>
        {words.map(([w, b], i) => {
          const p = prog(beat, b, 0.45, (t) => easeOutBack(t, 1.6));
          return (
            <span key={w} style={{
              fontFamily: F.text, fontWeight: 900, fontSize: L ? 112 : 128, letterSpacing: -4, lineHeight: 1,
              color: i === 2 ? "transparent" : C.text, opacity: clamp(p * 1.5), transform: `translateY(${(1 - p) * 50}px) scale(${0.8 + p * 0.2})`,
              ...(i === 2 ? { background: `linear-gradient(90deg, ${C.neon}, ${C.plasma})`, WebkitBackgroundClip: "text", backgroundClip: "text" } : {})
            }}>{w}</span>
          );
        })}
      </div>
      <div style={{
        marginTop: L ? 60 : 80, display: "flex", alignItems: "center", gap: 16, padding: L ? "20px 34px" : "26px 40px", borderRadius: 999,
        background: `linear-gradient(180deg, ${C.plasma}, #0891b2)`, boxShadow: `0 0 ${40 + pulse * 20}px ${rgba(C.plasma, 0.5)}`,
        opacity: clamp(cta * 1.4), transform: `scale(${0.8 + cta * 0.2})`
      }}>
        <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: L ? 34 : 40, color: "#051018" }}>Try it live at</span>
        <span style={{ fontFamily: F.text, fontWeight: 900, fontSize: L ? 34 : 40, color: "#051018" }}>www.trythepit.xyz</span>
      </div>
      <div style={{ marginTop: 40, display: "flex", gap: 18, alignItems: "center", fontFamily: F.mono, fontWeight: 700, fontSize: L ? 21 : 26, letterSpacing: 2, color: C.text2, textTransform: "uppercase", opacity: credits, transform: `translateY(${(1 - credits) * 16}px)` }}>
        <span>Built on <span style={{ color: C.gold }}>Panta</span></span><span style={{ color: C.text3 }}>·</span><span>Solana</span><span style={{ color: C.text3 }}>·</span><span>Panta API Sidetrack · Colosseum</span>
      </div>
    </div>
  );
};

/** OBS-style preview: the pit overlay as a browser source on a stream. */
export const StreamWindow: React.FC<{ layout: Layout; beat: number }> = ({ layout, beat }) => {
  const L = layout === "landscape";
  const start = cueBeat("host.overlay");
  const inP = prog(beat, start, 0.7, easeOutQuint);
  const outP = prog(beat, at("tech") - 0.4, 0.5, (t) => t * t);
  if (beat < start || outP >= 1) return null;
  const W = L ? 1180 : 960;
  const H = (W * 9) / 16;
  const cx = L ? 1282 : 540;
  const cy = L ? 560 : 900;
  const yes = keyframes(beat, [[start, 62], [start + 1.2, 65], [start + 2.2, 63], [start + 3.3, 67], [start + 4, 66]]);
  const spark = Array.from({ length: 24 }, (_, i) => 55 + Math.sin(i * 0.7) * 3 + i * 0.4 + (i > 20 ? (yes - 62) : 0));
  const sec = Math.max(0, 300 - Math.floor((beat - start) * 1.2) - 172);
  return (
    <div style={{
      position: "absolute", left: cx - W / 2, top: cy - H / 2 - 22, width: W, opacity: inP * (1 - outP),
      transform: `perspective(2000px) translateY(${(1 - inP) * 120}px) rotateX(${(1 - inP) * 14}deg) scale(${0.9 + inP * 0.1 - outP * 0.1})`
    }}>
      <div style={{ height: 44, borderRadius: "16px 16px 0 0", background: "#0c0f17", border: `1px solid ${C.borderStrong}`, borderBottom: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 18px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: F.mono, fontWeight: 800, fontSize: 14, color: "#fff", background: "#e11d48", padding: "4px 10px", borderRadius: 6 }}>● LIVE</span>
        <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: 15, color: C.text2 }}>Browser Source</span>
        <span style={{ fontFamily: F.mono, fontSize: 14, color: C.text }}>trythepit.xyz/a/R9V3PQ/overlay</span>
      </div>
      <div style={{ position: "relative", width: W, height: H, overflow: "hidden", borderRadius: "0 0 16px 16px", border: `1px solid ${C.borderStrong}`, boxShadow: `0 50px 140px rgba(0,0,0,0.7), 0 0 90px ${rgba(C.neon, 0.2)}` }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: "80% 22%", transform: `scale(${1 + 0.14 * prog(beat, start + 0.8, 3, (t) => t)})` }}>
          <StreamScene beat={beat} />
          <div style={{ position: "absolute", right: W * 0.03, top: H * 0.04 }}>
            <div style={{ transform: `translateX(${(1 - prog(beat, start + 0.4, 0.6, easeOutCubic)) * 120}%)`, width: 520 * (W / 1280) * (L ? 1.42 : 1.7) }}>
              <PitOverlayCard yes={yes} spark={spark} clockText={`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`} scale={(W / 1280) * (L ? 1.42 : 1.7)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** A stand-in for whatever the creator is streaming: abstract, moving, no people. */
const StreamScene: React.FC<{ beat: number }> = ({ beat }) => (
  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #12172a 0%, #0b0e17 60%, #1a1030 100%)" }}>
    {Array.from({ length: 7 }, (_, i) => {
      const a = beat * (0.18 + i * 0.03) + i;
      return (
        <div key={i} style={{
          position: "absolute", left: `${50 + Math.cos(a) * (18 + i * 5)}%`, top: `${55 + Math.sin(a * 1.3) * (14 + i * 3)}%`, width: 160 + i * 40, height: 160 + i * 40,
          marginLeft: -(80 + i * 20), marginTop: -(80 + i * 20), borderRadius: "50%",
          background: `radial-gradient(circle, ${rgba(i % 2 ? C.plasma : C.neon, 0.22)}, transparent 70%)`, filter: "blur(8px)"
        }} />
      );
    })}
    <div style={{
      position: "absolute", inset: 0, opacity: 0.35,
      backgroundImage: `repeating-linear-gradient(115deg, transparent 0 60px, ${rgba(C.neon, 0.08)} 60px 62px)`,
      backgroundPosition: `${(beat * 40) % 200}px 0`
    }} />
  </div>
);

/** The 3-way split (README "Money and fees"). */
export const SplitCard: React.FC<{ layout: Layout; beat: number }> = ({ layout, beat }) => {
  const L = layout === "landscape";
  const s = cueBeat("bell.split1");
  const inP = prog(beat, s - 0.4, 0.6, easeOutQuint);
  const outP = prog(beat, at("payout", -0.4), 0.4);
  if (beat < s - 0.5 || outP >= 1) return null;
  const top3 = FINAL.filter((x) => !x.out).slice(0, 3);
  const pct = ["62.5%", "23.4375%", "14.0625%"];
  const cues = [cueBeat("bell.split1"), cueBeat("bell.split2"), cueBeat("bell.split3")];
  return (
    <div style={{
      position: "absolute", ...(L ? { left: 1300, top: 640, width: 560 } : { left: 70, right: 70, top: 1390 }),
      opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 50}px)`,
      borderRadius: 22, padding: L ? "22px 24px" : "28px 30px", background: "linear-gradient(180deg, rgba(26,32,48,0.96), rgba(13,16,23,0.96))",
      border: `1px solid ${rgba(C.gold, 0.5)}`, boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 60px ${rgba(C.gold, 0.18)}`, zIndex: 30
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: L ? 14 : 18 }}>
        <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: L ? 18 : 24, letterSpacing: 3, textTransform: "uppercase", color: C.gold }}>Prize split</span>
        <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: L ? 18 : 24, color: C.text2 }}>{usd2(POOL)} pool</span>
      </div>
      {top3.map((x, i) => {
        const p = prog(beat, cues[i], 0.6, easeOutCubic);
        const w = SPLIT[i] * 100;
        return (
          <div key={x.id} style={{ display: "grid", gridTemplateColumns: L ? "34px 1fr auto" : "44px 1fr auto", gap: 12, alignItems: "center", padding: L ? "8px 0" : "11px 0", opacity: 0.3 + p * 0.7 }}>
            <span style={{ fontFamily: F.display, fontWeight: 900, fontSize: L ? 22 : 28, color: i === 0 ? C.gold : C.text2 }}>{i + 1}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar seed={playerOf(x.id).seed} size={L ? 26 : 34} radius={7} />
                <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: L ? 21 : 27, color: C.text }}>{playerOf(x.id).name}</span>
                <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: L ? 18 : 23, color: C.text2 }}>{pct[i]}</span>
              </div>
              <div style={{ height: L ? 8 : 10, borderRadius: 6, background: "rgba(237,240,246,0.08)" }}>
                <div style={{ width: `${w * p}%`, height: "100%", borderRadius: 6, background: i === 0 ? `linear-gradient(90deg, ${C.gold}, #f59e0b)` : `linear-gradient(90deg, ${C.neon}, ${C.plasma})` }} />
              </div>
            </div>
            <span style={{ fontFamily: F.mono, fontWeight: 800, fontSize: L ? 26 : 34, color: i === 0 ? C.gold : C.text }}>{usd2((PRIZES[x.id] ?? 0) * p)}</span>
          </div>
        );
      })}
    </div>
  );
};
