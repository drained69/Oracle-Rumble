import React from "react";
import { clamp, easeInOutCubic, lerp } from "./anim";
import { F } from "./fonts";
import { C, rgba } from "./theme";

export type Layout = "landscape" | "portrait";

export const COMP: Record<Layout, { w: number; h: number }> = {
  landscape: { w: 1920, h: 1080 },
  portrait: { w: 1080, h: 1920 }
};

/** The app's own viewport inside each device (CSS px). */
export const VIEW: Record<Layout, { w: number; h: number }> = {
  landscape: { w: 1120, h: 700 },
  portrait: { w: 390, h: 844 }
};

/** Phone content starts under the status bar. */
export const STATUS_BAR = 50;

/** Base scale + where the viewport centre sits on screen at rest. */
export const REST: Record<Layout, { scale: number; ax: number; ay: number }> = {
  landscape: { scale: 1180 / 1120, ax: 1282, ay: 566 },
  portrait: { scale: 1.9, ax: 540, ay: 700 + (844 * 1.9) / 2 }
};

export type CamKey = { beat: number; z?: number; fx?: number; fy?: number; ax?: number; ay?: number; tilt?: number };
export type Cam = { s: number; fx: number; fy: number; ax: number; ay: number; tilt: number };

/** Interpolate camera keys (missing fields fall back to the rest pose). */
export function cameraAt(layout: Layout, keys: CamKey[], beat: number): Cam {
  const r = REST[layout];
  const v = VIEW[layout];
  const full = (k: CamKey): Cam => ({
    s: r.scale * (k.z ?? 1), fx: k.fx ?? v.w / 2, fy: k.fy ?? v.h / 2, ax: k.ax ?? r.ax, ay: k.ay ?? r.ay, tilt: k.tilt ?? 1
  });
  if (beat <= keys[0].beat) return full(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (beat <= b.beat) {
      const t = easeInOutCubic((beat - a.beat) / Math.max(1e-6, b.beat - a.beat));
      const A = full(a), B = full(b);
      return { s: lerp(A.s, B.s, t), fx: lerp(A.fx, B.fx, t), fy: lerp(A.fy, B.fy, t), ax: lerp(A.ax, B.ax, t), ay: lerp(A.ay, B.ay, t), tilt: lerp(A.tilt, B.tilt, t) };
    }
  }
  return full(keys[keys.length - 1]);
}

/** Positions the device so the camera focus lands on the anchor point. */
export const DeviceRig: React.FC<{ layout: Layout; cam: Cam; beat: number; children: React.ReactNode; opacity?: number }> = ({ layout, cam, beat, children, opacity = 1 }) => {
  const zoomness = clamp((cam.s / REST[layout].scale - 1) / 0.35);
  const tilt = cam.tilt * (1 - zoomness);
  const ry = layout === "landscape" ? (-5 + Math.sin(beat * 0.21) * 1.6) * tilt : Math.sin(beat * 0.19) * 2.2 * tilt;
  const rx = layout === "landscape" ? (2.5 + Math.cos(beat * 0.17) * 1) * tilt : (3 + Math.cos(beat * 0.15) * 1.2) * tilt;
  return (
    <div style={{ position: "absolute", inset: 0, perspective: 2400, perspectiveOrigin: `${cam.ax}px ${cam.ay}px`, opacity }}>
      <div style={{
        position: "absolute", left: 0, top: 0, transformOrigin: "0 0",
        transform: `translate(${cam.ax - cam.s * cam.fx}px, ${cam.ay - cam.s * cam.fy}px) scale(${cam.s})`
      }}>
        <div style={{ transformOrigin: `${cam.fx}px ${cam.fy}px`, transform: `rotateX(${rx}deg) rotateY(${ry}deg)`, transformStyle: "preserve-3d" }}>
          {children}
        </div>
      </div>
    </div>
  );
};

/** Browser window around the 1120×700 viewport (landscape cut). Coordinates: viewport origin = (0,0). */
export const BrowserFrame: React.FC<{ url: string; children: React.ReactNode; glow?: number }> = ({ url, children, glow = 0 }) => {
  const v = VIEW.landscape;
  const chrome = 42;
  return (
    <div style={{ position: "relative", width: v.w, height: v.h }}>
      <div style={{
        position: "absolute", left: -1, top: -chrome - 1, width: v.w + 2, height: v.h + chrome + 2, borderRadius: 14,
        background: "#0c0f17", border: `1px solid ${C.borderStrong}`,
        boxShadow: `0 50px 140px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.03), 0 0 ${90 + glow * 60}px ${rgba(C.neon, 0.16 + glow * 0.2)}`
      }} />
      <div style={{ position: "absolute", left: 0, top: -chrome, width: v.w, height: chrome, display: "flex", alignItems: "center", padding: "0 16px", gap: 14, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, opacity: 0.9 }} />)}
        </div>
        <div style={{ display: "flex", gap: 12, color: C.text3, fontSize: 15, fontFamily: F.text }}><span>‹</span><span>›</span></div>
        <div style={{
          flex: 1, maxWidth: 560, margin: "0 auto", height: 26, borderRadius: 8, background: "#151a26", border: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontFamily: F.text, fontSize: 12.5, color: C.text2
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill={C.text3} /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={C.text3} strokeWidth="2.4" /></svg>
          <span><span style={{ color: C.text }}>trythepit.xyz</span>{url}</span>
        </div>
        <div style={{ width: 70 }} />
      </div>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "0 0 13px 13px", background: C.bg }}>{children}</div>
    </div>
  );
};

/** Phone around the 390×844 viewport (portrait cut). */
export const PhoneFrame: React.FC<{ children: React.ReactNode; glow?: number }> = ({ children, glow = 0 }) => {
  const v = VIEW.portrait;
  const bezel = 12;
  return (
    <div style={{ position: "relative", width: v.w, height: v.h }}>
      <div style={{
        position: "absolute", left: -bezel, top: -bezel, width: v.w + bezel * 2, height: v.h + bezel * 2, borderRadius: 60,
        background: "linear-gradient(145deg, #2a3042, #0b0d14 40%, #1d2231 100%)", padding: 2,
        boxShadow: `0 60px 140px rgba(0,0,0,0.7), 0 0 ${80 + glow * 60}px ${rgba(C.neon, 0.18 + glow * 0.2)}`
      }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 58, background: "#05070b" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, borderRadius: 48, overflow: "hidden", background: C.bg }}>
        {children}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: STATUS_BAR, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 30px 0 34px", zIndex: 100, background: "linear-gradient(180deg, rgba(10,13,19,1) 78%, rgba(10,13,19,0))" }}>
          <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: 15, color: C.text }}>9:41</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <svg width="17" height="11" viewBox="0 0 17 11">{[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4.5} y={8 - i * 2.6} width="3" height={3 + i * 2.6} rx="0.8" fill={C.text} />)}</svg>
            <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke={C.text} strokeOpacity="0.5" /><rect x="2" y="2" width="16" height="8" rx="1.8" fill={C.text} /><rect x="22.5" y="4" width="1.8" height="4" rx="0.8" fill={C.text} fillOpacity="0.5" /></svg>
          </span>
        </div>
        <div style={{ position: "absolute", left: "50%", top: 10, width: 118, height: 34, marginLeft: -59, borderRadius: 20, background: "#000", zIndex: 101 }} />
      </div>
    </div>
  );
};
