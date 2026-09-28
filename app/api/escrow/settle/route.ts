import { NextResponse } from "next/server";
import { escrowReady, listDepositors, readVault, settleArenaOnChain, type SettleEntry } from "@/lib/escrow-server";
import { getLatestRound, saveRound } from "@/lib/round-store";
import { normalizeArenaCode, type Round } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * A deposit signed just before a cancel can still land until its blockhash
 * expires (~60–90 s). Refunds close the vault, and a deposit landing after
 * that could never be settled — so wait this long after the cancel.
 */
const REFUND_SAFETY_MS = 120_000;

/** Cancelled arena → refund every on-chain depositor their full seat. */
async function refundCancelled(round: Round) {
  const escrow = round.escrow!;
  if (escrow.settleSignatures && escrow.settleSignatures.length > 0) {
    return NextResponse.json({ ok: true, refund: true, alreadySettled: true, signatures: escrow.settleSignatures });
  }
  const waitMs = (round.endedAt || 0) + REFUND_SAFETY_MS - Date.now();
  if (waitMs > 0) return NextResponse.json({ ok: false, refund: true, pending: true, retryInMs: waitMs });

  const vault = await readVault(escrow.roundVault);
  if (!vault) return NextResponse.json({ error: "vault not found on-chain" }, { status: 502 });
  if (vault.settled) return NextResponse.json({ ok: true, refund: true, alreadySettled: true });
  if (vault.deposited === 0) return NextResponse.json({ ok: true, refund: true, depositors: 0 });

  const seat = vault.entryUsdc + vault.vaultUsdc;
  const depositors = (await listDepositors(escrow.roundVault)).filter((d) => !d.settled);
  if (depositors.length !== vault.deposited) {
    // Account index lagging behind the vault counter — try again shortly
    // rather than closing with someone left out.
    return NextResponse.json({ ok: false, refund: true, pending: true, retryInMs: 5_000 });
  }
  const res = await settleArenaOnChain(escrow.roundVault, depositors.map((d) => ({ wallet: d.wallet, entitlementUsdc: seat })));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });

  escrow.settleSignatures = res.signatures;
  escrow.history.push(...res.signatures.map((s) => `Refund ✓ ${s.slice(0, 12)}…`));
  round.history.push(`Refunds open — ${depositors.length} deposit${depositors.length === 1 ? "" : "s"} can be claimed in full.`);
  await saveRound(round);
  return NextResponse.json({ ok: true, refund: true, signatures: res.signatures, depositors: depositors.length });
}

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
  if (round.status === "cancelled") return refundCancelled(round);
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
