import type { MarketPhase } from "@/lib/panta";

export type Market = {
  id: string;                 // Panta market pubkey (base58) in mock demo we use faux keys
  question: string;
  category: string;
  yesPrice: number;
  change: number;
  volume: string;
  closes: string;
  phase: MarketPhase;
  outcome?: "YES" | "NO" | null;
  /**
   * Markets that resolve to mutually exclusive outcomes share a
   * `correlationGroup`. A parlay may include at most one leg per group,
   * matching parlayit's correlation blocks.
   */
  correlationGroup?: string;
};

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
  signature?: string;         // Panta on-chain trade signature (mock in demo)
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

// Solana-style faux pubkeys for mock markets so the UI can be honest about
// what a "Panta market id" looks like when the real API isn't wired up.
export const arenas: Arena[] = [
  {
    id: "solana-signals",
    name: "Solana Signals",
    tagline: "Where the Solana community puts its conviction on-chain.",
    endsInMs: 62 * HOUR,
    markets: [
      { id: "SoL2XXjMkVsc1YSpjxLKMkVsc9pMBLqZbAyKzcRnxaAn", question: "Will SOL close above $200 by Friday?", category: "Crypto", yesPrice: 64, change: 7, volume: "$42.8k", closes: "Closes in 2d", phase: "active" },
      { id: "BtCAthMkAyLPcxNRnxaFKtHzYSpjxLKAtHnBLqAthMkV", question: "Will Bitcoin set a new all-time high this month?", category: "Crypto", yesPrice: 38, change: -3, volume: "$128.4k", closes: "Closes in 8d", phase: "active" },
      { id: "ShIp2WkPntGr8AthMkTgV1kAyKpNRnxaFKtHzYSpjxLK", question: "Will a top-10 Solana project ship a token this week?", category: "Ecosystem", yesPrice: 71, change: 12, volume: "$19.2k", closes: "Closes in 3d", phase: "active" },
      { id: "St6bLcNRnxaFKtHzYSpjxLK15BQnPntGr8AthMkTgV1k", question: "Will Solana stablecoin supply exceed $15B this quarter?", category: "On-chain", yesPrice: 53, change: 2, volume: "$67.5k", closes: "Closes in 21d", phase: "active" },
      { id: "TvL12BQnPntGr8AthMkTgV1kSpjxLKMkVsc9pMBLqAy2", question: "Will Solana DeFi TVL cross $12B this month?", category: "On-chain", yesPrice: 46, change: -1, volume: "$31.1k", closes: "Closes in 12d", phase: "active" }
    ]
  },
  {
    id: "fight-night",
    name: "Fight Night",
    tagline: "Combat sports, one round at a time. Call the fight before the bell.",
    endsInMs: 8 * HOUR,
    markets: [
      { id: "FnKoAthMkTgV1kAyKpNRnxaFKtHzYSpjxLK15BQnPnt", question: "Will the main event end by knockout?", category: "Sports", yesPrice: 42, change: 4, volume: "$88.7k", closes: "Closes at bell", phase: "active", correlationGroup: "fn-main-outcome" },
      { id: "FnDcNRnxaFKtHzYSpjxLK15BQnPntGr8AthMkTgV1kA", question: "Will the main event go to a decision?", category: "Sports", yesPrice: 33, change: -2, volume: "$54.2k", closes: "Closes at bell", phase: "active", correlationGroup: "fn-main-outcome" },
      { id: "FnR1BQnPntGr8AthMkTgV1kAyKpNRnxaFKtHzYSpjxL", question: "Will there be a first-round finish on the card?", category: "Sports", yesPrice: 58, change: 6, volume: "$21.6k", closes: "Closes at prelims", phase: "active" },
      { id: "FnUp5etAthMkTgV1kAyKpNRnxaFKtHzYSpjxLK15BQn", question: "Will an underdog (+200 or greater) win tonight?", category: "Sports", yesPrice: 47, change: 3, volume: "$16.4k", closes: "Closes at main", phase: "active" }
    ]
  },
  {
    id: "shipmas",
    name: "Shipmas",
    tagline: "Twelve days of launches. Which products actually ship?",
    endsInMs: 5 * 24 * HOUR,
    markets: [
      { id: "SmVrCe1BQnPntGr8AthMkTgV1kAyKpNRnxaFKtHzYSp", question: "Will Vercel ship a new AI product this week?", category: "Tech", yesPrice: 61, change: 5, volume: "$12.3k", closes: "Closes in 5d", phase: "active" },
      { id: "SmAppLeAthMkTgV1kAyKpNRnxaFKtHzYSpjxLK15BQn", question: "Will Apple announce a new hardware SKU this month?", category: "Tech", yesPrice: 29, change: -4, volume: "$47.9k", closes: "Closes in 14d", phase: "active" },
      { id: "SmOpNaIBQnPntGr8AthMkTgV1kAyKpNRnxaFKtHzYSp", question: "Will OpenAI release a new model family this quarter?", category: "AI", yesPrice: 74, change: 8, volume: "$96.1k", closes: "Closes in 60d", phase: "active" },
      { id: "SmAnThRpBQnPntGr8AthMkTgV1kAyKpNRnxaFKtHzYS", question: "Will Anthropic ship a Claude update in the next 14 days?", category: "AI", yesPrice: 68, change: 3, volume: "$41.5k", closes: "Closes in 14d", phase: "active" }
    ]
  }
];

export const players: Player[] = [
  { rank: 1, name: "Mira Vale", initials: "MV", returnPct: 28.4, accuracy: 83, markets: 6, color: "violet" },
  { rank: 2, name: "dune", initials: "DU", returnPct: 21.7, accuracy: 78, markets: 7, color: "cyan" },
  { rank: 3, name: "Theo L.", initials: "TL", returnPct: 18.2, accuracy: 75, markets: 4, color: "orange" },
  { rank: 4, name: "onchain.aya", initials: "OA", returnPct: 12.9, accuracy: 71, markets: 8, color: "pink" },
  { rank: 5, name: "witness", initials: "WI", returnPct: 8.4, accuracy: 67, markets: 5, color: "lime" }
];

// Back-compat for any consumer still importing the flat list.
export const markets: Market[] = arenas[0].markets;

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
