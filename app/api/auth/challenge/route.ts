import { limitByIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { PRIVY_ENABLED } from "@/lib/privy-server";
import { issueChallenge, siteOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/challenge { wallet } → { message, token } for the wallet to sign. */
export async function POST(request: Request) {
  // X-only: a wallet can't sign in on its own. This wallet-signature path is
  // kept for local development without X sign-in set up, never in production.
  if (PRIVY_ENABLED || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Sign in with X." }, { status: 403 });
  }
  const limited = limitByIp(request, "auth", 20, 60_000);
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { wallet?: string };
  const site = siteOrigin(request);
  if (!site) return NextResponse.json({ error: "unrecognised host" }, { status: 400 });
  const ch = issueChallenge(body.wallet ?? "", site);
  if (!ch) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  return NextResponse.json(ch);
}
