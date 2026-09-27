/**
 * Parlay engine — the technical mechanics borrow from parlayit.gg.
 *
 * Ideas taken from parlayit and rebuilt here:
 *
 *   ▸ Native parlays          — a parlay is not a smart-contract product on
 *                               the market layer, it's a client-space bundle
 *                               of N linked single orders sharing a parlayId.
 *   ▸ 2 ≤ legs ≤ 5            — hard bounds on parlay size.
 *   ▸ Correlation blocks      — reject a candidate leg if it duplicates an
 *                               existing market OR shares a `correlationGroup`
 *                               with an existing leg (mutually exclusive
 *                               outcomes: KO vs Decision, up vs down, etc.).
 *   ▸ Variance-based fee      — per-leg fee is `C × feeRate × p(1-p) × 4`,
 *                               scaled so a coinflip leg costs the full rate
 *                               and a 95¢ conviction leg costs almost nothing.
 *                               Aggregate fee is capped at `PARLAY_FEE_CAP`.
 *   ▸ 50/50 fallback          — if a leg is voided at resolution it pays 0.5×,
 *                               so the parlay's payout is multiplied by 0.5
 *                               per voided leg. `quoteParlay` returns the
 *                               worst-case (one leg voided) payout so the UI
 *                               can show downside without guessing.
 *   ▸ Quote-based liquidity   — the parlay price is computed on demand from
 *                               live single-market prices; there is no
 *                               pre-listed parlay market.
 *
 * The math here is the source of truth. The server `/api/parlay/quote`
 * route imports `quoteParlay` and `validateAddLeg` directly, so the client
 * and server never disagree on price or correlation rules.
 */

export const PARLAY_MIN_LEGS = 2;
export const PARLAY_MAX_LEGS = 5;

/** Base fee rate at maximum variance (p = 0.5). */
export const PARLAY_FEE_RATE = 0.05;
/** Aggregate parlay fee is never more than this share of the stake. */
export const PARLAY_FEE_CAP = 0.05;

/**
 * Cash-out edge — parlayit charges an early-exit fee on top of the fair
 * mid-price so a rapid quote → cashout can't be arb'd for a free penny.
 * Held small so the tool stays useful.
 */
export const CASHOUT_FEE_RATE = 0.02;
/** Cap on the cashout fee in USDC — matters at high stakes. */
export const CASHOUT_FEE_CAP_USDC = 1.5;

export type ParlayLeg = {
  marketId: string;
  question: string;
  side: "YES" | "NO";
  price: number;              // cents, 0..100
  correlationGroup?: string;
};

export type ParlayQuote = {
  legs: ParlayLeg[];
  combinedPrice: number;                 // cents
  impliedOdds: number;                   // decimal (1 / prob)
  stakeUsdc: number;
  legFees: number[];                     // per-leg fee, variance-based
  feeUsdc: number;                       // sum of legFees, capped
  netStakeUsdc: number;
  shares: number;
  potentialPayoutUsdc: number;           // every leg wins outright
  halfPayoutIfOneVoidUsdc: number;       // one leg voids to 50/50
  validUntil: string;                    // ISO expiry, quote is short-lived
};

export type ParlayValidation = { ok: true } | { ok: false; reason: string };

/** Would adding `candidate` to `legs` be legal? Enforces size + correlation. */
export function validateAddLeg(legs: ParlayLeg[], candidate: ParlayLeg): ParlayValidation {
  const existing = legs.find((l) => l.marketId === candidate.marketId);
  if (!existing && legs.length >= PARLAY_MAX_LEGS) {
    return { ok: false, reason: `Parlays cap at ${PARLAY_MAX_LEGS} legs.` };
  }
  if (candidate.correlationGroup) {
    const conflict = legs.find(
      (l) => l.marketId !== candidate.marketId && l.correlationGroup === candidate.correlationGroup
    );
    if (conflict) {
      return { ok: false, reason: `Correlated with "${conflict.question}" — parlayit-style correlation block.` };
    }
  }
  return { ok: true };
}

