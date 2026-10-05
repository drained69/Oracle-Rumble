import { NextResponse } from "next/server";
import { recentArenas, STORE_ENABLED } from "@/lib/round-store";
import { humanCount, isPracticeArena } from "@/lib/royale";

export const dynamic = "force-dynamic";

/**
 * GET /api/arenas
 *
 * Directory of active + recently-finished user-hosted arenas — everything the
 * lobby page needs to render "All arenas". The reserved PUBLIC code (retired
 * walk-in room) is excluded so only real hosted rooms surface.
 */
export async function GET() {
  try {
    const all = await recentArenas(30);
    const items = all
      .filter(({ arenaCode }) => !isPracticeArena(arenaCode))
      .map(({ arenaCode, latest }) => {
      const humans = humanCount(latest);
      const bots = latest.entrants.length - humans;
      const alive = latest.entrants.filter((e) => e.eliminatedRound === null).length;
      return {
        arenaCode,
        isPublic: false,
        inviteSlug: `/a/${arenaCode}`,
        status: latest.status,
        roundNumber: latest.roundNumber,
        roundLimit: latest.config.roundLimit,
        format: latest.config.format,
        asset: latest.config.asset,
        marketQuestion: latest.config.marketQuestion,
        capacity: latest.config.capacity,
        entryUsdc: latest.config.entryUsdc,
        startingBankroll: latest.config.startingBankroll,
        hostFeePct: latest.config.hostFeePct ?? 0,
        prizePoolUsdc: latest.prizePoolUsdc,
        humans,
        bots,
        alive,
        entrants: latest.entrants.length,
        createdAt: latest.createdAt,
        enrollDeadline: latest.enrollDeadline,
        liveDeadline: latest.liveDeadline,
        endedAt: latest.endedAt
      };
    });
    // Sort: live > enrolling > others, then most recent.
    const rank = (s: string) => (s === "live" ? 0 : s === "enrolling" ? 1 : s === "advancing" || s === "settling" ? 2 : 3);
    items.sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return b.createdAt - a.createdAt;
    });
    return NextResponse.json({ items, persisted: STORE_ENABLED });
  } catch (err) {
    console.error("GET /api/arenas failed:", err);
    return NextResponse.json({ items: [], error: err instanceof Error ? err.message : "arenas error" }, { status: 500 });
  }
}
