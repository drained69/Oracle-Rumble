import { NextResponse } from "next/server";
import { mutateActiveRound } from "@/lib/round-store";
import { enroll, fillWithBots, makeEntrant } from "@/lib/royale";

/**
 * POST /api/round/enroll  { wallet, nickname }
 *
 * Enrolls a wallet into the current enrolling round. Runs inside an atomic
 * round mutation so concurrent enrolls serialize. The entry fee is added to
 * the prize pool (ledger — on-chain escrow via the TraderVault Anchor
 * program is the next milestone).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { wallet: string; nickname?: string };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  let entrantId = "";
  let enrollError: string | undefined;
  const { round, error } = await mutateActiveRound((r) => {
    if (r.status !== "enrolling") { enrollError = "enrollment closed for this round"; return; }
    const nickname = (body.nickname || body.wallet.slice(0, 4)).slice(0, 16);
    const entrant = makeEntrant(r, body.wallet, nickname, false);
    const res = enroll(r, entrant);
    if (!res.ok) { enrollError = res.reason; return; }
    entrantId = entrant.id;
    // Seed a few bots so the roster feels alive during enrollment. The rest
    // fill at lock. Bots don't fund the prize pool.
    if (r.entrants.length < 4) fillWithBots(r, 4);
  });

  if (!round) return NextResponse.json({ error: "no active round" }, { status: 404 });
  if (enrollError) return NextResponse.json({ error: enrollError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ round, entrantId });
}
