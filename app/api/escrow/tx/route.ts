import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { buildDepositTx, buildWithdrawTx, escrowReady } from "@/lib/escrow-server";
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
    // Find the arena's on-chain roundVault. We stored it in the Round's
    // escrow record when hosting; here we look it up from the active round.
    const round = (await getActiveRound(arena)) ?? (await getLatestRound(arena));
    if (!round) return NextResponse.json({ error: "arena not found", arena }, { status: 404 });
    // Escrow records live under a top-level property we attach at host time.
    const escrow = (round as unknown as { escrow?: { host: string; roundVault: string } }).escrow;
    if (!escrow?.roundVault) return NextResponse.json({ error: "arena is ledger-only (no on-chain escrow record)" }, { status: 409 });
    let roundVault: PublicKey;
    try { roundVault = new PublicKey(escrow.roundVault); }
    catch { return NextResponse.json({ error: "invalid stored roundVault" }, { status: 500 }); }

    const res = body.action === "deposit"
      ? await buildDepositTx(wallet, roundVault)
      : await buildWithdrawTx(wallet, roundVault, body.action === "recover");
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
    return NextResponse.json({ escrow: "active", base64: res.base64, roundVault: roundVault.toBase58() });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
