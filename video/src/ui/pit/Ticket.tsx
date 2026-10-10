import React from "react";
import { lerp, prog, usd2 } from "../../anim";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { PIT, PLAYERS, type Standing } from "../../timeline";
import { Avatar } from "../brand";
import { Caret, Touch, pressScale } from "../kit";

export type TicketProps = {
  m: boolean;
  beat: number;
  yes: number;
  vault: number;
  cash: number;
  position: string;
  pnl: number;
  stake: string;
  focused: boolean;
  focusAt: number;
  buyAt: number;
  quote: { shares: number; avgCents: number; afterCents: number };
  closesIn: string;
  filledP?: number; // 0..1 confirmation flash after the fill
};

const Row: React.FC<{ k: string; v: React.ReactNode; m: boolean; accent?: boolean }> = ({ k, v, m, accent }) => (
  <>
    <span style={{ fontFamily: F.text, fontSize: m ? 11.5 : 12.5, color: C.text2 }}>{k}</span>
    <b style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 12 : 13, color: accent ? C.up : C.text, textAlign: "right" }}>{v}</b>
  </>
);

/** The trading column of the cockpit in app/ArenaView.tsx (room-book ticket). */
export const Ticket: React.FC<TicketProps> = (t) => {
  const { m, beat } = t;
  const stakeNum = Number(t.stake || 0);
  const y = Math.round(t.yes);
  return (
    <div style={{
      borderRadius: 14, padding: m ? 13 : 16, display: "flex", flexDirection: "column", gap: m ? 10 : 12, position: "relative",
      background: "linear-gradient(180deg, rgba(19,24,36,0.94), rgba(13,16,23,0.94))", border: `1px solid ${rgba(C.neon, 0.2)}`
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: C.neon }}>{PIT.category}</div>
          <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: m ? 15 : 17, lineHeight: 1.25, color: C.text, marginTop: 3 }}>{PIT.question}</div>
        </div>
        <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
          {[[`${y}¢`, "▲ YES", C.up], [`${100 - y}¢`, "▼ NO", C.down]].map(([v, k, col]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <b style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 17 : 20, color: col }}>{v}</b>
              <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.text3 }}>{k}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.45fr 1fr", gap: 6 }}>
        {[["Vault", usd2(t.vault), C.text], ["Cash", usd2(t.cash), C.text], ["Position", t.position, C.text], ["Vault P&L", `${t.pnl >= 0 ? "+" : ""}${usd2(t.pnl)}`, t.pnl >= 0 ? C.up : C.down]].map(([k, v, col]) => (
          <div key={k} style={{ padding: m ? "6px 7px" : "7px 9px", borderRadius: 8, background: "rgba(10,13,19,0.6)", border: `1px solid ${C.border}`, minWidth: 0 }}>
            <div style={{ fontFamily: F.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: C.text3 }}>{k}</div>
            <div style={{ fontFamily: F.mono, fontWeight: 800, fontSize: m ? 11 : 12.5, color: col, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ fontFamily: F.text, fontSize: m ? 11 : 12, lineHeight: 1.45, color: C.text2 }}>
        Trading closes in <b style={{ fontFamily: F.mono, color: C.text }}>{t.closesIn}</b> — last call is 30s before the end. Every trade moves the room&apos;s odds — the bigger the trade, the further the price moves while it fills.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{
          height: m ? 40 : 42, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: F.text, fontWeight: 800, fontSize: m ? 13 : 14,
          color: C.up, background: rgba(C.up, 0.14), border: `1.5px solid ${rgba(C.up, 0.7)}`, boxShadow: `0 0 16px ${rgba(C.up, 0.2)}`
        }}>▲ YES <b style={{ fontFamily: F.mono }}>{y}¢</b></div>
        <div style={{
          height: m ? 40 : 42, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: F.text, fontWeight: 800, fontSize: m ? 13 : 14,
          color: C.text2, background: "rgba(10,13,19,0.5)", border: `1px solid ${C.border}`
        }}>▼ NO <b style={{ fontFamily: F.mono }}>{100 - y}¢</b></div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.text, fontSize: m ? 11 : 12, color: C.text2 }}>
          <span>Stake from your vault (USDC)</span><em style={{ fontStyle: "normal", color: C.text3 }}>{usd2(t.cash)} available</em>
        </div>
        <div style={{
          position: "relative", height: m ? 44 : 46, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 6px 0 12px", gap: 6,
          background: "rgba(10,13,19,0.8)", border: `1.5px solid ${t.focused ? rgba(C.plasma, 0.8) : C.borderStrong}`,
          boxShadow: t.focused ? `0 0 0 3px ${rgba(C.plasma, 0.15)}` : undefined
        }}>
          <span style={{ fontFamily: F.mono, fontSize: m ? 16 : 17, color: C.text3 }}>$</span>
          <span style={{ flex: 1, fontFamily: F.mono, fontWeight: 700, fontSize: m ? 18 : 20, color: t.stake ? C.text : C.text3 }}>
            {t.stake || usd2(t.cash).slice(1)}{t.focused && <Caret beat={beat} h={m ? 18 : 20} />}
          </span>
          <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 10.5, letterSpacing: 1, color: C.plasma, padding: "6px 9px", borderRadius: 7, border: `1px solid ${rgba(C.plasma, 0.35)}` }}>MAX</span>
          <Touch beat={beat} at={t.focusAt} dx={-40} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: m ? "5px 10px" : "6px 12px", padding: m ? "9px 11px" : "10px 13px", borderRadius: 10, background: "rgba(10,13,19,0.55)", border: `1px solid ${C.border}` }}>
        <Row m={m} k="Average fill" v={stakeNum > 0 ? <>{t.quote.avgCents.toFixed(1)}¢ <em style={{ fontStyle: "normal", color: C.text3, fontWeight: 500 }}>room {y}¢ YES now</em></> : "—"} />
        <Row m={m} k="Shares" v={t.quote.shares.toFixed(2)} />
        <Row m={m} k="Room after your trade" v={`${Math.round(stakeNum > 0 ? t.quote.afterCents : t.yes)}¢ YES`} />
        <Row m={m} k="Pays if YES wins" v={usd2(t.quote.shares)} accent />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1, transform: `scale(${pressScale(beat, t.buyAt)})` }}>
          <div style={{
            height: m ? 44 : 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.text, fontWeight: 800, fontSize: m ? 14 : 15,
            color: "#051018", background: `linear-gradient(180deg, ${C.plasma}, #0891b2)`, boxShadow: `0 0 ${20 + (t.filledP ?? 0) * 30}px ${rgba(C.plasma, 0.35 + (t.filledP ?? 0) * 0.4)}`
          }}>Buy YES</div>
          <Touch beat={beat} at={t.buyAt} dx={m ? 80 : 110} />
        </div>
        <div style={{
          height: m ? 44 : 46, padding: "0 14px", borderRadius: 10, display: "flex", alignItems: "center", fontFamily: F.text, fontWeight: 700, fontSize: m ? 12.5 : 13,
          color: C.text, background: C.surfaceAlt, border: `1px solid ${C.borderStrong}`
        }}>Sell all</div>
      </div>
    </div>
  );
};

