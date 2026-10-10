import React from "react";
import { F } from "../fonts";
import { C } from "../theme";

/**
 * The Pit mark — app/BrandMark.tsx, verbatim geometry: a tiered octagonal
 * trading pit seen from above, four stairways in, the price at the centre.
 * `glow` (0..1) lights the rings for the intro/outro.
 */
export const BrandMark: React.FC<{ size?: number; id?: string; glow?: number; tierPulse?: [number, number, number] }> = ({
  size = 34, id = "m", glow = 0, tierPulse = [0, 0, 0]
}) => {
  const gid = `pit-ring-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d8b4fe" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
        <filter id={`${gid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={1.6} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="15" fill="#0b0e17" stroke="#262b40" />
      <g filter={glow > 0 ? `url(#${gid}-glow)` : undefined}>
        <path d="M 53.25 40.80 L 40.80 53.25 L 23.20 53.25 L 10.75 40.80 L 10.75 23.20 L 23.20 10.75 L 40.80 10.75 L 53.25 23.20 Z"
          fill="none" stroke={`url(#${gid})`} strokeWidth={3 + tierPulse[0] * 1.2} strokeLinejoin="round" />
        <path d="M 46.78 38.12 L 38.12 46.78 L 25.88 46.78 L 17.22 38.12 L 17.22 25.88 L 25.88 17.22 L 38.12 17.22 L 46.78 25.88 Z"
          fill="none" stroke="#edf0f6" strokeOpacity={0.55 + tierPulse[1] * 0.45} strokeWidth="2" strokeLinejoin="round" />
        <path d="M 40.78 35.64 L 35.64 40.78 L 28.36 40.78 L 23.22 35.64 L 23.22 28.36 L 28.36 23.22 L 35.64 23.22 L 40.78 28.36 Z"
          fill="#131826" stroke="#edf0f6" strokeOpacity={0.35 + tierPulse[2] * 0.5} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M 53.25 32 H 40.78 M 10.75 32 H 23.22 M 32 10.75 V 23.22 M 32 53.25 V 40.78"
          stroke="#edf0f6" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
        <path d="M 35.70 33.53 L 33.53 35.70 L 30.47 35.70 L 28.30 33.53 L 28.30 30.47 L 30.47 28.30 L 33.53 28.30 L 35.70 30.47 Z"
          fill={`url(#${gid})`} />
      </g>
    </svg>
  );
};

/** Two-tone wordmark (app/BrandMark.tsx + .wordmark in globals.css). */
export const Wordmark: React.FC<{ size?: number; gap?: number }> = ({ size = 15, gap }) => (
  <span style={{ fontFamily: F.display, fontWeight: 900, fontSize: size, letterSpacing: size * 0.2, display: "inline-flex", gap: gap ?? size * 0.42, lineHeight: 1 }}>
    <span style={{ color: "#f4f6fb" }}>THE</span>
    <span style={{ color: C.neon }}>PIT</span>
  </span>
);

/** The X logo (app/SiteHeader.tsx). */
export const XLogo: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = "currentColor" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: "block" }}>
    <path fill={color} d="M13.6 10.7 18.9 4.5h-1.3l-4.6 5.4-3.7-5.4H5l5.6 8.1L5 19.5h1.3l4.9-5.7 3.9 5.7h4.3l-5.8-8.8Zm-1.7 2-.6-.8-4.5-6.4h1.9l3.6 5.2.6.8 4.7 6.7h-1.9l-3.8-5.5Z" />
  </svg>
);

// ── Procedural avatars — same algorithm as lib/avatars.ts ─────────────
const PALETTES = [
  { skin: "#00ff9d", trim: "#00cf7c" },
  { skin: "#ffb54c", trim: "#d18f2e" },
  { skin: "#45f0d4", trim: "#2ec7ae" },
  { skin: "#ff4d6a", trim: "#c73e58" },
  { skin: "#a774ff", trim: "#8757d9" },
  { skin: "#4dc0ff", trim: "#2b95c9" },
  { skin: "#ffe14d", trim: "#c9b02f" },
  { skin: "#f37ba1", trim: "#c95b83" }
];
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export const Avatar: React.FC<{ seed: string; size?: number; radius?: number; style?: React.CSSProperties }> = ({ seed, size = 24, radius, style }) => {
  const h = fnv(seed);
  const face = h % 6;
  const pal = PALETTES[(h >>> 8) % PALETTES.length];
  const eyeGap = face % 2 === 0 ? 4 : 5;
  const mouth = face < 2 ? "M 10 17 Q 12 19 14 17" : face < 4 ? "M 10 17 L 14 17" : "M 10 18 L 12 16 L 14 18";
  const helmY = face % 3 === 0 ? 6 : 5;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: "block", borderRadius: radius ?? size * 0.25, flexShrink: 0, ...style }}>
      <rect x="0" y="0" width="24" height="24" rx="6" fill="#101a30" />
      <path d={`M4 ${helmY} L 12 3 L 20 ${helmY} L 20 14 L 12 20 L 4 14 Z`} fill={pal.skin} stroke={pal.trim} strokeWidth="1" />
      <circle cx={12 - eyeGap / 2} cy="12" r="1.2" fill="#070b16" />
      <circle cx={12 + eyeGap / 2} cy="12" r="1.2" fill="#070b16" />
      <path d={mouth} stroke="#070b16" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
};
