import { NextResponse } from "next/server";
import { escrowReady, readPlayerEntry, readVault } from "@/lib/escrow-server";
import { getLatestRound } from "@/lib/round-store";
import { normalizeArenaCode, seatCostUsdc } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * GET /api/escrow/entry?arena=CODE&wallet=PUBKEY
 *
 * One wallet's on-chain position in an arena's escrow: whether it deposited,
 * whether a payout/refund has been recorded, and whether it was claimed.
 * Lets the arena page offer a refund to someone whose deposit landed after
 * the round was cancelled (they never appear in the ledger).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet") ?? "";
  const arena = normalizeArenaCode(url.searchParams.get("arena"));
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  if (!escrowReady()) return NextResponse.json({ escrow: "inactive", deposited: false });

  const round = await getLatestRound(arena);
  if (!round?.escrow) return NextResponse.json({ escrow: "none", deposited: false });

  const [entry, vault] = await Promise.all([
    readPlayerEntry(wallet, round.escrow.roundVault),
    readVault(round.escrow.roundVault)
  ]);
  if (!entry) return NextResponse.json({ deposited: false });
  const seat = vault ? vault.entryUsdc + vault.vaultUsdc : seatCostUsdc(round.config);
  return NextResponse.json({
    deposited: true,
    seatUsdc: seat,
    settled: entry.settled,
    claimed: entry.claimed,
    entitlementUsdc: entry.entitlementUsdc,
    claimsOpen: !!vault?.settled,
    // Platform fee the escrow takes from this claim (0 on refunds and old vaults).
    claimFeeBps: vault?.claimFeeBps ?? 0,
    recoverAt: vault ? vault.settleDeadline * 1000 : null
  });
}
