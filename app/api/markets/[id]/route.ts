import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";
import { findMockMarket } from "@/lib/arena-data";

/**
 * GET /api/markets/[id] — single market catalog row.
 * Maps to Panta's GET /markets/{id}.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<PantaMarket>(`/markets/${encodeURIComponent(id)}`);
      return NextResponse.json({ source: "panta", market: data });
    } catch (err) {
      console.error("panta /markets/{id} failed, serving mock:", err);
    }
  }
  const hit = findMockMarket(id);
  if (!hit) return NextResponse.json({ source: "mock", error: "market not found" }, { status: 404 });
  return NextResponse.json({ source: "mock", market: hit.market });
}
