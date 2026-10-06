/** Shape of GET /api/portfolio — a wallet's arenas, positions and claims. */

import type { RoundFormat, RoundStatus, Side } from "@/lib/royale";

export type PortfolioAction =
  | "claim"     // settled: withdraw remaining vault + prize (or a refund)
  | "recover"   // never settled and the recovery deadline passed
  | "settling"  // finished; settlement on chain still in progress
  | "claimed"   // already withdrawn
  | "none";     // nothing to do (live, practice, or nothing left)

export type PortfolioItem = {
  /** Arena code, or "" for a deposit whose arena the server no longer knows. */
  arena: string;
  status: RoundStatus | "unknown";
  question: string;
  asset: string;
  /** A pit on a Panta market: sides read YES/NO (crypto pits read UP/DOWN). */
  pantaPit?: boolean;
  format: RoundFormat;
  roundNumber: number;
  roundLimit: number;
  createdAt: number;
  endedAt: number;
  /** Enrollment or trading deadline (ms), 0 when none is running. */
  deadline: number;
  /** Ledger-only practice arena — no USDC involved. */
  practice: boolean;
  me: null | {
    nickname: string;
    startingVault: number;
    /** Vault value now: cash + open position, at live prices. */
    vault: number;
    cash: number;
    side: Side | null;
    shares: number;
    avgPrice: number;        // cents
    markPrice: number | null; // cents, current price of the side held
    openingCall: Side | null; // only returned to the wallet itself
    openingCallPct: number | null; // % of the vault the call uses
    /** Place among players still in (live) or overall finishing place (done). */
    place: number | null;
    players: number;
    /** How many survive this round's cut (live royale / single final). */
    survivors: number;
    eliminatedRound: number | null;
    prizeUsdc: number;
    /** Host fee this wallet earned for hosting the arena (USDC). */
    hostFeeUsdc: number;
    /** Predictions: right answers so far (live) or final; null in other formats. */
    score: number | null;
    /** Predictions: how many questions the round has. */
    questions: number;
    /** Predictions: how many picks this wallet has made (own wallet only). */
    picksMade: number | null;
    /** Predictions, live: would this score be paid if the round ended now? */
    inMoney: boolean | null;
    /** Streak: current leg and whether this player is still in. */
    streak: null | { leg: number; maxLegs: number; alive: boolean; picked: boolean };
  };
  chain: null | {
    roundVault: string;
    seatUsdc: number;
    entitlementUsdc: number;
    settled: boolean;
    claimed: boolean;
    claimsOpen: boolean;
    recoverAt: number | null; // ms
    /** Platform fee on a claim from this vault (basis points; 0 = none). */
    claimFeeBps: number;
  };
  action: PortfolioAction;
  /** USDC the action pays out (claim / recover). */
  actionUsdc: number;
};

export type Portfolio = {
  wallet: string;
  items: PortfolioItem[];
  summary: {
    active: number;        // arenas enrolling or live
    inPlayUsdc: number;    // vault value across active on-chain arenas
    claimableUsdc: number; // withdrawable right now
    prizesUsdc: number;    // prizes won, all time
  };
  error?: string;
};
