import { NextResponse } from "next/server";
import { sessionWallet } from "@/lib/session";
import { bindXProfile } from "@/lib/profile-store";
import { PRIVY_ENABLED, verifiedXAccount } from "@/lib/privy-server";
import { limitByIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/profile/x  { idToken?, accessToken? }   — signed-in wallet only
 *
 * Link the signed-in wallet to the X account proven by a Privy token. The
 * first link sets the wallet's username to its X handle for good; an X
 * account can belong to one wallet only.
 */
export async function POST(request: Request) {
  const limited = limitByIp(request, "profile-x", 20, 10 * 60_000);
  if (limited) return limited;
  if (!PRIVY_ENABLED) return NextResponse.json({ error: "X sign-in isn't set up on this deployment." }, { status: 404 });
  const wallet = sessionWallet(request);
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first.", needsAuth: true }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { idToken?: string; accessToken?: string };

  let x;
  try {
    x = await verifiedXAccount({ idToken: body.idToken, accessToken: body.accessToken });
  } catch {
    return NextResponse.json({ error: "Your X sign-in couldn't be verified — connect X again." }, { status: 401 });
  }
  if (!x) return NextResponse.json({ error: "No X account is linked to that sign-in — connect with X." }, { status: 400 });

  const res = await bindXProfile(wallet, x.xId, x.username);
  if (!res.ok) return NextResponse.json({ error: res.message, reason: res.reason }, { status: 409 });
  const changedX = !res.created && res.profile.xId !== x.xId;
  return NextResponse.json({
    profile: { username: res.profile.username, setAt: res.profile.setAt },
    created: res.created,
    note: changedX ? `This wallet's username is already @${res.profile.username} — usernames can't be changed.` : undefined
  });
}
