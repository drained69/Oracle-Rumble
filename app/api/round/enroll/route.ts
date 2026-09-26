import { NextResponse } from "next/server";
import { getActiveRound, mutateActiveRound } from "@/lib/round-store";
import { enroll, fillWithBots, makeEntrant, normalizeArenaCode } from "@/lib/royale";
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

  const needsDeposit = escrowReady() && !!peek.escrow;
  let escrowSignature: string | undefined;
  if (needsDeposit) {
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
    // Prevent the same signature being replayed to enroll a different nickname
    // after the wallet was booted out — the PDA check already stops double
    // deposits, but we also gate the ledger side.
    const already = peek.escrow!.history.some((h) => h.includes(body.escrowSignature!.slice(0, 12)));
    if (already) return NextResponse.json({ error: "signature already used" }, { status: 409 });
    escrowSignature = body.escrowSignature;
  }

  let entrantId = "";
  let enrollError: string | undefined;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (r.status !== "enrolling") { enrollError = "enrollment closed for this round"; return; }
    const nickname = (body.nickname || body.wallet.slice(0, 4)).slice(0, 16);
    const entrant = makeEntrant(r, body.wallet, nickname, false);
    const res = enroll(r, entrant);
    if (!res.ok) { enrollError = res.reason; return; }
    entrantId = entrant.id;
    if (escrowSignature && r.escrow) r.escrow.history.push(`Deposit ${entrant.nickname} ✓ ${escrowSignature.slice(0, 12)}…`);
    // Seed a few bots so the roster feels alive during enrollment.
    if (r.entrants.length < 4) fillWithBots(r, 4);
  });

  if (!round) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  if (enrollError) return NextResponse.json({ error: enrollError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ round, arena, entrantId });
}
