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
import { describeWalletError, signAndSendAs } from "@/lib/wallet";

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

// ---- Market creation (a pit on a new Panta market) --------------------

export type MarketDraftInput = {
  question: string;
  category: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  /** When trading on the market ends, unix seconds. */
  endsAt: number;
  /** An event already under way (e.g. tonight's game) — trades immediately. */
  breaking: boolean;
};
export type MarketQuote = { draftId: string; feeUsdc: number; liquidityUsdc: number; sandbox: boolean; expiresAt: string | null };

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; field?: string; code?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `Request failed (${res.status})`, field: (data as { field?: string }).field, code: (data as { code?: string }).code };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error — check your connection and try again." };
  }
}

/** Step 1: validate the market and get Panta's creation fee. */
export async function quoteMarket(input: MarketDraftInput) {
  return postJson<MarketQuote>("/api/markets/quote", input);
}

/** Keep a sent creation signature through registration retries and reloads. */
const pendingCreateKey = (draftId: string, wallet: string) => `pit:panta:create:${wallet}:${draftId}`;
const pendingCreateMemory = new Map<string, string>();
export function pendingMarketSignature(draftId: string | undefined, wallet: string): string {
  if (!draftId || !wallet || typeof window === "undefined") return "";
  const key = pendingCreateKey(draftId, wallet);
  try {
    const signature = pendingCreateMemory.get(key) ?? window.localStorage.getItem(key) ?? "";
    return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature) ? signature : "";
  } catch { return ""; }
}

function rememberMarketSignature(draftId: string, wallet: string, signature: string): void {
  pendingCreateMemory.set(pendingCreateKey(draftId, wallet), signature);
  try { window.localStorage.setItem(pendingCreateKey(draftId, wallet), signature); } catch { /* storage can be disabled */ }
}

function canRememberMarketSignature(draftId: string, wallet: string): boolean {
  try {
    const key = `${pendingCreateKey(draftId, wallet)}:check`;
    window.localStorage.setItem(key, "ok");
    const works = window.localStorage.getItem(key) === "ok";
    window.localStorage.removeItem(key);
    return works;
  } catch { return false; }
}

function forgetMarketSignature(draftId: string, wallet: string): void {
  pendingCreateMemory.delete(pendingCreateKey(draftId, wallet));
  try { window.localStorage.removeItem(pendingCreateKey(draftId, wallet)); } catch { /* storage can be disabled */ }
}

/**
 * Steps 2–3: build the creation transaction, have the creator's wallet sign
 * it (it pays the fee), and register the market with Panta. In Panta's
 * sandbox there's no transaction — nothing to sign, nothing charged.
 */
export async function finishMarket(
  draftId: string,
  wallet: string,
  onStep?: (step: "building" | "signing" | "registering") => void,
  question?: string
): Promise<{ ok: true; marketId: string } | { ok: false; error: string; requote?: boolean; pendingRegistration?: boolean }> {
  let signature = pendingMarketSignature(draftId, wallet);
  if (!signature) {
    onStep?.("building");
    const built = await postJson<{ transaction: string; sandbox: boolean }>("/api/markets/build", { draftId });
    if (!built.ok) return {
      ...built,
      requote: built.code === "CREATE_EXPIRED" || /(?:quote|draft|session).*expired/i.test(built.error)
    };
    if (built.data.transaction) {
      if (!canRememberMarketSignature(draftId, wallet)) return { ok: false, error: "Browser storage is unavailable. Enable it before paying Panta so a sent transaction can be safely registered after a retry." };
      onStep?.("signing");
      try {
        ({ signature } = await signAndBroadcast({
          serializedTx: built.data.transaction, wallet,
          // Save as soon as broadcast returns, before waiting for RPC confirmation.
          onBroadcast: (sent) => rememberMarketSignature(draftId, wallet, sent)
        }));
      } catch (err) {
        // An explicit on-chain failure is safe to re-quote. For any other
        // post-broadcast error, retain the signature for registration retry.
        if (pendingMarketSignature(draftId, wallet)) {
          if (err instanceof WalletSignatureError) forgetMarketSignature(draftId, wallet);
          else return { ok: false, error: "The creation transaction was sent. Retry Panta registration with the same signature; do not sign or pay again.", pendingRegistration: true };
        }
        return { ok: false, error: err instanceof Error ? err.message : "The wallet didn't sign the market." };
      }
    }
  }
  onStep?.("registering");
  let reg = await postJson<{ marketId: string }>("/api/markets/register", { draftId, signature });
  for (let attempt = 0; !reg.ok && reg.code === "TX_NOT_FOUND" && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    reg = await postJson<{ marketId: string }>("/api/markets/register", { draftId, signature });
  }
  if (!reg.ok) {
    if (reg.code === "TX_FAILED") {
      forgetMarketSignature(draftId, wallet);
      return { ok: false, error: "Panta confirmed the transaction failed on chain. Check a new creation fee quote before trying again.", requote: true };
    }
    if (signature) return {
      ok: false,
      error: reg.code === "CREATE_EXPIRED" ? reg.error : `The transaction was sent, but Panta has not registered it yet. Retry registration without signing again. ${reg.error}`,
      pendingRegistration: true
    };
    return reg;
  }
  forgetMarketSignature(draftId, wallet);
  // Watch the market for its primary → graduated flip (creator fees start then).
  try {
    const { trackMarket } = await import("@/lib/tracked-markets");
    trackMarket({ marketId: reg.data.marketId, question, role: "creator" });
  } catch { /* client-only helper */ }
  return { ok: true, marketId: reg.data.marketId };
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
      if (st.value?.err) throw new WalletSignatureError(new Error(JSON.stringify(st.value.err)));
      if (v === "confirmed" || v === "finalized") return true;
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
  onBroadcast?: (signature: string) => void;
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
  args.onBroadcast?.(signature);
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
