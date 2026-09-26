/** Browser helpers for the Market Royale round API — every call is arena-scoped. */

import type { Entrant, Round, RoundConfig } from "@/lib/royale";

const CONFIRM_TIMEOUT_MS = 60_000;
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sign a base64-encoded LEGACY Transaction with the connected Solana wallet
 * (Phantom / Backpack / Solflare) and broadcast to devnet. Returns the tx
 * signature. Used for escrow Deposit / Claim / Recover txs whose account
 * shape doesn't need lookup tables.
 */
async function signAndBroadcastLegacy(base64: string): Promise<string> {
  if (typeof window === "undefined") throw new Error("client only");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const provider = w.phantom?.solana ?? w.solana ?? w.backpack?.solana ?? w.solflare;
  if (!provider) throw new Error("no wallet found — install Phantom, Backpack or Solflare");

  const bytes = b64ToBytes(base64);
  const { Connection, Transaction } = await import("@solana/web3.js");
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const tx = Transaction.from(bytes);

  let signature = "";
  if (typeof provider.signAndSendTransaction === "function") {
    const res = await provider.signAndSendTransaction(tx);
    signature = res.signature ?? "";
  } else if (typeof provider.signTransaction === "function") {
    const signed = await provider.signTransaction(tx);
    signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  } else {
    throw new Error("wallet does not expose a signing method");
  }
  if (!signature) throw new Error("wallet returned empty signature");

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const st = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
      const s = st.value?.confirmationStatus;
      if (s === "confirmed" || s === "finalized") return signature;
      if (st.value?.err) throw new Error(JSON.stringify(st.value.err));
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return signature; // return best-effort; server confirms too
}

/** Host-tunable fields of a rumble (the rest are fixed by the arena). */
export type HostConfig = Partial<Pick<RoundConfig,
  "asset" | "format" | "entryUsdc" | "startingBankroll" | "capacity" | "roundLimit" | "host" | "enrollmentSec"
>>;

export type RoundView = {
  round: Round | null;
  arena?: string;
  yesPrice: number;
  cutLine: number;
  standings: Entrant[];
  persisted?: boolean;
  error?: string;
};

export async function getRound(arena?: string): Promise<RoundView> {
  const qs = arena ? `?arena=${encodeURIComponent(arena)}` : "";
  const res = await fetch(`/api/round${qs}`, { cache: "no-store" });
  return res.json();
}

/**
 * Enroll a wallet into an arena. When the arena runs on-chain escrow the
 * server responds with 402 { needsDeposit: true }; the caller must sign a
 * Deposit tx and re-post with the resulting signature.
 */
export async function enrollRound(wallet: string, nickname: string, arena?: string, escrowSignature?: string): Promise<{ round?: Round; arena?: string; entrantId?: string; error?: string; needsDeposit?: boolean }> {
  const res = await fetch("/api/round/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, nickname, arena, escrowSignature })
  });
  return res.json();
}

/**
 * Full escrow-aware enrollment: ask the server for a Deposit tx, sign it with
 * the connected wallet, then finalize the enrollment. Falls back cleanly to
 * ledger enroll when the arena is not escrow-backed.
 */
export async function enrollWithEscrow(wallet: string, nickname: string, arena?: string): Promise<{ round?: Round; entrantId?: string; escrowSignature?: string; error?: string }> {
  // Attempt 1: plain ledger enroll. If the arena needs a deposit we get 402.
  const first = await enrollRound(wallet, nickname, arena);
  if (!first.needsDeposit) return first;

  // Build a Deposit tx from the server.
  const txRes = await fetch("/api/escrow/tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "deposit", wallet, arena })
  }).then((r) => r.json());
  if (txRes.escrow === "inactive") return { error: "escrow is inactive on the server" };
  if (txRes.error) return { error: txRes.error };

  // Sign + broadcast via the connected wallet.
  let sig: string;
  try { sig = await signAndBroadcastLegacy(txRes.base64); }
  catch (err) { return { error: err instanceof Error ? err.message : "wallet signing failed" }; }
  if (!sig) return { error: "wallet did not return a signature" };

  // Finalize with the signature.
  return enrollRound(wallet, nickname, arena, sig);
}

/** Ask the server to sign + submit SettlePlayer + CloseSettlement for the arena. */
export async function serverSettleArena(arena: string): Promise<{ ok?: boolean; signatures?: string[]; alreadySettled?: boolean; error?: string; escrow?: string }> {
  const res = await fetch("/api/escrow/settle", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ arena })
  });
  return res.json();
}

/** Claim my settled entitlement out of the arena's escrow to my wallet. */
export async function claimFromEscrow(wallet: string, arena: string, recover = false): Promise<{ signature?: string; error?: string; escrow?: string }> {
  const txRes = await fetch("/api/escrow/tx", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: recover ? "recover" : "claim", wallet, arena })
  }).then((r) => r.json());
  if (txRes.escrow === "inactive") return { error: "escrow is inactive" };
  if (txRes.error) return { error: txRes.error };
  try {
    const signature = await signAndBroadcastLegacy(txRes.base64);
    return { signature };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "wallet signing failed" };
  }
}

export async function tradeRound(args: { wallet: string; action: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number; arena?: string }): Promise<{ round?: Round; entrant?: Entrant; yesPrice?: number; standings?: Entrant[]; error?: string }> {
  const res = await fetch("/api/round/trade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args)
  });
  return res.json();
}

export type ParlayLegInput = { marketId: string; side: "YES" | "NO" };

/** Place a native parlay from the vault into the live round. */
export async function placeParlayApi(wallet: string, legs: ParlayLegInput[], stakeUsdc: number, arena?: string): Promise<{ round?: Round; entrant?: Entrant; error?: string }> {
  const res = await fetch("/api/round/parlay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, legs, stakeUsdc, arena })
  });
  return res.json();
}

/**
 * Host a rumble. Every call MINTS A NEW ARENA CODE and returns the shareable
 * `inviteSlug` (e.g. `/a/A7XB2M`) which the client shares with friends.
 */
export async function newRound(config?: HostConfig): Promise<RoundView & { error?: string; inviteSlug?: string; arena?: string }> {
  const res = await fetch("/api/round", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "new", config })
  });
  return res.json();
}
