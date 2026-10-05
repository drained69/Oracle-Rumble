import { NextResponse } from "next/server";
import { escrowReady, listDepositors, readVault, settleArenaOnChain, vaultSignaturesSince, type SettleEntry } from "@/lib/escrow-server";
import { getLatestRound, mutateRoundById } from "@/lib/round-store";
import { normalizeArenaCode, payoutShares, type Round, logEvent } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * A deposit signed just before a cancel can still land until its blockhash
 * expires (~60–90 s). Refunds close the vault, and a deposit landing after
 * that could never be settled — so wait this long after the cancel.
 */
const REFUND_SAFETY_MS = 120_000;

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Every viewer's page nudges settlement, so calls arrive concurrently. One
 * settlement per arena at a time (the app runs as a single instance); the
 * others are told to retry and then find it done.
 */
const _g = globalThis as unknown as { __or_settling?: Set<string> };
const settling: Set<string> = (_g.__or_settling ??= new Set());

/**
 * The vault is already settled on chain but the game record doesn't know
 * (the server stopped between CloseSettlement and saving). Adopt it, so the
 * arena stops waiting for a settlement that already happened.
 */
async function adoptChainSettlement(round: Round, label: string) {
  const sigs = await vaultSignaturesSince(round.escrow!.roundVault, (round.endedAt || round.createdAt) - 60_000);
  await recordSettlement(round, sigs.length ? sigs : ["onchain"], label, []);
  return NextResponse.json({ ok: true, alreadySettled: true, adopted: true });
}

/** Store the settlement result without overwriting changes made meanwhile. */
async function recordSettlement(round: Round, signatures: string[], label: string, notes: string[]) {
  await mutateRoundById(round.arenaCode, round.id, (r) => {
    if (!r.escrow) return;
    r.escrow.settleSignatures = signatures;
    r.escrow.history.push(...signatures.map((s) => `${label} ✓ ${s.slice(0, 12)}…`));
    for (const n of notes) logEvent(r, n);
  });
}

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
  if (vault.settled) return adoptChainSettlement(round, "Refund");
  if (vault.deposited === 0) return NextResponse.json({ ok: true, refund: true, depositors: 0 });

  const seat = vault.entryUsdc + vault.vaultUsdc;
  const all = await listDepositors(escrow.roundVault);
  if (all.length !== vault.deposited) {
    // Account index lagging behind the vault counter — try again shortly
    // rather than closing with someone left out.
    return NextResponse.json({ ok: false, refund: true, pending: true, retryInMs: 5_000 });
  }
  // Entries already recovered on chain have their seat back; skip them.
  const depositors = all.filter((d) => !d.claimed);
  // Closed as a refund: these claims carry no platform fee.
  const res = await settleArenaOnChain(escrow.roundVault, depositors.map((d) => ({ wallet: d.wallet, entitlementUsdc: seat })), vault.deposited, true);
  if (!res.ok) {
    if ("retry" in res && res.retry) return NextResponse.json({ ok: false, refund: true, pending: true, retryInMs: 3_000 });
    return NextResponse.json({ error: res.error }, { status: 502 });
  }
  await recordSettlement(round, res.signatures, "Refund", [
    `Refunds open — ${depositors.length} deposit${depositors.length === 1 ? "" : "s"} can be claimed in full.`
  ]);
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
  const body = (await request.json().catch(() => ({}))) as { arena?: string };
  if (!escrowReady()) return NextResponse.json({ escrow: "inactive" });
  const arena = normalizeArenaCode(body.arena);
  if (settling.has(arena)) return NextResponse.json({ ok: false, pending: true, retryInMs: 4_000 });
  settling.add(arena);
  try {
    return await settle(arena);
  } finally {
    settling.delete(arena);
  }
}

async function settle(arena: string) {
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

  // Settle against the chain, not just the ledger: every PlayerEntry in the
  // vault must be settled before CloseSettlement, or that wallet's USDC is
  // locked for good (Claim needs a settled entry; Recover needs an open vault).
  const vault = await readVault(round.escrow.roundVault);
  if (!vault) return NextResponse.json({ error: "vault not found on-chain" }, { status: 502 });
  if (vault.settled) return adoptChainSettlement(round, "Settle");
  const allOnChain = await listDepositors(round.escrow.roundVault);
  if (allOnChain.length !== vault.deposited) {
    return NextResponse.json({ ok: false, pending: true, retryInMs: 5_000 });
  }
  // A player who already recovered their seat on chain (recovery deadline
  // passed) holds their money back: leave them out and shrink the pot by
  // what they took, so the rest are never promised more than the escrow has.
  const recovered = allOnChain.filter((d) => d.claimed);
  const onChain = allOnChain.filter((d) => !d.claimed);
  const depositorSet = new Set(onChain.map((d) => d.wallet));
  // The seat as the escrow holds it (a predictions seat carries a 1-unit vault).
  const seatUsdc = vault.entryUsdc + vault.vaultUsdc;

  // Players: remaining vault + prize share (includes players knocked out in
  // earlier royale rounds — they withdraw the vault they finished with).
  const players = round.entrants.filter((e) => !e.isBot && depositorSet.has(e.wallet));
  const seated = new Set(players.map((e) => e.wallet));
  // Paid but never seated (deposit landed after lock or the room was full):
  // full refund of the seat.
  const refunds: SettleEntry[] = onChain
    .filter((d) => !seated.has(d.wallet))
    .map((d) => ({ wallet: d.wallet, entitlementUsdc: seatUsdc }));
  // Payout rule (lib/royale payoutShares): prizes plus the players' vault
  // money split by final vault value — pays out the escrow exactly, so no
  // gain is capped away and no loss is left locked in the vault.
  const recoveredUsdc = recovered.length * (vault.entryUsdc + vault.vaultUsdc);
  const playerPot = Math.max(0, vault.totalEscrowedUsdc - recoveredUsdc - refunds.length * seatUsdc);
  // The host's fee is paid into the host's own seat, alongside any prize.
  const hostFee = round.hostFeeUsdc ?? 0;
  const prizeOf = (e: (typeof players)[number]) => e.prizeUsdc + (e.wallet === round.config.host ? hostFee : 0);
  const shares = payoutShares(players.map((e) => ({ key: e.wallet, cash: e.cash, prize: prizeOf(e) })), playerPot);
  const notes: string[] = [];
  let entries: SettleEntry[] = players.map((e) => ({ wallet: e.wallet, entitlementUsdc: shares[e.wallet] ?? 0 }));
  const ledgerSum = players.reduce((s, e) => s + Math.max(0, e.cash) + prizeOf(e), 0);
  if (Math.abs(ledgerSum - playerPot) > 0.005) {
    notes.push(`Vault money shared by final vault value: ${usd(playerPot)} paid out across ${players.length} player${players.length === 1 ? "" : "s"}.`);
  }
  entries = entries.concat(refunds);
  if (refunds.length) notes.push(`${refunds.length} deposit${refunds.length === 1 ? "" : "s"} without a seat refunded in full.`);
  if (recovered.length) notes.push(`${recovered.length} deposit${recovered.length === 1 ? " was" : "s were"} already recovered on chain.`);

  const res = await settleArenaOnChain(round.escrow.roundVault, entries, vault.deposited);
  if (!res.ok) {
    if ("retry" in res && res.retry) return NextResponse.json({ ok: false, pending: true, retryInMs: 3_000 });
    return NextResponse.json({ error: res.error }, { status: 502 });
  }
  await recordSettlement(round, res.signatures, "Settle", notes);
  return NextResponse.json({ ok: true, signatures: res.signatures });
}
