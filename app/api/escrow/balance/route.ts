import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { escrowReady, playerBalances } from "@/lib/escrow-server";
import { limitByIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/escrow/balance?wallet=<pubkey>
 *
 * USDC + SOL held by a wallet on this app's cluster — for the account menu,
 * and to check a seat is affordable before any signing. `escrow` says
 * whether seats actually take USDC here (practice mode moves none).
 */
export async function GET(request: Request) {
  const limited = limitByIp(request, "balance", 60, 60_000);
  if (limited) return limited;
  const w = new URL(request.url).searchParams.get("wallet") ?? "";
  let owner: PublicKey;
  try { owner = new PublicKey(w); }
  catch { return NextResponse.json({ error: "invalid wallet" }, { status: 400 }); }
  const bal = await playerBalances(owner);
  return NextResponse.json({ escrow: escrowReady() ? "active" : "inactive", ...bal });
}
