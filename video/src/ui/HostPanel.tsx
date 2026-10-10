import React from "react";
import { prog } from "../anim";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { ME, PIT } from "../timeline";
import { Avatar } from "./brand";
import { Caret, CtaButton, Touch, pressScale } from "./kit";

/** Example Panta markets for the host picker (made up). */
export const PANTA_MARKETS = [
  { cat: "crypto", q: PIT.question, px: "62¢ YES · 2d left" },
  { cat: "sports", q: "Will the final go to overtime?", px: "31¢ YES · 5h left" },
  { cat: "culture", q: "Will the album debut at No. 1?", px: "72¢ YES · 6d left" }
];
const CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"];

const Seg: React.FC<{ opts: string[]; on: string; small?: boolean; tapAt?: Record<string, number>; beat: number }> = ({ opts, on, small, tapAt = {}, beat }) => (
  <div style={{ display: "flex", gap: 2, padding: small ? 3 : 4, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, width: "100%" }}>
    {opts.map((o) => {
      const sel = o === on;
      const t = tapAt[o];
      return (
        <div key={o} style={{
          position: "relative", flex: 1, textAlign: "center", padding: small ? "6px 6px" : "8px 8px", borderRadius: 7, fontFamily: F.display, fontWeight: 800,
          fontSize: small ? 9.5 : 10.5, letterSpacing: small ? 1.1 : 1.4, textTransform: "uppercase", whiteSpace: "nowrap",
          color: sel ? "#051510" : C.text2, background: sel ? `linear-gradient(180deg, ${C.neon}, #6d28d9)` : "transparent",
          boxShadow: sel ? `0 4px 12px ${rgba(C.neon, 0.35)}` : undefined, transform: t !== undefined ? `scale(${pressScale(beat, t)})` : undefined
        }}>
          {o}
          {t !== undefined && <Touch beat={beat} at={t} size={40} />}
        </div>
      );
    })}
  </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: 1.4, color: C.text3, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>{children}</div>
);
const Help: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ margin: "8px 2px 12px", fontFamily: F.text, fontSize: 12.5, lineHeight: 1.45, color: C.text3 }}>{children}</p>
);

/**
 * The Host tab of the lobby card (HostPanel in app/ArenasDirectory.tsx):
 * market source, the Panta market picker, the new-market form, and the game settings.
 */
