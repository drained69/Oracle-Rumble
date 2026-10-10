import React from "react";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { Avatar } from "../brand";

export type PodState = "winner" | "eliminated" | "below" | "line" | "safe" | "ready" | "empty";
const STATE_LABEL: Record<PodState, string> = {
  winner: "Winner", eliminated: "Eliminated", below: "Below cut", line: "On the line", safe: "Safe", ready: "Ready", empty: ""
};

export type Pod = {
  key: string;
  name: string;
  seed: string;
  rank: string; // "#1" or "OUT"
  bank: number;
  pnl: number;
  side: "YES" | "NO" | null;
  state: PodState;
  x: number; // % of stage
  y: number; // %
  opacity?: number;
  scale?: number;
  dy?: number; // px drop
  me?: boolean;
  pulse?: number; // trade pulse 0..1
  hideMoney?: boolean;
};

/** Even spacing on an ellipse, rank #1 at 12 o'clock (app/ArenaStage.tsx pinFor). */
export function pinFor(i: number, total: number, rx = 40, ry = 33): { x: number; y: number } {
  const a = -Math.PI / 2 + (i / Math.max(1, total)) * Math.PI * 2;
  return { x: 50 + Math.cos(a) * rx, y: 50 + Math.sin(a) * ry };
}

const PodView: React.FC<{ p: Pod; m: boolean; w: number; h: number }> = ({ p, m, w, h }) => {
  const width = m ? 80 : 104;
  const hx = width / 2 + 6;
  const hy = m ? 44 : 58;
  const left = Math.min(Math.max((p.x / 100) * w, hx), w - hx);
  const top = Math.min(Math.max((p.y / 100) * h, hy), h - hy);
  const st = p.state;
  const border =
    st === "winner" ? rgba(C.gold, 0.85) : st === "below" ? rgba(C.xp, 0.75) : st === "line" ? rgba(C.xp, 0.45) :
    st === "eliminated" ? rgba(C.down, 0.35) : p.me ? rgba(C.neon, 0.65) : C.border;
  const glow =
    st === "winner" ? `0 0 40px ${rgba(C.gold, 0.4)}` : st === "below" ? `0 0 22px ${rgba(C.xp, 0.22)}` : p.me ? `0 0 22px ${rgba(C.neon, 0.25)}` : "none";
  const pulse = p.pulse ?? 0;
  const pill: React.CSSProperties =
    st === "winner" ? { color: "#1a1204", background: C.gold } :
    st === "below" ? { color: "#0f131b", background: C.xp } :
    st === "line" ? { color: "#fdba74", background: rgba(C.xp, 0.12) } :
    st === "eliminated" ? { color: "#fda4af", background: rgba(C.down, 0.14) } :
    { color: C.text2, background: "rgba(148,163,184,0.1)" };
  if (st === "empty") {
    return (
      <div style={{
        position: "absolute", left, top, width: m ? 46 : 56, height: m ? 46 : 56, transform: "translate(-50%,-50%)", borderRadius: 12,
        border: `1px dashed ${rgba(C.neon, 0.3)}`, opacity: p.opacity ?? 1, display: "grid", placeItems: "center",
        fontFamily: F.mono, fontSize: m ? 9 : 10, color: C.text3
      }}>open</div>
    );
  }
  const av = m ? 22 : 30;
  return (
    <div style={{
      position: "absolute", left, top, width, padding: m ? "6px 5px 5px" : "8px 7px 7px",
      transform: `translate(-50%, calc(-50% + ${p.dy ?? 0}px)) scale(${(p.scale ?? 1) * (st === "winner" ? 1.08 : 1)})`,
      background: "linear-gradient(180deg, rgba(19,24,36,0.97), rgba(15,19,27,0.93))", border: `1px solid ${border}`, borderRadius: m ? 10 : 12,
      boxShadow: pulse > 0 ? `${glow === "none" ? "" : glow + ","} 0 0 ${26 * pulse}px ${rgba(p.side === "NO" ? C.down : C.plasma, 0.55 * pulse)}` : glow,
      display: "flex", flexDirection: "column", alignItems: "center", gap: m ? 2 : 3,
      opacity: p.opacity ?? 1, filter: st === "eliminated" ? "grayscale(0.8)" : undefined, zIndex: st === "winner" ? 3 : p.me ? 2 : 1
    }}>
      <span style={{ position: "absolute", left: m ? 6 : 8, top: m ? 5 : 7, fontFamily: F.display, fontWeight: 800, fontSize: m ? 8.5 : 10, letterSpacing: 0.6, color: st === "winner" ? C.gold : st === "eliminated" ? C.down : C.neon }}>{p.rank}</span>
      {p.side && st !== "eliminated" && (
        <span style={{ position: "absolute", right: m ? 6 : 8, top: m ? 5 : 7, fontFamily: F.mono, fontWeight: 800, fontSize: m ? 8 : 9.5, color: p.side === "YES" ? C.plasma : C.down }}>{p.side === "YES" ? "▲" : "▼"}</span>
      )}
      <Avatar seed={p.seed} size={av} radius={m ? 6 : 8} style={{ border: `1px solid ${C.border}` }} />
      <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: m ? 9.5 : 11.5, color: C.text, maxWidth: width - 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.15 }}>
        {p.name}{p.me && <em style={{ fontStyle: "normal", fontFamily: F.mono, fontSize: m ? 7 : 8, letterSpacing: 0.8, color: C.neon, marginLeft: 3, textTransform: "uppercase" }}>you</em>}
      </span>
      {!p.hideMoney && (
        <span style={{ display: "flex", alignItems: "baseline", gap: m ? 4 : 5, lineHeight: 1.1 }}>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 10.5 : 12.5, color: C.text }}>${p.bank.toFixed(2)}</span>
          <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 8.5 : 10, color: p.pnl >= 0 ? C.plasma : C.down }}>{p.pnl >= 0 ? "+" : "−"}{Math.abs(p.pnl).toFixed(2)}</span>
        </span>
      )}
      <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 7.5 : 8.5, letterSpacing: 0.9, textTransform: "uppercase", padding: m ? "1px 5px" : "2px 7px", borderRadius: 999, marginTop: 1, whiteSpace: "nowrap", ...pill }}>
        {STATE_LABEL[st]}
      </span>
    </div>
  );
};

