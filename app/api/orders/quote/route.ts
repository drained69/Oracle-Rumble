import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockQuoteId, type QuoteRequest, type QuoteResponse } from "@/lib/panta";
import { findMockMarket } from "@/lib/arena-data";

/**
 * POST /api/orders/quote
 * Maps to Panta's POST /orders/quote.
 *
 * The client sends { marketId, side, usdcAmount, wallet? } and gets back a
 * short-lived quote session with the simulated fill price, fee breakdown,
 * and estimated shares. The next step is /api/orders/build.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as QuoteRequest;
  if (!body?.marketId || !body?.side || !body?.usdcAmount) {
    return NextResponse.json({ error: "marketId, side, usdcAmount required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<QuoteResponse>("/orders/quote", {
        method: "POST",
        body: JSON.stringify(body)
      });
      return NextResponse.json({ ...data, source: "panta" });
    } catch (err) {
      console.error("panta /orders/quote failed, serving mock:", err);
    }
  }

  // Mock: read the cached market, price the side, compute fee.
  const hit = findMockMarket(body.marketId);
  if (!hit) return NextResponse.json({ error: "market not found" }, { status: 404 });
  const usdc = Math.max(0, Number(body.usdcAmount));
  const price = body.side === "YES" ? hit.market.yesPrice : 100 - hit.market.yesPrice;
  const shares = usdc / (price / 100);
  // Panta's fee model on the primary bonding-curve buy is baked into the
  // quote; a small mock fee keeps the summary honest.
  const feeUsdc = Math.round(usdc * 0.01 * 100) / 100;
  const networkFeeUsdc = 0.02;

  const resp: QuoteResponse = {
    quoteId: mockQuoteId(),
    marketId: body.marketId,
    side: body.side,
    price,
    shares: Math.round(shares * 100) / 100,
    usdcAmount: usdc.toFixed(2),
    feeUsdc: feeUsdc.toFixed(2),
    networkFeeUsdc: networkFeeUsdc.toFixed(2),
    expiresAt: new Date(Date.now() + 15_000).toISOString(),
    source: "mock"
  };
  return NextResponse.json(resp);
}
