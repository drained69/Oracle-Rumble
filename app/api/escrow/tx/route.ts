import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { buildDepositTx, buildWithdrawTx, escrowReady, verifyPlayerDeposited } from "@/lib/escrow-server";
import { getActiveRound, getLatestRound } from "@/lib/round-store";
import { normalizeArenaCode } from "@/lib/royale";

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
    }
    if (body.action === "claim") {
      if (round.status !== "complete") {
        return NextResponse.json({ error: `round is ${round.status} — nothing to claim yet` }, { status: 409 });
      }
      if (!escrow.settleSignatures || escrow.settleSignatures.length === 0) {
        return NextResponse.json({ error: "arena not settled yet — settlement pending" }, { status: 409 });
      }
      // Only entrants can claim — bots and observers cannot.
      const entrant = round.entrants.find((e) => e.wallet === body.wallet);
      if (!entrant) return NextResponse.json({ error: "this wallet did not play in this arena" }, { status: 403 });
      if ((entrant.cash + entrant.prizeUsdc) <= 0) {
        return NextResponse.json({ error: "no entitlement to claim" }, { status: 409 });
      }
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

    const res = body.action === "deposit"
      ? await buildDepositTx(wallet, roundVault)
      : await buildWithdrawTx(wallet, roundVault, body.action === "recover");
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
    return NextResponse.json({ escrow: "active", base64: res.base64, roundVault: roundVault.toBase58() });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