export const HostPanel: React.FC<{
  beat: number; source: "crypto" | "panta" | "create"; picked: number | null; typed: string;
  pantaAt: number; pickAt: number; createAt: number; scroll?: number;
}> = ({ beat, source, picked, typed, pantaAt, pickAt, createAt, scroll = 0 }) => {
  const listIn = prog(beat, pantaAt + 0.1, 0.5);
  const formIn = prog(beat, createAt + 0.1, 0.5);
  const rule = typed ? `Resolves YES if the answer to "${typed}" is yes, as reported by the source of truth below. Resolves NO otherwise.` : "";
  return (
    <div style={{ transform: `translateY(${-scroll}px)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: rgba(C.neon, 0.07), border: `1px solid ${rgba(C.neon, 0.2)}`, marginBottom: 14 }}>
        <Avatar seed={ME.seed} size={26} radius={999} />
        <span style={{ fontFamily: F.text, fontSize: 12.5, color: C.text2 }}>Hosting as <b style={{ color: C.text }}>@{ME.name}</b> · you take seat 1</span>
      </div>

      <Label>Market</Label>
      <Seg beat={beat} opts={["Crypto", "Panta market", "New market"]} on={source === "crypto" ? "Crypto" : source === "panta" ? "Panta market" : "New market"}
        tapAt={{ "Panta market": pantaAt, "New market": createAt }} />
      <Help>
        {source === "crypto" ? "BTC, ETH or SOL up or down — priced live from the spot market."
          : source === "panta" ? "Run a pit on any open Panta market — sports, politics, culture. The room trades its own odds; Panta resolves it."
          : "Write your own question — tonight's game, a stream bet, anything with a clear yes or no. It's listed on Panta and your pit runs on it."}
      </Help>

      {source === "panta" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14, opacity: listIn, transform: `translateY(${(1 - listIn) * 10}px)` }}>
          {PANTA_MARKETS.map((mk, i) => {
            const on = picked === i;
            return (
              <div key={mk.q} style={{
                position: "relative", display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", padding: "9px 11px", borderRadius: 10,
                background: on ? rgba(C.neon, 0.08) : "rgba(10,13,19,0.6)", border: `1px solid ${on ? C.neon : C.borderStrong}`,
                boxShadow: on ? `0 0 0 3px ${rgba(C.neon, 0.12)}` : undefined, transform: i === 0 ? `scale(${pressScale(beat, pickAt)})` : undefined
              }}>
                <span style={{ gridRow: "1 / 3", alignSelf: "start", fontFamily: F.text, fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#d8b4fe", border: `1px solid ${rgba(C.neon, 0.35)}`, borderRadius: 5, padding: "2px 6px" }}>{mk.cat}</span>
                <span style={{ fontFamily: F.text, fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, color: C.text }}>{mk.q}</span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text2 }}>{mk.px}</span>
                {i === 0 && <Touch beat={beat} at={pickAt} />}
              </div>
            );
          })}
        </div>
      )}

      {source === "create" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12, opacity: formIn, transform: `translateY(${(1 - formIn) * 10}px)` }}>
          <div>
            <Label>Question</Label>
            <div style={{ height: 40, borderRadius: 9, padding: "0 12px", display: "flex", alignItems: "center", fontFamily: F.text, fontSize: 14, color: C.text, background: "rgba(10,13,19,0.8)", border: `1.5px solid ${rgba(C.plasma, 0.7)}`, boxShadow: `0 0 0 3px ${rgba(C.plasma, 0.12)}` }}>
              {typed}<Caret beat={beat} h={18} />
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {CATEGORIES.map((c) => (
              <span key={c} style={{
                padding: "5px 8px", borderRadius: 7, fontFamily: F.display, fontWeight: 800, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                color: c === "sports" ? "#051510" : C.text2, background: c === "sports" ? `linear-gradient(180deg, ${C.neon}, #6d28d9)` : C.surface, border: `1px solid ${C.border}`
              }}>{c}</span>
            ))}
          </div>
          <div>
            <Label>Resolves YES if…</Label>
            <div style={{ minHeight: 52, borderRadius: 9, padding: "8px 12px", fontFamily: F.text, fontSize: 12, lineHeight: 1.4, color: C.text2, background: "rgba(10,13,19,0.8)", border: `1px solid ${C.borderStrong}` }}>{rule}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.text, fontSize: 12, color: C.text, padding: "7px 10px", borderRadius: 9, border: `1px solid ${rgba(C.up, 0.45)}`, background: rgba(C.up, 0.08), whiteSpace: "nowrap" }}>
              <span style={{ width: 26, height: 14, borderRadius: 8, background: C.up, position: "relative" }}><span style={{ position: "absolute", right: 2, top: 2, width: 10, height: 10, borderRadius: "50%", background: "#fff" }} /></span>
              Live event — trades on Panta now
            </span>
            <div style={{ flex: 1 }}><Seg beat={beat} small opts={["1h", "3h", "12h", "1d", "7d"]} on="3h" /></div>
          </div>
          <Help>Panta&apos;s AI resolver settles it after trading ends, using your rule and source. A live event trades on Panta immediately.</Help>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div><Label>Game</Label><Seg beat={beat} small opts={["Single", "Royale"]} on="Royale" /></div>
        <div><Label>Trading window</Label><Seg beat={beat} small opts={["5m", "15m", "1h"]} on="5m" /></div>
        <div><Label>Players</Label><Seg beat={beat} small opts={["2", "4", "8", "12", "16"]} on="8" /></div>
        <div><Label>Rounds</Label><Seg beat={beat} small opts={["2", "3", "4"]} on="2" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        {[["Entry (USDC)", `${PIT.entry}`, "Into the shared prize pool · $1–100"], ["Vault (USDC)", `${PIT.vault}`, "Your trading bankroll · $5–500"]].map(([k, v, h]) => (
          <div key={k}>
            <Label>{k}</Label>
            <div style={{ height: 38, borderRadius: 9, padding: "0 12px", display: "flex", alignItems: "center", fontFamily: F.mono, fontWeight: 700, fontSize: 16, color: C.text, background: "rgba(10,13,19,0.8)", border: `1px solid ${C.borderStrong}` }}>{v}</div>
            <div style={{ fontFamily: F.text, fontSize: 10.5, color: C.text3, marginTop: 4 }}>{h}</div>
          </div>
        ))}
      </div>
      <Label>Host fee</Label>
      <Seg beat={beat} small opts={["0%", "1%", "2%", "3%", "4%", "5%"]} on="2%" />
      <Help>You keep 2% of the prize pool ($0.32 if full), paid with your own payout. Players see it before they join.</Help>
      <CtaButton full h={44} fs={11.5}>Deposit $12.00 &amp; call YES</CtaButton>
    </div>
  );
};
