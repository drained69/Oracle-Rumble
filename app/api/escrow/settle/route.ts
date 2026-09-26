import { NextResponse } from "next/server";
import { escrowReady, settleArenaOnChain, type SettleEntry } from "@/lib/escrow-server";
import { getLatestRound, saveRound } from "@/lib/round-store";
import { normalizeArenaCode } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * POST /api/escrow/settle { arena }
 *
 * Fires SettlePlayer for each human player then CloseSettlement, so the
 * arena's Claim endpoints unlock. Idempotent — if `escrow.settleSignatures`
 * is already populated, returns those without hitting the chain again.
 *
 * Safe to call by anyone; the on-chain program only accepts SettlePlayer /
 * CloseSettlement signed by the arena's host key (our server-held operator
 * key). If someone else calls this endpoint, the server still enforces its
 * own auth — the host keypair is server-side only.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { arena?: string };
  if (!escrowReady()) return NextResponse.json({ escrow: "inactive" });
  const arena = normalizeArenaCode(body.arena);

  // We settle against the LATEST round in the arena — either the active
  // "complete" one or the most recent finished one.
  const round = await getLatestRound(arena);
  if (!round) return NextResponse.json({ error: "arena not found", arena }, { status: 404 });
  if (!round.escrow) return NextResponse.json({ error: "arena is ledger-only" }, { status: 409 });
  if (round.status !== "complete") return NextResponse.json({ error: `round is ${round.status}, not complete` }, { status: 409 });
  if (round.escrow.settleSignatures && round.escrow.settleSignatures.length > 0) {
    return NextResponse.json({ ok: true, alreadySettled: true, signatures: round.escrow.settleSignatures });
  }

  // Build entitlements — remaining vault + prize share for each human.
  const rawEntries = round.entrants
    .filter((e) => !e.isBot && !e.wallet.startsWith("bot:"))
    .map((e) => ({ wallet: e.wallet, entitlementUsdc: Math.max(0, e.cash + e.prizeUsdc) }));

  // BUG N — CRITICAL conservation gate.
  //
  // On-chain the vault holds exactly `humansEnrolled × (entry + vault)`. Ledger
  // trading against bots (or price-maker slippage on our synthetic market) can
  // inflate sum(cash + prize) beyond that. If we sent inflated entitlements
  // to SettlePlayer, later players would hit the on-chain Overpay guard and
  // be permanently stuck (round moves to SETTLED without their entry.settled
  // flag flipped — neither Claim nor Recover would work for them).
  //
  // Fix: cap sum(entitlements) at total_escrowed by proportional scale-down.
  // This is fair (everyone loses the same fraction of their surplus) and
  // guarantees every human can Claim their assigned entitlement.
  const humansEnrolled = round.entrants.filter((e) => !e.isBot).length;
  const seatUsdc = round.config.entryUsdc + round.config.startingBankroll;
  const totalEscrowed = humansEnrolled * seatUsdc;
  const rawSum = rawEntries.reduce((s, e) => s + e.entitlementUsdc, 0);

  let entries: SettleEntry[] = rawEntries;
  let capApplied: { rawSum: number; capped: number; ratio: number } | undefined;
  if (rawSum > totalEscrowed && totalEscrowed > 0) {
    const ratio = totalEscrowed / rawSum;
    entries = rawEntries.map((e) => ({
      wallet: e.wallet,
      // Floor to 6 decimals (USDC precision) so we never round UP past cap.
      entitlementUsdc: Math.floor(e.entitlementUsdc * ratio * 1e6) / 1e6
    }));
    capApplied = { rawSum, capped: totalEscrowed, ratio };
    round.history.push(
      `Entitlements capped for conservation: ${rawSum.toFixed(2)} → ${totalEscrowed.toFixed(2)} USDC (×${ratio.toFixed(4)}).`
    );
  }

  const res = await settleArenaOnChain(round.escrow.roundVault, entries);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });

  // Persist signatures back on the round so the UI can link them.
  const sigs = res.signatures;
  if (round.escrow) {
    round.escrow.settleSignatures = sigs;
    round.escrow.history.push(...sigs.map((s) => `Settle ✓ ${s.slice(0, 12)}…`));
    await saveRound(round);
  }
  return NextResponse.json({ ok: true, signatures: sigs, capApplied });
}
