import { NextResponse } from "next/server";
import { STORE_ENABLED, getActiveRound, saveRound, withKeeperLock } from "@/lib/round-store";
import { advanceToNext, bootstrapRound, marketYesPrice, pickMarket, tick } from "@/lib/round-keeper";
import { cutLine, standings, type Round } from "@/lib/royale";

export const dynamic = "force-dynamic";

const HOLD_MS = 20_000; // keep a finished round on screen this long

/**
 * GET /api/round
 *
 * Returns the current round with live standings. Runs the keeper on every
 * read: bootstraps a round if none exists, fills bots + opens the window at
 * lock, lets bots trade, settles + advances when timers expire.
 *
 * The whole tick/bootstrap/advance sequence runs under a global advisory
 * lock (withKeeperLock) so concurrent reads can't fork the round. External
 * I/O — the live Panta price and market selection — is fetched BEFORE the
 * lock so the lock is held only for fast DB ops.
 */
async function currentWithTick(): Promise<Round | null> {
  // Phase 1 — unlocked peek + external I/O (kept out of the lock).
  const peek = await getActiveRound();
  const priceMarketId = peek?.config.marketId;
  const yesPrice = priceMarketId ? await marketYesPrice(priceMarketId) : 50;
  // Only pre-fetch a next market when the round could actually advance.
  const mayAdvance = peek?.status === "live";
  const nextMarket = mayAdvance ? await pickMarket(priceMarketId) : null;
  // Only pre-build a boot round when nothing is active.
  const bootRound = peek ? null : await bootstrapRound();

  // Phase 2 — locked, atomic keeper.
  return withKeeperLock(async (ctx) => {
    let round = await ctx.getActive();
    if (!round) {
      const latest = await ctx.getLatest();
      if (latest && (latest.status === "complete" || latest.status === "cancelled")
          && latest.endedAt && Date.now() - latest.endedAt < HOLD_MS) {
        return latest; // hold the result on screen briefly
      }
      if (bootRound) { await ctx.save(bootRound); await ctx.cancelOtherActive(bootRound.id); return bootRound; }
      return latest ?? null;
    }

    // Retire any older forked/zombie active rounds so only this one is live.
    await ctx.cancelOtherActive(round.id);

    tick(round, yesPrice);
    if (round.status === "advancing") {
      const next = advanceToNext(round, nextMarket);
      await ctx.save(round);   // persist the settled round
      await ctx.save(next);    // and the promoted one
      await ctx.cancelOtherActive(next.id);
      round = next;
    } else {
      await ctx.save(round);
    }
    return round;
  });
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
  const body = (await request.json().catch(() => ({}))) as { action?: string; config?: Record<string, unknown>; force?: boolean };
  if (body.action === "new") {
    // Guard against griefing: don't blow away an in-progress round. Only
    // open a fresh one when nothing is active (or when a host explicitly
    // forces it with the ROUND_HOST_SECRET).
    const active = await getActiveRound();
    const forceOk = body.force === true && !!process.env.ROUND_HOST_SECRET
      && request.headers.get("x-host-secret") === process.env.ROUND_HOST_SECRET;
    if (active && !forceOk) {
      return NextResponse.json({ error: "a round is already active", round: active }, { status: 409 });
    }
    const fresh = await bootstrapRound(body.config as never);
    if (!fresh) return NextResponse.json({ error: "no market available" }, { status: 503 });
    await saveRound(fresh);
    const yesPrice = await marketYesPrice(fresh.config.marketId);
    return NextResponse.json({ round: fresh, yesPrice, cutLine: cutLine(fresh), standings: standings(fresh), persisted: STORE_ENABLED });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
