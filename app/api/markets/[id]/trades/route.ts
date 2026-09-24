import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockPubkey, mockSignature } from "@/lib/panta";
import { findMockMarket } from "@/lib/arena-data";

/**
 * GET /api/markets/[id]/trades
 * Maps to Panta's GET /markets/{id}/trades.
 *
 * The live trade tape for a single market. Powers the "recent trades"
 * strip in the market panel — every row is a real on-chain fill (in
 * live mode) or a plausible fake (in mock mode).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{
        trades: Array<{ signature: string; side: "YES" | "NO"; shares: number; priceCents: number; usdcAmount: string; wallet: string; ts: string }>;
      }>(`/markets/${encodeURIComponent(id)}/trades`);
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/{id}/trades failed, serving mock:", err);
    }
  }

  const hit = findMockMarket(id);
  const baseYes = hit?.market.yesPrice ?? 50;
  const now = Date.now();
  const trades = Array.from({ length: 6 }, (_, i) => {
    const side: "YES" | "NO" = Math.random() > 0.5 ? "YES" : "NO";
    const priceCents = Math.max(4, Math.min(96, baseYes + Math.round((Math.random() - 0.5) * 12)));
    const usdc = Math.round((Math.random() * 200 + 10) * 100) / 100;
    const shares = Math.round((usdc / ((side === "YES" ? priceCents : 100 - priceCents) / 100)) * 10) / 10;
    return {
      signature: mockSignature(),
      side,
      shares,
      priceCents: side === "YES" ? priceCents : 100 - priceCents,
      usdcAmount: usdc.toFixed(2),
      wallet: mockPubkey(),
      ts: new Date(now - i * (30_000 + Math.random() * 60_000)).toISOString()
    };
  });
  return NextResponse.json({ source: "mock", trades });
}