/** The Standings roster (app/ArenaView.tsx). Rows glide when ranks change. */
export const Roster: React.FC<{ m: boolean; beat: number; now: Standing[]; before: Standing[]; changedAt: number; cut?: number | null; w: number | string; head?: string }> = ({
  m, beat, now, before, changedAt, cut, w, head
}) => {
  const rh = m ? 34 : 40;
  const k = prog(beat, changedAt, 0.55);
  return (
    <div style={{ width: w, borderRadius: 14, padding: m ? 10 : 12, background: "linear-gradient(180deg, rgba(19,24,36,0.94), rgba(13,16,23,0.94))", border: `1px solid ${rgba(C.neon, 0.18)}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 9.5 : 10.5, letterSpacing: 2, color: C.neon, textTransform: "uppercase" }}>Standings</span>
        {head && <span style={{ fontFamily: F.mono, fontSize: 10, color: C.xp }}>{head}</span>}
      </div>
      <div style={{ position: "relative", height: now.length * rh + (cut ? 16 : 0) }}>
        {now.map((s, i) => {
          const j = before.findIndex((b) => b.id === s.id);
          const yi = lerp(j < 0 ? i : j, i, k);
          const extra = cut && yi >= cut - 0.5 ? 16 : 0;
          const p = PLAYERS.find((pl) => pl.id === s.id)!;
          const me = s.id === "me";
          return (
            <div key={s.id} style={{
              position: "absolute", left: 0, right: 0, top: yi * rh + extra, height: rh - 4, display: "flex", alignItems: "center", gap: 8, padding: "0 8px", borderRadius: 8,
              background: me ? rgba(C.neon, 0.1) : "transparent", border: `1px solid ${me ? rgba(C.neon, 0.4) : "transparent"}`
            }}>
              <span style={{ width: 16, fontFamily: F.display, fontWeight: 800, fontSize: 11, color: C.text3 }}>{i + 1}</span>
              <Avatar seed={p.seed} size={m ? 20 : 24} radius={6} />
              <span style={{ flex: 1, fontFamily: F.text, fontWeight: 600, fontSize: m ? 11.5 : 12.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.name}{me && <em style={{ fontStyle: "normal", fontFamily: F.mono, fontSize: 8.5, color: C.neon, marginLeft: 5, textTransform: "uppercase", letterSpacing: 1 }}>you</em>}
              </span>
              <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 11.5 : 12.5, color: C.text }}>{usd2(s.vault)}</span>
              <span style={{ width: m ? 50 : 56, textAlign: "right", fontFamily: F.mono, fontWeight: 700, fontSize: m ? 10.5 : 11.5, color: s.pnl >= 0 ? C.plasma : C.down }}>
                {s.pnl >= 0 ? "+" : "−"}{usd2(Math.abs(s.pnl))}
              </span>
            </div>
          );
        })}
        {cut ? (
          <div style={{ position: "absolute", left: 0, right: 0, top: cut * rh + 2, height: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, borderTop: `1px dashed ${rgba(C.xp, 0.7)}` }} />
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 1, color: C.xp, textTransform: "uppercase" }}>elimination line</span>
            <span style={{ flex: 1, borderTop: `1px dashed ${rgba(C.xp, 0.7)}` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
};
