/**
 * Browser side of sessions (see lib/session.ts and /api/auth/x).
 *
 * Signing in with X gives the browser an httpOnly session cookie for the
 * player's X wallet. When it lapses while Privy still has the player signed
 * in to X, it is renewed from Privy's tokens — no prompt, nothing to sign.
 */

import { getPrivyBridge, waitForPrivy, X_ENABLED, X_NOT_SET_UP } from "@/lib/privy-client";

type Result = { ok: true } | { ok: false; error: string; cancelled?: boolean };
export type XSession = { wallet: string; username: string; created: boolean; movedFrom: string | null };

let signedInAs: string | null = null;
let pending: { wallet: string; promise: Promise<Result> } | null = null;

/** The wallet (and username) the server has a session for, or null. */
export async function currentSession(): Promise<{ wallet: string; username: string } | null> {
  try {
    const cur = (await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json())) as { wallet?: string | null; username?: string | null };
    if (!cur?.wallet) { signedInAs = null; return null; }
    signedInAs = cur.wallet;
    return { wallet: cur.wallet, username: cur.username ?? "" };
  } catch {
    return null;
  }
}

/**
 * Exchange Privy's proof of the X account (and its wallet) for a session.
 * Privy must already have the player signed in to X.
 */
export async function sessionFromX(): Promise<{ ok: true; session: XSession } | { ok: false; error: string }> {
  if (!X_ENABLED) return { ok: false, error: X_NOT_SET_UP };
  const b = await waitForPrivy();
  if (!b?.authenticated) return { ok: false, error: "Sign in with X to continue." };
  let wallet: string;
  let tokens: { idToken?: string; accessToken?: string };
  try {
    wallet = b.embeddedAddress ?? await b.ensureEmbeddedWallet();
    tokens = await (getPrivyBridge() ?? b).tokens();
  } catch {
    return { ok: false, error: "Couldn't set up your X wallet — try signing in again." };
  }
  try {
    const res = await fetch("/api/auth/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, ...tokens })
    });
    const j = (await res.json().catch(() => ({}))) as Partial<XSession> & { error?: string };
    if (!res.ok || !j.wallet) return { ok: false, error: j.error ?? "Sign-in failed — try again." };
    signedInAs = j.wallet;
    return { ok: true, session: { wallet: j.wallet, username: j.username ?? "", created: !!j.created, movedFrom: j.movedFrom ?? null } };
  } catch {
    return { ok: false, error: "Couldn't reach the server to sign in — check your connection and try again." };
  }
}

async function renew(wallet: string): Promise<Result> {
  const cur = await currentSession();
  if (cur?.wallet === wallet) return { ok: true };
  const r = await sessionFromX();
  if (!r.ok) return { ok: false, error: r.error };
  if (r.session.wallet !== wallet) return { ok: false, error: "You're signed in to X with a different account now — reload the page." };
  return { ok: true };
}

/**
 * Make sure the browser holds a session for `wallet`, renewing it from the X
 * sign-in if it lapsed. The extra arguments are kept for callers that show
 * progress; renewal never opens a prompt.
 */
export function ensureSession(wallet: string, _onPrompt?: () => void, _onSlow?: (walletName: string) => void): Promise<Result> {
  void _onPrompt; void _onSlow;
  if (signedInAs === wallet) return Promise.resolve({ ok: true });
  if (pending?.wallet === wallet) return pending.promise;
  const promise = renew(wallet).finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { wallet, promise };
  return promise;
}

/** End the session on this browser. */
export async function signOut(): Promise<void> {
  signedInAs = null;
  pending = null;
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => { /* ignore */ });
}

/** The server rejected the session (expired) — renew it next time. */
export function sessionLost(): void {
  signedInAs = null;
}
