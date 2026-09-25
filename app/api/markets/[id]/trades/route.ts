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
      // Panta returns `{ marketId, items: [...] }`. Each item's field names
      // vary by phase (primary vs secondary). Handle common shapes.
      type PantaTradeItem = {
        signature?: string;
        txSig?: string;
        side?: "YES" | "NO" | "yes" | "no";
        shares?: number | string;
        sharesFilled?: number | string;
        priceCents?: number;
        price?: number | string;
        usdcAmount?: number | string;
        amountUsdc?: number | string;
        wallet?: string;
        walletAddress?: string;
        buyerAddress?: string;
        ts?: string;
        createdAt?: string;
      };
      const data = await pantaFetch<{ items?: PantaTradeItem[]; trades?: PantaTradeItem[] } | PantaTradeItem[]>(
        `/markets/${encodeURIComponent(id)}/trades`
      );
      const raw: PantaTradeItem[] = Array.isArray(data)
        ? data
        : (data.items ?? data.trades ?? []);
      const trades = raw.map((t) => {
        const side = ((t.side ?? "YES").toString().toUpperCase()) as "YES" | "NO";
        const price = typeof t.price === "number" ? t.price : parseFloat((t.price ?? "0.5").toString());
        const priceCents = t.priceCents ?? Math.max(0, Math.min(100, price > 1 ? Math.round(price) : Math.round(price * 100)));
        return {
          signature: t.signature ?? t.txSig ?? "",
          side,
          shares: Number(t.shares ?? t.sharesFilled ?? 0),
          priceCents,
          usdcAmount: String(t.usdcAmount ?? t.amountUsdc ?? "0"),
          wallet: t.wallet ?? t.walletAddress ?? t.buyerAddress ?? "",
          ts: t.ts ?? t.createdAt ?? new Date().toISOString()
        };
      });
      return NextResponse.json({ source: "panta", trades });
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
