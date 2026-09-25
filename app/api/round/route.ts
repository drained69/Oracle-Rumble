import { NextResponse } from "next/server";
import { STORE_ENABLED, getActiveRound, getLatestRound, saveRound } from "@/lib/round-store";
import { advanceToNext, bootstrapRound, marketYesPrice, tick } from "@/lib/round-keeper";
import { cutLine, standings, type Round } from "@/lib/royale";

/**
 * GET /api/round
 *
 * Returns the current round with live standings. Runs the keeper on every
 * read: bootstraps a round if none exists, fills bots + opens the window at
 * lock, lets bots trade, settles + advances when timers expire. Idempotent.
 *
 * Response: { round, yesPrice, cutLine, standings, persisted }
 */
async function currentWithTick(): Promise<Round | null> {
  let round = await getActiveRound();
  if (!round) {
    // No active round. If the latest is complete/cancelled we still show it
    // for a beat, but bootstrap a fresh enrolling round so the lobby is live.
    const latest = await getLatestRound();
    if (latest && (latest.status === "complete" || latest.status === "cancelled")) {
      // keep it briefly, but spin up the next lobby
      const fresh = await bootstrapRound();
      if (fresh) { await saveRound(fresh); round = fresh; }
      else round = latest;
    } else {
      const fresh = await bootstrapRound();
      if (fresh) { await saveRound(fresh); round = fresh; }
    }
  }
  if (!round) return null;

  round = await tick(round);
  if (round.status === "advancing") {
    const next = await advanceToNext(round);
    await saveRound(round);   // persist the settled round
    await saveRound(next);    // and the promoted one
    round = next;
  } else {
    await saveRound(round);
  }
  return round;
}

export async function GET() {
  try {
    const round = await currentWithTick();
    if (!round) {
      return NextResponse.json({ round: null, error: "no market available to open a round" }, { status: 503 });
    }
    const yesPrice = await marketYesPrice(round.config.marketId);
    return NextResponse.json({
      round,
      yesPrice,
      cutLine: cutLine(round),
      standings: standings(round),
      persisted: STORE_ENABLED
    });
  } catch (err) {
    console.error("GET /api/round failed:", err);
    return NextResponse.json({ round: null, error: err instanceof Error ? err.message : "round error" }, { status: 500 });
  }
}

/**
 * POST /api/round  { action: "new", config? }
 * Force a fresh round (host action). Optional config overrides.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; config?: Record<string, unknown> };
  if (body.action === "new") {
    const fresh = await bootstrapRound(body.config as never);
    if (!fresh) return NextResponse.json({ error: "no market available" }, { status: 503 });
    await saveRound(fresh);
    const yesPrice = await marketYesPrice(fresh.config.marketId);
    return NextResponse.json({ round: fresh, yesPrice, cutLine: cutLine(fresh), standings: standings(fresh), persisted: STORE_ENABLED });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
