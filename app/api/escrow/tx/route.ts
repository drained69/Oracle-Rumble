import { NextResponse } from "next/server";
import { sessionWallet } from "@/lib/session";
import { PublicKey } from "@solana/web3.js";
import { buildDepositTx, buildWithdrawTx, escrowReady, playerBalances, readPlayerEntry, verifyPlayerDeposited } from "@/lib/escrow-server";
import { getActiveRound, getLatestRound, mutateActiveRound } from "@/lib/round-store";
import { normalizeArenaCode, type Side } from "@/lib/royale";
import { validateUsername } from "@/lib/username";

/** Cap on remembered pending seats per arena (anti-spam). */
const MAX_PENDING_SEATS = 64;

export const dynamic = "force-dynamic";

/**
 * POST /api/escrow/tx  { action: "deposit" | "claim" | "recover", wallet, arena }
 *
 * Returns a base64-encoded legacy Transaction the CLIENT WALLET signs and
 * broadcasts. When the escrow program isn't deployed/configured, returns
 * `{ escrow: "inactive" }` so the caller can fall back to the ledger flow.
 *
 * - deposit → { wallet, arena } — needs the arena's on-chain roundVault
 *             which is looked up from the round's stored escrow record.
 * - claim   → { wallet, arena } — after settlement
 * - recover → { wallet, arena } — after settle deadline on an unsettled round
 *
 * (Host isn't here — InitRound is server-signed on POST /api/round.)
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    action: "deposit" | "claim" | "recover";
    wallet: string;
    arena?: string;
    nickname?: string;
    openingCall?: Side | null;
  };
  if (!escrowReady()) {
    return NextResponse.json({ escrow: "inactive" });
  }
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  let wallet: PublicKey;
  try { wallet = new PublicKey(body.wallet); }
  catch { return NextResponse.json({ error: "invalid wallet pubkey" }, { status: 400 }); }

  if (body.action === "deposit" || body.action === "claim" || body.action === "recover") {
    const arena = normalizeArenaCode(body.arena);
    const round = (await getActiveRound(arena)) ?? (await getLatestRound(arena));
    if (!round) return NextResponse.json({ error: "arena not found", arena }, { status: 404 });
    const escrow = round.escrow;
    if (!escrow?.roundVault) return NextResponse.json({ error: "arena is ledger-only (no on-chain escrow record)" }, { status: 409 });
    let roundVault: PublicKey;
    try { roundVault = new PublicKey(escrow.roundVault); }
    catch { return NextResponse.json({ error: "invalid stored roundVault" }, { status: 500 }); }

    // BUG F — pre-flight checks so the wallet is never asked to sign a tx
    // that will predictably fail on-chain.
    if (body.action === "deposit") {
      if (round.status !== "enrolling") {
        return NextResponse.json({ error: `deposits closed (round is ${round.status})` }, { status: 409 });
      }
      // If this wallet already has a PlayerEntry PDA on chain, another deposit
      // will fail with AlreadyInitialized. Short-circuit.
      const dep = await verifyPlayerDeposited(body.wallet, escrow.roundVault);
      if (dep.ok) {
        return NextResponse.json({ error: "wallet already deposited into this arena", alreadyDeposited: true }, { status: 409 });
      }
      if (round.entrants.filter((e) => !e.isBot).length >= round.config.capacity) {
        return NextResponse.json({ error: "arena is full" }, { status: 409 });
      }
      // Funds check: without it the wallet shows a red "failed to simulate"
      // warning instead of telling the player they're short on USDC/SOL.
      const seat = round.config.entryUsdc + round.config.startingBankroll;
      const bal = await playerBalances(wallet);
      if (bal.usdc + 1e-9 < seat) {
        return NextResponse.json({
          error: `Not enough devnet USDC: this seat costs ${seat.toFixed(2)} USDC and your wallet holds ${bal.usdc.toFixed(2)}. Get test USDC at faucet.circle.com (Solana Devnet).`,
          insufficient: "usdc", needUsdc: seat, haveUsdc: bal.usdc
        }, { status: 402 });
      }
      if (bal.sol < 0.005) {
        return NextResponse.json({
          error: `Not enough devnet SOL for fees: you hold ${bal.sol.toFixed(4)} SOL, need about 0.005. Get some at faucet.solana.com.`,
          insufficient: "sol", haveSol: bal.sol
        }, { status: 402 });
      }
    }
    if (body.action === "claim") {
      if (round.status !== "complete" && round.status !== "cancelled") {
        return NextResponse.json({ error: `round is ${round.status} — nothing to claim yet` }, { status: 409 });
      }
      if (!escrow.settleSignatures || escrow.settleSignatures.length === 0) {
        return NextResponse.json({ error: round.status === "cancelled" ? "refund is still being prepared — try again in a minute" : "arena not settled yet — settlement pending" }, { status: 409 });
      }
      // Claims go by the on-chain entry: it covers players, refunds of
      // cancelled arenas, and deposits that never got a seat.
      const pe = await readPlayerEntry(body.wallet, escrow.roundVault);
      if (!pe) return NextResponse.json({ error: "this wallet has no deposit in this arena" }, { status: 403 });
      if (pe.claimed) return NextResponse.json({ error: "already claimed" }, { status: 409 });
      if (!pe.settled) return NextResponse.json({ error: "settlement for this wallet isn't recorded yet — try again in a minute" }, { status: 409 });
      if (pe.entitlementUsdc <= 0) return NextResponse.json({ error: "nothing to claim — this vault finished at $0" }, { status: 409 });
    }
    if (body.action === "recover") {
      if (round.status === "complete") {
        return NextResponse.json({ error: "round completed — use Claim instead" }, { status: 409 });
      }
      // Only depositors can recover; refuse observers early so they don't get
      // a wallet prompt for a tx that would fail with AccountMismatch.
      const dep = await verifyPlayerDeposited(body.wallet, escrow.roundVault);
      if (!dep.ok) return NextResponse.json({ error: "this wallet did not deposit into this arena" }, { status: 403 });
    }

    if (body.action === "deposit" && sessionWallet(request) === body.wallet) {
      // Remember who this wallet wants to be, so if its deposit lands but the
      // enroll request never arrives the keeper still seats it correctly.
      const name = validateUsername(body.nickname ?? "");
      const openingCall = body.openingCall === "YES" || body.openingCall === "NO" ? body.openingCall : null;
      await mutateActiveRound(arena, (r) => {
        if (r.status !== "enrolling" || !r.escrow) return;
        const pending = (r.escrow.pendingSeats ??= {});
        if (!pending[body.wallet] && Object.keys(pending).length >= MAX_PENDING_SEATS) return;
        pending[body.wallet] = { nickname: name.ok ? name.value : "", openingCall };
      }).catch(() => { /* best effort — enroll carries the same data */ });
    }

    const seatUsdc = round.config.entryUsdc + round.config.startingBankroll;
    const call = body.openingCall === "YES" ? "UP" : body.openingCall === "NO" ? "DOWN" : "decide later";
    const memo = `Oracle Rumble arena ${arena}: ${seatUsdc.toFixed(2)} USDC seat, ${round.config.asset} opening call ${call}`;
    const res = body.action === "deposit"
      ? await buildDepositTx(wallet, roundVault, memo)
      : await buildWithdrawTx(wallet, roundVault, body.action === "recover");
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
    return NextResponse.json({ escrow: "active", base64: res.base64, roundVault: roundVault.toBase58() });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
