"use client";

/**
 * Bridge between Privy (loaded only when NEXT_PUBLIC_PRIVY_APP_ID is set)
 * and the rest of the app, which never imports the Privy SDK directly.
 *
 * The Pit is X-only: a player signs in with X and plays with the Solana
 * wallet Privy creates for that X account (an embedded wallet). That wallet
 * holds the player's USDC and signs deposits and withdrawals; nothing else
 * can sign in.
 *
 * <PrivyRoot/> mounts Privy and registers a bridge here. X sign-in is an
 * OAuth redirect: the page reloads, so finishing sign-in after coming back
 * is remembered in sessionStorage ("pending").
 */

import type { SolanaProvider } from "@/lib/wallet";

const RAW_APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
/** Privy app IDs are 25 characters; the SDK throws on anything else, so a bad value means "off". */
export const PRIVY_APP_ID = RAW_APP_ID.length === 25 ? RAW_APP_ID : "";
/** X sign-in is set up on this deployment. */
export const X_ENABLED = PRIVY_APP_ID.length > 0;

if (RAW_APP_ID && !PRIVY_APP_ID && typeof window !== "undefined") {
  console.error("NEXT_PUBLIC_PRIVY_APP_ID isn't a Privy app ID (25 characters), so X sign-in is off.");
}

export type PrivyBridge = {
  ready: boolean;
  authenticated: boolean;
  /** The X handle Privy knows for this user, if they signed in with X. */
  xUsername: string | null;
  /** Address of the user's Privy embedded Solana wallet, if one exists. */
  embeddedAddress: string | null;
  /** Start X sign-in (redirects away and back). */
  loginWithX: () => Promise<void>;
  ensureEmbeddedWallet: () => Promise<string>;
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>;
  /** Up-to-date Privy tokens (the identity token is refreshed so it lists a just-created wallet). */
  tokens: () => Promise<{ idToken?: string; accessToken?: string }>;
  /** Privy's own dialog to copy the wallet's private key (shown on Privy's domain, never to this app). */
  exportWallet: () => Promise<void>;
  logout: () => Promise<void>;
};

let bridge: PrivyBridge | null = null;
let failed = false;
const waiters = new Set<() => void>();
const changeSubs = new Set<() => void>();

/** Privy couldn't start: stop waiting for it (X sign-in reports itself unavailable). */
export function setPrivyFailed(): void {
  failed = true;
  waiters.forEach((f) => f());
  waiters.clear();
}

export function setPrivyBridge(b: PrivyBridge | null): void {
  bridge = b;
  if (b?.ready) { waiters.forEach((f) => f()); waiters.clear(); }
  if (b?.ready) runReturnHandlers();
  changeSubs.forEach((f) => f());
}

export function getPrivyBridge(): PrivyBridge | null {
  return bridge;
}

/** Called whenever Privy's state changes (signed in or out, wallet created). */
export function onPrivyChange(fn: () => void): () => void {
  changeSubs.add(fn);
  return () => { changeSubs.delete(fn); };
}

/** Wait (briefly) for Privy to finish loading. */
export function waitForPrivy(timeoutMs = 10_000): Promise<PrivyBridge | null> {
  if (!X_ENABLED || failed) return Promise.resolve(null);
  if (bridge?.ready) return Promise.resolve(bridge);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(bridge?.ready ? bridge : null); };
    const t = setTimeout(() => { waiters.delete(done); resolve(bridge?.ready ? bridge : null); }, timeoutMs);
    waiters.add(done);
  });
}

// ---- What to do after the X redirect -------------------------------------

export type Pending = "signin";
const PENDING_KEY = "the-pit/x-pending/v2";

function setPending(p: Pending | null): void {
  try { if (p) sessionStorage.setItem(PENDING_KEY, p); else sessionStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
}
function getPending(): Pending | null {
  try { return sessionStorage.getItem(PENDING_KEY) === "signin" ? "signin" : null; } catch { return null; }
}

type ReturnHandler = (pending: Pending, b: PrivyBridge) => void;
const returnHandlers = new Set<ReturnHandler>();
let handled = false;

/** Run `fn` once Privy is ready after an X sign-in this page started. */
export function onXReturn(fn: ReturnHandler): () => void {
  returnHandlers.add(fn);
  runReturnHandlers();
  return () => { returnHandlers.delete(fn); };
}

function runReturnHandlers() {
  if (handled || !bridge?.ready || returnHandlers.size === 0) return;
  const pending = getPending();
  if (!pending) return;
  // Back without signing in (cancelled on X): nothing to finish.
  if (!bridge.authenticated) { setPending(null); return; }
  handled = true;
  setPending(null);
  const b = bridge;
  returnHandlers.forEach((fn) => fn(pending, b));
}

/** A problem with X sign-in itself (not a cancelled prompt); its message is shown as is. */
export class XSignInError extends Error {}

export const X_UNAVAILABLE = "X sign-in isn't available right now — reload the page and try again.";
export const X_NOT_SET_UP = "X sign-in isn't set up on this deployment.";

/** Start X sign-in; sign-in finishes once Privy is back (usually after the redirect). */
export async function startXSignIn(b: PrivyBridge): Promise<void> {
  setPending("signin");
  try {
    await b.loginWithX();
  } catch (err) {
    setPending(null);
    const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "").trim();
    throw new XSignInError(msg ? `X sign-in failed: ${msg.slice(0, 160)}` : "X sign-in failed — try again.");
  }
}

// ---- The embedded wallet as a SolanaProvider ------------------------------

/** Privy lists the wallet a moment after it reports ready: wait for it briefly. */
function waitForWallet(timeoutMs = 6_000): Promise<PrivyBridge | null> {
  if (bridge?.authenticated && bridge.embeddedAddress) return Promise.resolve(bridge);
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(t); off(); resolve(bridge?.authenticated && bridge.embeddedAddress ? bridge : null); };
    const off = onPrivyChange(() => { if (bridge?.authenticated && bridge.embeddedAddress) finish(); });
    const t = setTimeout(finish, timeoutMs);
  });
}

type Serializable = { serialize(opts?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array };

const pk = (addr: string) => ({ toString: () => addr, toBase58: () => addr });

/** The player's X wallet. It never starts X sign-in itself — that's the Sign in button's job. */
export const privyProvider: SolanaProvider = {
  get publicKey() { return bridge?.authenticated && bridge.embeddedAddress ? pk(bridge.embeddedAddress) : null; },
  get isConnected() { return !!bridge?.authenticated && !!bridge.embeddedAddress; },
  async connect() {
    const b = await waitForPrivy();
    if (!b) throw new XSignInError(X_ENABLED ? X_UNAVAILABLE : X_NOT_SET_UP);
    if (!b.authenticated) throw new XSignInError("You're signed out of X — sign in with X again.");
    const ready = await waitForWallet(3_000);
    const addr = ready?.embeddedAddress ?? await b.ensureEmbeddedWallet();
    return { publicKey: pk(addr) };
  },
  async disconnect() { await bridge?.logout(); },
  async signTransaction(tx: unknown) {
    if (!bridge?.authenticated) throw new XSignInError("You're signed out of X — sign in with X again.");
    const b = await waitForWallet();
    if (!b) throw new XSignInError("Your X wallet is still loading — try again in a moment.");
    const raw = (tx as Serializable).serialize({ requireAllSignatures: false, verifySignatures: false });
    const signed = await b.signTransaction(raw);
    return { serialize: () => signed };
  }
};
