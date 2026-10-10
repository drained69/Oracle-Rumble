import React from "react";
import { clock, lerp, usd0, usd2 } from "../anim";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { PIT, SEAT } from "../timeline";
import { CtaButton, Dot, Panel, Touch, pressScale } from "./kit";
import { SeatRing } from "./SeatRing";

/** Example "more arenas" rows for the directory (made-up pits). */
const OTHERS = [
  { tier: "A", q: "Will the home team win tonight's final?", meta: "10/12 players · Live · 8:05", prize: 40 },
  { tier: "B", q: "BTC · Will Bitcoin be up in 5 minutes?", meta: "6/8 players · Live · 3:12", prize: 16 },
  { tier: "C", q: "ETH · Will Ethereum be up in 15 minutes?", meta: "3/6 players · Enrolling · 1:50", prize: 6 }
];

const tierStyle = (t: string): React.CSSProperties =>
  t === "S" || t === "A"
    ? { background: t === "S" ? `linear-gradient(180deg, ${C.gold}, #b45309)` : `linear-gradient(180deg, ${C.neon}, #6d28d9)`, color: t === "S" ? "#1a0f00" : "#f5f3ff" }
    : t === "B"
      ? { background: `linear-gradient(180deg, ${C.neon2}, #0369a1)`, color: "#ecfeff" }
      : { background: C.surfaceAlt, color: C.text2, border: `1px solid ${C.borderStrong}` };

