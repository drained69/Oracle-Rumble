import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch } from "@/lib/panta";
import { findMockMarket } from "@/lib/arena-data";
import { pantaMarketToUi, type PantaLiveMarket } from "@/lib/panta-shape";

/**
 * GET /api/markets/[id] — single market catalog row.
 * Maps to Panta's GET /markets/{id}.
 *
 * Normalizes Panta's phase-dependent field names (marketId/title/yesPrice
 * as "0.50", phase "primary"/"resolved") into the stable PantaMarket
 * shape used by the UI (id/question/cents, resolvedAt).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (PANTA_LIVE) {
    try {
      const raw = await pantaFetch<PantaLiveMarket>(`/markets/${encodeURIComponent(id)}`);
      return NextResponse.json({ source: "panta", market: pantaMarketToUi(raw) });
    } catch (err) {
      console.error("panta /markets/{id} failed, serving mock:", err);
    }
  }
  const hit = findMockMarket(id);
  if (!hit) return NextResponse.json({ source: "mock", error: "market not found" }, { status: 404 });
  return NextResponse.json({ source: "mock", market: hit.market });
}
