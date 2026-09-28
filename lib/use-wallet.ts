"use client";

import { useCallback, useEffect, useState } from "react";
import { connectSolanaWallet } from "@/lib/panta-client";
import { getStoredUsername, saveStoredUsername, shortPk, validateUsername } from "@/lib/username";

export const WALLET_KEY = "oracle-rumble/wallet/v1";

export type EscrowStatus = { active: boolean; reason?: string | null };

/**
 * Connected wallet + its stored callsign, shared by every page so the
 * header, host flow, and arena all agree on who the player is.
 */
export function useWalletIdentity() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [callsign, setCallsign] = useState("");

  useEffect(() => {
    try {
      const w = localStorage.getItem(WALLET_KEY);
      if (w) {
        setWallet(w);
        setCallsign(getStoredUsername(w));
      }
    } catch { /* storage unavailable */ }
  }, []);

  /** Connect, or disconnect when already connected. Returns a status line for a toast. */
  const toggleConnect = useCallback(async (): Promise<{ message: string; needsCallsign: boolean }> => {
    if (wallet) {
      setWallet(null);
      setCallsign("");
      try { localStorage.removeItem(WALLET_KEY); } catch { /* ignore */ }
      return { message: "Wallet disconnected.", needsCallsign: false };
    }
    const real = await connectSolanaWallet();
    if (!real) return { message: "No Solana wallet found. Install Phantom, Backpack or Solflare.", needsCallsign: false };
    setWallet(real);
    try { localStorage.setItem(WALLET_KEY, real); } catch { /* ignore */ }
    const stored = getStoredUsername(real);
    setCallsign(stored);
    return stored
      ? { message: `Connected as ${stored}.`, needsCallsign: false }
      : { message: `Connected ${shortPk(real)} — choose a callsign.`, needsCallsign: true };
  }, [wallet]);

  const saveCallsign = useCallback((raw: string): { ok: boolean; message: string } => {
    if (!wallet) return { ok: false, message: "Connect a wallet first." };
    const v = validateUsername(raw);
    if (!v.ok) return { ok: false, message: v.reason };
    saveStoredUsername(wallet, v.value);
    setCallsign(v.value);
    return { ok: true, message: `Callsign set to ${v.value}.` };
  }, [wallet]);

  return { wallet, callsign, toggleConnect, saveCallsign };
}

/** Server escrow status — decides on-chain vs practice mode. */
export function useEscrowStatus(): EscrowStatus | null {
  const [escrow, setEscrow] = useState<EscrowStatus | null>(null);
  useEffect(() => {
    fetch("/api/escrow/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setEscrow)
      .catch(() => setEscrow({ active: false, reason: "unreachable" }));
  }, []);
  return escrow;
}