export type OrbProps = { label: string; price: number; sub: string; subTone?: "up" | "down" | "flat"; live: boolean; spin: number; yes: number; flash?: number };

/** The centre of a Panta pit's stage (PantaOrb in app/ArenaStage.tsx). */
const Orb: React.FC<OrbProps & { m: boolean }> = ({ label, price, sub, subTone = "flat", live, spin, yes, flash = 0, m }) => {
  const up = yes >= 50;
  const col = up ? C.plasma : C.down;
  const size = m ? 128 : 156;
  return (
    <div style={{
      position: "absolute", left: "50%", top: "50%", width: size, height: size, transform: "translate(-50%,-50%)", borderRadius: "50%",
      display: "grid", placeItems: "center", zIndex: 1,
      background: "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.12), transparent 55%), linear-gradient(180deg, #131824 0%, #0a0d13 100%)",
      border: `2px solid ${rgba(col, 0.55 + flash * 0.4)}`,
      boxShadow: `0 0 ${56 + flash * 50}px ${rgba(col, 0.25 + flash * 0.35)}, inset 0 0 36px ${rgba(col, 0.08)}`
    }}>
      <div style={{ position: "absolute", inset: -9, borderRadius: "50%", border: `1px dashed ${col}`, opacity: 0.35, transform: `rotate(${live ? spin : 0}deg)` }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: m ? 2 : 3, zIndex: 1 }}>
        <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 8 : 9.5, letterSpacing: 1.8, color: C.text3, textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 34 : 42, color: C.text, lineHeight: 1 }}>
          {Math.round(price)}<em style={{ fontStyle: "normal", fontSize: m ? 15 : 18, color: C.text3, marginLeft: 2 }}>¢</em>
        </span>
        <span style={{
          fontFamily: F.mono, fontSize: m ? 8 : 9.5, textAlign: "center", maxWidth: size - 26, lineHeight: 1.3,
          color: subTone === "up" ? C.plasma : subTone === "down" ? C.down : C.text3
        }}>{sub}</span>
        <span style={{ display: "flex", gap: 8, fontFamily: F.mono, fontWeight: 700, fontSize: m ? 8.5 : 10 }}>
          <span style={{ color: C.plasma }}>YES {Math.round(yes)}¢</span>
          <span style={{ color: C.down }}>NO {100 - Math.round(yes)}¢</span>
        </span>
      </div>
    </div>
  );
};

