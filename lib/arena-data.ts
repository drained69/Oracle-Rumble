import type { MarketPhase } from "@/lib/panta";
import {
  ASSETS,
  HORIZONS,
  directionGroup,
  directionMarketId,
  getAsset,
  type AssetSymbol,
  type Horizon
} from "@/lib/assets";

export type Market = {
  id: string;                 // Panta market pubkey (base58), or our dir-<asset>-<horizon> id
  question: string;
  category: string;
  asset: AssetSymbol;         // which of the three the market calls
  horizon: Horizon;
  yesPrice: number;           // cents, YES = "up"
  change: number;
  volume: string;
  closes: string;
  phase: MarketPhase;
  outcome?: "YES" | "NO" | null;
  /**
   * Markets that resolve to mutually exclusive outcomes share a
   * `correlationGroup`. A parlay may include at most one leg per group,
   * matching parlayit's correlation blocks. Here the two horizons of a single
   * asset share a group so you can't stack BTC-hour-up with BTC-day-up.
   */
  correlationGroup?: string;
};

// Player = a rumbler on the leaderboard. Kept as a type so the UI can
// render a "your record" row when a wallet is connected. Panta doesn't
// expose a global leaderboard endpoint yet, so we render only the
// connected wallet's own on-chain stats — no fabricated peers.
export type Player = {
  rank: number;
  name: string;
  initials: string;
  returnPct: number;
  accuracy: number;
  markets: number;
  color: string;
};

export type Arena = {
  id: string;
  name: string;
  tagline: string;
  endsInMs: number;
  markets: Market[];
};

export type Position = {
  id: string;
  arenaId: string;
  marketId: string;
  question: string;
  side: "YES" | "NO";
  entryPrice: number;
  shares: number;
  cost: number;
  ts: number;
  signature?: string;         // Panta on-chain trade signature
  quoteId?: string;
};

export type StoredParlay = {
  id: string;
  arenaId: string;
  ts: number;
  legs: { marketId: string; question: string; side: "YES" | "NO"; price: number }[];
  combinedPrice: number;
  stake: number;
  fee: number;
  shares: number;
  potentialPayout: number;
  signature?: string;
};

const HOUR = 3_600_000;

// Deterministic starter prices so the board is stable across a fresh boot in
// mock mode. Real prices come from Panta / the price oracle when live.
const SEED_YES: Record<string, number> = {
  "dir-btc-hour": 55, "dir-btc-day": 58,
  "dir-eth-hour": 52, "dir-eth-day": 54,
  "dir-sol-hour": 60, "dir-sol-day": 57
};
const SEED_CHANGE: Record<string, number> = {
  "dir-btc-hour": 3, "dir-btc-day": 5,
  "dir-eth-hour": -1, "dir-eth-day": 2,
  "dir-sol-hour": 6, "dir-sol-day": 4
};
const SEED_VOL: Record<string, string> = {
  "dir-btc-hour": "$182.4k", "dir-btc-day": "$310.7k",
  "dir-eth-hour": "$96.1k", "dir-eth-day": "$141.2k",
  "dir-sol-hour": "$74.8k", "dir-sol-day": "$118.9k"
};

function buildDirectionMarket(symbol: AssetSymbol, horizon: Horizon): Market {
  const asset = getAsset(symbol)!;
  const hz = HORIZONS.find((h) => h.id === horizon)!;
  const id = directionMarketId(symbol, horizon);
  return {
    id,
    question: `Will ${asset.name} be up ${hz.label}?`,
    category: "crypto",
    asset: symbol,
    horizon,
    yesPrice: SEED_YES[id] ?? 50,
    change: SEED_CHANGE[id] ?? 0,
    volume: SEED_VOL[id] ?? "$0",
    closes: hz.closes,
    phase: "active",
    correlationGroup: directionGroup(symbol)
  };
}

// The whole board is the three-asset direction set. Every leg you can parlay,
// and every market a round can run on, lives here.
const directionMarkets: Market[] = ASSETS.flatMap((a) =>
  HORIZONS.map((h) => buildDirectionMarket(a.symbol, h.id))
);

export const arenas: Arena[] = [
  {
    id: "oracle-rumble",
    name: "Oracle Rumble",
    tagline: "Call BTC, ETH and SOL. Build the parlay. Outlast the cut.",
    endsInMs: 24 * HOUR,
    markets: directionMarkets
  }
];

// No seeded players — the leaderboard renders your own on-chain record
// from Panta, not fabricated peers. Left as an empty array so any stray
// import stays type-safe until it's removed.
export const players: Player[] = [];

// Back-compat for any consumer still importing the flat list.
export const markets: Market[] = directionMarkets;

/**
 * Every arena market id, so mock server routes can look up mock data by id.
 */
export function findMockMarket(id: string): { arena: Arena; market: Market } | null {
  for (const a of arenas) {
    const m = a.markets.find((x) => x.id === id);
    if (m) return { arena: a, market: m };
  }
  return null;
}
