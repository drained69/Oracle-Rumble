import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { claimXProfile } from "@/lib/profile-store";
import { PRIVY_ENABLED, verifyXLogin } from "@/lib/privy-server";
import { limitByIp } from "@/lib/rate-limit";
import { SESSION_COOKIE, sessionCookieValue } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/x  { wallet, idToken?, accessToken? }
 *
 * The only way to sign in: prove an X account with Privy tokens, and that
 * `wallet` is that account's own Privy embedded Solana wallet. The X handle
 * becomes the username (set once), and the browser gets a session cookie
 * for the wallet.
 */
export async function POST(request: Request) {
  const limited = limitByIp(request, "auth-x", 30, 10 * 60_000);
  if (limited) return limited;
  if (!PRIVY_ENABLED) return NextResponse.json({ error: "X sign-in isn't set up on this deployment." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { wallet?: string; idToken?: string; accessToken?: string };
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  try { new PublicKey(wallet); } catch { return NextResponse.json({ error: "invalid wallet" }, { status: 400 }); }
  if (!body.idToken && !body.accessToken) return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });

  let login;
  try {
    login = await verifyXLogin({ idToken: body.idToken, accessToken: body.accessToken }, wallet);
  } catch {
    return NextResponse.json({ error: "Your X sign-in couldn't be verified — sign in with X again." }, { status: 401 });
  }
  if (!login.ok) return NextResponse.json({ error: login.message, reason: login.reason }, { status: 403 });

  const res = await claimXProfile(wallet, login.x.xId, login.x.username);
  if (!res.ok) return NextResponse.json({ error: res.message, reason: res.reason }, { status: 409 });

  const { value, maxAge } = sessionCookieValue(wallet);
  const out = NextResponse.json({
    wallet,
    username: res.profile.username,
    created: res.created,
    movedFrom: res.movedFrom ?? null
  });
  out.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
  return out;
}
