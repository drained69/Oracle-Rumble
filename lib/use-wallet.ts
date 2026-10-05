"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ensureSession, signOut } from "@/lib/session-client";
import { getPrivyBridge, onXReturn, startXSignIn, waitForPrivy, X_REQUIRED, X_UNAVAILABLE } from "@/lib/privy-client";
import { getStoredUsername, saveStoredUsername, shortPk, validateUsername } from "@/lib/username";
import {
  connectWallet, describeWalletError, disconnectWallet, listWallets, reconnectSilently,
  rememberedKind, watchWallet, type WalletKind, type WalletOption
} from "@/lib/wallet";

export const WALLET_KEY = "oracle-rumble/wallet/v1";

export type EscrowStatus = { active: boolean; reason?: string | null };

// ---- One identity for the whole page -----------------------------------

type Identity = { wallet: string | null; username: string; xLinked: boolean };
type Picker = { options: WalletOption[]; remembered: WalletKind | null; resolve: (k: WalletKind | null) => void };

const SIGNED_OUT: Identity = { wallet: null, username: "", xLinked: false };
let identity: Identity = SIGNED_OUT;
let picker: Picker | null = null;
const subs = new Set<() => void>();
let booted = false;

const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** A wallet's name before its profile loads: the saved one, or none when names come from X. */
const localName = (wallet: string) => (X_REQUIRED ? "" : getStoredUsername(wallet));

function setIdentity(wallet: string | null) {
  identity = wallet ? { wallet, username: localName(wallet), xLinked: false } : SIGNED_OUT;
  try {
    if (wallet) localStorage.setItem(WALLET_KEY, wallet);
    else localStorage.removeItem(WALLET_KEY);
  } catch { /* storage unavailable */ }
  emit();
  if (wallet) void loadProfile(wallet);
}

/** When usernames are X handles, the server's profile is the source of truth. */
async function loadProfile(wallet: string): Promise<void> {
  if (!X_REQUIRED) return;
  try {
    const r = (await fetch(`/api/profile?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" }).then((x) => x.json())) as { profile?: { username: string } | null };
    if (identity.wallet !== wallet) return;
    identity = { wallet, username: r.profile?.username ?? "", xLinked: !!r.profile };
    emit();
  } catch { /* keep what we have */ }
}

/**
 * Link the X account the player signed in with to `wallet` (needs a wallet
 * session). The first link sets the username for good.
 */
async function linkX(wallet: string): Promise<{ ok: boolean; message: string }> {
  const b = getPrivyBridge();
  if (!b?.authenticated) return { ok: false, message: "Sign in with X first." };
  const auth = await ensureSession(wallet);
  if (!auth.ok) return { ok: false, message: auth.error };
  try {
    const tokens = await b.tokens();
    const res = await fetch("/api/profile/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tokens) });
    const r = (await res.json()) as { profile?: { username: string }; error?: string; note?: string; created?: boolean };
    if (!res.ok || !r.profile) return { ok: false, message: r.error ?? "Couldn't link your X account — try again." };
    if (identity.wallet === wallet) { identity = { wallet, username: r.profile.username, xLinked: true }; emit(); }
    return { ok: true, message: r.note ?? (r.created ? `You're @${r.profile.username} now — that's your username for good.` : `Playing as @${r.profile.username}.`) };
  } catch {
    return { ok: false, message: "Couldn't reach the server to link X — try again." };
  }
}

/** Messages from flows that finish after the X redirect, for whichever page shows toasts. */
const xNotices = new Set<(message: string) => void>();
function notifyX(message: string) { xNotices.forEach((f) => f(message)); }

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  let stored: string | null = null;
  try { stored = localStorage.getItem(WALLET_KEY); } catch { /* storage unavailable */ }
  if (stored) {
    identity = { wallet: stored, username: localName(stored), xLinked: false };
    emit();
    void loadProfile(stored);
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
    identity = e.newValue ? { wallet: e.newValue, username: localName(e.newValue), xLinked: false } : SIGNED_OUT;
    emit();
    if (e.newValue) void loadProfile(e.newValue);
  });
  // Back from X sign-in: finish what the player started.
  onXReturn((pending, b) => {
    void (async () => {
      if (pending === "embedded") {
        // "Play with X": use the X account's embedded wallet as the wallet.
        let addr: string;
        try { addr = await connectWallet("privy"); }
        catch (err) { notifyX(describeWalletError(err, "Setting up your X wallet")); return; }
        setIdentity(addr);
        const r = await linkX(addr);
        notifyX(r.ok ? `Signed in with X — ${r.message}` : r.message);
        return;
      }
      const wallet = identity.wallet;
      if (!wallet) { notifyX(`Signed in with X as @${b.xUsername ?? "you"}. Connect your wallet to link it.`); return; }
      const r = await linkX(wallet);
      notifyX(r.message);
    })();
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
    // Always show the picker when "X account" is an option, so it's a choice.
    const kind = options.length === 1 && options[0].kind !== "privy" ? options[0].kind : await pickWallet(options);
    if (!kind) return { message: "", needsUsername: false };

    let addr: string;
    try { addr = await connectWallet(kind); }
    catch (err) { return { message: describeWalletError(err, "The connection request"), needsUsername: false }; }
    setIdentity(addr);

    // Sign in now, while the wallet is open, so seats and trades later need
    // no extra prompt. Declining is fine — it is asked again when needed.
    const auth = await ensureSession(addr);
    if (X_REQUIRED) await loadProfile(addr);
    const who = identity.username || shortPk(addr);
    const later = auth.ok ? "" : ` ${auth.error} You'll be asked to sign in again before your first seat or trade.`;
    return identity.username
      ? { message: `Connected as ${who}.${later}`, needsUsername: false }
      : { message: `Connected ${who}.${later || (X_REQUIRED ? " Connect your X account — your X handle becomes your username." : " Set a username so other players know who you are.")}`, needsUsername: true };
  }, []);

  /**
   * Connect X: link the X account to this wallet (its handle becomes the
   * username, once). Redirects to X when not signed in there yet.
   */
  const connectX = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const w = identity.wallet;
    if (!w) return { ok: false, message: "Connect a wallet first." };
    const b = await waitForPrivy();
    if (!b) return { ok: false, message: X_UNAVAILABLE };
    if (b.authenticated && b.xUsername) return linkX(w);
    // Make sure the wallet session exists before leaving for X.
    const auth = await ensureSession(w);
    if (!auth.ok) return { ok: false, message: auth.error };
    try { await startXSignIn(b, "link"); }
    catch (err) { return { ok: false, message: describeWalletError(err, "X sign-in") }; }
    return { ok: true, message: "Opening X…" };
  }, []);

  const saveUsername = useCallback((raw: string): { ok: boolean; message: string } => {
    const w = identity.wallet;
    if (!w) return { ok: false, message: "Connect a wallet first." };
    if (X_REQUIRED) return { ok: false, message: "Your username is your X handle — connect X to set it." };
    const v = validateUsername(raw);
    if (!v.ok) return { ok: false, message: v.reason };
    saveStoredUsername(w, v.value);
    identity = { wallet: w, username: v.value, xLinked: false };
    emit();
    return { ok: true, message: `Username set to ${v.value}.` };
  }, []);

  return { wallet, username, toggleConnect, saveUsername, connectX, xRequired: X_REQUIRED };
}

/** Wire X-flow results (after the redirect back) into a page's toasts. */
export function useXNotices(toast: (message: string) => void): void {
  useEffect(() => {
    xNotices.add(toast);
    return () => { xNotices.delete(toast); };
  }, [toast]);
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
