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
  VerifyResponse,
  TradeStatusResponse,
  ClaimBuildResponse,
  PantaCategory,
  PantaInstruction,
  PantaMarket,
  PantaPosition
} from "@/lib/panta";
import type { ParlayQuote, ParlayLeg } from "@/lib/parlay";
import { connectWallet, describeWalletError, signAndSendAs } from "@/lib/wallet";

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
export function submitOrder(args: { orderId: string; signature: string; wallet?: string }) {
  return jpost<SubmitResponse>("/api/orders/submit", args);
}
export function verifyOrder(args: { orderId?: string; signature?: string; wallet?: string }) {
  return jpost<VerifyResponse>("/api/orders/verify", args);
}
export function buildClaim(args: { wallet: string; marketId: string }) {
  return jpost<ClaimBuildResponse>("/api/claims/build", args);
}
/**
 * Read the on-chain attribution status for a signature after a Panta
 * trade. Panta doesn't expose a POST /trades/report — this is a GET-style
 * status probe. Ticks the HUD attribution counter when the response is
 * `processed` or `confirmed`.
 */
export function reportTrade(args: { signature: string; wallet?: string; marketId?: string }) {
  return jpost<TradeStatusResponse>("/api/trades/report", { signature: args.signature });
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
export async function marketCreateRegister(args: { createId: string; signature: string }) {
  const res = await jpost<{ source: "panta" | "mock"; marketId: string; status: "registered" | "pending"; title?: string; category?: string }>(
    "/api/markets/register", args
  );
  // Any market we register goes into the tracked-markets store so the
  // graduation banner can watch it flip from "primary" → "graduated".
  try {
    const { trackMarket } = await import("@/lib/tracked-markets");
    if (res.marketId) trackMarket({ marketId: res.marketId, question: res.title, role: "creator" });
  } catch { /* client-only helper — noop on server */ }
  return res;
}

// ---- Wallet detection -------------------------------------------------

/** Connect the player's wallet (see lib/wallet.ts). Returns the address or null. */
export async function connectSolanaWallet(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try { return await connectWallet(); } catch { return null; }
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

export class WalletSignatureError extends Error { constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause)); } }

async function pollConfirmation(connection: import("@solana/web3.js").Connection, signature: string): Promise<boolean> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const st = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const v = st.value?.confirmationStatus;
      if (v === "confirmed" || v === "finalized") return true;
      if (st.value?.err) throw new WalletSignatureError(new Error(JSON.stringify(st.value.err)));
    } catch (err) {
      if (err instanceof WalletSignatureError) throw err;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return false;
}

/**
 * Sign a Panta-supplied VersionedTransaction (base64) with the connected
 * wallet, broadcast to Solana, and poll for confirmation. Used by the
 * market-creation lifecycle where Panta returns a fully-built tx.
 */
export async function signAndBroadcast(args: {
  serializedTx: string;
  wallet: string;
}): Promise<{ signature: string; confirmed: boolean }> {
  if (typeof window === "undefined") throw new Error("client only");
  const bytes = b64ToBytes(args.serializedTx);
  const { Connection, VersionedTransaction } = await import("@solana/web3.js");
  const connection = new Connection(SOLANA_RPC, "confirmed");

  let tx: InstanceType<typeof VersionedTransaction>;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new WalletSignatureError(new Error(`Panta returned an unparseable VersionedTransaction: ${err instanceof Error ? err.message : String(err)}`));
  }

  let signature: string;
  try {
    signature = await signAndSendAs(args.wallet, tx, (raw) => connection.sendRawTransaction(raw, { skipPreflight: false }));
  } catch (err) {
    throw new WalletSignatureError(new Error(describeWalletError(err, "The transaction")));
  }
  const confirmed = await pollConfirmation(connection, signature);
  return { signature, confirmed };
}

/**
 * Compile a v0 VersionedTransaction from raw Panta instructions +
 * recentBlockhash (the shape returned by /primaryorderbuild/ and
 * /claim/build/), then sign + broadcast + confirm through the connected
 * wallet.
 *
 * If Panta returned an empty instructions array (sandbox mode or a
 * malformed response), we throw so the caller can fall back to demo
 * behavior rather than sending an empty tx.
 */
export async function signAndBroadcastFromInstructions(args: {
  wallet: string;
  instructions: PantaInstruction[];
  recentBlockhash: string;
}): Promise<{ signature: string; confirmed: boolean }> {
  if (!args.instructions || args.instructions.length === 0) {
    throw new WalletSignatureError(new Error("Panta returned no instructions to sign — sandbox / demo mode."));
  }
  if (!args.recentBlockhash) {
    throw new WalletSignatureError(new Error("Panta returned no recentBlockhash."));
  }

  if (typeof window === "undefined") throw new Error("client only");
  const { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");
  const connection = new Connection(SOLANA_RPC, "confirmed");

  const payer = new PublicKey(args.wallet);
  const ix = args.instructions.map((raw) => new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable
    })),
    data: Buffer.from(raw.data, "base64")
  }));

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: args.recentBlockhash,
    instructions: ix
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  let signature: string;
  try {
    signature = await signAndSendAs(args.wallet, tx, (raw) => connection.sendRawTransaction(raw, { skipPreflight: false }));
  } catch (err) {
    throw new WalletSignatureError(new Error(describeWalletError(err, "The transaction")));
  }
  const confirmed = await pollConfirmation(connection, signature);
  return { signature, confirmed };
}
