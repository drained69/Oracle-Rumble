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
  const entries: SettleEntry[] = round.entrants
    .filter((e) => !e.isBot && !e.wallet.startsWith("bot:"))
    .map((e) => ({ wallet: e.wallet, entitlementUsdc: e.cash + e.prizeUsdc }));

  const res = await settleArenaOnChain(round.escrow.roundVault, entries);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });

  // Persist signatures back on the round so the UI can link them.
  const sigs = res.signatures;
  if (round.escrow) {
    round.escrow.settleSignatures = sigs;
    round.escrow.history.push(...sigs.map((s) => `Settle ✓ ${s.slice(0, 12)}…`));
    await saveRound(round);
  }
  return NextResponse.json({ ok: true, signatures: sigs });
}
