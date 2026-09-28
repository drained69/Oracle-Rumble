/** Browser helpers for the Market Royale round API — every call is arena-scoped. */

import type { Entrant, Round, RoundConfig } from "@/lib/royale";
import { ensureSession, sessionLost } from "@/lib/session-client";

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
    let failed: unknown = null;
    try {
      const st = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
      const s = st.value?.confirmationStatus;
      if (st.value?.err) failed = st.value.err;
      else if (s === "confirmed" || s === "finalized") return signature;
    } catch { /* transient RPC error — keep polling */ }
    if (failed) throw new Error(`Transaction failed on chain: ${JSON.stringify(failed)}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  return signature; // return best-effort; server confirms too
}

/**
 * POST as the signed-in wallet. Signs in first if needed (one free message
 * signature), and once more if the server says the session is gone.
 */
async function postAsWallet(url: string, wallet: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const auth = await ensureSession(wallet);
  if (!auth.ok) return { status: 401, data: { error: auth.error, needsAuth: true } };
  const send = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let res = await send();
  if (res.status === 401) {
    sessionLost();
    const again = await ensureSession(wallet);
    if (!again.ok) return { status: 401, data: { error: again.error, needsAuth: true } };
    res = await send();
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

/** Host-tunable fields of a rumble (the rest are fixed by the arena). */
export type HostConfig = Partial<Pick<RoundConfig,
  "asset" | "format" | "entryUsdc" | "startingBankroll" | "capacity" | "roundLimit" | "host" | "enrollmentSec" | "liveSec"
>> & {
  /** Which timeframe of the asset to trade — 5m / 15m / 1h / 1d. */
  horizon?: "MIN5" | "MIN15" | "HOUR" | "DAY";
};

export type RoundView = {
  round: Round | null;
  arena?: string;
  yesPrice: number;
  cutLine: number;
  standings: Entrant[];
  /** UP price (cents) of every board market for this round — parlay legs. */
  prices?: Record<string, number>;
  /** Latest USD spot price of the round's asset. */
  spot?: number | null;
  persisted?: boolean;
  error?: string;
};

export async function getRound(arena?: string, wallet?: string | null): Promise<RoundView> {
  const qs = new URLSearchParams();
  if (arena) qs.set("arena", arena);
  if (wallet) qs.set("wallet", wallet); // lets the server show me my own opening call
  const q = qs.toString();
  const res = await fetch(`/api/round${q ? `?${q}` : ""}`, { cache: "no-store" });
  return res.json();
}

/** UP = YES, DOWN = NO, null = decide once the round is live. */
export type OpeningCall = "YES" | "NO" | null;

export type EnrollResult = {
  round?: Round;
  arena?: string;
  entrantId?: string;
  error?: string;
  needsDeposit?: boolean;
  already?: boolean;
  escrowDown?: boolean;
  refundable?: boolean;
  /** Deposit still confirming on chain — retry shortly. */
  pending?: boolean;
  /** A deposit tx was signed and sent — never cancel the arena after this. */
  deposited?: boolean;
  escrowSignature?: string;
};

/**
 * Enroll a wallet into an arena. When the arena runs on-chain escrow the
 * server responds with 402 { needsDeposit: true }; the caller must sign a
 * Deposit tx and re-post with the resulting signature.
 */
export async function enrollRound(wallet: string, nickname: string, arena?: string, escrowSignature?: string, openingCall: OpeningCall = null): Promise<EnrollResult> {
  try {
    const { status, data: raw } = await postAsWallet("/api/round/enroll", wallet, { wallet, nickname, arena, escrowSignature, openingCall });
    const data = raw as EnrollResult;
    if (status >= 500 && !data.error) return { pending: true, error: "server busy" };
    if (status === 202) return { ...data, pending: true };
    if (status >= 500) return { ...data, pending: !data.escrowDown };
    return data;
  } catch {
    return { pending: true, error: "network error" };
  }
}

/**
 * Register the seat for a deposit that has been sent. Retries while the
 * deposit is confirming or the server is unreachable — the on-chain entry is
 * the ticket, so this can safely be repeated. (If every try fails the
 * server's keeper still seats the wallet from its on-chain entry.)
 */
async function finishSeat(wallet: string, nickname: string, arena: string | undefined, sig: string | undefined, openingCall: OpeningCall): Promise<EnrollResult> {
  let last: EnrollResult = {};
  for (let attempt = 0; attempt < 8; attempt++) {
    last = await enrollRound(wallet, nickname, arena, sig, openingCall);
    if (!last.pending) return last;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return {
    ...last,
    pending: true,
    error: sig
      ? "Your deposit hasn't confirmed yet. If it lands, your seat appears here automatically — if it doesn't, nothing was taken and you can try again."
      : "Registering your seat is taking longer than usual — it will appear here automatically."
  };
}

/**
 * Full escrow-aware enrollment: ask the server for a Deposit tx, sign it with
 * the connected wallet, then finalize the enrollment. Falls back cleanly to
 * ledger enroll when the arena is not escrow-backed.
 */
export async function enrollWithEscrow(wallet: string, nickname: string, arena?: string, openingCall: OpeningCall = null): Promise<EnrollResult> {
  // Attempt 1: plain enroll. Seats a ledger-only arena, a wallet that is
  // already seated, or one whose deposit already landed; otherwise 402.
  const auth = await ensureSession(wallet);
  if (!auth.ok) return { error: auth.error };
  const first = await enrollRound(wallet, nickname, arena, undefined, openingCall);
  if (first.pending) return finishSeat(wallet, nickname, arena, undefined, openingCall);
  if (!first.needsDeposit) return first;

  // Build a Deposit tx from the server.
  let txRes: { escrow?: string; alreadyDeposited?: boolean; error?: string; base64?: string };
  try {
    txRes = await fetch("/api/escrow/tx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deposit", wallet, arena, nickname, openingCall })
    }).then((r) => r.json());
  } catch {
    return { error: "Couldn't reach the server to prepare your deposit — try again." };
  }
  if (txRes.escrow === "inactive") return { error: "escrow is inactive on the server" };
  // Already paid on chain → just claim the seat, no signing.
  if (txRes.alreadyDeposited) return { ...(await finishSeat(wallet, nickname, arena, undefined, openingCall)), deposited: true };
  if (txRes.error || !txRes.base64) return { error: txRes.error ?? "could not build the deposit" };

  // Sign + broadcast via the connected wallet.
  let sig: string;
  try { sig = await signAndBroadcastLegacy(txRes.base64); }
  catch (err) { return { error: err instanceof Error ? err.message : "wallet signing failed" }; }
  if (!sig) return { error: "wallet did not return a signature" };

  const done = await finishSeat(wallet, nickname, arena, sig, openingCall);
  return { ...done, deposited: true, escrowSignature: sig };
}

/** Change my opening call while the arena is still enrolling. */
export async function setOpeningCall(wallet: string, arena: string, call: OpeningCall): Promise<{ ok?: boolean; error?: string; needsAuth?: boolean }> {
  try {
    const { data } = await postAsWallet("/api/round/call", wallet, { wallet, arena, call });
    return data as { ok?: boolean; error?: string; needsAuth?: boolean };
  } catch {
    return { error: "network error" };
  }
}

/** Ask the server to sign + submit SettlePlayer + CloseSettlement for the arena. */
export async function serverSettleArena(arena: string): Promise<{ ok?: boolean; signatures?: string[]; alreadySettled?: boolean; error?: string; escrow?: string; refund?: boolean; pending?: boolean; retryInMs?: number; depositors?: number }> {
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
  try {
    const { data } = await postAsWallet("/api/round/trade", args.wallet, args);
    return data as { round?: Round; entrant?: Entrant; yesPrice?: number; standings?: Entrant[]; error?: string };
  } catch {
    return { error: "network error — try again" };
  }
}

export type ParlayLegInput = { marketId: string; side: "YES" | "NO" };

/** Place a native parlay from the vault into the live round. */
export async function placeParlayApi(wallet: string, legs: ParlayLegInput[], stakeUsdc: number, arena?: string): Promise<{ round?: Round; entrant?: Entrant; error?: string }> {
  try {
    const { data } = await postAsWallet("/api/round/parlay", wallet, { wallet, legs, stakeUsdc, arena });
    return data as { round?: Round; entrant?: Entrant; error?: string };
  } catch {
    return { error: "network error — try again" };
  }
}

/**
 * Cash out an open parlay ticket. Server re-prices from live YES prices,
 * applies the cashout edge, marks the ticket cashed_out, and credits the
 * entrant's cash bankroll. Refuses on non-live rounds or already-settled
 * tickets.
 */
export async function cashOutParlayApi(wallet: string, ticketId: string, arena: string): Promise<{
  round?: Round;
  entrant?: Entrant;
  quote?: {
    liveCombinedPrice: number;
    fairValueUsdc: number;
    cashoutFeeUsdc: number;
    netCashoutUsdc: number;
    originalStakeUsdc: number;
    pnlUsdc: number;
    legs: Array<{ marketId: string; side: "YES" | "NO"; entryPrice: number; currentSidePrice: number; question?: string }>;
  };
  error?: string;
}> {
  try {
    const { data } = await postAsWallet("/api/round/parlay/cashout", wallet, { wallet, ticketId, arena });
    return data as Awaited<ReturnType<typeof cashOutParlayApi>>;
  } catch {
    return { error: "network error — try again" };
  }
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

/**
 * Check a wallet can afford a seat before any on-chain work happens.
 * Returns null when affordable (or escrow is off), otherwise a user-facing reason.
 */
export async function checkSeatFunds(wallet: string, seatUsdc: number): Promise<string | null> {
  try {
    const r = await fetch(`/api/escrow/balance?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" }).then((x) => x.json());
    if (r.escrow !== "active" || r.usdc == null) return null;
    if (r.usdc + 1e-9 < seatUsdc) {
      return `This seat costs ${seatUsdc.toFixed(2)} USDC but your wallet holds ${Number(r.usdc).toFixed(2)} devnet USDC. Get test USDC at faucet.circle.com (Solana Devnet).`;
    }
    if (r.sol < 0.005) {
      return `You need about 0.005 devnet SOL for fees (you hold ${Number(r.sol).toFixed(4)}). Get some at faucet.solana.com.`;
    }
    return null;
  } catch {
    return null; // the deposit route re-checks server-side
  }
}

/**
 * Cancel an arena that was just created but never funded — used when the
 * host's seat-deposit signing fails so we don't leave an orphaned room.
 */
export async function cancelArena(arena: string, wallet?: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch("/api/round/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ arena, wallet })
  });
  return res.json();
}
