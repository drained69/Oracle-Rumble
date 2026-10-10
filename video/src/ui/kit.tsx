import React from "react";
import { clamp, easeOutBack, easeOutCubic, prog } from "../anim";
import { F } from "../fonts";
import { C, rgba } from "../theme";

/**
 * A visible touch: the fingertip lands, presses, and leaves a ripple.
 * Render inside any `position: relative` element; it centres on it.
 */
export const Touch: React.FC<{ beat: number; at: number; size?: number; dx?: number; dy?: number }> = ({ beat, at, size = 46, dx = 0, dy = 0 }) => {
  const t = beat - at;
  if (t < -0.55 || t > 0.9) return null;
  const approach = clamp((t + 0.55) / 0.55);
  const press = t >= 0 ? Math.max(0, 1 - t / 0.25) : 0;
  const leave = t > 0.25 ? clamp((t - 0.25) / 0.45) : 0;
  const ring = t >= 0 ? clamp(t / 0.65) : 0;
  const s = (1.55 - 0.55 * easeOutCubic(approach)) * (1 - press * 0.12);
  const base: React.CSSProperties = {
    position: "absolute", left: "50%", top: "50%", width: size, height: size, marginLeft: -size / 2 + dx, marginTop: -size / 2 + dy,
    borderRadius: "50%", pointerEvents: "none", zIndex: 50
  };
  return (
    <>
      <div style={{
        ...base,
        background: `radial-gradient(circle, rgba(255,255,255,${0.42 + press * 0.3}) 0%, rgba(255,255,255,0.16) 62%, rgba(255,255,255,0) 72%)`,
        border: "2px solid rgba(255,255,255,0.85)",
        boxShadow: `0 0 ${18 + press * 16}px rgba(34,211,238,${0.35 + press * 0.4})`,
        transform: `scale(${s})`, opacity: approach * (1 - leave)
      }} />
      {t >= 0 && (
        <div style={{
          ...base, border: `2px solid ${rgba(C.plasma, 0.9)}`,
          transform: `scale(${1 + ring * 1.5})`, opacity: (1 - ring) * 0.9
        }} />
      )}
    </>
  );
};

/** Press-scale for a tapped control. */
export const pressScale = (beat: number, at: number) => {
  const t = beat - at;
  if (t < -0.1 || t > 0.4) return 1;
  return t < 0 ? 1 - (t + 0.1) * 0.5 : 0.95 + 0.05 * clamp(t / 0.35);
};

/** A notification that slides down from the top of the device and sits there. */
export const Notice: React.FC<{
  beat: number; from: number; to?: number; icon?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode;
  tone?: "neon" | "plasma" | "up" | "gold" | "xp" | "down"; m?: boolean; top?: number; width?: number | string;
}> = ({ beat, from, to = Infinity, icon, title, sub, tone = "neon", m, top = 12, width }) => {
  const inP = prog(beat, from, 0.45, (t) => easeOutBack(t, 1.2));
  const outP = prog(beat, to, 0.35);
  if (beat < from || outP >= 1) return null;
  const col = C[tone];
  return (
    <div style={{
      position: "absolute", left: "50%", top, zIndex: 80, width: width ?? (m ? 360 : 460),
      transform: `translate(-50%, ${(-1 + inP) * 90 - outP * 40}px)`, opacity: Math.min(1, inP * 1.4) * (1 - outP),
      background: "linear-gradient(180deg, rgba(23,29,44,0.98), rgba(15,19,27,0.98))",
      border: `1px solid ${rgba(col, 0.45)}`, borderRadius: 14,
      boxShadow: `0 18px 50px rgba(0,0,0,0.55), 0 0 26px ${rgba(col, 0.18)}`,
      display: "flex", alignItems: "center", gap: 12, padding: m ? "11px 13px" : "12px 15px"
    }}>
      {icon && (
        <div style={{
          width: m ? 34 : 36, height: m ? 34 : 36, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center",
          background: rgba(col, 0.14), border: `1px solid ${rgba(col, 0.4)}`, color: col
        }}>{icon}</div>
      )}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontFamily: F.text, fontWeight: 700, fontSize: m ? 13.5 : 14, color: C.text, lineHeight: 1.3 }}>{title}</div>
        {sub && <div style={{ fontFamily: F.text, fontSize: m ? 12 : 12.5, color: C.text2, lineHeight: 1.35 }}>{sub}</div>}
      </div>
    </div>
  );
};

