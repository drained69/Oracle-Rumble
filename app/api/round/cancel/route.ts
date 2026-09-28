import { NextResponse } from "next/server";
import { withKeeperLock } from "@/lib/round-store";
import { normalizeArenaCode } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * POST /api/round/cancel  { arena, wallet? }
 *
 * Marks an arena as `cancelled` when the host's seat-deposit signing failed
 * (wallet rejected, tx failed, timeout). This exists so a freshly-created
 * arena doesn't linger as an orphan after a Host & Join that never funded.
 *
 * Cancels only when it is safe to do so:
 *   1. Arena is still `enrolling` (the only state where the host would be
 *      the first depositor).
 *   2. No entrants have joined yet other than possibly the caller themselves.
 *
 * If either check fails we return 409 without touching the row — someone
 * else is already using this arena and we shouldn't rip it out from under
 * them.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    arena?: string;
    wallet?: string;
  };
  const arenaCode = normalizeArenaCode(body.arena ?? "");
  if (!arenaCode) return NextResponse.json({ error: "arena required" }, { status: 400 });

  const result = await withKeeperLock(arenaCode, async (ctx) => {
    const round = await ctx.getActive();
    if (!round) return { ok: false, error: "arena not found" } as const;
    if (round.status !== "enrolling") {
      return { ok: false, error: `arena is ${round.status} — cannot cancel` } as const;
    }
    const humanCount = round.entrants.filter((e) => !e.isBot).length;
    if (humanCount > 0) {
      // If the ONLY human is the caller and they're the host, still allow cancel.
      // Otherwise refuse — someone else is already in the room.
      const onlyCaller =
        humanCount === 1 &&
        !!body.wallet &&
        round.entrants.some((e) => !e.isBot && e.wallet === body.wallet);
      if (!onlyCaller) return { ok: false, error: "arena already has players" } as const;
    }
    round.status = "cancelled";
    round.endedAt = Date.now();
    round.history.push("Round cancelled — host deposit was not signed.");
    await ctx.save(round);
    return { ok: true, arena: arenaCode } as const;
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, arena: result.arena });
}
