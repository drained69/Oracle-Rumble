import { NextResponse } from "next/server";
import { getProfile } from "@/lib/profile-store";
import { PRIVY_ENABLED } from "@/lib/privy-server";
import { SESSION_COOKIE, sessionWallet } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/auth/session → { wallet, username } the browser is signed in as (or nulls). */
export async function GET(request: Request) {
  const wallet = sessionWallet(request);
  if (!wallet) return NextResponse.json({ wallet: null, username: null });
  const profile = await getProfile(wallet);
  // X-only: a session without an X profile isn't a valid sign-in.
  if (PRIVY_ENABLED && !profile) return NextResponse.json({ wallet: null, username: null });
  return NextResponse.json({ wallet, username: profile?.username ?? null });
}

/** DELETE /api/auth/session → sign out. */
export async function DELETE() {
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return out;
}
