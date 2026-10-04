import { NextResponse } from "next/server";
import { requireWallet } from "@/lib/session";
import { mutateActiveRound } from "@/lib/round-store";
import { normalizeArenaCode } from "@/lib/royale";
import { normalizeLocks, normalizePicks, type Picks } from "@/lib/predictions";
import { canPick, currentLeg } from "@/lib/streak";

export const dynamic = "force-dynamic";

/**
 * POST /api/round/picks
 *
 * Predictions: { wallet, arena, picks?: { questionId: optionId }, locks?: questionId[] }
 *   Change picks and/or the lock while the arena is enrolling. Picks are
 *   merged into the player's current ones; `locks` replaces the lock.
 *
 * Streak: { wallet, arena, pick: optionId }
 *   Pick the current leg's answer while its window is open (leg 1 can be
 *   picked from the moment you take a seat). Players who are out can't pick.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; arena?: string; picks?: unknown; locks?: unknown; pick?: unknown };
  if (!body.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  // Only the wallet itself (signed-in session) may change its picks.
  const denied = requireWallet(request, body.wallet);
  if (denied) return denied;
  const arena = normalizeArenaCode(body.arena);
  let pickError = "";
  let picks: Picks = {};
  let locks: string[] = [];
  let pick: string | null = null;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    const me = r.entrants.find((e) => e.wallet === body.wallet);
    if (r.streak) {
      if (!me) { pickError = "take a seat first"; return; }
      if (me.eliminatedRound !== null) { pickError = "you're out of this streak"; return; }
      if (!canPick(r, me)) { pickError = "picks for this leg are locked — the next leg opens shortly"; return; }
      const leg = currentLeg(r.streak);
      if (typeof body.pick !== "string" || !leg.question.options.some((o) => o.id === body.pick)) { pickError = "pick one of the answers"; return; }
      leg.picks[me.id] = body.pick;
      pick = body.pick;
      return;
    }
    if (!r.predictions) { pickError = "this arena has no picks"; return; }
    if (r.status !== "enrolling") { pickError = "the round has started — picks are locked"; return; }
    if (!me) { pickError = "take a seat first"; return; }
    if (body.picks !== undefined) me.picks = { ...(me.picks ?? {}), ...normalizePicks(r.predictions.questions, body.picks) };
    if (body.locks !== undefined) me.locks = normalizeLocks(r.predictions.questions, body.locks).filter((q) => me.picks?.[q]);
    picks = me.picks ?? {};
    locks = me.locks ?? [];
  });
  if (!round) return NextResponse.json({ error: "no active round in this arena" }, { status: 404 });
  if (pickError) return NextResponse.json({ error: pickError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(round.streak ? { ok: true, pick } : { ok: true, picks, locks });
}
