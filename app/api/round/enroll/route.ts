import { NextResponse } from "next/server";
import { getActiveRound, mutateActiveRound } from "@/lib/round-store";
import { enroll, makeEntrant, normalizeArenaCode } from "@/lib/royale";
import { confirmSignature, escrowReady, verifyPlayerDeposited } from "@/lib/escrow-server";

/**
 * POST /api/round/enroll  { wallet, nickname, arena?, escrowSignature? }
 *
 * Enroll a wallet into an arena's current enrolling round.
 *
 * Ledger-only arenas (PUBLIC or when escrow isn't deployed): single-step —
 * the caller just enrolls and the entry fee is credited to the pool as a
 * ledger figure.
 *
 * On-chain arenas (Round.escrow set): the caller MUST first sign + broadcast
 * a Deposit tx (obtained from POST /api/escrow/tx {action:"deposit"}) and
 * pass the resulting `escrowSignature`. We confirm the signature on chain
 * before crediting the ledger entry. Prevents free enrollment.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    wallet: string;
    nickname?: string;
    arena?: string;
    escrowSignature?: string;
  };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  const arena = normalizeArenaCode(body.arena);

  // Peek to see whether this arena requires an on-chain deposit.
  const peek = await getActiveRound(arena);
  if (!peek) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });

  // BUG D fix — if this wallet is already enrolled, short-circuit with success.
  // Prevents a page reload from asking the wallet to sign a Deposit that would
  // then fail on-chain with AlreadyInitialized.
  const existing = peek.entrants.find((e) => e.wallet === body.wallet);
  if (existing) {
    return NextResponse.json({ round: peek, arena, entrantId: existing.id, already: true });
  }

  // BUG E fix — if the arena is escrow-backed but the server can no longer
  // reach the escrow (env var removed, host key missing), REFUSE. Never fall
  // through to ledger-only enrollment for an arena that expects on-chain USDC.
  if (peek.escrow && !escrowReady()) {
    return NextResponse.json({
      error: "escrow service unavailable — try again later",
      escrowDown: true
    }, { status: 503 });
  }

  const needsDeposit = escrowReady() && !!peek.escrow;
  let escrowSignature: string | undefined;
  if (needsDeposit) {
    // Only enrolling rounds accept deposits. Refuse early so the client
    // doesn't get a wallet prompt for a tx that will fail on-chain.
    if (peek.status !== "enrolling") {
      return NextResponse.json({ error: `enrollment closed (round is ${peek.status})` }, { status: 409 });
    }
    if (peek.entrants.filter((e) => !e.isBot).length >= peek.config.capacity) {
      return NextResponse.json({ error: "arena is full" }, { status: 409 });
    }
    if (!body.escrowSignature) {
      return NextResponse.json({
        error: "deposit required",
        needsDeposit: true,
        escrow: peek.escrow
      }, { status: 402 }); // Payment Required
    }
    // Confirm the signature landed AND the PlayerEntry PDA now exists — the
    // ground truth for "this wallet has deposited into THIS arena." Signature
    // alone is not enough (an attacker could paste any confirmed sig).
    const conf = await confirmSignature(body.escrowSignature);
    if (!conf.ok) return NextResponse.json({ error: `deposit not confirmed: ${conf.err ?? "unknown"}` }, { status: 400 });
    const chk = await verifyPlayerDeposited(body.wallet, peek.escrow!.roundVault);
    if (!chk.ok) return NextResponse.json({ error: `on-chain deposit missing: ${chk.err ?? "unknown"}` }, { status: 400 });
    escrowSignature = body.escrowSignature;
  }

  let entrantId = "";
  let enrollError: string | undefined;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (r.status !== "enrolling") { enrollError = "enrollment closed for this round"; return; }
    // Replay guard runs INSIDE the advisory lock so two concurrent enrolls
    // with the same signature can't both make it through.
    if (escrowSignature && r.escrow) {
      const sigMark = escrowSignature.slice(0, 12);
      if (r.escrow.history.some((h) => h.includes(sigMark))) {
        enrollError = "signature already used"; return;
      }
    }
    // Also gate: this wallet can only enroll once. The on-chain PlayerEntry
    // PDA already prevents double-deposits, but we mirror it in the ledger
    // to give a fast, arena-scoped answer without needing another RPC call.
    if (r.entrants.some((e) => e.wallet === body.wallet)) {
      enrollError = "wallet already enrolled"; return;
    }
    const nickname = (body.nickname || body.wallet.slice(0, 4)).slice(0, 16);
    const entrant = makeEntrant(r, body.wallet, nickname, false);
    const res = enroll(r, entrant);
    if (!res.ok) { enrollError = res.reason; return; }
    entrantId = entrant.id;
    if (escrowSignature && r.escrow) r.escrow.history.push(`Deposit ${entrant.nickname} ✓ ${escrowSignature.slice(0, 12)}…`);
    // No eager bot seeding — the roster shows the real players who joined.
    // A thin backfill only happens at lock, and only if we're below the
    // minimum to run a game (see round-keeper tick).
  });

  if (!round) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  if (enrollError) return NextResponse.json({ error: enrollError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ round, arena, entrantId });
}
