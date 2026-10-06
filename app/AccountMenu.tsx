"use client";

/**
 * The signed-in player's account: their X handle and the Solana wallet Privy
 * keeps for their X account — full address (copy, QR, explorer), what it
 * holds, how to fund it, exporting its key, and signing out.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { avatarDataUrl } from "@/lib/avatars";
import { getPrivyBridge } from "@/lib/privy-client";
import { shortPk } from "@/lib/username";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const MAINNET = CLUSTER === "mainnet-beta";

type Balances = { usdc: number; sol: number; escrow: "active" | "inactive" } | null;

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}${MAINNET ? "" : `?cluster=${CLUSTER}`}`;
}

export default function AccountMenu({ wallet, username, busy, onSignOut, onToast }: {
  wallet: string;
  username: string;
  busy: boolean;
  onSignOut: () => void;
  onToast: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState<Balances>(null);
  const [balErr, setBalErr] = useState(false);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const loadBalances = useCallback(async () => {
    try {
      const r = await fetch(`/api/escrow/balance?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error();
      setBal({ usdc: Number(j.usdc) || 0, sol: Number(j.sol) || 0, escrow: j.escrow === "active" ? "active" : "inactive" });
      setBalErr(false);
    } catch { setBalErr(true); }
  }, [wallet]);

  // Balances refresh while the menu is open (funding usually happens then).
  useEffect(() => {
    if (!open) return;
    void loadBalances();
    const id = window.setInterval(loadBalances, 10_000);
    return () => window.clearInterval(id);
  }, [open, loadBalances]);

  useEffect(() => {
    if (!open || qr) return;
    import("qrcode")
      .then((Q) => Q.toString(wallet, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b0e17", light: "#edf0f6" } }))
      .then(setQr)
      .catch(() => { /* QR is optional */ });
  }, [open, qr, wallet]);
  useEffect(() => { setQr(""); setBal(null); }, [wallet]);

  // Close on Escape (focus back to the trigger) or a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { onToast("Copy failed — select the address and copy it manually."); }
  };

  const exportKey = async () => {
    const b = getPrivyBridge();
    if (!b?.authenticated) { onToast("Sign in with X again to export your wallet's key."); return; }
    try { await b.exportWallet(); }
    catch { onToast("Couldn't open the key export — try again."); }
  };

  const lowSol = bal && bal.sol < 0.005;
  const noUsdc = bal && bal.usdc < 1;

  return (
    <div className="acct" ref={root}>
      <button
        ref={trigger}
        className="acct-main"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="acct-panel"
        title="Your account and wallet"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="acct-avatar" src={avatarDataUrl(wallet, 26)} width={26} height={26} alt="" />
        <span className="acct-text">
          <span className="acct-name">{username ? `@${username}` : shortPk(wallet)}</span>
          <span className="acct-pk">{shortPk(wallet)}</span>
        </span>
        <svg className="acct-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>

      {open && (
        <div id="acct-panel" className="acct-panel" role="dialog" aria-label="Your account">
          <div className="ap-who">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarDataUrl(wallet, 40)} width={40} height={40} alt="" />
            <div>
              {username
                ? <a className="ap-handle" href={`https://x.com/${encodeURIComponent(username)}`} target="_blank" rel="noopener noreferrer">@{username}</a>
                : <span className="ap-handle">{shortPk(wallet)}</span>}
              <span className="ap-sub">{username ? "Signed in with X" : "Signed in"}</span>
            </div>
          </div>

          <div className="ap-sec">
            <div className="ap-k">Your Solana wallet <span className="ap-net">{CLUSTER}</span></div>
            <div className="ap-addr-row">
              <code className="ap-addr" aria-label="Wallet address">{wallet}</code>
            </div>
            <div className="ap-actions">
              <button className="btn secondary sm" onClick={copy}>{copied ? "Copied ✓" : "Copy address"}</button>
              <a className="btn ghost sm" href={explorerAddress(wallet)} target="_blank" rel="noopener noreferrer">Explorer ↗</a>
            </div>
            <span className="sr-only" role="status">{copied ? "Address copied" : ""}</span>
          </div>

          <div className="ap-sec ap-bal-row">
            <div className="ap-bal">
              <span>USDC</span>
              <b>{bal ? bal.usdc.toFixed(2) : balErr ? "—" : "…"}</b>
            </div>
            <div className="ap-bal">
              <span>SOL</span>
              <b>{bal ? bal.sol.toFixed(4) : balErr ? "—" : "…"}</b>
            </div>
            {qr && <span className="ap-qr" role="img" aria-label="QR code of your wallet address" dangerouslySetInnerHTML={{ __html: qr }} />}
          </div>
          {balErr && <p className="ap-note">Couldn&apos;t read your balances right now.</p>}

          <div className="ap-sec">
            <div className="ap-k">Fund it</div>
            {MAINNET ? (
              <p className="ap-note">Send USDC and a little SOL (for network fees) on Solana to the address above.</p>
            ) : (
              <p className="ap-note">
                Seats are paid in {CLUSTER} USDC. Send test tokens to the address above:{" "}
                <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">USDC (choose Solana Devnet)</a>
                {" · "}
                <a href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer">SOL for fees</a>.
              </p>
            )}
            {bal?.escrow === "active" && (lowSol || noUsdc) && (
              <p className="ap-warn">
                {noUsdc && lowSol ? "You need USDC for a seat and about 0.005 SOL for fees." : noUsdc ? "You need USDC to take a seat." : "You need about 0.005 SOL for network fees."}
              </p>
            )}
          </div>

          <div className="ap-foot">
            <button className="link-btn" onClick={exportKey}>Export private key</button>
            <button className="btn secondary sm" onClick={() => { setOpen(false); onSignOut(); }} disabled={busy}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}
