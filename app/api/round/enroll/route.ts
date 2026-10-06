import { NextResponse } from "next/server";
import { requireWallet } from "@/lib/session";
import { getActiveRound, getLatestRound, mutateActiveRound } from "@/lib/round-store";
import { isPracticeArena, normalizeArenaCode, normalizeCallPct, redactOpeningCalls, seatPlayer, type Side } from "@/lib/royale";
import { confirmSignature, escrowReady, verifyPlayerDeposited } from "@/lib/escrow-server";
import { NEEDS_X_MESSAGE, playerName } from "@/lib/identity";

export const dynamic = "force-dynamic";

/** How long to wait for a just-signed deposit to show up on chain. */
const DEPOSIT_WAIT_MS = 25_000;

/**
 * Wait (HTTP polling) until the wallet's PlayerEntry exists in the vault.
 * The PDA — not the signature — is the proof of payment; the signature is
 * only used to fail fast when the tx itself errored on chain.
 */
async function waitForDeposit(wallet: string, roundVault: string, signature?: string): Promise<{ ok: boolean; err?: string; pending?: boolean }> {
  const deadline = Date.now() + DEPOSIT_WAIT_MS;
  while (true) {
    const chk = await verifyPlayerDeposited(wallet, roundVault);
    if (chk.ok) return { ok: true };
    if (signature) {
      const st = await confirmSignature(signature, 0);
      if (!st.ok && !st.pending) return { ok: false, err: `deposit failed on chain: ${st.err}` };
    }
    if (!signature || Date.now() >= deadline) {
      return { ok: false, pending: !!signature, err: signature ? "deposit still confirming" : "no deposit found for this wallet" };
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

/**
 * POST /api/round/enroll  { wallet, nickname, arena?, escrowSignature?, openingCall?, openingCallPct?, picks? }
 *
 * Enroll a wallet into an arena's current enrolling round.
 *
 * Ledger-only arenas (PUBLIC or when escrow isn't deployed): single step.
 *
 * On-chain arenas: the wallet's PlayerEntry PDA in the arena vault is the
 * seat ticket. The caller signs a Deposit tx (POST /api/escrow/tx) and
 * posts the signature; we wait for the PDA over HTTP and seat them. A
 * wallet that already deposited can re-post without a signature and gets
 * its seat — a dropped request never strands a paid deposit.
 *
 * Responses: 200 seated · 202 { pending } deposit still confirming, retry ·
 * 402 { needsDeposit } · 409 closed/full/refundable.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    wallet: string;
    nickname?: string;
    arena?: string;
    escrowSignature?: string;
    openingCall?: Side | null;
    openingCallPct?: number;
    /** Predictions arena: question id → option id, and the locked questions. */
    picks?: Record<string, string>;
    locks?: string[];
  };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  // Only the wallet itself (signed-in session) may act for its seat.
  const denied = requireWallet(request, body.wallet);
  if (denied) return denied;
  const arena = normalizeArenaCode(body.arena);
  const openingCall: Side | null = body.openingCall === "YES" || body.openingCall === "NO" ? body.openingCall : null;
  const peek = await getActiveRound(arena);

  if (!peek) {
    // A deposit can confirm after the arena closed. Tell the player their
    // funds are safe and where to get them back, rather than a bare 404.
    const latest = await getLatestRound(arena);
    if (latest?.escrow && (await verifyPlayerDeposited(body.wallet, latest.escrow.roundVault)).ok) {
      return NextResponse.json({
        error: `Pit ${arena} closed before your seat was registered. Your deposit is safe in escrow — open the pit to claim a full refund.`,
        refundable: true, arena
      }, { status: 409 });
    }
    return NextResponse.json({ error: "this pit is no longer taking players", arena }, { status: 404 });
  }

  // Already seated → success (page reloads never ask for a second deposit).
  const existing = peek.entrants.find((e) => e.wallet === body.wallet);
  if (existing) {
    return NextResponse.json({ round: redactOpeningCalls(peek, body.wallet), arena, entrantId: existing.id, already: true });
  }

  // Usernames are X handles when Privy is set up; X is required wherever
  // real USDC moves (arenas without an escrow vault are practice).
  const who = await playerName(body.wallet, body.nickname, isPracticeArena(arena) || !peek.escrow);
  if (who.needsX) return NextResponse.json({ error: NEEDS_X_MESSAGE, needsX: true }, { status: 403 });
  const nickname = who.name;

  // Never fall back to ledger-only for an arena that expects on-chain USDC.
  if (peek.escrow && !escrowReady()) {
    return NextResponse.json({ error: "escrow service unavailable — try again later", escrowDown: true }, { status: 503 });
  }

  const needsDeposit = !!peek.escrow;
  if (needsDeposit) {
    const deposited = await waitForDeposit(body.wallet, peek.escrow!.roundVault, body.escrowSignature);
    if (!deposited.ok) {
      if (deposited.pending) {
        return NextResponse.json({ pending: true, error: "Your deposit is still confirming — hold on." }, { status: 202 });
      }
      if (body.escrowSignature) return NextResponse.json({ error: deposited.err }, { status: 400 });
      // No deposit yet: only an enrolling arena with a free seat takes one.
      if (peek.status !== "enrolling") {
        return NextResponse.json({ error: `enrollment closed (round is ${peek.status})` }, { status: 409 });
      }
      if (peek.entrants.filter((e) => !e.isBot).length >= peek.config.capacity) {
        return NextResponse.json({ error: "pit is full" }, { status: 409 });
      }
      return NextResponse.json({ error: "deposit required", needsDeposit: true, escrow: { roundVault: peek.escrow!.roundVault, mint: peek.escrow!.mint } }, { status: 402 });
    }
  }

  let entrantId = "";
  let enrollError: string | undefined;
  let closedWithDeposit = false;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    const already = r.entrants.find((e) => e.wallet === body.wallet);
    if (already) { entrantId = already.id; return; } // seated by the keeper meanwhile
    const res = seatPlayer(r, body.wallet, nickname, {
      signature: body.escrowSignature,
      openingCall,
      openingCallPct: normalizeCallPct(body.openingCallPct),
      picks: body.picks,
      locks: body.locks
    });
    if (!res.ok) {
      enrollError = res.reason;
      closedWithDeposit = needsDeposit;
      return;
    }
    entrantId = res.entrant.id;
    if (r.escrow?.pendingSeats) delete r.escrow.pendingSeats[body.wallet];
  });

  if (!round) return NextResponse.json({ error: "no active round in this pit", arena }, { status: 404 });
  if (enrollError) {
    // Paid but the round locked or filled first: the deposit is refunded at
    // settlement (every on-chain entry is settled, seated or not).
    return NextResponse.json(closedWithDeposit
      ? { error: `${enrollError} Your deposit is safe — it's returned in full when this pit settles.`, refundable: true }
      : { error: enrollError }, { status: 409 });
  }
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ round: redactOpeningCalls(round, body.wallet), arena, entrantId });
}
