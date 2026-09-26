import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 30;

/**
 * GET /api/prices
 *
 * Live BTC/ETH/SOL spot prices for the top-of-page ticker. Pulled from
 * CoinGecko's free public endpoint (no key, ~30/min rate limit) with an
 * in-process 30-second cache so the ticker's fast client polling never
 * hammers upstream. Returns cached values on upstream failure.
 */

type Cached = { at: number; body: { items: PriceItem[]; source: string } };
type PriceItem = { symbol: "BTC" | "ETH" | "SOL"; name: string; priceUsd: number; change24h: number };

const CACHE_MS = 30_000;
const _g = globalThis as unknown as { __or_prices?: Cached };

async function fetchLive(): Promise<{ items: PriceItem[]; source: string }> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true",
    { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) }
  );
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const data = (await res.json()) as Record<string, { usd: number; usd_24h_change: number }>;
  return {
    items: [
      { symbol: "BTC", name: "Bitcoin",  priceUsd: data.bitcoin?.usd ?? 0,  change24h: data.bitcoin?.usd_24h_change ?? 0 },
      { symbol: "ETH", name: "Ethereum", priceUsd: data.ethereum?.usd ?? 0, change24h: data.ethereum?.usd_24h_change ?? 0 },
      { symbol: "SOL", name: "Solana",   priceUsd: data.solana?.usd ?? 0,   change24h: data.solana?.usd_24h_change ?? 0 }
    ],
    source: "coingecko"
  };
}

export async function GET() {
  const now = Date.now();
  if (_g.__or_prices && now - _g.__or_prices.at < CACHE_MS) {
    return NextResponse.json(_g.__or_prices.body);
  }
  try {
    const body = await fetchLive();
    _g.__or_prices = { at: now, body };
    return NextResponse.json(body);
  } catch (err) {
    // Serve stale cache if we have any; otherwise a zeroed shape.
    if (_g.__or_prices) return NextResponse.json({ ..._g.__or_prices.body, source: "stale" });
    return NextResponse.json({
      items: [
        { symbol: "BTC", name: "Bitcoin",  priceUsd: 0, change24h: 0 },
        { symbol: "ETH", name: "Ethereum", priceUsd: 0, change24h: 0 },
        { symbol: "SOL", name: "Solana",   priceUsd: 0, change24h: 0 }
      ],
      source: "unavailable",
      error: err instanceof Error ? err.message : "price fetch failed"
    });
  }
}
