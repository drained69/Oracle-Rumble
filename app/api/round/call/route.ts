import { NextResponse } from "next/server";
import { requireWallet } from "@/lib/session";
import { mutateActiveRound } from "@/lib/round-store";
import { normalizeArenaCode, normalizeCallPct, type Side } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * POST /api/round/call  { wallet, arena, call: "YES" | "NO" | null, pct?: 25 | 50 | 100 }
 *
 * Change a seated player's opening call while the arena is enrolling.
 * YES = UP, NO = DOWN, null = decide once the round is live. The call is
 * placed with the player's whole vault at the opening price when the round
 * locks.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; arena?: string; call?: Side | null; pct?: number };
  if (!body.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  // Only the wallet itself (signed-in session) may act for its seat.
  const denied = requireWallet(request, body.wallet);
  if (denied) return denied;
  if (body.call !== null && body.call !== "YES" && body.call !== "NO") {
    return NextResponse.json({ error: "call must be YES (up), NO (down) or null" }, { status: 400 });
  }
  const arena = normalizeArenaCode(body.arena);
  let callError = "";
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (r.status !== "enrolling") { callError = "the round has started — trade from the live panel"; return; }
    if (r.predictions || r.streak) { callError = "this pit has picks, not an opening call"; return; }
    const me = r.entrants.find((e) => e.wallet === body.wallet);
    if (!me) { callError = "take a seat first"; return; }
    me.openingCall = body.call ?? null;
    if (body.pct !== undefined) me.openingCallPct = normalizeCallPct(body.pct);
  });
  if (!round) return NextResponse.json({ error: "no active round in this pit" }, { status: 404 });
  if (callError) return NextResponse.json({ error: callError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  const me = round.entrants.find((e) => e.wallet === body.wallet);
  return NextResponse.json({ ok: true, call: body.call ?? null, pct: me?.openingCallPct ?? null });
}
