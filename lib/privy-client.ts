"use client";

/**
 * Bridge between Privy (loaded only when NEXT_PUBLIC_PRIVY_APP_ID is set)
 * and the rest of the app, which never imports the Privy SDK directly.
 *
 * <PrivyRoot/> mounts Privy and registers a bridge here. Through it:
 *   - "Connect X" proves which X account a player owns; the server then
 *     makes that X handle the wallet's username, once and for good.
 *   - Players without a Solana wallet can sign in with X and play with a
 *     Privy embedded wallet, offered as one more wallet ("X account") that
 *     signs exactly like Phantom or Backpack.
 *
 * X sign-in is an OAuth redirect: the page reloads, so what to do after
 * coming back is remembered in sessionStorage ("pending").
 */

import type { SolanaProvider } from "@/lib/wallet";

const RAW_APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
/** Privy app IDs are 25 characters; the SDK throws on anything else, so a bad value means "off". */
export const PRIVY_APP_ID = RAW_APP_ID.length === 25 ? RAW_APP_ID : "";
/** Usernames are X handles on this deployment. */
export const X_REQUIRED = PRIVY_APP_ID.length > 0;

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
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>;
  tokens: () => Promise<{ idToken?: string; accessToken?: string }>;
  logout: () => Promise<void>;
};

let bridge: PrivyBridge | null = null;
let failed = false;
const waiters = new Set<() => void>();

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
}

export function getPrivyBridge(): PrivyBridge | null {
  return bridge;
}

/** Wait (briefly) for Privy to finish loading. */
export function waitForPrivy(timeoutMs = 8_000): Promise<PrivyBridge | null> {
  if (!X_REQUIRED || failed) return Promise.resolve(null);
  if (bridge?.ready) return Promise.resolve(bridge);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(bridge?.ready ? bridge : null); };
    const t = setTimeout(() => { waiters.delete(done); resolve(bridge?.ready ? bridge : null); }, timeoutMs);
    waiters.add(done);
  });
}

// ---- What to do after the X redirect -------------------------------------

export type Pending = "link" | "embedded";
const PENDING_KEY = "oracle-rumble/x-pending/v1";

export function setPending(p: Pending | null): void {
  try { if (p) sessionStorage.setItem(PENDING_KEY, p); else sessionStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
}
function getPending(): Pending | null {
  try { return (sessionStorage.getItem(PENDING_KEY) as Pending | null) ?? null; } catch { return null; }
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
  if (handled || !bridge?.ready || !bridge.authenticated || returnHandlers.size === 0) return;
  const pending = getPending();
  if (!pending) return;
  handled = true;
  setPending(null);
  const b = bridge;
  returnHandlers.forEach((fn) => fn(pending, b));
}

/** A problem with X sign-in itself (not a cancelled wallet prompt); its message is shown as is. */
export class XSignInError extends Error {}

export const X_UNAVAILABLE = "X sign-in isn't available right now — try again later.";

/** Start X sign-in; `pending` runs once Privy is back (usually after the redirect). */
export async function startXSignIn(b: PrivyBridge, pending: Pending): Promise<void> {
  setPending(pending);
  try {
    await b.loginWithX();
  } catch (err) {
    setPending(null);
    const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "").trim();
    throw new XSignInError(msg ? `X sign-in failed: ${msg.slice(0, 160)}` : "X sign-in failed — try again.");
  }
}

// ---- The embedded wallet as a SolanaProvider ------------------------------

type Serializable = { serialize(opts?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array };

const pk = (addr: string) => ({ toString: () => addr, toBase58: () => addr });

export const privyProvider: SolanaProvider = {
  get publicKey() { return bridge?.authenticated && bridge.embeddedAddress ? pk(bridge.embeddedAddress) : null; },
  get isConnected() { return !!bridge?.authenticated && !!bridge.embeddedAddress; },
  async connect(opts?: { onlyIfTrusted?: boolean }) {
    const b = await waitForPrivy();
    if (!b) throw new XSignInError(X_UNAVAILABLE);
    if (b.authenticated && b.embeddedAddress) return { publicKey: pk(b.embeddedAddress) };
    if (opts?.onlyIfTrusted) throw { code: 4001, message: "Not signed in with X." };
    if (!b.authenticated) {
      await startXSignIn(b, "embedded");
      // OAuth usually redirects away; if it completed in place, carry on.
      if (!getPrivyBridge()?.authenticated) throw { code: 4001, message: "X sign-in didn't finish." };
    }
    const addr = await (getPrivyBridge() ?? b).ensureEmbeddedWallet();
    return { publicKey: pk(addr) };
  },
  async disconnect() { await bridge?.logout(); },
  async signMessage(message: Uint8Array) {
    if (!bridge) throw { code: 4100, message: "X account not connected." };
    return { signature: await bridge.signMessage(message) };
  },
  async signTransaction(tx: unknown) {
    if (!bridge) throw { code: 4100, message: "X account not connected." };
    const raw = (tx as Serializable).serialize({ requireAllSignatures: false, verifySignatures: false });
    const signed = await bridge.signTransaction(raw);
    return { serialize: () => signed };
  }
};

/** X's logo, for the wallet picker. */
export const X_ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#000"/><path fill="#fff" d="M13.6 10.7 18.9 4.5h-1.3l-4.6 5.4-3.7-5.4H5l5.6 8.1L5 19.5h1.3l4.9-5.7 3.9 5.7h4.3l-5.8-8.8Zm-1.7 2-.6-.8-4.5-6.4h1.9l3.6 5.2.6.8 4.7 6.7h-1.9l-3.8-5.5Z"/></svg>')
    : "");
