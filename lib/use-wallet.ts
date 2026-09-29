"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ensureSession, signOut } from "@/lib/session-client";
import { getStoredUsername, saveStoredUsername, shortPk, validateUsername } from "@/lib/username";
import {
  connectWallet, describeWalletError, disconnectWallet, listWallets, reconnectSilently,
  rememberedKind, watchWallet, type WalletKind, type WalletOption
} from "@/lib/wallet";

export const WALLET_KEY = "oracle-rumble/wallet/v1";

export type EscrowStatus = { active: boolean; reason?: string | null };

// ---- One identity for the whole page -----------------------------------

type Identity = { wallet: string | null; username: string };
type Picker = { options: WalletOption[]; remembered: WalletKind | null; resolve: (k: WalletKind | null) => void };

const SIGNED_OUT: Identity = { wallet: null, username: "" };
let identity: Identity = SIGNED_OUT;
let picker: Picker | null = null;
const subs = new Set<() => void>();
let booted = false;

const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function setIdentity(wallet: string | null) {
  identity = wallet ? { wallet, username: getStoredUsername(wallet) } : SIGNED_OUT;
  try {
    if (wallet) localStorage.setItem(WALLET_KEY, wallet);
    else localStorage.removeItem(WALLET_KEY);
  } catch { /* storage unavailable */ }
  emit();
}

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  let stored: string | null = null;
  try { stored = localStorage.getItem(WALLET_KEY); } catch { /* storage unavailable */ }
  if (stored) {
    identity = { wallet: stored, username: getStoredUsername(stored) };
    emit();
    // The extension forgets this site on reload — reconnect it quietly so
    // the first signature doesn't fail. If the wallet moved to another
    // account in the meantime, follow it.
    void reconnectSilently().then((addr) => {
      if (addr && identity.wallet && addr !== identity.wallet) {
        void signOut();
        setIdentity(addr);
      }
    });
  }
  watchWallet((addr) => {
    if (!identity.wallet || addr === identity.wallet) return;
    void signOut();
    setIdentity(addr); // null = the wallet disconnected this site
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== WALLET_KEY) return;
    identity = e.newValue ? { wallet: e.newValue, username: getStoredUsername(e.newValue) } : SIGNED_OUT;
    emit();
  });
}

/** Opens the wallet picker and resolves with the chosen wallet (null = closed). */
function pickWallet(options: WalletOption[]): Promise<WalletKind | null> {
  picker?.resolve(null);
  return new Promise((resolve) => {
    picker = {
      options,
      remembered: rememberedKind(),
      resolve: (k) => { picker = null; emit(); resolve(k); }
    };
    emit();
  });
}

/** State for <WalletPicker/> — null while it is closed. */
export function useWalletPicker(): Picker | null {
  return useSyncExternalStore(subscribe, () => picker, () => null);
}

/**
 * Connected wallet + its username, shared by every component so the header,
 * host flow and arena all agree on who the player is.
 */
export function useWalletIdentity() {
  useEffect(boot, []);
  const { wallet, username } = useSyncExternalStore(subscribe, () => identity, () => SIGNED_OUT);

  /** Connect, or disconnect when already connected. Returns a status line for a toast. */
  const toggleConnect = useCallback(async (): Promise<{ message: string; needsUsername: boolean }> => {
    if (identity.wallet) {
      setIdentity(null);
      await Promise.all([signOut(), disconnectWallet()]);
      return { message: "Wallet disconnected.", needsUsername: false };
    }

    const options = listWallets();
    if (options.length === 0) {
      return { message: "No Solana wallet found in this browser. Install Phantom, Backpack or Solflare, then reload.", needsUsername: false };
    }
    const kind = options.length === 1 ? options[0].kind : await pickWallet(options);
    if (!kind) return { message: "", needsUsername: false };

    let addr: string;
    try { addr = await connectWallet(kind); }
    catch (err) { return { message: describeWalletError(err, "The connection request"), needsUsername: false }; }
    setIdentity(addr);

    // Sign in now, while the wallet is open, so seats and trades later need
    // no extra prompt. Declining is fine — it is asked again when needed.
    const auth = await ensureSession(addr);
    const who = identity.username || shortPk(addr);
    const later = auth.ok ? "" : ` ${auth.error} You'll be asked to sign in again before your first seat or trade.`;
    return identity.username
      ? { message: `Connected as ${who}.${later}`, needsUsername: false }
      : { message: `Connected ${who}.${later || " Set a username so other players know who you are."}`, needsUsername: true };
  }, []);

  const saveUsername = useCallback((raw: string): { ok: boolean; message: string } => {
    const w = identity.wallet;
    if (!w) return { ok: false, message: "Connect a wallet first." };
    const v = validateUsername(raw);
    if (!v.ok) return { ok: false, message: v.reason };
    saveStoredUsername(w, v.value);
    identity = { wallet: w, username: v.value };
    emit();
    return { ok: true, message: `Username set to ${v.value}.` };
  }, []);

  return { wallet, username, toggleConnect, saveUsername };
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
