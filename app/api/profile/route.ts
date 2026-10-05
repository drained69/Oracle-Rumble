import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getProfile } from "@/lib/profile-store";
import { PRIVY_ENABLED } from "@/lib/privy-server";
import { limitByIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile?wallet=…
 *
 * A wallet's username (its X handle) if it has connected X, and whether
 * X-linked usernames are required on this deployment.
 */
export async function GET(request: Request) {
  const limited = limitByIp(request, "profile", 120, 60_000);
  if (limited) return limited;
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  try { new PublicKey(wallet); } catch { return NextResponse.json({ error: "invalid wallet" }, { status: 400 }); }
  const profile = await getProfile(wallet);
  return NextResponse.json({
    required: PRIVY_ENABLED,
    profile: profile ? { username: profile.username, setAt: profile.setAt } : null
  });
}
