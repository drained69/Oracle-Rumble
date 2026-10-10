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

// Env is defined in lib/panta-env.ts and re-exported so existing callers
// can keep importing from "@/lib/panta". The split exists so the telemetry
// module can read env without a circular import back through this file.
export { PANTA_BASE, PANTA_KEY, PANTA_LIVE, PANTA_USER_ID } from "@/lib/panta-env";
import { PANTA_BASE, PANTA_KEY, PANTA_LIVE, PANTA_USER_ID } from "@/lib/panta-env";
import { recordPantaCall } from "@/lib/panta-telemetry";

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
  /** ISO 8601 timestamp Panta resolved the market at (present when phase==="resolved"). */
  resolvedAt?: string | null;
  /** ISO 8601 timestamp trading closes (Panta's resolutionTime for the AI Resolver). */
  resolutionTime?: string | null;
};

export type PantaCategory = { id: string; label: string };

export type QuoteRequest = {
  marketId: string;
  side: "YES" | "NO";
  usdcAmount: string;         // human-readable, e.g. "25.00" — mapped to `amountUsdc` on the wire
  wallet?: string;            // Solana pubkey
  userId?: string;            // Panta attribution identifier (usr_…)
};

export type QuoteResponse = {
  quoteId: string;
  marketId: string;
  side: "YES" | "NO";
  price: number;              // cents (derived from Panta's avgPrice decimal string)
  shares: number;
  usdcAmount: string;         // echoed for the UI
  feeUsdc: string;
  networkFeeUsdc: string;     // client-facing; Panta's real fee is bundled into feeUsdc
  expiresAt: string;          // ISO
  source: "panta" | "mock";
};

/**
 * Response from Panta's `/primaryorderbuild/`. Panta does NOT return a
 * pre-serialized VersionedTransaction — it returns the raw Solana
 * instructions plus a `recentBlockhash`, and the client compiles the
 * transaction locally (see lib/panta-client.ts).
 */
export type PantaInstructionAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type PantaInstruction = { programId: string; accounts: PantaInstructionAccount[]; data: string };

export type BuildRequest = { quoteId: string; wallet: string };
export type BuildResponse = {
  orderId: string;                     // Panta's post-build session identifier
  quoteId: string;                     // preserved for the caller
  instructions: PantaInstruction[];    // Solana IX list to compile
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  expectedShares?: number;
  expiresAt?: string;
  source: "panta" | "mock";
};

export type SubmitRequest = { orderId: string; signature: string; wallet?: string };
export type SubmitResponse = {
  signature: string;
  status: "submitted" | "confirmed" | "failed";  // Panta returns "submitted"; we surface confirmed/failed via /verify
  source: "panta" | "mock";
};

export type VerifyRequest = { orderId: string; signature?: string; wallet?: string };
export type VerifyResponse = {
  orderId: string;
  status: "built" | "submitted" | "confirmed" | "failed" | "expired";
  signature?: string;
  marketId?: string;
  side?: "yes" | "no";
  amountUsdc?: string;
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
  instructions: PantaInstruction[];
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  outcome?: "YES" | "NO";
  winningShares?: string;
  amountUsdc: string;         // human-readable for the UI; derived from winningShares when Panta doesn't populate it
  source: "panta" | "mock";
};

/**
 * Panta doesn't expose a POST /trades/report endpoint. Attribution is
 * automatic via the API key (or explicit X-User-Id header) on the order
 * lifecycle. This type is the shape of GET /trades/{signature}/ which
 * lets the client verify that a trade got attributed after the fact.
 */
export type TradeStatusResponse = {
  signature: string;
  status: "unknown" | "pending" | "confirmed" | "processed" | "failed";
  marketId?: string;
  wallet?: string;
  side?: "yes" | "no";
  kind?: "buy" | "claim";
  source: "panta" | "mock";
};

// ------------------------------------------------------------------
// Low-level fetch. Server-side only — never import from the browser.
// ------------------------------------------------------------------

export class PantaError extends Error {
  constructor(public status: number, public body: string) {
    super(`Panta ${status}: ${body.slice(0, 200)}`);
  }
}

export async function pantaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  // Panta requires trailing slashes on all endpoints.
  const queryAt = path.indexOf("?");
  const pathname = queryAt < 0 ? path : path.slice(0, queryAt);
  const query = queryAt < 0 ? "" : path.slice(queryAt);
  const p = `${pathname.endsWith("/") ? pathname : `${pathname}/`}${query}`;

  if (!PANTA_LIVE) {
    // Demo mode: record the fact that a mock was served so the console
    // still shows the endpoint the code TRIED to call. status=0 signals
    // "no HTTP round trip".
    recordPantaCall({
      method, endpoint: p, status: 0, latencyMs: 0,
      source: "mock", outcome: "ok", note: "PANTA_LIVE=false"
    });
    throw new Error("PANTA_MOCK");
  }

  const started = Date.now();
  let status = 0;
  try {
    const res = await fetch(`${PANTA_BASE}${p}`, {
      ...init,
      headers: {
        "X-Api-Key": PANTA_KEY,
        // Attribution: Panta credits trades to the account owning the
        // API key by default. Passing X-User-Id explicitly makes it
        // deterministic across environments and is the recommended
        // pattern per docs.panta.market/api-reference/trades/report.
        ...(PANTA_USER_ID ? { "X-User-Id": PANTA_USER_ID } : {}),
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers ?? {})
      },
      cache: "no-store"
    });
    status = res.status;
    if (!res.ok) {
      const body = await res.text();
      recordPantaCall({
        method, endpoint: p, status, latencyMs: Date.now() - started,
        source: "mock", outcome: "error", errorClass: `HTTP_${status}`,
        note: body.slice(0, 140)
      });
      throw new PantaError(status, body);
    }
    const json = (await res.json()) as T;
    recordPantaCall({
      method, endpoint: p, status, latencyMs: Date.now() - started,
      source: "panta", outcome: "ok"
    });
    return json;
  } catch (err) {
    // Network / DNS / abort. Only record if we didn't already record above.
    if (!(err instanceof PantaError)) {
      recordPantaCall({
        method, endpoint: p, status, latencyMs: Date.now() - started,
        source: "mock", outcome: "error",
        errorClass: err instanceof Error ? err.name : "unknown",
        note: err instanceof Error ? err.message.slice(0, 140) : String(err).slice(0, 140)
      });
    }
    throw err;
  }
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
