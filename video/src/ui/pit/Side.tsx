import React from "react";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { R2 } from "../../timeline";
import { SparkIcon } from "../kit";

const shell: React.CSSProperties = {
  borderRadius: 14, background: "linear-gradient(180deg, rgba(19,24,36,0.94), rgba(13,16,23,0.94))", border: `1px solid ${rgba(C.neon, 0.18)}`
};
const K: React.FC<{ children: React.ReactNode; m: boolean }> = ({ children, m }) => (
  <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 9.5 : 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.text2, display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
);

/** "Where the room's money sits" (app/PitTerminal.tsx). */
export const Money: React.FC<{ m: boolean; yesShare: number | null; longYes: number; longNo: number; flat: number; w: number | string }> = ({ m, yesShare, longYes, longNo, flat, w }) => (
  <div style={{ ...shell, width: w, padding: m ? 11 : 13, display: "flex", flexDirection: "column", gap: 8 }}>
    <K m={m}>Where the room&apos;s money sits</K>
    {yesShare === null ? (
      <p style={{ margin: 0, fontFamily: F.text, fontSize: m ? 11.5 : 12.5, lineHeight: 1.45, color: C.text3 }}>
        Hidden until trading opens — seat calls stay secret while the pit fills.
      </p>
    ) : (
      <>
        <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", gap: 2 }}>
          <span style={{ width: `${Math.max(2, yesShare * 100)}%`, background: `linear-gradient(90deg, ${C.plasma}, #0891b2)`, boxShadow: `0 0 10px ${rgba(C.plasma, 0.5)}` }} />
          <span style={{ flex: 1, background: `linear-gradient(90deg, #be123c, ${C.down})` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: F.mono, fontSize: m ? 10.5 : 11, color: C.text2, whiteSpace: "nowrap" }}>
          <span><b style={{ color: C.plasma }}>YES {Math.round(yesShare * 100)}%</b> · {longYes}</span>
          <span><b style={{ color: C.down }}>NO {Math.round((1 - yesShare) * 100)}%</b> · {longNo}</span>
        </div>
        {flat > 0 && <div style={{ fontFamily: F.text, fontSize: 11, color: C.text3 }}>{flat} in cash</div>}
      </>
    )}
  </div>
);

/** The Oracle read (app/PitTerminal.tsx + lib/market-read.ts wording). */
export const OracleRead: React.FC<{ m: boolean; w: number | string; glow?: number }> = ({ m, w, glow = 0 }) => {
  const o = R2.oracle;
  const gap = o.yes - o.panta;
  const headline = `YES trades ${o.yes}¢, ${Math.abs(gap)}¢ ${gap > 0 ? "rich" : "cheap"} to Panta's ${o.panta}¢ line. Momentum up ${o.momentum}¢ in the last minute.`;
  const chips: Array<[string, string, "up" | "down" | "flat"]> = [
    ["vs Panta", `${gap > 0 ? "+" : "−"}${Math.abs(gap)}¢`, gap > 0 ? "up" : "down"],
    ["1-min move", `+${o.momentum.toFixed(1)}¢`, "up"],
    ["Room money", `${Math.round(o.roomYesShare * 100)}% YES`, "flat"],
    ["Bell", o.bell, "flat"]
  ];
  return (
    <div style={{
      ...shell, width: w, padding: m ? 12 : 14, display: "flex", flexDirection: "column", gap: 9,
      border: `1px solid ${rgba(C.neon, 0.3 + glow * 0.4)}`, boxShadow: `0 0 ${30 * glow}px ${rgba(C.neon, 0.3 * glow)}, 0 16px 40px rgba(0,0,0,0.4)`
    }}>
      <K m={m}>
        <span style={{ color: C.neon, display: "flex" }}><SparkIcon size={13} /></span> Oracle read
        <span style={{ marginLeft: "auto", fontSize: 9, letterSpacing: 1, padding: "3px 7px", borderRadius: 6, color: C.text2, border: `1px solid ${C.borderStrong}` }}>from market data</span>
      </K>
      <p style={{ margin: 0, fontFamily: F.text, fontWeight: 600, fontSize: m ? 13 : 14, lineHeight: 1.45, color: C.text }}>{headline}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 10.5 : 11.5, letterSpacing: 1.2, textTransform: "uppercase", padding: "5px 10px", borderRadius: 999, color: C.up, background: rgba(C.up, 0.12), border: `1px solid ${rgba(C.up, 0.45)}` }}>
          Lean YES
        </span>
        <span style={{ fontFamily: F.mono, fontSize: m ? 10.5 : 11.5, color: C.text2 }}>medium confidence</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {chips.map(([k, v, tone]) => (
          <div key={k} style={{ padding: "6px 7px", borderRadius: 8, background: "rgba(10,13,19,0.6)", border: `1px solid ${C.border}`, minWidth: 0 }}>
            <div style={{ fontFamily: F.mono, fontSize: 8, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: C.text3, whiteSpace: "nowrap" }}>{k}</div>
            <div style={{ fontFamily: F.mono, fontWeight: 800, fontSize: m ? 11 : 12, color: tone === "up" ? C.up : tone === "down" ? C.down : C.text, whiteSpace: "nowrap" }}>{v}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontFamily: F.text, fontSize: m ? 10 : 10.5, color: C.text3 }}>A read of the pit&apos;s own data — price, flow, Panta&apos;s line and the clock. Not advice.</p>
    </div>
  );
};
