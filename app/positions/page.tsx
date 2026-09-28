"use client";

/** /positions — the connected wallet's Panta positions, with one-click claims. */

import { useCallback, useEffect, useState } from "react";
import { useEscrowStatus, useWalletIdentity } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import CallsignModal from "@/app/CallsignModal";
import PantaPositions from "@/app/PantaPositions";

export default function PositionsPage() {
  const { wallet, callsign, toggleConnect, saveCallsign } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [showCallsign, setShowCallsign] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const connect = useCallback(async () => {
    const r = await toggleConnect();
    setToast(r.message);
    if (r.needsCallsign) setShowCallsign(true);
  }, [toggleConnect]);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="positions"
        wallet={wallet}
        callsign={callsign}
        escrow={escrow}
        onConnect={connect}
        onEditCallsign={() => setShowCallsign(true)}
      />

      <section className="page-hero">
        <p className="jt-eyebrow">Portfolio</p>
        <h1>Positions</h1>
        <p className="page-lead">
          Every Panta market position held by your connected wallet — shares, entry and mark price,
          and claimable winnings. Positions open when you trade with “Also fill on Panta” enabled.
        </p>
      </section>

      <section className="positions-page-shell">
        {wallet ? (
          <PantaPositions wallet={wallet} />
        ) : (
          <div className="positions-shell">
            <div className="positions-empty">
              <p>Connect a Solana wallet to see its positions.</p>
              <button className="btn-cta" onClick={connect} style={{ marginTop: 14 }}>Connect wallet</button>
            </div>
          </div>
        )}
      </section>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss">×</button>
        </div>
      )}
      {showCallsign && (
        <CallsignModal
          initial={callsign}
          onSave={(v) => { const r = saveCallsign(v); if (r.ok) setToast(r.message); return r; }}
          onClose={() => setShowCallsign(false)}
        />
      )}
    </main>
  );
}
