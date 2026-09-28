/**
 * Wallet sessions — proves a request comes from the wallet it names.
 *
 * Game actions (take a seat, set a call, trade, parlay, cash out) change a
 * player's vault, and their USDC payout follows the vault. They must not
 * be accepted on the strength of a wallet address in the request body.
 *
 * Sign-in: the browser asks for a challenge, the wallet signs it (a free
 * off-chain message, no transaction), and the server checks the ed25519
 * signature against the wallet's public key. It then sets an httpOnly
 * cookie bound to that wallet. No server-side session storage: challenges
 * and cookies are HMAC-signed and carry their own expiry.
 *
 * Server-only.
 */

import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "or_session";
const SESSION_TTL_MS = 7 * 24 * 3600_000;
const CHALLENGE_TTL_MS = 5 * 60_000;
/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const _g = globalThis as unknown as { __or_sessionKey?: Buffer };

function key(): Buffer {
  if (_g.__or_sessionKey) return _g.__or_sessionKey;
  const raw = process.env.SESSION_SECRET || process.env.ESCROW_HOST_SECRET_KEY || process.env.ROUND_HOST_SECRET || "";
  _g.__or_sessionKey = raw
    ? crypto.createHash("sha256").update(`oracle-rumble/session/v1:${raw}`).digest()
    : crypto.randomBytes(32); // dev without secrets: sessions last until restart
  return _g.__or_sessionKey;
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", key()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isWallet(w: unknown): w is string {
  if (typeof w !== "string" || w.length < 32 || w.length > 44) return false;
  try { new PublicKey(w); return true; } catch { return false; }
}

/** A sign-in message for `wallet` plus a token proving we issued it. */
export function issueChallenge(wallet: string): { message: string; token: string } | null {
  if (!isWallet(wallet)) return null;
  const nonce = crypto.randomBytes(12).toString("base64url");
  const issuedAt = new Date().toISOString();
  const message = [
    "Oracle Rumble wants you to sign in with your Solana account:",
    wallet,
    "",
    "Sign in to take seats and trade. This is not a transaction and costs nothing.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`
  ].join("\n");
  return { message, token: mac(`challenge|${message}`) };
}

/** Check a signed challenge. Returns the wallet on success. */
export function verifyChallenge(args: { wallet: string; message: string; token: string; signature: string }): { ok: true } | { ok: false; error: string } {
  const { wallet, message, token, signature } = args;
  if (!isWallet(wallet) || typeof message !== "string" || typeof token !== "string" || typeof signature !== "string") {
    return { ok: false, error: "bad sign-in request" };
  }
  if (!safeEqual(mac(`challenge|${message}`), token)) return { ok: false, error: "unknown sign-in challenge" };
  const lines = message.split("\n");
  if (lines[1] !== wallet) return { ok: false, error: "challenge is for a different wallet" };
  const issued = Date.parse((lines.find((l) => l.startsWith("Issued At: ")) ?? "").slice("Issued At: ".length));
  if (!Number.isFinite(issued) || Date.now() - issued > CHALLENGE_TTL_MS) return { ok: false, error: "sign-in expired — try again" };

  try {
    const pub = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(new PublicKey(wallet).toBytes())]),
      format: "der",
      type: "spki"
    });
    const sig = Buffer.from(signature, "base64");
    if (sig.length !== 64) return { ok: false, error: "bad signature" };
    if (!crypto.verify(null, Buffer.from(message, "utf8"), pub, sig)) return { ok: false, error: "signature does not match this wallet" };
  } catch {
    return { ok: false, error: "could not verify signature" };
  }
  return { ok: true };
}

/** Cookie value for a verified wallet. */
export function sessionCookieValue(wallet: string): { value: string; maxAge: number } {
  const exp = Date.now() + SESSION_TTL_MS;
  return { value: `${wallet}.${exp}.${mac(`session|${wallet}|${exp}`)}`, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

/** The wallet this request is signed in as, or null. */
export function sessionWallet(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [wallet, expStr, sig] = decodeURIComponent(raw).split(".");
  const exp = Number(expStr);
  if (!wallet || !sig || !Number.isFinite(exp) || Date.now() > exp) return null;
  return safeEqual(mac(`session|${wallet}|${exp}`), sig) ? wallet : null;
}

/** 401 unless the request is signed in as `wallet`. */
export function requireWallet(request: Request, wallet: string | undefined | null): NextResponse | null {
  if (wallet && sessionWallet(request) === wallet) return null;
  return NextResponse.json(
    { error: "Sign in with your wallet to continue.", needsAuth: true },
    { status: 401 }
  );
}
