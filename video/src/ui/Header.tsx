import React from "react";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { ME, PIT } from "../timeline";
import { Avatar, BrandMark, Wordmark, XLogo } from "./brand";
import { CtaButton, Dot, Touch, pressScale } from "./kit";

/**
 * app/SiteHeader.tsx — brand, nav, network mode and the X account.
 * `account` 0..1 crossfades the "Sign in with X" button into the account chip.
 */
export const Header: React.FC<{
  m: boolean; beat: number; account: number; signing?: boolean; tapAt?: number; arenaCode?: string; active?: "arenas" | "host";
}> = ({ m, beat, account, signing, tapAt, arenaCode, active = "arenas" }) => {
  const nav = [["arenas", "Pits"], ["host", "Host"], ["positions", "Positions"], ["docs", "Docs"]];
  return (
    <div style={{
      position: "relative", margin: m ? "8px 10px 0" : "10px 14px 0", height: m ? 50 : 52, borderRadius: 14,
      background: "linear-gradient(180deg, rgba(19,24,36,0.92), rgba(12,15,22,0.92))",
      border: `1px solid ${rgba(C.neon, 0.2)}`, boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", padding: m ? "0 8px 0 10px" : "0 12px 0 14px", gap: 16, zIndex: 20
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: m ? 8 : 10 }}>
        <BrandMark size={m ? 28 : 30} id={`hdr-${m ? "m" : "d"}`} />
        <Wordmark size={m ? 12.5 : 13.5} />
      </div>
      {!m && (
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 4 }}>
          {nav.map(([k, label]) => {
            const on = k === active;
            return (
              <div key={k} style={{
                padding: "8px 12px", borderRadius: 7, fontFamily: F.display, fontWeight: 800, fontSize: 10.5, letterSpacing: 1.6,
                textTransform: "uppercase", color: on ? "#fff" : C.text2, background: on ? rgba(C.neon, 0.12) : "transparent",
                boxShadow: on ? `inset 0 -2px 0 ${C.neon}` : undefined
              }}>{label}</div>
            );
          })}
        </div>
      )}
      {m && <div style={{ flex: 1 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {!m && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 7,
            fontFamily: F.mono, fontWeight: 700, fontSize: 9.5, letterSpacing: 1.3, textTransform: "uppercase",
            color: C.up, background: rgba(C.up, 0.08), border: `1px solid ${rgba(C.up, 0.32)}`
          }}>
            <Dot color={C.up} size={6} /> devnet <span style={{ color: C.text }}>On-chain</span>
          </span>
        )}
        {arenaCode && !m && (
          <span style={{
            fontFamily: F.display, fontWeight: 800, fontSize: 11, letterSpacing: 1.6, color: C.neon, padding: "7px 10px", borderRadius: 7,
            background: rgba(C.neon, 0.1), border: `1px solid ${rgba(C.neon, 0.35)}`
          }}>{arenaCode} <span style={{ color: C.text3 }}>⧉</span></span>
        )}
        <div style={{ position: "relative", height: m ? 36 : 38, minWidth: m ? 150 : 172 }}>
          {account < 1 && (
            <div style={{ position: "absolute", right: 0, top: 0, opacity: 1 - account, transform: `scale(${(tapAt !== undefined ? pressScale(beat, tapAt) : 1) * (1 - account * 0.1)})` }}>
              <CtaButton h={m ? 36 : 38} fs={m ? 10 : 10.5} style={{ padding: m ? "0 12px" : "0 15px" }}>
                <XLogo size={m ? 12 : 13} /> {signing ? "Signing in…" : "Sign in with X"}
              </CtaButton>
              {tapAt !== undefined && <Touch beat={beat} at={tapAt} />}
            </div>
          )}
          {account > 0 && (
            <div style={{
              position: "absolute", right: 0, top: 0, height: m ? 36 : 38, display: "flex", alignItems: "center", gap: 8,
              padding: "0 10px 0 5px", borderRadius: 999, background: C.surface, border: `1px solid ${rgba(C.up, 0.38)}`,
              opacity: account, transform: `scale(${0.9 + account * 0.1})`, transformOrigin: "right center", whiteSpace: "nowrap"
            }}>
              <Avatar seed={ME.seed} size={m ? 26 : 28} radius={999} />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
                <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: m ? 12 : 12.5, color: C.text }}>@{ME.name}</span>
                <span style={{ fontFamily: F.mono, fontSize: m ? 9.5 : 10, color: C.text3 }}>{PIT.walletShort}</span>
              </div>
              <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 4l4 4 4-4" fill="none" stroke={C.text2} strokeWidth="1.8" strokeLinecap="round" /></svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
