/**
 * Browser-side helpers that talk to our own /api routes.
 * The Panta API key never touches this file — the server injects it.
 */

import type {
  QuoteResponse,
  BuildResponse,
  SubmitResponse,
  ReportResponse,
  ClaimBuildResponse,
  PantaCategory
} from "@/lib/panta";
import type { ParlayQuote, ParlayLeg } from "@/lib/parlay";

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

export function fetchCategories() {
  return jget<{ source: string; categories: PantaCategory[] }>("/api/categories");
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
export function buildClaim(args: { wallet: string; marketId: string }) {
  return jpost<ClaimBuildResponse>("/api/claims/build", args);
}
export function reportTrade(args: { signature: string; wallet: string; marketId: string }) {
  return jpost<ReportResponse>("/api/trades/report", args);
}

export function quoteParlayLive(args: { legs: Array<Pick<ParlayLeg, "marketId" | "side" | "correlationGroup" | "question">>; stakeUsdc: number }) {
  return jpost<{ source: "panta" | "mock"; quote: ParlayQuote }>("/api/parlay/quote", args);
}

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

/**
 * In a real integration we'd deserialize the Panta-built tx, hand it to
 * the wallet for `signAndSendTransaction`, and read the returned signature.
 * The demo simulates that step so the full lifecycle runs client-side
 * without a live wallet.
 */
export async function signAndBroadcast(args: {
  serializedTx: string;
  wallet: string;
}): Promise<{ signature: string; simulated: boolean }> {
  if (typeof window === "undefined") throw new Error("client only");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const provider = w.phantom?.solana ?? w.solana;
  if (provider?.signAndSendTransaction) {
    try {
      // NOTE: production code would VersionedTransaction.deserialize the base64
      // payload with @solana/web3.js and pass the object to the wallet. We keep
      // this file dependency-free for the hackathon build.
      const bytes = Uint8Array.from(atob(args.serializedTx), (c) => c.charCodeAt(0));
      const res = await provider.signAndSendTransaction({ serialized: bytes });
      return { signature: res.signature ?? res.publicKey?.toString?.() ?? "", simulated: false };
    } catch {
      // fall through to simulated
    }
  }
  const { mockSignature } = await import("@/lib/panta");
  return { signature: mockSignature(), simulated: true };
}
