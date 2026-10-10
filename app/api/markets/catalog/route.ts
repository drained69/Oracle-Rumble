import { NextResponse } from "next/server";
import { PANTA_LIVE } from "@/lib/panta";
import { listPantaMarkets, pantaCatalogFetchFailed, PANTA_SANDBOX } from "@/lib/panta-market";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/catalog — open Panta markets a host can run a pit on.
 * Unresolved, still trading, most-traded first. Empty without a Panta key.
 */
export async function GET() {
  const list = await listPantaMarkets();
  return NextResponse.json({
    available: PANTA_LIVE,
    sandbox: PANTA_SANDBOX,
    stale: pantaCatalogFetchFailed(),
    items: list.slice(0, 60).map((m) => ({
      id: m.id,
      question: m.question,
      category: m.category,
      yesCents: m.priceAvailable ? m.yesCents : null,
      endMs: m.endMs,
      volumeUsdc: m.volumeUsdc
    }))
  });
}