/** Full parlay validation for a placement attempt. */
export function validateParlay(legs: ParlayLeg[]): ParlayValidation {
  if (legs.length < PARLAY_MIN_LEGS) return { ok: false, reason: `A parlay needs at least ${PARLAY_MIN_LEGS} legs.` };
  if (legs.length > PARLAY_MAX_LEGS) return { ok: false, reason: `Parlays cap at ${PARLAY_MAX_LEGS} legs.` };
  const seen = new Set<string>();
  const groups = new Set<string>();
  for (const l of legs) {
    if (seen.has(l.marketId)) return { ok: false, reason: `Duplicate market: ${l.marketId}` };
    seen.add(l.marketId);
    if (l.correlationGroup) {
      if (groups.has(l.correlationGroup)) {
        return { ok: false, reason: `Two legs correlated on "${l.correlationGroup}".` };
      }
      groups.add(l.correlationGroup);
    }
  }
  return { ok: true };
}

/**
 * Variance-based per-leg fee. Normalized so p = 0.5 peaks at exactly
 * `PARLAY_FEE_RATE × stake`, and p = 0 or p = 1 pays zero fee.
 *
 *     legFee = stake × rate × 4 × p × (1 - p)
 *
 * The ×4 brings the peak (at p = 0.5, where p(1-p) = 0.25) back to `rate`.
 */
function legFee(stake: number, priceCents: number): number {
  const p = Math.max(0.01, Math.min(0.99, priceCents / 100));
  return stake * PARLAY_FEE_RATE * 4 * p * (1 - p);
}

/**
 * Compute a parlay quote from live leg prices. Pure — same inputs yield
 * the same outputs on client and server.
 */
export function quoteParlay(legs: ParlayLeg[], stakeUsdc: number, ttlMs = 15_000): ParlayQuote {
  const safeStake = Math.max(0, Number.isFinite(stakeUsdc) ? stakeUsdc : 0);
  const validUntil = new Date(Date.now() + ttlMs).toISOString();

  if (legs.length === 0) {
    return {
      legs, combinedPrice: 0, impliedOdds: 0, stakeUsdc: safeStake,
      legFees: [], feeUsdc: 0, netStakeUsdc: safeStake,
      shares: 0, potentialPayoutUsdc: 0, halfPayoutIfOneVoidUsdc: 0, validUntil
    };
  }

  const legFees = legs.map((l) => legFee(safeStake, l.price));
  const feeSum = legFees.reduce((s, x) => s + x, 0);
  const feeCap = safeStake * PARLAY_FEE_CAP;
  const feeUsdc = Math.min(feeSum, feeCap);
  const netStakeUsdc = Math.max(0, safeStake - feeUsdc);

  let prob = 1;
  for (const l of legs) prob *= Math.max(1, Math.min(99, l.price)) / 100;
  const combinedPrice = Math.max(0.01, prob * 100);

  const shares = netStakeUsdc / (combinedPrice / 100);
  const potentialPayoutUsdc = shares;                // every leg lands
  const halfPayoutIfOneVoidUsdc = shares * 0.5;      // 50/50 fallback on one leg

  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    legs,
    combinedPrice: r(combinedPrice),
    impliedOdds: r(100 / combinedPrice),
    stakeUsdc: safeStake,
    legFees: legFees.map(r),
    feeUsdc: r(feeUsdc),
    netStakeUsdc: r(netStakeUsdc),
    shares: Math.round(shares * 10) / 10,
    potentialPayoutUsdc: r(potentialPayoutUsdc),
    halfPayoutIfOneVoidUsdc: r(halfPayoutIfOneVoidUsdc),
    validUntil
  };
}

// ─── Cash-out math (parlayit design 7 — early exit / partial cash-out) ────

export type CashOutLegState = {
  marketId: string;
  question?: string;
  side: "YES" | "NO";
  entryPrice: number;        // cents at placement
  currentSidePrice: number;  // cents right now (live), on the leg's side
};

