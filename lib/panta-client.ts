/**
 * Browser-side helpers that talk to our own /api routes.
 * The Panta API key never touches this file — the server injects it.
 *
 * Signing is done directly against a Solana wallet adapter using
 * @solana/web3.js: the base64 payload Panta returns from /orders/build is
 * deserialized as a VersionedTransaction, handed to the wallet for
 * signing, broadcast to the configured RPC, and confirmed on-chain before
 * the signature is reported back to Panta.
 */

import type {
  QuoteResponse,
  BuildResponse,
  SubmitResponse,
  ReportResponse,
  ClaimBuildResponse,
  PantaCategory,
  PantaMarket,
  PantaPosition
} from "@/lib/panta";
import type { ParlayQuote, ParlayLeg } from "@/lib/parlay";

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---- Panta proxy calls ------------------------------------------------

export function fetchCategories() {
  return jget<{ source: string; categories: PantaCategory[] }>("/api/categories");
}
export function fetchMarkets(arena?: string, category?: string) {
  const qs = new URLSearchParams();
  if (arena) qs.set("arena", arena);
  if (category) qs.set("category", category);
  return jget<{
    source: string;
    markets?: PantaMarket[];
    arenas?: Array<{ id: string; name?: string; tagline?: string; endsInMs?: number; markets: PantaMarket[] }>;
  }>(`/api/markets${qs.toString() ? `?${qs}` : ""}`);
}
export function fetchMarketTrades(marketId: string) {
  return jget<{ source: string; trades: Array<{ signature: string; side: "YES" | "NO"; shares: number; priceCents: number; usdcAmount: string; wallet: string; ts: string }> }>(
    `/api/markets/${encodeURIComponent(marketId)}/trades`
  );
}
export function fetchPositions(wallet: string) {
  return jget<{ source: string; positions: PantaPosition[] }>(`/api/positions?wallet=${encodeURIComponent(wallet)}`);
}
export function quoteOrder(args: { marketId: string; side: "YES" | "NO"; usdcAmount: string; wallet?: string }) {
  return jpost<QuoteResponse>("/api/orders/quote", args);
}
export function buildOrder(args: { quoteId: string; wallet: string }) {
  return jpost<BuildResponse>("/api/orders/build", args);
}
export function submitOrder(args: { quoteId: string; signature: string; wallet: string }) {
  return jpost<SubmitResponse>("/api/orders/submit", args);
}
export function verifyOrder(args: { signature: string }) {
  return jpost<{ source: "panta" | "mock"; status: "pending" | "confirmed" | "failed" }>("/api/orders/verify", args);
}
export function buildClaim(args: { wallet: string; marketId: string }) {
  return jpost<ClaimBuildResponse>("/api/claims/build", args);
}
export function reportTrade(args: { signature: string; wallet: string; marketId: string }) {
  return jpost<ReportResponse>("/api/trades/report", args);
}
export function quoteParlayLive(args: { legs: Array<Pick<ParlayLeg, "marketId" | "side" | "correlationGroup" | "question">>; stakeUsdc: number }) {
  return jpost<{ source: "panta" | "mock"; quote: ParlayQuote }>("/api/parlay/quote", args);
}

// ---- Market creation (host-a-ring) lifecycle --------------------------

export type MarketCreateQuoteRequest = {
  wallet: string;
  question: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: string;
  startTime: number;     // unix seconds
  endTime: number;       // unix seconds
  resolutionTime: number;// unix seconds
  imageUrl: string;
};
export type MarketCreateQuoteResponse = {
  source: "panta" | "mock";
  createId: string;
  paymentUsdc: string;
  liquidityInjectionUsdc?: string;
  platformRevenueUsdc?: string;
  expectedEventPda: string;
  expiresAt?: string;
};
export function marketCreateQuote(args: MarketCreateQuoteRequest) {
  return jpost<MarketCreateQuoteResponse>("/api/markets/quote", args);
}
export function marketCreateBuild(args: { createId: string; wallet: string }) {
  return jpost<{ source: "panta" | "mock"; transaction: string; buildFingerprint?: string; lastValidBlockHeight?: number; expiresAt?: string }>(
    "/api/markets/build", args
  );
}
export function marketCreateRegister(args: { createId: string; signature: string }) {
  return jpost<{ source: "panta" | "mock"; marketId: string; status: "registered" | "pending"; title?: string; category?: string }>(
    "/api/markets/register", args
  );
}

