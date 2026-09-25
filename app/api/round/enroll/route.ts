import { NextResponse } from "next/server";
import { getActiveRound, saveRound } from "@/lib/round-store";
import { enroll, makeEntrant } from "@/lib/royale";

/**
 * POST /api/round/enroll  { wallet, nickname }
 *
 * Enrolls a wallet into the current enrolling round. The entry fee is added
 * to the prize pool (ledger — on-chain escrow via the TraderVault Anchor
 * program is the next milestone). Returns the updated round.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { wallet: string; nickname?: string };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const round = await getActiveRound();
  if (!round) return NextResponse.json({ error: "no active round" }, { status: 404 });
  if (round.status !== "enrolling") return NextResponse.json({ error: "enrollment closed for this round" }, { status: 409 });

  const nickname = (body.nickname || body.wallet.slice(0, 4)).slice(0, 16);
  const entrant = makeEntrant(round, body.wallet, nickname, false);
  const res = enroll(round, entrant);
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 409 });

  await saveRound(round);
  return NextResponse.json({ round, entrantId: entrant.id });
}
