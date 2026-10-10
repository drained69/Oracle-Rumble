import React from "react";
import { prog, usd2 } from "../../anim";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { ME, PIT, SEAT } from "../../timeline";
import { Avatar, XLogo } from "../brand";
import { CheckIcon, Touch, pressScale } from "../kit";

export type SeatStep = "" | "approve" | "confirming" | "seating";

/** "Take your seat" — the seat modal of app/ArenaView.tsx for a Panta pit. */
export const SeatModal: React.FC<{ m: boolean; beat: number; picked: boolean; yesAt: number; depositAt: number; step: SeatStep; lockIn: string; entryAt?: number; vaultAt?: number }> = ({
  m, beat, picked, yesAt, depositAt, step, lockIn, entryAt = -99, vaultAt = -99
}) => {
  const stake = PIT.vault / 2;
  const cta = step === "approve" ? "Approve the deposit…" : step === "confirming" ? "Confirming on Solana…" : step === "seating" ? "Taking your seat…"
    : picked ? `Deposit ${usd2(SEAT)} & call YES` : "Pick YES, NO or decide later";
  const busy = step !== "";
  return (
    <div style={{
      width: m ? 366 : 500, borderRadius: 18, padding: m ? "16px 15px 15px" : "22px 24px 20px", position: "relative",
      background: "linear-gradient(180deg, #161c2b 0%, #0f131b 100%)", border: `1px solid ${rgba(C.neon, 0.35)}`,
      boxShadow: `0 30px 80px rgba(0,0,0,0.65), 0 0 50px ${rgba(C.neon, 0.12)}`, display: "flex", flexDirection: "column", gap: m ? 10 : 12
    }}>
      <div style={{ position: "absolute", right: 14, top: 10, fontSize: 20, color: C.text3, fontFamily: F.text }}>×</div>
      <div>
        <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 18 : 22, color: C.text, letterSpacing: 0.4, textTransform: "uppercase" }}>Take your seat</div>
        <div style={{ fontFamily: F.text, fontSize: m ? 11.5 : 12.5, color: C.text2, marginTop: 4 }}>Pit <b style={{ color: C.text }}>{PIT.code}</b> · {PIT.question}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontFamily: F.text, fontSize: m ? 11.5 : 12.5, color: C.text2 }}>Your call · Panta has YES at <b style={{ color: C.text }}>{PIT.line}¢</b></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {([["YES", "▲", "It happens — the market resolves YES", C.up], ["NO", "▼", "It doesn't — the market resolves NO", C.down]] as const).map(([k, arrow, d, col]) => {
            const on = picked && k === "YES";
            return (
              <div key={k} style={{
                position: "relative", borderRadius: 12, padding: m ? "10px 10px" : "12px 13px", display: "flex", flexDirection: "column", gap: 3,
                background: on ? rgba(col, 0.14) : "rgba(10,13,19,0.6)", border: `1.5px solid ${on ? rgba(col, 0.8) : C.border}`,
                boxShadow: on ? `0 0 22px ${rgba(col, 0.25)}` : undefined, transform: k === "YES" ? `scale(${pressScale(beat, yesAt)})` : undefined
              }}>
                <span style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 16 : 18, color: col }}>{arrow} {k}</span>
                <span style={{ fontFamily: F.text, fontSize: m ? 10.5 : 11.5, lineHeight: 1.35, color: C.text2 }}>{d}</span>
                {on && <span style={{ position: "absolute", right: 9, top: 9, color: col }}><CheckIcon size={16} /></span>}
                {k === "YES" && <Touch beat={beat} at={yesAt} />}
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "center", fontFamily: F.text, fontSize: m ? 11 : 12, color: C.text3, padding: "7px 0", borderRadius: 9, border: `1px dashed ${C.border}` }}>Decide when trading opens</div>
      </div>

      <div style={{ opacity: picked ? 1 : 0.35, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.text3 }}>On the call</span>
        <div style={{ display: "flex", gap: 6, flex: 1 }}>
          {[["25%", 2.5], ["Half", 5], ["All", 10]].map(([l, v]) => {
            const on = picked && l === "Half";
            return (
              <div key={l as string} style={{
                flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 8, fontFamily: F.text, fontWeight: 700, fontSize: m ? 11.5 : 12.5,
                color: on ? C.text : C.text2, background: on ? rgba(C.neon, 0.16) : "rgba(10,13,19,0.6)", border: `1px solid ${on ? rgba(C.neon, 0.6) : C.border}`
              }}>{l} <em style={{ fontStyle: "normal", fontFamily: F.mono, fontSize: 10.5, color: C.text3 }}>{usd2(v as number)}</em></div>
            );
          })}
        </div>
      </div>
      {picked && (
        <div style={{ fontFamily: F.text, fontSize: m ? 11 : 12, lineHeight: 1.45, color: C.text2 }}>
          When enrollment locks, {usd2(stake)} of your {usd2(PIT.vault)} vault buys <b style={{ color: C.up }}>YES</b> at the opening price — Panta&apos;s line, each paying $1 if you&apos;re right.
        </div>
      )}

      {!m && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: F.text, fontSize: 12, color: C.text2 }}>
          <div><b style={{ color: C.text }}>Enrollment</b> closes in <span style={{ fontFamily: F.mono }}>{lockIn}</span></div>
          <div><b style={{ color: C.text }}>{PIT.liveMin} min</b> trading the room&apos;s odds on this Panta market, {PIT.rounds} rounds</div>
          <div><b style={{ color: C.text }}>Top finishers</b> split the pool · everyone is paid out after the round</div>
        </div>
      )}

      <div style={{ borderRadius: 11, padding: m ? "9px 11px" : "10px 13px", background: "rgba(10,13,19,0.6)", border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 5 }}>
        {([["Entry → shared prize pool", usd2(PIT.entry), entryAt], ["Platform fee", "0.1% when you withdraw", -99], ["Vault → your trading bankroll", usd2(PIT.vault), vaultAt]] as const).map(([k, v, a]) => {
          const g = beat >= a ? 1 - prog(beat, a + 1.8, 1.2) : 0;
          return (
            <div key={k} style={{
              display: "flex", justifyContent: "space-between", fontFamily: F.text, fontSize: m ? 11.5 : 12.5, color: g > 0 ? C.text : C.text2,
              margin: "0 -8px", padding: "3px 8px", borderRadius: 7, background: rgba(C.plasma, 0.14 * g), boxShadow: g > 0 ? `inset 0 0 0 1px ${rgba(C.plasma, 0.5 * g)}` : undefined
            }}>
              <span>{k}</span><b style={{ fontFamily: F.mono, color: g > 0 ? C.plasma : C.text }}>{v}</b>
            </div>
          );
        })}
        <div style={{ height: 1, background: C.border, margin: "2px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.text, fontWeight: 700, fontSize: m ? 13 : 14, color: C.text }}>
          <span>Total deposit</span><b style={{ fontFamily: F.mono, color: C.plasma }}>{usd2(SEAT)} USDC</b>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.text, fontSize: m ? 11.5 : 12, color: C.text2 }}>
        <Avatar seed={ME.seed} size={18} radius={999} /> Playing as <b style={{ color: C.text }}>@{ME.name}</b> <em style={{ fontStyle: "normal", color: C.text3 }}>· your X handle</em>
      </div>
      <div style={{ position: "relative", transform: `scale(${pressScale(beat, depositAt)})` }}>
        <div style={{
          height: m ? 44 : 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: F.text, fontWeight: 800,
          fontSize: m ? 13.5 : 14.5, color: picked ? "#051018" : C.text3,
          background: picked ? `linear-gradient(180deg, ${C.plasma}, #0891b2)` : C.surfaceAlt, opacity: busy ? 0.85 : 1,
          boxShadow: picked ? `0 0 22px ${rgba(C.plasma, 0.35)}` : undefined
        }}>
          {busy && <Spinner />}{cta}
        </div>
        <Touch beat={beat} at={depositAt} dx={m ? 95 : 120} />
      </div>
      {!m && (
        <div style={{ fontFamily: F.text, fontSize: 11, lineHeight: 1.45, color: C.text3 }}>
          Held in a non-custodial escrow program on Solana devnet. After settlement you withdraw your payout: any prize plus your share of the vault money.
        </div>
      )}
    </div>
  );
};

