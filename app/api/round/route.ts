import { NextResponse } from "next/server";
import { STORE_ENABLED, withKeeperLock } from "@/lib/round-store";
import { advanceToNext, bootstrapRound, buildPriceMap, marketYesPrice, pickMarket, tick } from "@/lib/round-keeper";
import { PUBLIC_ARENA, cutLine, humanCount, newArenaCode, normalizeArenaCode, standings, type Round } from "@/lib/royale";

export const dynamic = "force-dynamic";

const HOLD_MS = 20_000; // keep a finished round on screen this long

/**
 * GET /api/round?arena=CODE
 *
 * Returns the current round FOR AN ARENA with live standings. Every arena is
 * independent; the reserved `PUBLIC` code is the walk-in bot lobby that
 * auto-bootstraps a round whenever none is live. Hosted arenas do NOT
 * auto-bootstrap — when their series ends, the URL shows the final scoreboard
 * (during the hold window) then goes empty.
 *
 * The whole tick/bootstrap/advance sequence runs under a per-arena advisory
 * lock so concurrent reads to one arena serialize while different arenas run
 * in parallel. External I/O is fetched BEFORE the lock.
 */
async function currentWithTick(arena: string, allowBootstrap: boolean): Promise<Round | null> {
  // Phase 1 — unlocked peek + external I/O (kept out of the lock).
  const peek = await import("@/lib/round-store").then((m) => m.getActiveRound(arena));
  const priceMarketId = peek?.config.marketId;
  const yesPrice = priceMarketId ? await marketYesPrice(priceMarketId) : 50;
  const priceMap = buildPriceMap(priceMarketId ? { marketId: priceMarketId, yesPrice } : undefined);
  const mayAdvance = peek?.status === "live";
  const nextMarket = mayAdvance ? await pickMarket(priceMarketId) : null;
  // Only the walk-in PUBLIC arena auto-boots. Hosted arenas stay empty when done.
  const bootRound = !peek && allowBootstrap ? await bootstrapRound(undefined, arena) : null;

  // Phase 2 — locked, atomic keeper (per-arena lock).
  return withKeeperLock(arena, async (ctx) => {
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

    await ctx.cancelOtherActive(round.id);
    tick(round, yesPrice, priceMap);
    if (round.status === "advancing") {
      const next = advanceToNext(round, nextMarket);
      await ctx.save(round);
      await ctx.save(next);
      await ctx.cancelOtherActive(next.id);
      round = next;
    } else {
      await ctx.save(round);
    }
    return round;
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const arena = normalizeArenaCode(url.searchParams.get("arena"));
    const allowBootstrap = arena === PUBLIC_ARENA;
    const round = await currentWithTick(arena, allowBootstrap);
    if (!round) {
      const status = arena === PUBLIC_ARENA ? 503 : 404;
      const error = arena === PUBLIC_ARENA
        ? "no market available to open a round"
        : `arena ${arena} not found`;
      return NextResponse.json({ round: null, arena, error }, { status });
    }
    const yesPrice = await marketYesPrice(round.config.marketId);
    return NextResponse.json({
      round,
      arena: round.arenaCode,
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
 * POST /api/round  { action:"new", config?, arena? }
 *
 * Host a rumble. Every host call MINTS A NEW ARENA (short shareable code)
 * unless one is provided and the caller is trusted (ROUND_HOST_SECRET). Because
 * arenas are independent, hosting always succeeds — no more single-active
 * conflict. The response includes the new arena code and its invite URL slug
 * (`/a/{code}`) which the client can share with friends.
 *
 * Special case: passing `arena: "PUBLIC"` and no force header replaces the
 * walk-in public lobby only when it's still empty (no humans joined).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    config?: Record<string, unknown>;
    force?: boolean;
    arena?: string;
  };
  if (body.action !== "new") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const forceOk = body.force === true && !!process.env.ROUND_HOST_SECRET
    && request.headers.get("x-host-secret") === process.env.ROUND_HOST_SECRET;

  const wantArena = body.arena ? normalizeArenaCode(body.arena) : "";
  // Default: mint a brand-new arena for every host call. The client can force
  // a specific code (including PUBLIC) with the host secret.
  const arena = wantArena && forceOk ? wantArena : (wantArena === PUBLIC_ARENA ? PUBLIC_ARENA : newArenaCode());

  const fresh = await bootstrapRound(body.config as never, arena);
  if (!fresh) return NextResponse.json({ error: "no market available" }, { status: 503 });

  const result = await withKeeperLock(arena, async (ctx) => {
    const active = await ctx.getActive();
    // In a private (fresh-code) arena there is no active yet, so this is a no-op.
    // For PUBLIC we still allow replacing an empty lobby only.
    if (active && !forceOk) {
      const emptyLobby = active.status === "enrolling" && humanCount(active) === 0;
      if (!emptyLobby) return { conflict: active } as const;
    }
    await ctx.save(fresh);
    await ctx.cancelOtherActive(fresh.id);
    return { round: fresh } as const;
  });

  if ("conflict" in result) {
    return NextResponse.json({ error: "a rumble is already in progress in this arena", round: result.conflict }, { status: 409 });
  }
  const yesPrice = await marketYesPrice(fresh.config.marketId);
  return NextResponse.json({
    round: fresh,
    arena: fresh.arenaCode,
    inviteSlug: `/a/${fresh.arenaCode}`,
    yesPrice,
    cutLine: cutLine(fresh),
    standings: standings(fresh),
    persisted: STORE_ENABLED
  });
}