/** app/ArenasDirectory.tsx — the lobby: what The Pit is, and the Join card. */
export const Lobby: React.FC<{
  m: boolean; beat: number; loaded: number; statsP: number; seats: number; lockSec: number; takeSeatAt: number; ringPulse?: number; host?: React.ReactNode;
}> = ({ m, beat, loaded, statsP, seats, lockSec, takeSeatAt, ringPulse = 0, host }) => {
  const pool = PIT.entry * seats;
  const hero = (
    <div style={{ width: m ? "auto" : 500, display: "flex", flexDirection: "column", gap: m ? 12 : 16 }}>
      <div style={{ fontFamily: F.text, fontWeight: 700, fontSize: m ? 10.5 : 12, letterSpacing: m ? 1.6 : 2.2, textTransform: "uppercase", color: C.text2, lineHeight: 1.5 }}>
        Trading pits on any prediction market · Solana
      </div>
      <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 33 : 46, lineHeight: 1.04, letterSpacing: m ? -0.4 : -0.9, textTransform: "uppercase" }}>
        <span style={{ background: "linear-gradient(180deg, #fff 0%, #d8b4fe 60%, #a855f7 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Any market.</span>
        <br />
        <span style={{ color: C.plasma, textShadow: `0 0 24px ${rgba(C.plasma, 0.45)}` }}>Outtrade</span>
        <br />
        <span style={{ color: C.text }}>the room.</span>
      </div>
      <p style={{ margin: 0, fontFamily: F.text, fontSize: m ? 13 : 14, lineHeight: 1.6, color: C.text2 }}>
        Host a pit on tonight&apos;s game, a question you write, or live BTC, ETH and SOL. Everyone takes the same seat and the same vault,
        {m ? " the room trades its own odds." : " the room trades its own odds, and the best vaults split the pool when the bell rings."}
      </p>
      {!m && (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            ["01", "Pick any market — an open Panta market, one you create in a minute, or BTC, ETH and SOL."],
            ["02", "Trade the room — every YES/NO trade moves the pit's odds. The Oracle reads the tape and Panta's line as you go."],
            ["03", "Finish on top — Panta's resolver or the closing price settles it, and payouts go straight to the top vaults' wallets."]
          ].map(([n, t]) => (
            <li key={n} style={{ display: "flex", gap: 14, fontFamily: F.text, fontSize: 13, lineHeight: 1.5, color: C.text2 }}>
              <b style={{ fontFamily: F.display, color: C.neon, fontSize: 11, paddingTop: 2 }}>{n}</b><span>{t}</span>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", gap: m ? 20 : 34, marginTop: m ? 2 : 6 }}>
        {[
          ["In prize pools", usd0(lerp(0, 214, statsP)), C.plasma],
          ["Players alive", String(Math.round(lerp(0, 37, statsP))), C.neon],
          ["Live rounds", String(Math.round(lerp(0, 6, statsP))), C.gold]
        ].map(([k, v, col]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: F.mono, fontSize: m ? 9 : 9.5, fontWeight: 700, letterSpacing: 1.3, textTransform: "uppercase", color: C.text3 }}>{k}</span>
            <b style={{ fontFamily: F.display, fontWeight: 800, fontSize: m ? 19 : 23, color: col, textShadow: `0 0 14px ${rgba(col, 0.4)}` }}>{v}</b>
          </div>
        ))}
      </div>
      {!m && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Non-custodial USDC escrow", "Markets by Panta", "0.1% platform fee"].map((t) => (
            <span key={t} style={{ fontFamily: F.mono, fontSize: 10.5, color: C.text2, padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.border}`, background: "rgba(19,24,36,0.6)" }}>✓ {t}</span>
          ))}
        </div>
      )}
    </div>
  );

  const featured = (
    <div style={{ opacity: loaded, transform: `translateY(${(1 - loaded) * 14}px)`, display: "flex", flexDirection: "column", gap: m ? 12 : 14 }}>
      <div style={{
        borderRadius: 12, padding: m ? 14 : 16, background: "linear-gradient(180deg, rgba(23,29,44,0.9), rgba(15,19,27,0.9))",
        border: `1px solid ${rgba(C.neon, 0.25)}`, display: "flex", flexDirection: "column", gap: 12
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontFamily: F.display, fontWeight: 800, fontSize: 9.5, letterSpacing: 1.6, textTransform: "uppercase",
            color: C.xp, padding: "4px 9px", borderRadius: 999, background: rgba(C.xp, 0.1), border: `1px solid ${rgba(C.xp, 0.4)}`
          }}><Dot color={C.xp} size={5} /> Enrolling</span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text2 }}>{PIT.code} · Round 1/{PIT.rounds}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, fontFamily: F.text, fontWeight: 700, fontSize: m ? 16 : 17.5, lineHeight: 1.3, color: C.text }}>{PIT.question}</div>
          <SeatRing taken={seats} capacity={PIT.capacity} pulse={ringPulse} scale={m ? 1 : 1.1} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px 8px" }}>
          {[
            ["Pool", usd2(pool), C.plasma],
            ["Seat", usd2(SEAT), C.text],
            ["Players", `${seats}/${PIT.capacity}`, C.text],
            ["Locks in", clock(lockSec), C.neon],
            ["Tier", "C", C.text]
          ].map(([k, v, col]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: F.mono, fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.text3 }}>{k}</span>
              <b style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 13 : 14, color: col }}>{v}</b>
            </div>
          ))}
        </div>
        <div style={{ position: "relative", transform: `scale(${pressScale(beat, takeSeatAt)})` }}>
          <CtaButton full h={m ? 42 : 42} fs={12}>Take a seat</CtaButton>
          <Touch beat={beat} at={takeSeatAt} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: C.text3 }}>More arenas · {OTHERS.length}</div>
        {OTHERS.slice(0, m ? 2 : 3).map((a) => (
          <div key={a.q} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(19,24,36,0.7)", border: `1px solid ${C.border}` }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center", fontFamily: F.display, fontWeight: 900, fontSize: 12, ...tierStyle(a.tier) }}>{a.tier}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontFamily: F.text, fontWeight: 600, fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.q}</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.text3 }}>{a.meta}</span>
            </span>
            <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 14, color: C.plasma }}>{usd0(a.prize)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const card = (
    <Panel glow style={{ width: m ? "auto" : 480, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {["Join", "Host"].map((t, i) => {
          const on = host ? i === 1 : i === 0;
          return (
            <div key={t} style={{
              flex: 1, padding: "13px 0", textAlign: "center", fontFamily: F.display, fontWeight: 800, fontSize: 11.5, letterSpacing: 2.2, textTransform: "uppercase",
              color: on ? C.neon : C.text3, boxShadow: on ? `inset 0 -2px 0 ${C.neon}` : undefined
            }}>● {t}</div>
          );
        })}
      </div>
      <div style={{ padding: m ? 12 : 16, minHeight: m ? 360 : 470, height: host ? 560 : undefined, overflow: host ? "hidden" : undefined, position: "relative" }}>
        {host ? host : <>
        {loaded < 1 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: 1 - loaded, fontFamily: F.text, fontSize: 13, color: C.text2 }}>Loading pits…</div>
        )}
        {featured}
        </>}
      </div>
    </Panel>
  );

  return m ? (
    <div style={{ padding: "18px 16px 0", display: "flex", flexDirection: "column", gap: 18 }}>{hero}{card}</div>
  ) : (
    <div style={{ padding: "30px 40px 0", display: "flex", gap: 40, alignItems: "flex-start" }}>{hero}{card}</div>
  );
};
