"use client";

/**
 * /positions — wallet-scoped Panta positions as a real page (not a drawer).
 * Reuses the PantaPositions component in its embedded-view form.
 */

import { useCallback, useEffect, useState } from "react";
import { connectSolanaWallet } from "@/lib/panta-client";
import PantaPositions from "@/app/PantaPositions";

const WALLET_KEY = "oracle-rumble/wallet/v1";
const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

function shortPk(pk: string) {
  if (!pk) return "";
  if (pk.length <= 10) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export default function PositionsPage() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<{ active: boolean; reason?: string | null } | null>(null);

  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);

  useEffect(() => {
    try { const w = localStorage.getItem(WALLET_KEY); if (w) setWallet(w); } catch { /* ignore */ }
    fetch("/api/escrow/status", { cache: "no-store" }).then((r) => r.json()).then(setEscrow).catch(() => setEscrow({ active: false, reason: "unreachable" }));
  }, []);

  const connect = useCallback(async () => {
    if (wallet) {
      setWallet(null);
      try { localStorage.removeItem(WALLET_KEY); } catch { /* ignore */ }
      return;
    }
    const real = await connectSolanaWallet();
    if (real) {
      setWallet(real);
      try { localStorage.setItem(WALLET_KEY, real); } catch { /* ignore */ }
    }
  }, [wallet]);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <nav className="hud-bar game-hud">
        <div className="tabbar-inner">
          <a href="/" className="brand" aria-label="Oracle Rumble">
            <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
              <g fill="none" stroke="#edf0f6" strokeWidth="3.2" strokeLinecap="round">
                <path d="M 12 24 A 22 22 0 0 1 24 12" />
                <path d="M 40 12 A 22 22 0 0 1 52 24" />
                <path d="M 52 40 A 22 22 0 0 1 40 52" />
                <path d="M 24 52 A 22 22 0 0 1 12 40" />
              </g>
              <path d="M 4 32 L 11 32 M 53 32 L 60 32" stroke="#edf0f6" strokeWidth="3" strokeLinecap="round" />
              <path d="M 32 2 L 36 18 L 32 23 L 28 18 Z" fill="#edf0f6" />
              <path d="M 32 62 L 36 46 L 32 41 L 28 46 Z" fill="#edf0f6" />
              <path d="M 10 32 C 18 20, 26 18, 32 18 C 38 18, 46 20, 54 32 C 46 44, 38 46, 32 46 C 26 46, 18 44, 10 32 Z" fill="#edf0f6" />
              <circle cx="32" cy="32" r="7" fill="#0a0d13" />
              <circle cx="32" cy="32" r="3.3" fill="#edf0f6" />
            </svg>
            ORACLE RUMBLE
          </a>
          <div className="hud-nav">
            <a href="/">Arenas</a>
            <a href="/#host">Host</a>
            <a href="/positions" className="active">Positions</a>
            <a href="/docs">Docs</a>
          </div>
          <div className="hud-right">
            <span
              className={`system-chip ${escrow?.active ? "on" : "off"}`}
              title={`Solana ${CLUSTER} · ${escrow?.active ? "on-chain escrow" : `practice mode (${escrow?.reason ?? "escrow off"})`}`}
            >
              <span className="dot" />
              {CLUSTER}
            </span>
            <button className={wallet ? "wallet game connected" : "wallet game"} onClick={connect}>
              <span className="avatar">{wallet ? wallet.slice(0, 2).toUpperCase() : "?"}</span>
              {wallet ? shortPk(wallet) : "Connect"}
            </button>
          </div>
        </div>
      </nav>

      <section className="docs-hero">
        <h1 className="game-title"><span className="lash">Your</span> <span className="kill">Positions</span></h1>
        <p className="sublead">
          Wallet-scoped Panta holdings across every market you&apos;ve touched. Claim wins in one click.
        </p>
      </section>

      <section className="positions-page-shell">
        <PantaPositions wallet={wallet} />
      </section>
    </main>
  );
}
