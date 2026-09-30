/**
 * Probability that several UP/DOWN legs all land, when the legs' assets move
 * together. BTC, ETH and SOL are strongly correlated over a few minutes, so
 * "BTC UP + ETH UP" is far likelier than 50% × 50%, and "BTC UP + ETH DOWN"
 * far less likely. Multiplying leg prices (treating legs as independent)
 * misprices both.
 *
 * Model (Gaussian copula): each asset's remaining move is a standard normal;
 * the three are correlated as below. A leg with probability p lands when its
 * signed move clears the threshold Φ⁻¹(p), so its own price is unchanged —
 * only the joint probability accounts for correlation. Computed by numerical
 * integration: exact enough for 2 or 3 legs (one per asset). Pure, shared by
 * client and server.
 */

import { assetOfMarketId, type AssetSymbol } from "@/lib/assets";

/** Correlation of short-horizon moves between the assets. */
const CORRELATION: Record<string, number> = { "BTC|ETH": 0.85, "BTC|SOL": 0.8, "ETH|SOL": 0.8 };

function corr(a: AssetSymbol | null, b: AssetSymbol | null): number {
  if (!a || !b) return 0;
  if (a === b) return 0.99;
  return CORRELATION[[a, b].sort().join("|")] ?? 0;
}

/** Standard normal density and CDF (A&S 26.2.17, |error| < 7.5e-8). */
const phi = (x: number) => 0.3989422804014327 * Math.exp(-x * x / 2);
function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = phi(x) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam, relative error < 1.2e-9). */
function inv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -inv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** ∫_{-8}^{h} φ(x) g(x) dx by Simpson's rule. */
function integrate(h: number, g: (x: number) => number, steps = 200): number {
  const lo = -8;
  if (h <= lo) return 0;
  const n = steps % 2 ? steps + 1 : steps;
  const w = (h - lo) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const x = lo + i * w;
    s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * phi(x) * g(x);
  }
  return (s * w) / 3;
}

/** P(X < h, Y < k) for standard normals with correlation r. */
function bivariate(h: number, k: number, r: number, steps = 200): number {
  if (Math.abs(r) < 1e-9) return cdf(h) * cdf(k);
  const s = Math.sqrt(1 - r * r);
  return integrate(h, (x) => cdf((k - r * x) / s), steps);
}

/** P(X1 < d1, X2 < d2, X3 < d3) for standard normals with correlations r12, r13, r23. */
function trivariate(d1: number, d2: number, d3: number, r12: number, r13: number, r23: number): number {
  const s2 = Math.sqrt(1 - r12 * r12), s3 = Math.sqrt(1 - r13 * r13);
  const r23c = (r23 - r12 * r13) / (s2 * s3); // correlation of X2, X3 given X1
  return integrate(d1, (x) => bivariate((d2 - r12 * x) / s2, (d3 - r13 * x) / s3, Math.max(-0.999, Math.min(0.999, r23c)), 80), 120);
}

export type JointLeg = { marketId: string; side: "YES" | "NO"; /** probability of this leg's side, 0..1 */ prob: number };

/** Probability that every leg lands. */
export function jointProbability(legs: JointLeg[]): number {
  const ps = legs.map((l) => Math.max(0.01, Math.min(0.99, l.prob)));
  if (legs.length === 0) return 0;
  if (legs.length === 1) return ps[0];
  const assets = legs.map((l) => assetOfMarketId(l.marketId));
  const sign = legs.map((l) => (l.side === "YES" ? 1 : -1));
  const d = ps.map(inv);
  const r = (i: number, j: number) => sign[i] * sign[j] * corr(assets[i], assets[j]);
  let p: number;
  if (legs.length === 2) p = bivariate(d[0], d[1], r(0, 1));
  else if (legs.length === 3) p = trivariate(d[0], d[1], d[2], r(0, 1), r(0, 2), r(1, 2));
  else p = ps.reduce((a, b) => a * b, 1); // more than one leg per asset can't happen (correlation block)
  // Never above the least likely leg, never below zero.
  return Math.max(0.0001, Math.min(Math.min(...ps), p));
}
