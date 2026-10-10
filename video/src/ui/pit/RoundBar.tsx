import React from "react";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { PIT } from "../../timeline";
import { Dot } from "../kit";

export type Status = "enrolling" | "live" | "settling" | "advancing" | "complete";
const STATUS_LABEL: Record<Status, string> = { enrolling: "Enrolling", live: "Live", settling: "Settling", advancing: "Advancing", complete: "Complete" };
const STATUS_COLOR: Record<Status, string> = { enrolling: C.xp, live: C.plasma, settling: C.text2, advancing: C.text2, complete: C.gold };

export type RoundBarProps = {
  m: boolean;
  round: number;
  status: Status;
  clockLabel: string;
  clock: string;
  pool: number;
  alive: number;
  total: number;
  yes: number;
  line: number | null;
  survive?: number | null;
  flash?: number; // 0..1 status-change flash
  question?: string;
  category?: string;
};

const Cell: React.FC<{ k: string; children: React.ReactNode; grow?: boolean; m: boolean; last?: boolean }> = ({ k, children, grow, m, last }) => (
  <div style={{
    padding: m ? "8px 10px" : "10px 14px", display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: grow ? 1 : undefined,
    borderRight: last ? "none" : `1px solid ${C.border}`
  }}>
    <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 8.5 : 9, letterSpacing: 1.3, textTransform: "uppercase", color: C.text3, whiteSpace: "nowrap" }}>{k}</span>
    <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 13 : 14, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
  </div>
);

/** The round bar from app/ArenaView.tsx. */
export const RoundBar: React.FC<RoundBarProps> = ({ m, round, status, clockLabel, clock, pool, alive, total, yes, line, survive, flash = 0, question = PIT.question, category = PIT.category }) => {
  const col = STATUS_COLOR[status];
  const pill = (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: m ? "3px 8px" : "4px 9px", borderRadius: 999, fontFamily: F.display, fontWeight: 800,
      fontSize: m ? 9 : 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: col, background: rgba(col, 0.1 + flash * 0.25),
      boxShadow: flash > 0 ? `0 0 ${18 * flash}px ${rgba(col, 0.8 * flash)}` : undefined
    }}><Dot color={col} size={5} />{STATUS_LABEL[status]}</span>
  );
  const shell: React.CSSProperties = {
    margin: m ? "10px 10px 0" : "12px 14px 0", borderRadius: 14, overflow: "hidden",
    background: "linear-gradient(180deg, rgba(19,24,36,0.88), rgba(15,19,27,0.7))",
    border: `1px solid ${rgba(C.neon, 0.22)}`, boxShadow: "0 12px 40px rgba(0,0,0,0.4)"
  };
  const yesNo = <><span style={{ color: C.plasma }}>{Math.round(yes)}¢</span> <em style={{ color: C.text3, fontStyle: "normal", fontWeight: 500 }}>/</em> <span style={{ color: C.down }}>{100 - Math.round(yes)}¢</span></>;
  const gap = line !== null ? Math.round(yes) - line : 0;
  if (m) {
    return (
      <div style={shell}>
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
          <Cell m k="Round">{round} <em style={{ color: C.text3, fontStyle: "normal", fontWeight: 500 }}>/ {PIT.rounds}</em></Cell>
          <Cell m k="Status">{pill}</Cell>
          <Cell m k={clockLabel}><span style={{ fontFamily: F.mono }}>{clock}</span></Cell>
          <Cell m k="Prize pool" last><span style={{ color: C.plasma }}>${Math.round(pool)}</span></Cell>
        </div>
        <div style={{ display: "flex" }}>
          <Cell m k={`Market · ${category}`} grow><span style={{ fontFamily: F.text, fontWeight: 600, fontSize: 12.5 }}>{question}</span></Cell>
          <Cell m k="Room YES / NO" last>{yesNo}</Cell>
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...shell, display: "flex" }}>
      <Cell m={false} k="Round">{round} <em style={{ color: C.text3, fontStyle: "normal", fontWeight: 500 }}>/ {PIT.rounds}</em></Cell>
      <Cell m={false} k="Status">{pill}</Cell>
      <Cell m={false} k={clockLabel}><span style={{ fontFamily: F.mono }}>{clock}</span></Cell>
      <Cell m={false} k="Prize pool"><span style={{ color: C.plasma, textShadow: `0 0 12px ${rgba(C.plasma, 0.35)}` }}>${Math.round(pool)}</span></Cell>
      <Cell m={false} k="Alive">{alive} <em style={{ color: C.text3, fontStyle: "normal", fontWeight: 500 }}>/ {total}</em></Cell>
      {survive ? <Cell m={false} k="Survive"><span style={{ color: C.xp }}>Top {survive}</span></Cell> : null}
      <Cell m={false} k={`Market · ${category}`} grow><span style={{ fontFamily: F.text, fontWeight: 600, fontSize: 13 }}>{question}</span></Cell>
      <Cell m={false} k="Room YES / NO">{yesNo}</Cell>
      {line !== null && (
        <Cell m={false} k="Panta line" last>
          <span style={{ fontFamily: F.mono }}>{line}¢ <em style={{ fontStyle: "normal", fontSize: 11, color: gap > 0 ? C.plasma : gap < 0 ? C.down : C.text3 }}>room {gap >= 0 ? "+" : "−"}{Math.abs(gap)}¢</em></span>
        </Cell>
      )}
    </div>
  );
};
