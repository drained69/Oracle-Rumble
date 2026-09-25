/**
 * The Oracle Rumble asset universe.
 *
 * The game is deliberately focused on three liquid, high-conviction assets —
 * BTC, ETH, SOL. Every round market and every parlay leg is a price-direction
 * call on one of these three. Keeping the universe small makes the parlays
 * legible (you always know the three names on the board) and mirrors Market
 * Royale's fast BTC/ETH-style up/down markets.
 *
 * This module is the single source of truth for the asset set. Market data,
 * the round keeper's market picker, and the seed script all resolve assets
 * from here so the three symbols can never drift apart across the codebase.
 */

export type AssetSymbol = "BTC" | "ETH" | "SOL";

export type Asset = {
  symbol: AssetSymbol;
  name: string;
  /** Brand accent used by the UI for this asset's legs / chips. */
  color: string;
  /** CoinGecko id — the price source of truth for direction resolution. */
  coingeckoId: string;
};

export const ASSETS: Asset[] = [
  { symbol: "BTC", name: "Bitcoin", color: "#f7931a", coingeckoId: "bitcoin" },
  { symbol: "ETH", name: "Ethereum", color: "#627eea", coingeckoId: "ethereum" },
  { symbol: "SOL", name: "Solana", color: "#14f195", coingeckoId: "solana" }
];

export const ASSET_SYMBOLS: AssetSymbol[] = ASSETS.map((a) => a.symbol);

const BY_SYMBOL = new Map<AssetSymbol, Asset>(ASSETS.map((a) => [a.symbol, a]));

export function getAsset(symbol: string): Asset | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase() as AssetSymbol);
}

/**
 * Two direction horizons per asset. UP and DOWN are the two sides of one
 * market (YES = up), so they never need a correlation group. But the HOUR and
 * DAY markets on the SAME asset are correlated (a daily-up call largely
 * subsumes an hourly-up call), so they share `dir-<asset>` and a parlay may
 * include at most one horizon per asset — this is where parlayit-style
 * correlation blocking earns its keep on a three-asset board.
 */
export type Horizon = "HOUR" | "DAY";

export const HORIZONS: { id: Horizon; label: string; closes: string }[] = [
  { id: "HOUR", label: "next hour", closes: "Closes in 1h" },
  { id: "DAY", label: "on the day", closes: "Closes at 00:00 UTC" }
];

/** Correlation group for an asset's direction markets. */
export function directionGroup(symbol: AssetSymbol): string {
  return `dir-${symbol.toLowerCase()}`;
}

/** Is a market id one of our BTC/ETH/SOL direction markets? */
export function assetOfMarketId(id: string): AssetSymbol | null {
  const m = /^dir-(btc|eth|sol)-/i.exec(id);
  return m ? (m[1].toUpperCase() as AssetSymbol) : null;
}

/** Stable, human-readable market id for an asset/horizon direction market. */
export function directionMarketId(symbol: AssetSymbol, horizon: Horizon): string {
  return `dir-${symbol.toLowerCase()}-${horizon.toLowerCase()}`;
}
