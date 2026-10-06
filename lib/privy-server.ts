/**
 * Server-side Privy checks: prove which X (Twitter) account a player owns
 * and that a wallet is that account's own Privy embedded wallet.
 *
 * The browser sends the Privy identity token it holds after X sign-in; we
 * verify its signature against Privy's published keys for our app (no
 * secret needed) and read the linked accounts from it. With
 * PRIVY_APP_SECRET set we can also take an access token and look the user
 * up through Privy's API (needed if identity tokens are turned off).
 *
 * Server-only.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

const RAW_APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
// Same rule as the browser (lib/privy-client): a malformed ID means Privy is off.
export const PRIVY_APP_ID = RAW_APP_ID.length === 25 ? RAW_APP_ID : "";
const PRIVY_APP_SECRET = (process.env.PRIVY_APP_SECRET ?? "").trim();

if (RAW_APP_ID && !PRIVY_APP_ID) {
  console.warn("NEXT_PUBLIC_PRIVY_APP_ID isn't a Privy app ID (25 characters); X usernames are off.");
}

/** Privy is configured: the app is X-only — every session is an X account's wallet. */
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

export type XAccount = { xId: string; username: string };

const _g = globalThis as unknown as { __or_privyJwks?: ReturnType<typeof createRemoteJWKSet> };
function jwks() {
  _g.__or_privyJwks ??= createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`));
  return _g.__or_privyJwks;
}

async function verify(token: string) {
  const { payload } = await jwtVerify(token, jwks(), { issuer: "privy.io", audience: PRIVY_APP_ID });
  return payload;
}

type LinkedAccount = {
  type?: string;
  subject?: string;
  username?: string;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
};

function xFrom(accounts: LinkedAccount[] | undefined): XAccount | null {
  const x = (accounts ?? []).find((a) => a.type === "twitter_oauth" && a.subject && a.username);
  return x ? { xId: String(x.subject), username: String(x.username).replace(/^@/, "") } : null;
}

/** True when `accounts` holds `wallet` as the user's own Privy embedded Solana wallet. */
function ownsEmbeddedWallet(accounts: LinkedAccount[] | undefined, wallet: string): boolean {
  return (accounts ?? []).some((a) =>
    a.type === "wallet" &&
    a.address === wallet &&
    (a.chain_type ?? "solana") === "solana" &&
    (a.wallet_client_type === "privy" || a.connector_type === "embedded")
  );
}

type PrivyUser = { did: string; accounts: LinkedAccount[] };

/** The user in a verified Privy identity token. */
async function fromIdentityToken(idToken: string): Promise<PrivyUser> {
  const payload = await verify(idToken);
  const raw = payload.linked_accounts;
  const accounts = typeof raw === "string" ? (JSON.parse(raw) as LinkedAccount[]) : ((raw as LinkedAccount[] | undefined) ?? []);
  return { did: String(payload.sub ?? ""), accounts };
}

/** The user behind a verified access token, looked up through Privy's API (needs the app secret). */
async function fromAccessToken(accessToken: string): Promise<PrivyUser | null> {
  if (!PRIVY_APP_SECRET) return null;
  const payload = await verify(accessToken);
  const did = String(payload.sub ?? "");
  if (!did) return null;
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString("base64")}`,
      "privy-app-id": PRIVY_APP_ID
    },
    cache: "no-store"
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { linked_accounts?: LinkedAccount[] };
  return { did, accounts: user.linked_accounts ?? [] };
}

export type XLogin =
  | { ok: true; x: XAccount }
  | { ok: false; reason: "no-x" | "not-your-wallet"; message: string };

/**
 * Prove an X sign-in: the Privy token must be valid, carry an X account, and
 * `wallet` must be that same user's Privy embedded Solana wallet — so a
 * session can only ever belong to an X account's own wallet. A fresh
 * identity token may predate a just-created wallet, so the access token
 * (looked up live) is the fallback. Throws on an invalid or expired token.
 */
export async function verifyXLogin(tokens: { idToken?: string; accessToken?: string }, wallet: string): Promise<XLogin> {
  const users: PrivyUser[] = [];
  if (tokens.idToken) users.push(await fromIdentityToken(tokens.idToken));
  const needLookup = !users.some((u) => xFrom(u.accounts) && ownsEmbeddedWallet(u.accounts, wallet));
  if (needLookup && tokens.accessToken) {
    const u = await fromAccessToken(tokens.accessToken);
    // Both tokens must be for the same Privy user.
    if (u && (users.length === 0 || users[0].did === u.did)) users.push(u);
  }
  const x = users.map((u) => xFrom(u.accounts)).find(Boolean) ?? null;
  if (!x) return { ok: false, reason: "no-x", message: "That sign-in has no X account — sign in with X." };
  if (!users.some((u) => ownsEmbeddedWallet(u.accounts, wallet))) {
    // Shapes only (no addresses or handles), to diagnose a token format change.
    console.warn("[auth-x] wallet not found in Privy accounts:", JSON.stringify(users.map((u) => u.accounts.map((a) => ({
      type: a.type, chain: a.chain_type, client: a.wallet_client_type, connector: a.connector_type, keys: Object.keys(a).join(",")
    })))));
    return { ok: false, reason: "not-your-wallet", message: "That wallet isn't your X account's wallet — sign in with X again." };
  }
  return { ok: true, x };
}
