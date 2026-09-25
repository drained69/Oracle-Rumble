/** Browser helpers for the Market Royale round API. */

import type { Entrant, Round } from "@/lib/royale";

export type RoundView = {
  round: Round | null;
  yesPrice: number;
  cutLine: number;
  standings: Entrant[];
  persisted?: boolean;
  error?: string;
};

export async function getRound(): Promise<RoundView> {
  const res = await fetch("/api/round", { cache: "no-store" });
  return res.json();
}

export async function enrollRound(wallet: string, nickname: string): Promise<{ round?: Round; entrantId?: string; error?: string }> {
  const res = await fetch("/api/round/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, nickname })
  });
  return res.json();
}

export async function tradeRound(args: { wallet: string; action: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number }): Promise<{ round?: Round; entrant?: Entrant; yesPrice?: number; standings?: Entrant[]; error?: string }> {
  const res = await fetch("/api/round/trade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args)
  });
  return res.json();
}

export async function newRound(): Promise<RoundView> {
  const res = await fetch("/api/round", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "new" })
  });
  return res.json();
}
