import React from "react";
import { clamp, easeOutCubic, easeOutQuint, prog } from "../anim";
import type { Layout } from "../device";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { section, type SectionId } from "../timeline";

/**
 * Step captions. Wording comes from README.md and the product's own screens.
 */
export const CAPTIONS: Partial<Record<SectionId, { n: string; label: string; head: string; line: string }>> = {
  signin: { n: "01", label: "Sign in", head: "Sign in with X", line: "One tap with X creates a Solana embedded wallet — no extension, no seed phrase to start." },
  seat: { n: "02", label: "Take a seat", head: "Take your seat", line: "Pay the seat — entry + vault — into escrow and make a hidden YES/NO opening call." },
  trade: { n: "03", label: "Trade live", head: "The room makes its own odds", line: "Panta's line opens the pit. Every trade moves the price for the whole room." },
  cut: { n: "04", label: "Royale", head: "The bottom half is cut", line: "Survivors carry their vault forward. The Oracle read gives its lean." },
  bell: { n: "05", label: "The bell", head: "The best vaults split the pool", line: "Vaults are ranked and the prize split is recorded on-chain." },
  payout: { n: "06", label: "Payout", head: "Withdraw to your own wallet", line: "Only your signature releases your funds — the operator can't move them." },
  host: { n: "07", label: "Host & creator", head: "Bring your audience in", line: "Join code, QR, invite link and an OBS / Streamlabs overlay at /a/CODE/overlay." }
};
const ORDER: SectionId[] = ["signin", "seat", "trade", "cut", "bell", "payout", "host"];

const Words: React.FC<{ text: string; beat: number; start: number; style: React.CSSProperties; step?: number }> = ({ text, beat, start, style, step = 0.07 }) => (
  <div style={style}>
    {text.split(" ").map((w, i) => {
      const p = prog(beat, start + i * step, 0.45, easeOutQuint);
      return (
        <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.08em", marginRight: "0.24em" }}>
          <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, opacity: clamp(p * 1.6) }}>{w}</span>
        </span>
      );
    })}
  </div>
);

export const Caption: React.FC<{ layout: Layout; beat: number; id: SectionId }> = ({ layout, beat, id }) => {
  const cap = CAPTIONS[id];
  if (!cap) return null;
  const s = section(id);
  const start = s.startBeat + 0.05;
  const end = s.endBeat - 0.45;
  if (beat < s.startBeat - 0.1 || beat > s.endBeat + 0.1) return null;
  const out = prog(beat, end, 0.4, (t) => t * t);
  const L = layout === "landscape";
  const numP = prog(beat, start, 0.55, easeOutQuint);
  const labP = prog(beat, start + 0.12, 0.5, easeOutCubic);
  const idx = ORDER.indexOf(id);
  const box: React.CSSProperties = L
    ? { position: "absolute", left: 104, top: 0, bottom: 0, width: 548, display: "flex", flexDirection: "column", justifyContent: "center", gap: 0 }
    : { position: "absolute", left: 76, right: 76, top: 150, display: "flex", flexDirection: "column" };
  return (
    <div style={{ ...box, opacity: 1 - out, transform: `translateY(${-out * 40}px)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: L ? 22 : 24 }}>
        <span style={{
          fontFamily: F.mono, fontWeight: 800, fontSize: L ? 104 : 96, lineHeight: 0.9, letterSpacing: -4,
          background: `linear-gradient(135deg, #f5e9ff 0%, ${C.neon} 45%, ${C.plasma} 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          opacity: numP, transform: `translateY(${(1 - numP) * 40}px)`, filter: `drop-shadow(0 0 30px ${rgba(C.neon, 0.35)})`
        }}>{cap.n}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: labP, transform: `translateX(${(1 - labP) * -24}px)` }}>
          <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: L ? 26 : 30, letterSpacing: L ? 6 : 7, textTransform: "uppercase", color: C.plasma }}>{cap.label}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {ORDER.map((o, i) => (
              <span key={o} style={{
                width: i === idx ? 38 : 14, height: 5, borderRadius: 3,
                background: i < idx ? rgba(C.neon, 0.55) : i === idx ? `linear-gradient(90deg, ${C.neon}, ${C.plasma})` : "rgba(237,240,246,0.14)"
              }} />
            ))}
          </div>
        </div>
      </div>
      <Words text={cap.head} beat={beat} start={start + 0.2} style={{
        fontFamily: F.text, fontWeight: 800, fontSize: L ? 76 : 84, lineHeight: 1.02, letterSpacing: L ? -2.6 : -3, color: C.text, marginTop: L ? 30 : 34
      }} />
    </div>
  );
};