/** app/ArenaStage.tsx — the arena: orb, pods around it, the cut line. */
export const Stage: React.FC<{
  m: boolean; w: number; h: number; pods: Pod[]; orb: OrbProps; legend: React.ReactNode; legendTone?: "cut" | "muted";
  cutAngle?: number | null; cutOpacity?: number; champion?: { name: string; prize: string; p: number } | null;
}> = ({ m, w, h, pods, orb, legend, legendTone = "muted", cutAngle, cutOpacity = 1, champion }) => (
  <div style={{
    position: "relative", width: w, height: h, borderRadius: 18, overflow: "hidden",
    background: "radial-gradient(circle at 50% 50%, rgba(192,132,252,0.12), transparent 55%), linear-gradient(180deg, #101423 0%, #0a0d13 100%)",
    border: `1px solid ${rgba(C.neon, 0.22)}`, boxShadow: "inset 0 0 40px rgba(0,0,0,0.4)"
  }}>
    <div style={{
      position: "absolute", inset: 0,
      backgroundImage: "repeating-linear-gradient(0deg, transparent 0 39px, rgba(192,132,252,0.05) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(192,132,252,0.05) 39px 40px)",
      WebkitMaskImage: "radial-gradient(closest-side, black 60%, transparent 100%)", maskImage: "radial-gradient(closest-side, black 60%, transparent 100%)"
    }} />
    <div style={{ position: "absolute", left: "50%", top: "50%", width: "80%", height: "66%", transform: "translate(-50%,-50%)", borderRadius: "50%", border: `1px dashed ${rgba(C.neon, 0.14)}` }} />
    <div style={{ position: "absolute", left: 12, top: 11, zIndex: 4 }}>
      <span style={{
        fontFamily: F.mono, fontSize: m ? 9.5 : 10.5, letterSpacing: 0.8, padding: "5px 10px", borderRadius: 999,
        ...(legendTone === "cut"
          ? { color: C.xp, background: rgba(C.xp, 0.1), border: `1px solid ${rgba(C.xp, 0.35)}` }
          : { color: C.text2, background: "rgba(15,19,27,0.7)", border: `1px solid ${C.border}` })
      }}>{legend}</span>
    </div>
    <Orb {...orb} m={m} />
    {cutAngle != null && (
      <div style={{
        position: "absolute", left: "50%", top: "50%", width: "38%", height: 0, transformOrigin: "0 0", transform: `rotate(${cutAngle}deg)`,
        borderTop: `2px dashed ${rgba(C.xp, 0.75)}`, opacity: cutOpacity, zIndex: 0
      }}>
        <span style={{
          position: "absolute", right: -8, top: -10, transform: `rotate(${-cutAngle}deg)`, fontFamily: F.display, fontWeight: 800, fontSize: m ? 8 : 9,
          letterSpacing: 1.4, color: C.xp, background: "#0f131b", padding: "2px 6px", borderRadius: 6, border: `1px solid ${rgba(C.xp, 0.5)}`
        }}>CUT</span>
      </div>
    )}
    {pods.map((p) => <PodView key={p.key} p={p} m={m} w={w} h={h} />)}
    {champion && champion.p > 0 && (
      <div style={{
        position: "absolute", left: "50%", bottom: m ? 14 : 18, transform: `translate(-50%, ${(1 - champion.p) * 20}px)`, opacity: champion.p, zIndex: 5,
        textAlign: "center", padding: m ? "8px 16px" : "10px 22px", borderRadius: 14, background: "rgba(15,19,27,0.92)", border: `1px solid ${rgba(C.gold, 0.6)}`,
        boxShadow: `0 0 40px ${rgba(C.gold, 0.25)}`
      }}>
        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 8.5 : 10, letterSpacing: 2, color: C.gold, textTransform: "uppercase" }}>Champion</div>
        <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: m ? 15 : 18, color: C.text }}>{champion.name}</div>
        <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 11 : 12.5, color: C.gold }}>{champion.prize}</div>
      </div>
    )}
  </div>
);