export type CashOutQuote = {
  legs: CashOutLegState[];
  shares: number;              // ticket.shares (payout units if all land)
  liveCombinedPrice: number;   // cents — product of current side probabilities × 100
  fairValueUsdc: number;       // shares × prob — mid-price
  cashoutFeeRate: number;
  cashoutFeeUsdc: number;
  netCashoutUsdc: number;      // fairValueUsdc - cashoutFeeUsdc
  originalStakeUsdc: number;
  pnlUsdc: number;             // netCashoutUsdc - originalStakeUsdc
  reason?: string;             // populated when cashout is refused
  eligible: boolean;
  validUntil: string;
};

/**
 * Price the early-exit cashout for an already-placed parlay ticket.
 *
 *   fair value = shares × Π(currentSideProb)
 *   cashout fee = min(fair × rate, cap)
 *   net = fair − cashout fee
 *
 * Same math on client and server. The route re-runs this inside the round
 * mutation lock using fresh prices, so the client quote is advisory only —
 * the server value wins.
 */
export function quoteCashOut(args: {
  ticketId: string;
  shares: number;
  originalStake: number;
  legs: Array<{ marketId: string; question?: string; side: "YES" | "NO"; entryPrice: number }>;
  currentYesPrices: Record<string, number>;  // marketId → yes cents (0..100)
  ttlMs?: number;
}): CashOutQuote {
  const ttlMs = args.ttlMs ?? 15_000;
  const validUntil = new Date(Date.now() + ttlMs).toISOString();
  const shares = Math.max(0, Number.isFinite(args.shares) ? args.shares : 0);
  const originalStake = Math.max(0, Number.isFinite(args.originalStake) ? args.originalStake : 0);

  if (args.legs.length === 0 || shares <= 0) {
    return {
      legs: [], shares, liveCombinedPrice: 0, fairValueUsdc: 0,
      cashoutFeeRate: CASHOUT_FEE_RATE, cashoutFeeUsdc: 0, netCashoutUsdc: 0,
      originalStakeUsdc: originalStake, pnlUsdc: -originalStake,
      eligible: false, reason: "no legs or zero shares",
      validUntil
    };
  }

  const legState: CashOutLegState[] = [];
  let prob = 1;
  let missing = 0;
  for (const leg of args.legs) {
    const yes = args.currentYesPrices[leg.marketId];
    if (yes === undefined || !Number.isFinite(yes)) {
      missing += 1;
      // Fall back to the leg's entry price when the current price is unknown
      // so the mark stays stable — same convention as parlayMarkValue.
      const sideNow = leg.side === "YES" ? leg.entryPrice : 100 - leg.entryPrice;
      const clamped = Math.max(1, Math.min(99, sideNow));
      prob *= clamped / 100;
      legState.push({ marketId: leg.marketId, question: leg.question, side: leg.side, entryPrice: leg.entryPrice, currentSidePrice: clamped });
      continue;
    }
    const sideNow = leg.side === "YES" ? yes : 100 - yes;
    const clamped = Math.max(1, Math.min(99, sideNow));
    prob *= clamped / 100;
    legState.push({ marketId: leg.marketId, question: leg.question, side: leg.side, entryPrice: leg.entryPrice, currentSidePrice: clamped });
  }

  const liveCombinedPrice = Math.max(0.01, prob * 100);
  const fairValueUsdc = shares * prob;
  const rawFee = fairValueUsdc * CASHOUT_FEE_RATE;
  const cashoutFeeUsdc = Math.min(rawFee, CASHOUT_FEE_CAP_USDC);
  const netCashoutUsdc = Math.max(0, fairValueUsdc - cashoutFeeUsdc);
  const pnlUsdc = netCashoutUsdc - originalStake;

  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    legs: legState,
    shares,
    liveCombinedPrice: r(liveCombinedPrice),
    fairValueUsdc: r(fairValueUsdc),
    cashoutFeeRate: CASHOUT_FEE_RATE,
    cashoutFeeUsdc: r(cashoutFeeUsdc),
    netCashoutUsdc: r(netCashoutUsdc),
    originalStakeUsdc: r(originalStake),
    pnlUsdc: r(pnlUsdc),
    eligible: netCashoutUsdc > 0 && missing < args.legs.length,
    reason: missing === args.legs.length ? "no live prices available" : undefined,
    validUntil
  };
}
