"use client";

/** /positions — the connected wallet's arenas, positions and payouts, plus Panta holdings. */

import { useCallback, useEffect, useState } from "react";
import { useEscrowStatus, useWalletIdentity, useXNotices } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import UsernameModal from "@/app/UsernameModal";
import PantaPositions from "@/app/PantaPositions";
import ArenaPortfolio from "@/app/ArenaPortfolio";

export default function PositionsPage() {
  const { wallet, username, toggleConnect, saveUsername } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [showUsername, setShowUsername] = useState(false);
  const [toast, setToast] = useState("");
  useXNotices(setToast);

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
    if (r.needsUsername) setShowUsername(true);
  }, [toggleConnect]);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="positions"
        wallet={wallet}
        username={username}
        escrow={escrow}
        onConnect={connect}
        onEditUsername={() => setShowUsername(true)}
      />

      <section className="page-hero">
        <p className="jt-eyebrow">Portfolio</p>
        <h1>Positions</h1>
        <p className="page-lead">
          Every arena your wallet is in: your UP/DOWN position and vault value in live rounds, where you
          stand against the cut, and payouts or refunds ready to withdraw — read from the game and the
          on-chain escrow.
        </p>
      </section>

      <section className="positions-page-shell">
        {wallet ? (
          <>
            <ArenaPortfolio wallet={wallet} onToast={setToast} />
            <div className="pf-section pf-secondary" aria-labelledby="pf-panta">
              <h2 id="pf-panta">Panta market holdings</h2>
              <p className="pf-note">Shares on Panta&apos;s own markets, opened by trading with “Also fill on Panta” switched on.</p>
              <PantaPositions wallet={wallet} />
            </div>
          </>
        ) : (
          <div className="positions-shell">
            <div className="positions-empty">
              <p>Connect a Solana wallet to see your pits, positions and payouts.</p>
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
      {showUsername && (
        <UsernameModal
          initial={username}
          onSave={(v) => { const r = saveUsername(v); if (r.ok) setToast(r.message); return r; }}
          onClose={() => setShowUsername(false)}
        />
      )}
    </main>
  );
}
