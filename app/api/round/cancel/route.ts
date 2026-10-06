import { NextResponse } from "next/server";
import { getActiveRound, withKeeperLock } from "@/lib/round-store";
import { normalizeArenaCode, logEvent } from "@/lib/royale";
import { readVault } from "@/lib/escrow-server";
import { sessionWallet } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/round/cancel  { arena } — signed-in host only
 *
 * Marks an arena as `cancelled` when the host's seat-deposit signing failed
 * (wallet rejected, tx failed, timeout). This exists so a freshly-created
 * arena doesn't linger as an orphan after a Host & Join that never funded.
 *
 * Cancels only when it is safe to do so:
 *   1. Arena is still `enrolling` (the only state where the host would be
 *      the first depositor).
 *   2. No entrants have joined yet other than possibly the caller themselves.
 *   3. Nobody has deposited into the arena's on-chain vault. A paid seat is
 *      registered by the keeper even if its enroll request failed, so a
 *      funded arena must never be torn down from the client.
 *
 * If a check fails we return 409 without touching the row — someone
 * else is already using this arena and we shouldn't rip it out from under
 * them.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    arena?: string;
    wallet?: string;
  };
  const arenaCode = normalizeArenaCode(body.arena ?? "");
  if (!arenaCode) return NextResponse.json({ error: "pit required" }, { status: 400 });
  // Only the signed-in host may cancel their own arena.
  const caller = sessionWallet(request);
  if (!caller) return NextResponse.json({ error: "Sign in with your wallet to continue.", needsAuth: true }, { status: 401 });

  const peek = await getActiveRound(arenaCode);
  if (peek?.escrow) {
    const vault = await readVault(peek.escrow.roundVault);
    if (!vault) return NextResponse.json({ error: "could not read the pit vault — not cancelling" }, { status: 409 });
    if (vault.deposited > 0) {
      return NextResponse.json({ error: "a seat deposit already landed in this pit", funded: true }, { status: 409 });
    }
  }

  const result = await withKeeperLock(arenaCode, async (ctx) => {
    const round = await ctx.getActive();
    if (!round) return { ok: false, error: "pit not found" } as const;
    if (round.status !== "enrolling") {
      return { ok: false, error: `pit is ${round.status} — cannot cancel` } as const;
    }
    if (round.config.host !== caller) return { ok: false, error: "only the host can cancel this pit" } as const;
    const humans = round.entrants.filter((e) => !e.isBot);
    // Refuse once anyone other than the host is in the room.
    if (humans.some((e) => e.wallet !== caller)) return { ok: false, error: "pit already has players" } as const;
    round.status = "cancelled";
    round.endedAt = Date.now();
    logEvent(round, "Round cancelled — host deposit was not signed.");
    await ctx.save(round);
    return { ok: true, arena: arenaCode } as const;
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true, arena: result.arena });
}
