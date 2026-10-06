import { NextResponse } from "next/server";
import { PRIVY_ENABLED } from "@/lib/privy-server";
import { SESSION_COOKIE, sessionCookieValue, siteOrigin, verifyChallenge } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify { wallet, message, token, signature(base64) }
 * Checks the wallet's signature over its challenge and starts a session.
 */
export async function POST(request: Request) {
  // X-only: a wallet can't sign in on its own. This wallet-signature path is
  // kept for local development without X sign-in set up, never in production.
  if (PRIVY_ENABLED || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Sign in with X." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; message?: string; token?: string; signature?: string };
  const site = siteOrigin(request);
  if (!site) return NextResponse.json({ error: "unrecognised host" }, { status: 400 });
  const res = verifyChallenge({
    host: site.host,
    wallet: body.wallet ?? "",
    message: body.message ?? "",
    token: body.token ?? "",
    signature: body.signature ?? ""
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  const { value, maxAge } = sessionCookieValue(body.wallet!);
  const out = NextResponse.json({ ok: true, wallet: body.wallet });
  out.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    // Development only (see the guard above), so plain-http localhost works.
    path: "/",
    maxAge
  });
  return out;
}
