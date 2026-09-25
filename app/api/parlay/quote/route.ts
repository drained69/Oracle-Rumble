import { NextResponse } from "next/server";
import { quoteParlay, validateParlay, type ParlayLeg } from "@/lib/parlay";
import { findMockMarket } from "@/lib/arena-data";
import { assetOfMarketId } from "@/lib/assets";
import { pantaPriceToCents } from "@/lib/round-keeper";
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
    let question = leg.question ?? "";
    let correlationGroup = leg.correlationGroup;
    let yes = 50; // YES price in cents

    const local = findMockMarket(leg.marketId);
    // Our own BTC/ETH/SOL board markets are synthetic — price from the board,
    // never the Panta sandbox (which returns a 50¢ fixture for any id).
    if (local && assetOfMarketId(leg.marketId)) {
      question ||= local.market.question;
      correlationGroup ||= local.market.correlationGroup;
      yes = local.market.yesPrice;
    } else if (PANTA_LIVE) {
      try {
        const live = await pantaFetch<PantaMarket & { yesPrice?: number | string }>(`/markets/${encodeURIComponent(leg.marketId)}`);
        question ||= live.question;
        yes = pantaPriceToCents(live.yesPrice);
      } catch {
        if (!local) return NextResponse.json({ error: `market not found: ${leg.marketId}` }, { status: 404 });
        question ||= local.market.question;
        correlationGroup ||= local.market.correlationGroup;
        yes = local.market.yesPrice;
      }
    } else {
      if (!local) return NextResponse.json({ error: `market not found: ${leg.marketId}` }, { status: 404 });
      question ||= local.market.question;
      correlationGroup ||= local.market.correlationGroup;
      yes = local.market.yesPrice;
    }

    refreshed.push({
      marketId: leg.marketId,
      side: leg.side,
      question,
      price: leg.side === "YES" ? yes : 100 - yes,
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
