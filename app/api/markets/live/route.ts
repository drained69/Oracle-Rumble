import { NextResponse } from "next/server";
import { markets as boardMarkets } from "@/lib/arena-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/live
 *
 * Live UP/DOWN prices for the BTC/ETH/SOL direction board — powers the "live
 * markets" strip on the arenas directory. Board is synthetic (not fetched
 * from Panta) so this stays cheap and always returns.
 */
export async function GET() {
  const items = boardMarkets.map((m) => ({
    id: m.id,
    asset: m.asset,
    horizon: m.horizon,
    question: m.question,
    up: m.yesPrice,
    down: 100 - m.yesPrice,
    change: m.change,
    volume: m.volume,
    closes: m.closes
  }));
  return NextResponse.json({ items });
}
