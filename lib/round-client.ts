/** Browser helpers for the Market Royale round API — every call is arena-scoped. */

import type { Entrant, Round, RoundConfig } from "@/lib/royale";

/** Host-tunable fields of a rumble (the rest are fixed by the arena). */
export type HostConfig = Partial<Pick<RoundConfig,
  "asset" | "format" | "entryUsdc" | "startingBankroll" | "capacity" | "roundLimit" | "host"
>>;

export type RoundView = {
  round: Round | null;
  arena?: string;
  yesPrice: number;
  cutLine: number;
  standings: Entrant[];
  persisted?: boolean;
  error?: string;
};

export async function getRound(arena?: string): Promise<RoundView> {
  const qs = arena ? `?arena=${encodeURIComponent(arena)}` : "";
  const res = await fetch(`/api/round${qs}`, { cache: "no-store" });
  return res.json();
}

export async function enrollRound(wallet: string, nickname: string, arena?: string): Promise<{ round?: Round; arena?: string; entrantId?: string; error?: string }> {
  const res = await fetch("/api/round/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, nickname, arena })
  });
  return res.json();
}

export async function tradeRound(args: { wallet: string; action: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number; arena?: string }): Promise<{ round?: Round; entrant?: Entrant; yesPrice?: number; standings?: Entrant[]; error?: string }> {
  const res = await fetch("/api/round/trade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args)
  });
  return res.json();
}

export type ParlayLegInput = { marketId: string; side: "YES" | "NO" };

/** Place a native parlay from the vault into the live round. */
export async function placeParlayApi(wallet: string, legs: ParlayLegInput[], stakeUsdc: number, arena?: string): Promise<{ round?: Round; entrant?: Entrant; error?: string }> {
  const res = await fetch("/api/round/parlay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, legs, stakeUsdc, arena })
  });
  return res.json();
}

/**
 * Host a rumble. Every call MINTS A NEW ARENA CODE and returns the shareable
 * `inviteSlug` (e.g. `/a/A7XB2M`) which the client shares with friends.
 */
export async function newRound(config?: HostConfig): Promise<RoundView & { error?: string; inviteSlug?: string; arena?: string }> {
  const res = await fetch("/api/round", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "new", config })
  });
  return res.json();
}
