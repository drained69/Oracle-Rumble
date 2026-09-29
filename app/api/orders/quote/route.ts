import { limitByIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { PANTA_LIVE, PANTA_USER_ID, pantaFetch, mockQuoteId, type QuoteRequest, type QuoteResponse } from "@/lib/panta";
import { findMockMarket } from "@/lib/arena-data";

/**
 * POST /api/orders/quote
 *
 * Proxies Panta's POST /primaryorderquote/.
 *
 * Wire mapping (client → Panta):
 *   • `usdcAmount`       → `amountUsdc`
 *   • `side: "YES"|"NO"` → lowercase `"yes"|"no"`
 *   • wallet             passthrough
 *   • userId             injected server-side from PANTA_USER_ID (also
 *                        available as X-User-Id header via pantaFetch).
 *
 * Response mapping (Panta → client):
 *   • `avgPrice: "0.53"` decimal string → integer cents `price: 53`
 *   • `shares: "…"` string → number
 *   • `feeUsdc`, `expiresAt` passthrough
 *   • networkFeeUsdc = "0.02" default — Panta bundles it into feeUsdc,
 *     but keeping the client-facing field simplifies the UI.
 */

type PantaPrimaryQuote = {
  quoteId: string;
  marketId: string;
  wallet?: string;
  side: "yes" | "no";
  amountUsdc: string;
  shares: string | number;
  avgPrice?: string | number;
  feeUsdc?: string;
  expiresAt: string;
  blockhashExpiryHintSec?: number;
};

function decimalToCents(v: number | string | undefined): number {
  if (v === undefined || v === null) return 50;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n > 1 ? Math.round(n) : Math.round(n * 100)));
}

export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-write", 30, 60_000);
  if (limited) return limited;
  const body = (await request.json()) as QuoteRequest;
  if (!body?.marketId || !body?.side || !body?.usdcAmount) {
    return NextResponse.json({ error: "marketId, side, usdcAmount required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      // Panta requires wallet on quote — synthesize a placeholder if the
      // caller hasn't connected one yet. Real fills of course use the
      // actual wallet passed through /orders/build later.
      const wallet = body.wallet ?? "11111111111111111111111111111111";
      const payload = {
        marketId: body.marketId,
        wallet,
        side: body.side.toLowerCase(),
        amountUsdc: body.usdcAmount,
        ...(body.userId ? { userId: body.userId } : PANTA_USER_ID ? { userId: PANTA_USER_ID } : {})
      };
      const data = await pantaFetch<PantaPrimaryQuote>("/primaryorderquote", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const resp: QuoteResponse = {
        quoteId: data.quoteId,
        marketId: data.marketId,
        side: body.side,
        price: decimalToCents(data.avgPrice),
        shares: Number(data.shares) || 0,
        usdcAmount: data.amountUsdc,
        feeUsdc: data.feeUsdc ?? "0.00",
        networkFeeUsdc: "0.02",
        expiresAt: data.expiresAt,
        source: "panta"
      };
      return NextResponse.json(resp);
    } catch (err) {
      console.error("panta /primaryorderquote failed, serving mock:", err);
    }
  }

  // Mock: read the cached market, price the side, compute fee.
  const hit = findMockMarket(body.marketId);
  if (!hit) return NextResponse.json({ error: "market not found" }, { status: 404 });
  const usdc = Math.max(0, Number(body.usdcAmount));
  const price = body.side === "YES" ? hit.market.yesPrice : 100 - hit.market.yesPrice;
  const shares = usdc / (price / 100);
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
