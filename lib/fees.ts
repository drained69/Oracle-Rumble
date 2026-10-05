/**
 * Fees.
 *
 * - Host fee: whoever opens an arena may take 0–5% of its prize pool (the
 *   entries). It is paid to the host's own seat at settlement, on top of any
 *   prize, and comes off the pool before the prize split. Cancelled arenas
 *   pay no host fee — every seat is refunded in full.
 * - Platform fee: 0.1% of every claim from a settled arena, taken by the
 *   escrow program when the player withdraws (v2 vaults). Refunds of a
 *   cancelled arena and on-chain recoveries are fee-free.
 */

/** Host fee choices (% of the prize pool). */
export const HOST_FEE_OPTIONS = [0, 1, 2, 3, 4, 5] as const;
export const MAX_HOST_FEE_PCT = 5;

/** Platform fee on claims, in basis points (10 = 0.1%). */
export const PLATFORM_CLAIM_FEE_BPS = 10;

export function normalizeHostFeePct(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_HOST_FEE_PCT, n)) : 0;
}

/** The host's cut of a pool, in micro-USDC precision (floored). */
export function hostFeeOf(poolUsdc: number, pct: number | undefined): number {
  const p = normalizeHostFeePct(pct ?? 0);
  return Math.floor(Math.max(0, poolUsdc) * 1e6 * p / 100) / 1e6;
}

/** The platform fee the escrow takes from a claim of `amountUsdc` (as the program computes it). */
export function claimFeeOf(amountUsdc: number, bps: number): number {
  const units = Math.round(Math.max(0, amountUsdc) * 1e6);
  return Math.floor((units * Math.max(0, bps)) / 10_000) / 1e6;
}

/** What actually reaches the player's wallet from a claim. */
export function netOfClaimFee(amountUsdc: number, bps: number): number {
  return Math.round((amountUsdc - claimFeeOf(amountUsdc, bps)) * 1e6) / 1e6;
}
