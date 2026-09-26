import { NextResponse } from "next/server";
import { escrowReady, hostKeypair } from "@/lib/escrow-server";
import { ESCROW_ACTIVE, ESCROW_PROGRAM_ID, USDC_MINT } from "@/lib/escrow";

export const dynamic = "force-dynamic";

/**
 * GET /api/escrow/status
 *
 * Tells the client whether the on-chain escrow is fully wired. When any of
 * these are missing the site runs in ledger-only mode (no wallet prompts,
 * no real USDC moves) and the HUD shows a PRACTICE MODE badge so the user
 * isn't confused about why no money left their wallet.
 */
export async function GET() {
  const programSet = !!ESCROW_PROGRAM_ID;
  const mintSet = !!USDC_MINT;
  const hostSet = !!hostKeypair();
  const active = escrowReady();
  return NextResponse.json({
    active,
    checks: {
      programId: programSet,
      usdcMint: mintSet,
      operatorKey: hostSet,
      esCrowActiveFlag: ESCROW_ACTIVE
    },
    reason: active
      ? null
      : !programSet ? "NEXT_PUBLIC_ESCROW_PROGRAM_ID not set"
      : !mintSet ? "NEXT_PUBLIC_USDC_MINT not set"
      : !hostSet ? "ESCROW_HOST_SECRET_KEY not set"
      : "escrow init failed"
  });
}
