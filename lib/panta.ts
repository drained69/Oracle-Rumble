/**
 * Panta API client.
 *
 * Docs:  https://docs.panta.market/
 * Index: https://docs.panta.market/llms.txt
 *
 * The client speaks to `https://live-api.panta.market/api/v1` when the server
 * has a `PANTA_API_KEY` env var. Without a key, `PANTA_LIVE` is false and
 * every server route falls back to the deterministic mock data in
 * `lib/arena-data.ts`. This means:
 *
 *   - `npm run dev` on a fresh checkout still works end-to-end.
 *   - Adding a key in `.env.local` flips every route to real Panta with zero
 *     code changes; the client-side UI is unchanged because it only ever
 *     talks to our own `/api/*` proxy routes (the key never reaches the
 *     browser).
 *
 * Endpoint surface (subset — see llms.txt for the full list):
 *
 *   GET  /markets                     list w/ optional category / phase filter
 *   GET  /markets/{id}                single market catalog row
 *   GET  /markets/categories          allowlist of categories
 *   GET  /positions?wallet=<pk>       wallet holdings + claim eligibility
 *   POST /orders/quote                simulate fill + open a quote session
 *   POST /orders/build                build unsigned primary_order_usdc tx
 *   POST /orders/submit               register broadcast signature
 *   POST /claims/build                build unsigned claim_win_usdc tx
 *   POST /trades/report               attribute an on-chain trade
 */

const DEFAULT_BASE = "https://live-api.panta.market/api/v1";

export const PANTA_BASE = process.env.PANTA_API_BASE ?? DEFAULT_BASE;
export const PANTA_KEY = process.env.PANTA_API_KEY ?? "";
export const PANTA_LIVE = PANTA_KEY.length > 0;

// ------------------------------------------------------------------
// Types (best-effort — Panta's OpenAPI is authoritative, we shape our
// server responses to a stable client-facing schema so the UI is not
// coupled to Panta's exact wire format).
// ------------------------------------------------------------------

export type MarketPhase = "active" | "resolved" | "graduated" | "pending";

export type PantaMarket = {
  id: string;                 // Panta market address (Solana pubkey) or mock id
  question: string;
  category: string;
  yesPrice: number;           // cents, 0..100
  change: number;             // cents, 24h delta
  volume: string;             // human-readable USDC
  closes: string;             // human-readable countdown
  phase: MarketPhase;
  outcome?: "YES" | "NO" | null;
};

export type PantaCategory = { id: string; label: string };

export type QuoteRequest = {
  marketId: string;
  side: "YES" | "NO";
  usdcAmount: string;         // human-readable, e.g. "25.00"
  wallet?: string;            // Solana pubkey
  attributionKey?: string;    // Panta partner attribution key
};

export type QuoteResponse = {
  quoteId: string;
  marketId: string;
  side: "YES" | "NO";
  price: number;              // cents
  shares: number;
  usdcAmount: string;
  feeUsdc: string;
  networkFeeUsdc: string;
  expiresAt: string;          // ISO
  source: "panta" | "mock";
};

export type BuildRequest = { quoteId: string; wallet: string };
export type BuildResponse = {
  quoteId: string;
  serializedTx: string;       // base64 unsigned VersionedTransaction
  lastValidBlockHeight?: number;
  source: "panta" | "mock";
};

export type SubmitRequest = { quoteId: string; signature: string; wallet: string };
export type SubmitResponse = {
  signature: string;
  status: "submitted" | "confirmed" | "failed";
  source: "panta" | "mock";
};

export type PantaPosition = {
  marketId: string;
  question: string;
  side: "YES" | "NO";
  shares: number;
  entryPrice: number;         // cents
  markPrice: number;          // cents
  cost: string;               // human-readable USDC
  phase: MarketPhase;
  claimable: boolean;
  outcome?: "YES" | "NO" | null;
};

export type ClaimBuildRequest = { wallet: string; marketId: string };
export type ClaimBuildResponse = {
  serializedTx: string;
  amountUsdc: string;
  source: "panta" | "mock";
};

export type ReportRequest = {
  signature: string;
  wallet: string;
  marketId: string;
  attributionKey?: string;
};
export type ReportResponse = { status: "attributed" | "pending" | "failed"; source: "panta" | "mock" };

// ------------------------------------------------------------------
// Low-level fetch. Server-side only — never import from the browser.
// ------------------------------------------------------------------

export class PantaError extends Error {
  constructor(public status: number, public body: string) {
    super(`Panta ${status}: ${body.slice(0, 200)}`);
  }
}

export async function pantaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!PANTA_LIVE) throw new Error("PANTA_MOCK");
  // Panta requires trailing slashes on all endpoints.
  const p = path.endsWith("/") || path.includes("?") ? path : path + "/";
  const res = await fetch(`${PANTA_BASE}${p}`, {
    ...init,
    headers: {
      "X-Api-Key": PANTA_KEY,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  if (!res.ok) throw new PantaError(res.status, await res.text());
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------
// Fake but well-formed Solana artefacts for the mock path.
// A base64 payload keeps the shape stable — the frontend never
// deserializes it in the demo, but a real wallet would.
// ------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function mockSignature(): string {
  let s = "";
  for (let i = 0; i < 88; i++) s += B58[Math.floor(Math.random() * B58.length)];
  return s;
}

export function mockPubkey(): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(Math.random() * B58.length)];
  return s;
}

export function mockUnsignedTx(): string {
  const bytes = new Uint8Array(220);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  // btoa isn't available in every Node version, do it manually.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

export function mockQuoteId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
