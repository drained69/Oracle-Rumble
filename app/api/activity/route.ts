import { NextResponse } from "next/server";
import { recentArenas, STORE_ENABLED } from "@/lib/round-store";
import { isPracticeArena } from "@/lib/royale";

export const dynamic = "force-dynamic";

type Verb = "UP" | "DOWN" | "SEAT" | "WON" | "OPENED" | "SETTLED";
type Event = {
  id: string;
  actor: string;        // nickname of a real human player
  verb: Verb;
  asset: string;        // BTC / ETH / SOL, or "Predictions"
  arenaCode: string;
  amount?: number;      // USDC, filled on WON
  ts: number;           // ms epoch
};

/**
 * GET /api/activity
 *
 * Real room activity across every recent user-hosted arena — humans only,
 * sorted most-recent first. Returns an empty list on empty store so the UI
 * can hide the panel. Nothing synthesised; bots filtered out.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "10")));
  if (!STORE_ENABLED) return NextResponse.json({ items: [] });

  try {
    const rooms = await recentArenas(60);
    const events: Event[] = [];
    for (const { arenaCode, latest } of rooms) {
      if (isPracticeArena(arenaCode)) continue;
      // Predictions and Streak arenas cover all three coins.
      const asset = latest.config.format === "predictions" ? "Predictions" : latest.config.format === "streak" ? "Streak" : latest.config.asset;

      // ── Arena-level opens / settles ─────────────────────────────
      if (latest.roundNumber === 1 && latest.createdAt) {
        events.push({
          id: `${arenaCode}:opened`,
          actor: hostNickname(latest),
          verb: "OPENED",
          asset,
          arenaCode,
          ts: latest.createdAt
        });
      }
      if (latest.status === "complete" && latest.endedAt) {
        events.push({
          id: `${arenaCode}:settled:${latest.endedAt}`,
          actor: championNickname(latest),
          verb: "SETTLED",
          asset,
          arenaCode,
          ts: latest.endedAt
        });
      }

      // ── Human entrants → seat, call, win ────────────────────────
      for (const e of latest.entrants) {
        if (e.isBot) continue;
        if (e.joinedAt) {
          events.push({
            id: `${arenaCode}:seat:${e.id}`,
            actor: e.nickname,
            verb: "SEAT",
            asset,
            arenaCode,
            ts: e.joinedAt
          });
        }
        // Opening calls are hidden until the round locks (and cleared once
        // placed), so they are never announced while enrolling.
        if (e.openingCall && e.joinedAt && latest.status !== "enrolling") {
          events.push({
            id: `${arenaCode}:call:${e.id}`,
            actor: e.nickname,
            verb: e.openingCall === "YES" ? "UP" : "DOWN",
            asset,
            arenaCode,
            // Ordered just after the seat so UI shows seat → call.
            ts: e.joinedAt + 1
          });
        }
        if (e.prizeUsdc > 0 && latest.endedAt) {
          events.push({
            id: `${arenaCode}:win:${e.id}`,
            actor: e.nickname,
            verb: "WON",
            asset,
            arenaCode,
            amount: Math.round(e.prizeUsdc * 100) / 100,
            ts: latest.endedAt
          });
        }
      }
    }

    events.sort((a, b) => b.ts - a.ts);
    return NextResponse.json({ items: events.slice(0, limit) });
  } catch (err) {
    console.error("GET /api/activity failed:", err);
    return NextResponse.json({ items: [] });
  }
}

function hostNickname(round: { config: { host: string }; entrants: { wallet: string; nickname: string; isBot: boolean }[] }): string {
  const h = round.entrants.find((e) => !e.isBot && e.wallet === round.config.host);
  return h?.nickname ?? "a host";
}
function championNickname(round: { championId: string | null; entrants: { id: string; nickname: string; isBot: boolean }[] }): string {
  if (!round.championId) return "the pit";
  const c = round.entrants.find((e) => e.id === round.championId);
  return c && !c.isBot ? c.nickname : "the pit";
}
