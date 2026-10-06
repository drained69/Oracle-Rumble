/**
 * Wallet sessions — proves a request comes from the wallet it names.
 *
 * Where X sign-in is set up (Privy), sessions are issued only by
 * /api/auth/x, for an X account's own embedded wallet. The wallet-signature
 * sign-in below remains for deployments without X (local development).
 *
 * Game actions (take a seat, set a call or picks, trade) change a
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
    ? crypto.createHash("sha256").update(`the-pit/session/v2:${raw}`).digest()
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

const CHAIN_ID = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const HEADER = " wants you to sign in with your Solana account:";

/**
 * The site's own host and origin as the browser sees them (behind Railway's
 * proxy the forwarded headers carry them). The sign-in message is bound to
 * this domain, so a signature collected on another site can't be replayed.
 */
export function siteOrigin(request: Request): { host: string; uri: string } | null {
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host).split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const proto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0].trim();
  return { host, uri: `${proto === "http" ? "http" : "https"}://${host}` };
}

/**
 * A Sign-In With Solana message for `wallet`, plus a token proving we issued
 * it. The layout must follow the SIWS format exactly: wallets such as Phantom
 * recognise the "… wants you to sign in" header and refuse ("invalid
 * formatting") anything that deviates — a non-domain first line, a nonce with
 * symbols, missing URI/Version.
 */
export function issueChallenge(wallet: string, site: { host: string; uri: string }): { message: string; token: string } | null {
  if (!isWallet(wallet)) return null;
  const nonce = crypto.randomBytes(12).toString("hex"); // alphanumeric, as SIWS requires
  const now = Date.now();
  const message = [
    `${site.host}${HEADER}`,
    wallet,
    "",
    "Sign in to The Pit to take seats and trade. This is not a transaction and costs nothing.",
    "",
    `URI: ${site.uri}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(now).toISOString()}`,
    `Expiration Time: ${new Date(now + CHALLENGE_TTL_MS).toISOString()}`
  ].join("\n");
  return { message, token: mac(`challenge|${message}`) };
}

/** Check a signed challenge issued for this site. */
export function verifyChallenge(args: { wallet: string; message: string; token: string; signature: string; host: string }): { ok: true } | { ok: false; error: string } {
  const { wallet, message, token, signature, host } = args;
  if (!isWallet(wallet) || typeof message !== "string" || typeof token !== "string" || typeof signature !== "string") {
    return { ok: false, error: "bad sign-in request" };
  }
  if (!safeEqual(mac(`challenge|${message}`), token)) return { ok: false, error: "unknown sign-in challenge" };
  const lines = message.split("\n");
  if (lines[0] !== `${host}${HEADER}`) return { ok: false, error: "sign-in was issued for a different site" };
  if (lines[1] !== wallet) return { ok: false, error: "challenge is for a different wallet" };
  const field = (name: string) => (lines.find((l) => l.startsWith(`${name}: `)) ?? "").slice(name.length + 2);
  const issued = Date.parse(field("Issued At"));
  const expires = Date.parse(field("Expiration Time"));
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || Date.now() > expires || Date.now() - issued > CHALLENGE_TTL_MS) {
    return { ok: false, error: "sign-in expired — try again" };
  }

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
    { error: "Sign in with X to continue.", needsAuth: true },
    { status: 401 }
  );
}
