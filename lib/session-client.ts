/**
 * Browser side of wallet sessions (see lib/session.ts). The wallet signs a
 * free sign-in message once; the server then keeps an httpOnly cookie for
 * that wallet for a week.
 */

import { describeWalletError, signMessageAs } from "@/lib/wallet";

type Result = { ok: true } | { ok: false; error: string; cancelled?: boolean };

let signedInAs: string | null = null;
let pending: { wallet: string; promise: Promise<Result> } | null = null;

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** True when the server already holds a session for `wallet` (no prompt needed). */
export async function hasSession(wallet: string): Promise<boolean> {
  if (signedInAs === wallet) return true;
  try {
    const cur = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json());
    if (cur?.wallet === wallet) { signedInAs = wallet; return true; }
  } catch { /* treat as signed out */ }
  return false;
}

async function signIn(wallet: string, onPrompt?: () => void, onSlow?: (walletName: string) => void): Promise<Result> {
  if (await hasSession(wallet)) return { ok: true };

  let ch: { message?: string; token?: string; error?: string };
  try {
    ch = await fetch("/api/auth/challenge", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet })
    }).then((r) => r.json());
  } catch {
    return { ok: false, error: "Couldn't reach the server to sign in — check your connection and try again." };
  }
  if (!ch?.message || !ch?.token) return { ok: false, error: ch?.error ?? "Couldn't start sign-in — try again." };

  let sig: Uint8Array;
  try {
    onPrompt?.();
    sig = await signMessageAs(wallet, new TextEncoder().encode(ch.message), onSlow);
  } catch (err) {
    const error = describeWalletError(err, "Sign-in");
    return { ok: false, error, cancelled: /cancelled/.test(error) };
  }

  try {
    const v = await fetch("/api/auth/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, message: ch.message, token: ch.token, signature: bytesToB64(sig) })
    }).then((r) => r.json());
    if (!v?.ok) return { ok: false, error: v?.error ? `Sign-in failed: ${v.error}.` : "Sign-in failed — try again." };
  } catch {
    return { ok: false, error: "Couldn't reach the server to finish sign-in — try again." };
  }
  signedInAs = wallet;
  return { ok: true };
}

/**
 * Make sure the browser holds a session for `wallet`, asking the wallet to
 * sign in if needed. `onPrompt` runs just before the wallet prompt opens.
 */
export function ensureSession(wallet: string, onPrompt?: () => void, onSlow?: (walletName: string) => void): Promise<Result> {
  if (signedInAs === wallet) return Promise.resolve({ ok: true });
  if (pending?.wallet === wallet) return pending.promise;
  const promise = signIn(wallet, onPrompt, onSlow).finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { wallet, promise };
  return promise;
}

/** Forget the session (on disconnect or account switch). */
export async function signOut(): Promise<void> {
  signedInAs = null;
  pending = null;
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => { /* ignore */ });
}

/** The server rejected the session (expired / other wallet) — sign in again next time. */
export function sessionLost(): void {
  signedInAs = null;
}
