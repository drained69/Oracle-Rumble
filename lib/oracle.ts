/**
 * Price oracle for the BTC / ETH / SOL direction rounds.
 *
 * A round's market is "Will <asset> be up …?". It opens at the asset's spot
 * price when enrollment locks and resolves on the real move: UP (YES) pays
 * $1 a share if the price at the deadline is above the open, DOWN (NO) pays
 * $1 if it's below, and a dead-flat close pays 50¢ both ways.
 *
 * While the round is live the UP price is the probability of finishing
 * above the open given the move so far and the time left — a driftless
 * log-normal estimate — so positions mark to market as the asset moves.
 *
 * Sources: Coinbase Exchange public ticker, Kraken public ticker as backup.
 * No keys needed. Server-only (never imported by client components).
 */

import { ASSET_SYMBOLS, type AssetSymbol } from "@/lib/assets";

export type Spots = Partial<Record<AssetSymbol, number>>;

const CACHE_MS = 2_000;
/** A cached price older than this is not used at all. */
const STALE_MS = 60_000;
const FETCH_TIMEOUT_MS = 2_500;

const KRAKEN_PAIR: Record<AssetSymbol, string> = { BTC: "XBTUSD", ETH: "ETHUSD", SOL: "SOLUSD" };

/** Annualised volatility used to turn a move into an UP probability. */
const ANNUAL_VOL: Record<AssetSymbol, number> = { BTC: 0.55, ETH: 0.7, SOL: 0.9 };
const SECONDS_PER_YEAR = 365 * 24 * 3600;

const _g = globalThis as unknown as { __or_spots?: { at: number; spots: Spots } };

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const positive = (n: unknown): number | null => {
  const v = typeof n === "string" ? parseFloat(n) : typeof n === "number" ? n : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
};

async function fromCoinbase(): Promise<Spots> {
  const out: Spots = {};
  await Promise.all(ASSET_SYMBOLS.map(async (sym) => {
    try {
      const d = (await getJson(`https://api.exchange.coinbase.com/products/${sym}-USD/ticker`)) as { price?: string };
      const p = positive(d.price);
      if (p) out[sym] = p;
    } catch { /* try the backup */ }
  }));
  return out;
}

async function fromKraken(missing: AssetSymbol[]): Promise<Spots> {
  const out: Spots = {};
  if (missing.length === 0) return out;
  try {
    const d = (await getJson(`https://api.kraken.com/0/public/Ticker?pair=${missing.map((s) => KRAKEN_PAIR[s]).join(",")}`)) as {
      result?: Record<string, { c?: string[] }>;
    };
    const rows = Object.entries(d.result ?? {});
    for (const sym of missing) {
      // Kraken returns canonical keys (XXBTZUSD, XETHZUSD, SOLUSD).
      const want = sym === "BTC" ? "XBT" : sym;
      const row = rows.find(([k]) => k.includes(want) && k.endsWith("USD"));
      const p = positive(row?.[1].c?.[0]);
      if (p) out[sym] = p;
    }
  } catch { /* nothing more to try */ }
  return out;
}

/** Latest spot price per asset (USD). Cached for a couple of seconds. */
export async function spotPrices(): Promise<Spots> {
  const now = Date.now();
  const cached = _g.__or_spots;
  if (cached && now - cached.at < CACHE_MS) return cached.spots;

  const spots = await fromCoinbase();
  const missing = ASSET_SYMBOLS.filter((s) => !spots[s]);
  Object.assign(spots, await fromKraken(missing));

  if (Object.keys(spots).length > 0) {
    // Keep a still-fresh cached price for any asset that failed this time.
    if (cached && now - cached.at < STALE_MS) {
      for (const s of ASSET_SYMBOLS) if (!spots[s] && cached.spots[s]) spots[s] = cached.spots[s];
    }
    _g.__or_spots = { at: now, spots };
    return spots;
  }
  return cached && now - cached.at < STALE_MS ? cached.spots : {};
}

/** Two exchanges further apart than this (fraction) means a fast move is still landing. */
const DIVERGENCE = 0.0015;

/**
 * Uncached quotes for `assets`, taken at trade time from Coinbase and Kraken
 * in parallel. `spots` uses Coinbase (Kraken if Coinbase failed);
 * `divergent` lists assets whose two quotes disagree by more than 0.15% —
 * one venue hasn't caught up with a move yet, so the price isn't settled.
 */
export async function freshSpots(assets: AssetSymbol[]): Promise<{ spots: Spots; divergent: AssetSymbol[] }> {
  const want = [...new Set(assets)];
  const [cb, kr] = await Promise.all([
    Promise.all(want.map(async (sym) => {
      try {
        const d = (await getJson(`https://api.exchange.coinbase.com/products/${sym}-USD/ticker`)) as { price?: string };
        return [sym, positive(d.price)] as const;
      } catch { return [sym, null] as const; }
    })),
    fromKraken(want)
  ]);
  const spots: Spots = {};
  const divergent: AssetSymbol[] = [];
  for (const [sym, c] of cb) {
    const k = kr[sym];
    const p = c ?? k;
    if (p) spots[sym] = p;
    if (c && k && Math.abs(c - k) / c > DIVERGENCE) divergent.push(sym);
  }
  // Refresh the shared cache with what we just saw.
  const cached = _g.__or_spots;
  if (Object.keys(spots).length) _g.__or_spots = { at: Date.now(), spots: { ...(cached?.spots ?? {}), ...spots } };
  return { spots, divergent };
}

/**
 * Price at a past moment, from Coinbase 1-minute candles (the close of the
 * last full minute before `atMs`). Used when a round's deadline passed with
 * nobody watching, so the close isn't taken late.
 */
export async function spotPricesAt(atMs: number): Promise<Spots> {
  const out: Spots = {};
  const minute = Math.floor(atMs / 60_000) * 60;
  const start = new Date((minute - 180) * 1000).toISOString();
  const end = new Date((minute + 60) * 1000).toISOString();
  await Promise.all(ASSET_SYMBOLS.map(async (sym) => {
    try {
      const rows = (await getJson(
        `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=60&start=${start}&end=${end}`
      )) as Array<[number, number, number, number, number, number]>;
      // [time, low, high, open, close, volume], newest first.
      const candle = rows.filter((r) => r[0] + 60 <= atMs / 1000).sort((a, b) => b[0] - a[0])[0];
      const p = positive(candle?.[4]);
      if (p) out[sym] = p;
    } catch { /* leave missing */ }
  }));
  return out;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152073) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * UP price in cents: the chance `asset` finishes above `open` given it is at
 * `spot` with `secondsLeft` to go. 50 before the round opens.
 */
export function upCents(asset: AssetSymbol, open: number | undefined, spot: number | undefined, secondsLeft: number): number {
  if (!open || !spot) return 50;
  const move = Math.log(spot / open);
  if (secondsLeft <= 0) return move > 0 ? 98 : move < 0 ? 2 : 50;
  const sigma = ANNUAL_VOL[asset] * Math.sqrt(secondsLeft / SECONDS_PER_YEAR);
  const p = normCdf(move / sigma);
  return Math.max(2, Math.min(98, Math.round(p * 100)));
}

/** Final UP value in cents: 100 if it closed above the open, 0 below, 50 flat or unknown. */
export function resolvedCents(open: number | undefined, close: number | undefined): number {
  if (!open || !close) return 50;
  return close > open ? 100 : close < open ? 0 : 50;
}