export const Spinner: React.FC<{ size?: number; color?: string }> = ({ size = 15, color = "#051018" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="3" />
    <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/** Approval in the X account's embedded Solana wallet — the user's own signature. */
export const WalletSheet: React.FC<{ m: boolean; beat: number; action: string; amount: string; to: string; approveAt: number; done?: boolean }> = ({
  m, beat, action, amount, to, approveAt, done
}) => (
  <div style={{
    width: m ? 340 : 380, borderRadius: 18, padding: m ? 16 : 18, display: "flex", flexDirection: "column", gap: 12,
    background: "linear-gradient(180deg, #1a2030, #10141d)", border: `1px solid ${C.borderStrong}`,
    boxShadow: "0 30px 80px rgba(0,0,0,0.7)"
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "#000", border: `1px solid ${C.borderStrong}`, color: "#fff" }}>
        <XLogo size={16} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
        <span style={{ fontFamily: F.text, fontWeight: 800, fontSize: 14, color: C.text }}>Your X wallet</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text3 }}>@{ME.name} · {PIT.walletShort}</span>
      </div>
      <span style={{ marginLeft: "auto", fontFamily: F.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, color: C.amber, padding: "3px 7px", borderRadius: 6, border: `1px solid ${rgba(C.amber, 0.4)}`, textTransform: "uppercase" }}>devnet</span>
    </div>
    <div style={{ borderRadius: 12, padding: "12px 13px", background: "rgba(10,13,19,0.7)", border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: F.text, fontSize: 12.5, color: C.text2 }}>{action}</span>
        <b style={{ fontFamily: F.mono, fontWeight: 800, fontSize: 19, color: C.text }}>{amount}</b>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.text, fontSize: 12, color: C.text2 }}>
        <span>To</span><span style={{ color: C.text }}>{to}</span>
      </div>
    </div>
    <div style={{ position: "relative", transform: `scale(${pressScale(beat, approveAt)})` }}>
      <div style={{
        height: 44, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: F.text, fontWeight: 800, fontSize: 14.5,
        color: "#0b0e17", background: done ? C.up : "#edf0f6"
      }}>{done ? <><CheckIcon size={16} color="#0b0e17" /> Approved</> : "Approve"}</div>
      <Touch beat={beat} at={approveAt} />
    </div>
  </div>
);
