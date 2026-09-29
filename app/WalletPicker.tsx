"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useWalletPicker } from "@/lib/use-wallet";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

/** Shown by Connect when more than one Solana wallet is installed. */
export default function WalletPicker() {
  const picker = useWalletPicker();

  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") picker.resolve(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker]);

  if (!picker || typeof document === "undefined") return null;
  // Portal: the sticky header is its own stacking context.
  return createPortal(
    <div className="modal-backdrop" onClick={() => picker.resolve(null)}>
      <div className="modal wallet-picker" role="dialog" aria-modal="true" aria-labelledby="wp-title" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={() => picker.resolve(null)} aria-label="Close">×</button>
        <h2 id="wp-title">Connect a wallet</h2>
        <p className="sub">Choose the Solana wallet you play with. Set it to {CLUSTER}.</p>
        <div className="wp-list">
          {picker.options.map((o, i) => (
            <button key={o.kind} className="wp-opt" onClick={() => picker.resolve(o.kind)} autoFocus={o.kind === picker.remembered || (!picker.remembered && i === 0)}>
              {o.icon
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="wp-icon" src={o.icon} width={32} height={32} alt="" />
                : <span className="wp-icon wp-fallback" aria-hidden="true">{o.name.slice(0, 1)}</span>}
              <span className="wp-name">{o.name}</span>
              {o.kind === picker.remembered && <span className="wp-tag">Last used</span>}
            </button>
          ))}
        </div>
        <p className="wp-note">
          Connecting shares your public address. The wallet then asks you to sign a free sign-in message: no
          transaction, no fee.
        </p>
      </div>
    </div>,
    document.body
  );
}
