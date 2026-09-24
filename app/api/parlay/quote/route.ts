import { NextResponse } from "next/server";
import { quoteParlay, validateParlay, type ParlayLeg } from "@/lib/parlay";
import { findMockMarket } from "@/lib/arena-data";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";

/**
 * POST /api/parlay/quote
 *
 * Native parlays aren't a first-class Panta product — they're a client-space
 * bundle of N single-market orders. That means parlay pricing has to be
 * computed dynamically from live single-market prices, which is exactly the
 * "quote-based liquidity" idea parlayit uses.
 *
 * Flow:
 *   1. Client sends the intended legs and stake.
 *   2. Server refreshes every leg's price from Panta (`GET /markets/{id}`)
 *      so the quote is anchored to the live book, not a stale snapshot.
 *   3. Server re-runs correlation + size validation.
 *   4. `quoteParlay` produces the variance-based fee and combined price.
 *   5. Client places the parlay by running the single-order lifecycle for
 *      each leg against Panta's `orders/quote` → `orders/build` → `orders/submit`.
 */

type Body = {
  legs: Array<Pick<ParlayLeg, "marketId" | "side" | "correlationGroup"> & { question?: string }>;
  stakeUsdc: number | string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!Array.isArray(body?.legs) || body.legs.length === 0) {
    return NextResponse.json({ error: "legs[] required" }, { status: 400 });
  }
  const stake = Number(body.stakeUsdc);
  if (!Number.isFinite(stake) || stake <= 0) {
    return NextResponse.json({ error: "stakeUsdc > 0 required" }, { status: 400 });
  }

  // Refresh every leg's price from the market layer so the parlay quote
  // reflects the live single-market book.
  const refreshed: ParlayLeg[] = [];
  for (const leg of body.legs) {
    let price = 50;
    let question = leg.question ?? "";
    let correlationGroup = leg.correlationGroup;

    let live: PantaMarket | null = null;
    if (PANTA_LIVE) {
      try {
        live = await pantaFetch<PantaMarket>(`/markets/${encodeURIComponent(leg.marketId)}`);
      } catch {
        live = null;
      }
    }
    if (live) {
      question ||= live.question;
      price = leg.side === "YES" ? live.yesPrice : 100 - live.yesPrice;
    } else {
      const hit = findMockMarket(leg.marketId);
      if (!hit) return NextResponse.json({ error: `market not found: ${leg.marketId}` }, { status: 404 });
      question ||= hit.market.question;
      correlationGroup ||= hit.market.correlationGroup;
      price = leg.side === "YES" ? hit.market.yesPrice : 100 - hit.market.yesPrice;
    }

    refreshed.push({
      marketId: leg.marketId,
      side: leg.side,
      question,
      price,
      correlationGroup
    });
  }

  const validation = validateParlay(refreshed);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 422 });
  }

  const quote = quoteParlay(refreshed, stake);
  return NextResponse.json({ source: PANTA_LIVE ? "panta" : "mock", quote });
}
