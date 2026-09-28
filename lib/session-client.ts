/**
 * Browser side of wallet sessions (see lib/session.ts). Before the first
 * game action the wallet signs a free sign-in message; the server then
 * keeps an httpOnly cookie for that wallet for a week.
 */

let signedInAs: string | null = null;
let pending: Promise<{ ok: true } | { ok: false; error: string }> | null = null;

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function provider(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.phantom?.solana ?? w.solana ?? w.backpack?.solana ?? w.solflare ?? null;
}

async function signIn(wallet: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const cur = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    if (cur?.wallet === wallet) { signedInAs = wallet; return { ok: true }; }

    const p = provider();
    if (!p?.signMessage) return { ok: false, error: "Your wallet can't sign messages — try Phantom, Backpack or Solflare." };
    const ch = await fetch("/api/auth/challenge", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet })
    }).then((r) => r.json());
    if (!ch?.message || !ch?.token) return { ok: false, error: ch?.error ?? "Couldn't start sign-in." };

    let signed: unknown;
    try {
      signed = await p.signMessage(new TextEncoder().encode(ch.message), "utf8");
    } catch {
      return { ok: false, error: "Sign-in was cancelled in the wallet." };
    }
    // Phantom/Solflare return { signature }, Backpack may return the bytes.
    const sig = signed instanceof Uint8Array ? signed : (signed as { signature?: Uint8Array })?.signature;
    if (!(sig instanceof Uint8Array)) return { ok: false, error: "The wallet didn't return a signature." };

    const v = await fetch("/api/auth/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, message: ch.message, token: ch.token, signature: bytesToB64(sig) })
    }).then((r) => r.json());
    if (!v?.ok) return { ok: false, error: v?.error ?? "Sign-in failed." };
    signedInAs = wallet;
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server to sign in." };
  }
}

/** Make sure the browser holds a session for `wallet` (asks the wallet once). */
export function ensureSession(wallet: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (signedInAs === wallet) return Promise.resolve({ ok: true });
  if (!pending) pending = signIn(wallet).finally(() => { pending = null; });
  return pending;
}

/** Forget the session (on disconnect, or when the server says it's gone). */
export async function signOut(): Promise<void> {
  signedInAs = null;
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => { /* ignore */ });
}

/** The server rejected the session (expired / other wallet) — sign in again next time. */
export function sessionLost(): void {
  signedInAs = null;
}
