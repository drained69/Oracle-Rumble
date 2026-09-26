import { NextResponse } from "next/server";
import { mutateActiveRound } from "@/lib/round-store";
import { enroll, fillWithBots, makeEntrant, normalizeArenaCode } from "@/lib/royale";

/**
 * POST /api/round/enroll  { wallet, nickname, arena? }
 *
 * Enrolls a wallet into the current enrolling round IN ARENA `arena`
 * (default: PUBLIC). Runs inside an atomic per-arena mutation so concurrent
 * enrolls serialize.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { wallet: string; nickname?: string; arena?: string };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  const arena = normalizeArenaCode(body.arena);

  let entrantId = "";
  let enrollError: string | undefined;
  const { round, error } = await mutateActiveRound(arena, (r) => {
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

  if (!round) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  if (enrollError) return NextResponse.json({ error: enrollError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ round, arena, entrantId });
}
