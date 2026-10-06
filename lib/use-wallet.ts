"use client";

/**
 * Who the player is, shared by every component: their X handle and the
 * Solana wallet Privy keeps for their X account.
 *
 * The Pit is X-only. "Sign in with X" redirects to X; on the way back Privy
 * creates (or reopens) the player's X wallet and the server turns that into
 * a session for the wallet (/api/auth/x). There is no other way in.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { currentSession, sessionFromX, signOut as endSession } from "@/lib/session-client";
import { getPrivyBridge, onPrivyChange, onXReturn, startXSignIn, waitForPrivy, X_ENABLED, X_NOT_SET_UP, X_UNAVAILABLE } from "@/lib/privy-client";
import { describeWalletError } from "@/lib/wallet";

export type EscrowStatus = { active: boolean; reason?: string | null };

/** "loading" until the session is known; "busy" while signing in or out. */
export type IdentityStatus = "loading" | "out" | "busy" | "in";
type Identity = { wallet: string | null; username: string; status: IdentityStatus };

const LOADING: Identity = { wallet: null, username: "", status: "loading" };
const SIGNED_OUT: Identity = { wallet: null, username: "", status: "out" };
/** Bumped on sign-in/out so other tabs follow. */
const SYNC_KEY = "the-pit/session-sync/v1";

let identity: Identity = LOADING;
const subs = new Set<() => void>();
let booted = false;

const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function set(next: Identity, broadcast = false) {
  identity = next;
  emit();
  if (broadcast) { try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch { /* storage unavailable */ } }
}

/** Messages from flows that finish after the X redirect, for whichever page shows toasts. */
const xNotices = new Set<(message: string) => void>();
function notifyX(message: string) { xNotices.forEach((f) => f(message)); }

/** Turn Privy's X sign-in into a session (Privy must be signed in). */
async function finishSignIn(): Promise<string> {
  set({ ...identity, status: "busy" });
  const r = await sessionFromX();
  if (!r.ok) {
    set(SIGNED_OUT);
    return r.error;
  }
  const { wallet, username, created, movedFrom } = r.session;
  set({ wallet, username, status: "in" }, true);
  if (created) return `Welcome, @${username}. Your Solana wallet is ready — open your account to see its address and fund it.`;
  if (movedFrom) return `Signed in as @${username}. Your X account now plays with its own X wallet — open your account to see the address.`;
  return `Signed in as @${username}.`;
}

async function refreshFromServer(): Promise<void> {
  const cur = await currentSession();
  if (cur) { set({ wallet: cur.wallet, username: cur.username, status: "in" }); return; }
  // No session, but still signed in to X here (the session lapsed): renew it quietly.
  const b = X_ENABLED ? await waitForPrivy(6_000) : null;
  if (b?.authenticated && b.xUsername) {
    const r = await sessionFromX();
    if (r.ok) { set({ wallet: r.session.wallet, username: r.session.username, status: "in" }); return; }
  }
  set(SIGNED_OUT);
}

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  void refreshFromServer();
  // Back from X: finish signing in.
  onXReturn(() => { void finishSignIn().then(notifyX); });
  // Signed out of X elsewhere (or Privy's session ended): the X wallet can't
  // sign any more, so end this session too rather than fail at the next deposit.
  onPrivyChange(() => {
    const b = getPrivyBridge();
    if (b?.ready && !b.authenticated && identity.status === "in") {
      void endSession();
      set(SIGNED_OUT, true);
    }
  });
  window.addEventListener("storage", (e) => { if (e.key === SYNC_KEY) void refreshFromServer(); });
}

/**
 * The signed-in player, shared by every component so the header, host flow
 * and pit all agree on who is playing.
 */
export function useWalletIdentity() {
  useEffect(boot, []);
  const { wallet, username, status } = useSyncExternalStore(subscribe, () => identity, () => LOADING);

  /** Sign in with X. Usually redirects to X and finishes on the way back. */
  const signIn = useCallback(async (): Promise<{ message: string }> => {
    if (identity.status === "in") return { message: `Signed in as @${identity.username}.` };
    if (!X_ENABLED) return { message: X_NOT_SET_UP };
    const b = await waitForPrivy();
    if (!b) return { message: X_UNAVAILABLE };
    if (b.authenticated && b.xUsername) return { message: await finishSignIn() };
    set({ ...identity, status: "busy" });
    try {
      await startXSignIn(b);
    } catch (err) {
      set(SIGNED_OUT);
      return { message: describeWalletError(err, "X sign-in") };
    }
    // OAuth normally leaves the page; if it finished in place, complete now.
    if (getPrivyBridge()?.authenticated) return { message: await finishSignIn() };
    return { message: "Opening X…" };
  }, []);

  const signOut = useCallback(async (): Promise<{ message: string }> => {
    set({ ...identity, status: "busy" });
    await Promise.all([endSession(), getPrivyBridge()?.logout().catch(() => {})]);
    set(SIGNED_OUT, true);
    return { message: "Signed out." };
  }, []);

  return { wallet, username, status, signIn, signOut, xEnabled: X_ENABLED };
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