// ---- Wallet detection -------------------------------------------------

/**
 * Detects a Phantom / Backpack / Solflare wallet on the page. If one is
 * present, ask it to connect and return the pubkey. Otherwise return null
 * so the caller can fall back to a demo wallet.
 */
export async function connectSolanaWallet(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const provider = w.phantom?.solana ?? w.solana ?? w.backpack?.solana ?? w.solflare;
  if (!provider) return null;
  try {
    const res = await provider.connect({ onlyIfTrusted: false });
    const pk = res?.publicKey?.toString?.() ?? provider.publicKey?.toString?.();
    return pk ?? null;
  } catch {
    return null;
  }
}

// ---- Real Solana signing ---------------------------------------------

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sign a Panta-built VersionedTransaction with the connected wallet,
 * broadcast it via the configured Solana RPC, and wait for confirmation.
 *
 *   1. Deserialize the base64 payload into a VersionedTransaction.
 *   2. Ask the wallet to sign + send (Phantom / Backpack / Solflare all
 *      implement `signAndSendTransaction`). One call signs and broadcasts.
 *   3. Fall back to `signTransaction` + Connection.sendRawTransaction if
 *      the wallet doesn't expose signAndSend.
 *   4. Poll the RPC for confirmation up to CONFIRM_TIMEOUT_MS.
 *
 * Every failure path throws — there is no mock-signature safety net. A
 * caller in production wants a loud error, not a fake fill.
 */
const CONFIRM_TIMEOUT_MS = 30_000;

export class WalletUnavailableError extends Error { constructor() { super("No Solana wallet detected. Install Phantom, Backpack, or Solflare and reload."); } }
export class WalletSignatureError extends Error { constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause)); } }

export async function signAndBroadcast(args: {
  serializedTx: string;
  wallet: string;
}): Promise<{ signature: string; confirmed: boolean }> {
  if (typeof window === "undefined") throw new Error("client only");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const provider = w.phantom?.solana ?? w.solana ?? w.backpack?.solana ?? w.solflare;
  if (!provider) throw new WalletUnavailableError();

  const bytes = b64ToBytes(args.serializedTx);
  const { Connection, VersionedTransaction } = await import("@solana/web3.js");
  const connection = new Connection(SOLANA_RPC, "confirmed");

  let tx: InstanceType<typeof VersionedTransaction>;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new WalletSignatureError(new Error(`Panta returned an unparseable VersionedTransaction: ${err instanceof Error ? err.message : String(err)}`));
  }

  let signature = "";
  try {
    if (typeof provider.signAndSendTransaction === "function") {
      const res = await provider.signAndSendTransaction(tx);
      signature = res.signature ?? "";
    } else if (typeof provider.signTransaction === "function") {
      const signed = await provider.signTransaction(tx);
      signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    } else {
      throw new WalletUnavailableError();
    }
  } catch (err) {
    throw new WalletSignatureError(err);
  }
  if (!signature) throw new WalletSignatureError(new Error("wallet returned an empty signature"));

  // Poll for confirmation. We don't block indefinitely — Panta will also
  // pick up confirmations via the /orders/verify path.
  let confirmed = false;
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const st = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const v = st.value?.confirmationStatus;
      if (v === "confirmed" || v === "finalized") { confirmed = true; break; }
      if (st.value?.err) throw new WalletSignatureError(new Error(JSON.stringify(st.value.err)));
    } catch (err) {
      if (err instanceof WalletSignatureError) throw err;
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }

  return { signature, confirmed };
}