/** The cyan call-to-action (.btn-cta / .acct-connect). */
export const CtaButton: React.FC<{ children: React.ReactNode; full?: boolean; h?: number; fs?: number; style?: React.CSSProperties; scale?: number; tone?: "plasma" | "neon" | "up" }> = ({
  children, full, h = 40, fs = 11.5, style, scale = 1, tone = "plasma"
}) => {
  const g = tone === "neon" ? `linear-gradient(180deg, ${C.neon}, #7c3aed)` : tone === "up" ? `linear-gradient(180deg, #4ade80, #16a34a)` : `linear-gradient(180deg, ${C.plasma}, #0891b2)`;
  return (
    <div style={{
      position: "relative", height: h, padding: "0 18px", borderRadius: 10, display: full ? "flex" : "inline-flex",
      width: full ? "100%" : undefined, alignItems: "center", justifyContent: "center", gap: 8,
      background: g, color: tone === "neon" ? "#faf5ff" : "#051018", fontFamily: F.display, fontWeight: 800, fontSize: fs,
      letterSpacing: fs * 0.13, textTransform: "uppercase", whiteSpace: "nowrap",
      boxShadow: `0 0 22px ${rgba(tone === "neon" ? C.neon : tone === "up" ? C.up : C.plasma, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.35)`,
      transform: `scale(${scale})`, ...style
    }}>{children}</div>
  );
};

/** The app's standard buttons (.btn.primary / .btn.secondary). */
export const Btn: React.FC<{ children: React.ReactNode; kind?: "primary" | "secondary" | "ghost"; full?: boolean; h?: number; fs?: number; style?: React.CSSProperties; scale?: number }> = ({
  children, kind = "primary", full, h = 38, fs = 13, style, scale = 1
}) => (
  <div style={{
    position: "relative", height: h, padding: "0 16px", borderRadius: 8, display: full ? "flex" : "inline-flex", width: full ? "100%" : undefined,
    alignItems: "center", justifyContent: "center", gap: 8, fontFamily: F.text, fontWeight: 700, fontSize: fs, whiteSpace: "nowrap",
    ...(kind === "primary"
      ? { background: `linear-gradient(180deg, ${C.plasma}, #0891b2)`, color: "#051018", boxShadow: `0 0 18px ${rgba(C.plasma, 0.3)}` }
      : kind === "secondary"
        ? { background: C.surfaceAlt, color: C.text, border: `1px solid ${C.borderStrong}` }
        : { background: "transparent", color: C.text2, border: `1px solid ${C.border}` }),
    transform: `scale(${scale})`, ...style
  }}>{children}</div>
);

export const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; glow?: boolean }> = ({ children, style, glow }) => (
  <div style={{
    position: "relative", background: "linear-gradient(180deg, rgba(19,24,36,0.92), rgba(13,16,23,0.92))",
    border: `1px solid ${glow ? rgba(C.neon, 0.32) : rgba(C.neon, 0.16)}`, borderRadius: 14,
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)", ...style
  }}>{children}</div>
);

/** Small uppercase mono label (.pt-k / .rb-k). */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string; size?: number; style?: React.CSSProperties }> = ({ children, color = C.text3, size = 10, style }) => (
  <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: size, letterSpacing: size * 0.14, textTransform: "uppercase", color, ...style }}>{children}</div>
);

export const Dot: React.FC<{ color: string; size?: number; pulse?: number }> = ({ color, size = 6, pulse = 0 }) => (
  <span style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0, boxShadow: `0 0 ${4 + pulse * 6}px ${color}` }} />
);

export const LockIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <rect x="5" y="11" width="14" height="10" rx="2.5" fill="none" stroke={color} strokeWidth="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const CheckIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const WalletIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <rect x="3" y="6" width="18" height="13" rx="3" fill="none" stroke={color} strokeWidth="2" />
    <path d="M16 12.5h3" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    <path d="M5 6l9-3 2 3" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

export const BellIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    <path d="M10 20.5a2 2 0 0 0 4 0" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);

export const SparkIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" fill={color} />
  </svg>
);

/** Blinking text caret for typed inputs. */
export const Caret: React.FC<{ beat: number; color?: string; h?: number }> = ({ beat, color = C.plasma, h = 18 }) => (
  <span style={{ display: "inline-block", width: 2, height: h, background: color, marginLeft: 2, verticalAlign: "middle", opacity: Math.floor(beat * 2) % 2 === 0 ? 1 : 0.15 }} />
);
