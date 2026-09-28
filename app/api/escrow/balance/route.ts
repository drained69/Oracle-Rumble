import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { escrowReady, playerBalances } from "@/lib/escrow-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/escrow/balance?wallet=<pubkey>
 *
 * Devnet USDC + SOL for a wallet, so the UI can check a seat is affordable
 * before opening an arena or asking the wallet to sign.
 */
export async function GET(request: Request) {
  const w = new URL(request.url).searchParams.get("wallet") ?? "";
  let owner: PublicKey;
  try { owner = new PublicKey(w); }
  catch { return NextResponse.json({ error: "invalid wallet" }, { status: 400 }); }
  if (!escrowReady()) return NextResponse.json({ escrow: "inactive", usdc: null, sol: null });
  const bal = await playerBalances(owner);
  return NextResponse.json({ escrow: "active", ...bal });
}
