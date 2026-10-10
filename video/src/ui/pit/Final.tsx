import React from "react";
import { prog, usd0, usd2 } from "../../anim";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { FINAL, MY_FEE, MY_GROSS, MY_NET, PAYOUTS, PIT, POOL, PRIZES, R2, playerOf } from "../../timeline";
import { Avatar } from "../brand";
import { Touch, pressScale } from "../kit";
import { Spinner } from "./SeatModal";

export type ClaimState = "ready" | "busy" | "done";

/** The champion block of app/ArenaView.tsx after the final bell. */
export const Final: React.FC<{
  m: boolean; beat: number; board: number; boardRows?: number; claim: ClaimState; withdrawAt: number; hostAt?: number; showClaim?: boolean; doneAt?: number;
}> = ({ m, beat, board, boardRows, claim, withdrawAt, hostAt, showClaim = true, doneAt = 0 }) => {
  const champ = FINAL[0];
  const name = playerOf(champ.id).name;
  const rows = FINAL.slice(0, boardRows ?? FINAL.length);
  const done = prog(beat, doneAt, 0.45);
  return (
    <div style={{
      borderRadius: 16, padding: m ? "16px 14px" : "22px 26px", display: "flex", flexDirection: "column", gap: m ? 10 : 12,
      background: "radial-gradient(600px 200px at 50% 0%, rgba(252,211,77,0.10), transparent 70%), linear-gradient(180deg, rgba(19,24,36,0.95), rgba(13,16,23,0.95))",
      border: `1px solid ${rgba(C.gold, 0.35)}`
    }}>
      <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 10 : 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.gold }}>Round {PIT.rounds} · final</div>
      <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 22 : 30, lineHeight: 1.1, color: C.text, textTransform: "uppercase" }}>
        {name} wins <span style={{ color: C.gold, textShadow: `0 0 20px ${rgba(C.gold, 0.45)}` }}>{usd2(PRIZES[champ.id] ?? 0)}</span>
      </div>
      <div style={{ fontFamily: F.text, fontSize: m ? 12 : 13, lineHeight: 1.45, color: C.text2, padding: m ? "8px 10px" : "9px 12px", borderRadius: 10, background: rgba(C.plasma, 0.07), border: `1px solid ${rgba(C.plasma, 0.25)}` }}>
        Settled at <b style={{ color: C.plasma }}>{R2.settle}¢ YES</b> — the room&apos;s average price over the closing {PIT.closingMin} min. Panta hadn&apos;t ruled by the bell.
      </div>
      <div style={{ fontFamily: F.text, fontSize: m ? 11.5 : 12.5, lineHeight: 1.5, color: C.text2 }}>
        {usd0(POOL)} pool split across the top 3.{!m && " Players also share the vault money by how their vaults finished — one player's trading losses fund another's gains."}
      </div>

      {showClaim && (
        <div style={{ borderRadius: 12, padding: m ? 11 : 13, background: "rgba(10,13,19,0.65)", border: `1px solid ${claim === "done" ? rgba(C.up, 0.5) : C.borderStrong}`, display: "flex", flexDirection: "column", gap: 10 }}>
          {claim === "done" ? (
            <div style={{ fontFamily: F.text, fontSize: m ? 13 : 14, color: C.text, opacity: done, transform: `scale(${0.96 + done * 0.04})` }}>
              <b style={{ color: C.up }}>Withdrawn ✓</b> {usd2(MY_GROSS)} is back in your X wallet.
            </div>
          ) : (
            <>
              <div style={{ fontFamily: F.text, fontSize: m ? 11.5 : 12.5, lineHeight: 1.5, color: C.text2 }}>
                <b style={{ color: C.text }}>Your withdrawal:</b> {usd2(MY_GROSS)} — includes your {usd2(PRIZES.me ?? 0)} prize
                <span style={{ color: C.text3 }}> · 0.1% platform fee ({usd2(MY_FEE)}) — you receive {usd2(MY_NET)}</span>
              </div>
              <div style={{ position: "relative", transform: `scale(${pressScale(beat, withdrawAt)})` }}>
                <div style={{
                  height: m ? 44 : 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: F.text, fontWeight: 800,
                  fontSize: m ? 13.5 : 14.5, color: "#051018", background: `linear-gradient(180deg, ${C.plasma}, #0891b2)`, boxShadow: `0 0 22px ${rgba(C.plasma, 0.35)}`
                }}>
                  {claim === "busy" ? <><Spinner /> Approve in your X wallet…</> : `Withdraw ${usd2(MY_NET)} to my X wallet`}
                </div>
                <Touch beat={beat} at={withdrawAt} dx={m ? 95 : 150} />
              </div>
            </>
          )}
        </div>
      )}

      {hostAt !== undefined && (
        <div style={{ position: "relative", alignSelf: "flex-start", transform: `scale(${pressScale(beat, hostAt)})` }}>
          <div style={{
            height: 40, padding: "0 16px", borderRadius: 9, display: "flex", alignItems: "center", fontFamily: F.text, fontWeight: 800, fontSize: 13.5,
            color: "#051018", background: `linear-gradient(180deg, ${C.plasma}, #0891b2)`
          }}>Host the next pit →</div>
          <Touch beat={beat} at={hostAt} />
        </div>
      )}

      {board > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "grid", gridTemplateColumns: m ? "22px 1fr 76px 70px" : "28px 1fr 110px 100px", gap: 8, padding: "0 8px", fontFamily: F.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.text3 }}>
            <span>#</span><span>Player</span><span style={{ textAlign: "right" }}>Final vault</span><span style={{ textAlign: "right" }}>Payout</span>
          </div>
          {rows.map((s, i) => {
            const p = prog(board, i * 0.12, 0.35);
            const me = s.id === "me";
            const prize = PRIZES[s.id];
            return (
              <div key={s.id} style={{
                display: "grid", gridTemplateColumns: m ? "22px 1fr 76px 70px" : "28px 1fr 110px 100px", gap: 8, alignItems: "center", padding: m ? "5px 8px" : "6px 8px", borderRadius: 8,
                background: me ? rgba(C.gold, 0.1) : i % 2 ? "transparent" : "rgba(19,24,36,0.5)", border: `1px solid ${me ? rgba(C.gold, 0.45) : "transparent"}`,
                opacity: p, transform: `translateX(${(1 - p) * 18}px)`
              }}>
                <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 11.5, color: i < 3 ? C.gold : C.text3 }}>{i + 1}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <Avatar seed={playerOf(s.id).seed} size={m ? 18 : 20} radius={5} />
                  <span style={{ fontFamily: F.text, fontWeight: 600, fontSize: m ? 11.5 : 12.5, color: s.out ? C.text3 : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {playerOf(s.id).name}{s.out && <em style={{ fontStyle: "normal", fontFamily: F.mono, fontSize: 9, color: C.down, marginLeft: 5 }}>OUT</em>}
                  </span>
                </span>
                <span style={{ textAlign: "right", fontFamily: F.mono, fontWeight: 700, fontSize: m ? 11.5 : 12.5, color: C.text }}>{usd2(s.vault)}</span>
                <span style={{ textAlign: "right", fontFamily: F.mono, fontWeight: 800, fontSize: m ? 11.5 : 12.5, color: prize ? C.gold : C.text2 }}>{usd2(PAYOUTS[s.id])}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
