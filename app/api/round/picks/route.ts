import { NextResponse } from "next/server";
import { requireWallet } from "@/lib/session";
import { mutateActiveRound } from "@/lib/round-store";
import { normalizeArenaCode } from "@/lib/royale";
import { normalizePicks, type Picks } from "@/lib/predictions";

export const dynamic = "force-dynamic";

/**
 * POST /api/round/picks  { wallet, arena, picks: { questionId: optionId } }
 *
 * Change a seated player's predictions while the arena is enrolling. Picks
 * sent here are merged into the player's current ones; invalid entries are
 * ignored. Once the round locks, picks are final.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; arena?: string; picks?: unknown };
  if (!body.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  // Only the wallet itself (signed-in session) may change its picks.
  const denied = requireWallet(request, body.wallet);
  if (denied) return denied;
  const arena = normalizeArenaCode(body.arena);
  let pickError = "";
  let picks: Picks = {};
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (!r.predictions) { pickError = "this arena isn't a predictions arena"; return; }
    if (r.status !== "enrolling") { pickError = "the round has started — picks are locked"; return; }
    const me = r.entrants.find((e) => e.wallet === body.wallet);
    if (!me) { pickError = "take a seat first"; return; }
    me.picks = { ...(me.picks ?? {}), ...normalizePicks(r.predictions.questions, body.picks) };
    picks = me.picks;
  });
  if (!round) return NextResponse.json({ error: "no active round in this arena" }, { status: 404 });
  if (pickError) return NextResponse.json({ error: pickError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true, picks });
}
