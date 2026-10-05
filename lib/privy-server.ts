/**
 * Server-side Privy checks: prove which X (Twitter) account a player owns.
 *
 * The browser sends the Privy identity token it got after "Connect X"; we
 * verify its signature against Privy's published keys for our app (no
 * secret needed) and read the linked X account from it. With
 * PRIVY_APP_SECRET set we can instead take an access token and look the
 * user up through Privy's API (needed if identity tokens are turned off).
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

/** Privy is configured: X-linked usernames are enforced. */
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

type LinkedAccount = { type?: string; subject?: string; username?: string };

function xFrom(accounts: LinkedAccount[] | undefined): XAccount | null {
  const x = (accounts ?? []).find((a) => a.type === "twitter_oauth" && a.subject && a.username);
  return x ? { xId: String(x.subject), username: String(x.username).replace(/^@/, "") } : null;
}

/** The X account in a verified Privy identity token, or null. */
async function fromIdentityToken(idToken: string): Promise<XAccount | null> {
  const payload = await verify(idToken);
  const raw = payload.linked_accounts;
  const accounts = typeof raw === "string" ? (JSON.parse(raw) as LinkedAccount[]) : (raw as LinkedAccount[] | undefined);
  return xFrom(accounts);
}

/** The X account of the user behind a verified access token (needs the app secret). */
async function fromAccessToken(accessToken: string): Promise<XAccount | null> {
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
  return xFrom(user.linked_accounts);
}

/**
 * Verify a Privy token from the browser and return the X account it proves.
 * Throws on an invalid or expired token.
 */
export async function verifiedXAccount(tokens: { idToken?: string; accessToken?: string }): Promise<XAccount | null> {
  if (!PRIVY_ENABLED) return null;
  if (tokens.idToken) {
    const x = await fromIdentityToken(tokens.idToken);
    if (x) return x;
  }
  if (tokens.accessToken) return fromAccessToken(tokens.accessToken);
  return null;
}
