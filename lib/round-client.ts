/** Browser helpers for the Market Royale round API — every call is arena-scoped. */

import type { Entrant, Round, RoundConfig } from "@/lib/royale";
import type { Picks } from "@/lib/predictions";
import { ensureSession, sessionLost } from "@/lib/session-client";
import { describeWalletError, ensureWalletFor, signAndSendAs, WalletError } from "@/lib/wallet";

const CONFIRM_TIMEOUT_MS = 60_000;
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sign a base64-encoded LEGACY Transaction as `wallet` and broadcast it to
 * devnet, then wait for confirmation. Used for escrow Deposit / Claim /
 * Recover. Throws a player-readable Error.
 */
async function signAndBroadcastLegacy(
  wallet: string, base64: string, action: string,
  onSent?: () => void, onSlow?: (walletName: string) => void, onRetry?: () => void
): Promise<string> {
  if (typeof window === "undefined") throw new Error("client only");
  const { Connection, Transaction } = await import("@solana/web3.js");
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const tx = Transaction.from(b64ToBytes(base64));

  let signature = "";
  for (let attempt = 0; ; attempt++) {
    // Stamp a fresh blockhash right before the wallet prompt: a transaction
    // is only valid for ~150 blocks from its blockhash, and the one the
    // server built with is already seconds old. Safe — the player is the
    // only signer.
    const fresh = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = fresh.blockhash;
    for (const s of tx.signatures) s.signature = null; // a retry must be signed afresh
    const broadcast = async (raw: Uint8Array) => {
      try {
        return await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
      } catch (err) {
        // A lagging RPC node can report a still-valid blockhash as unknown:
        // if it hasn't actually expired, send the same signed bytes without
        // that node's pre-check (on-chain failures are caught when confirming).
        if (/blockhash not found/i.test(String((err as Error)?.message ?? err))) {
          const height = await conn.getBlockHeight("confirmed").catch(() => 0);
          if (height && height <= fresh.lastValidBlockHeight) {
            return conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 });
          }
        }
        throw err;
      }
    };
    try {
      signature = await signAndSendAs(wallet, tx, broadcast, action, onSlow);
      break;
    } catch (err) {
      // Really expired while the prompt was open: ask once more, fresh.
      if (err instanceof WalletError && err.reason === "expired" && attempt === 0) { onRetry?.(); continue; }
      throw new Error(describeWalletError(err, action));
    }
  }
  onSent?.();

  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let failed: unknown = null;
    try {
      const st = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
      const s = st.value?.confirmationStatus;
      if (st.value?.err) failed = st.value.err;
      else if (s === "confirmed" || s === "finalized") return signature;
    } catch { /* transient RPC error — keep polling */ }
    if (failed) throw new Error(`${action} failed on chain: ${JSON.stringify(failed)}`);
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
export async function enrollRound(wallet: string, nickname: string, arena?: string, escrowSignature?: string, openingCall: OpeningCall = null, openingCallPct?: number, picks?: Picks, locks?: string[]): Promise<EnrollResult> {
  try {
    const { status, data: raw } = await postAsWallet("/api/round/enroll", wallet, { wallet, nickname, arena, escrowSignature, openingCall, openingCallPct, picks, locks });
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
async function finishSeat(wallet: string, nickname: string, arena: string | undefined, sig: string | undefined, openingCall: OpeningCall, openingCallPct?: number, picks?: Picks, locks?: string[]): Promise<EnrollResult> {
  let last: EnrollResult = {};
  for (let attempt = 0; attempt < 8; attempt++) {
    last = await enrollRound(wallet, nickname, arena, sig, openingCall, openingCallPct, picks, locks);
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
 * Make sure the wallet is reachable on the right account and signed in,
 * before anything costs money (e.g. before an arena is created for a host).
 */
export async function prepareWallet(wallet: string, onStep?: (step: SeatStep, walletName?: string) => void): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await ensureWalletFor(wallet); }
  catch (err) { return { ok: false, error: describeWalletError(err, "The connection request") }; }
  const auth = await ensureSession(wallet, () => onStep?.("signin"), (name) => onStep?.("waiting", name));
  return auth.ok ? { ok: true } : { ok: false, error: auth.error };
}

/** Where a seat request is — drives the "approve in your wallet" hints. */
export type SeatStep = "signin" | "deposit" | "again" | "waiting" | "confirming" | "seating";

/** Toast line and short button label for each seat step. */
export function seatStepText(step: SeatStep, seatUsd: number, call?: OpeningCall, walletName = "your wallet"): { toast: string; button: string } {
  const amount = `$${seatUsd.toFixed(2)}`;
  const callText = call === "YES" ? " · opening call UP" : call === "NO" ? " · opening call DOWN" : "";
  switch (step) {
    case "signin": return { toast: "Sign in with your wallet — a free message, not a transaction.", button: "Sign the message in your wallet…" };
    case "deposit": return { toast: `Approve the ${amount} seat deposit in your wallet${callText}.`, button: "Approve the deposit in your wallet…" };
    case "again": return {
      toast: `That took over a minute, so Solana needs a fresh signature — approve the ${amount} deposit once more in your wallet.`,
      button: "Approve again in your wallet…"
    };
    case "waiting": return {
      toast: `Still waiting for ${walletName}. If its window isn't showing, click the ${walletName === "your wallet" ? "wallet" : walletName} icon in your browser toolbar — or check behind this window.`,
      button: `Waiting for ${walletName}…`
    };
    case "confirming": return { toast: "Deposit sent — confirming on Solana…", button: "Confirming on Solana…" };
    case "seating": return { toast: "Taking your seat…", button: "Taking your seat…" };
  }
}

/**
 * Full escrow-aware enrollment: ask the server for a Deposit tx, sign it with
 * the connected wallet, then finalize the enrollment. Falls back cleanly to
 * ledger enroll when the arena is not escrow-backed.
 */
export async function enrollWithEscrow(
  wallet: string, nickname: string, arena?: string, openingCall: OpeningCall = null,
  onStep?: (step: SeatStep, walletName?: string) => void, openingCallPct?: number, picks?: Picks, locks?: string[]
): Promise<EnrollResult> {
  // Attempt 1: plain enroll. Seats a ledger-only arena, a wallet that is
  // already seated, or one whose deposit already landed; otherwise 402.
  const auth = await ensureSession(wallet, () => onStep?.("signin"), (name) => onStep?.("waiting", name));
  if (!auth.ok) return { error: auth.error };
  onStep?.("seating");
  const first = await enrollRound(wallet, nickname, arena, undefined, openingCall, openingCallPct, picks, locks);
  if (first.pending) return finishSeat(wallet, nickname, arena, undefined, openingCall, openingCallPct, picks, locks);
  if (!first.needsDeposit) return first;

  // Build a Deposit tx from the server.
  let txRes: { escrow?: string; alreadyDeposited?: boolean; error?: string; base64?: string };
  try {
    txRes = await fetch("/api/escrow/tx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deposit", wallet, arena, nickname, openingCall, openingCallPct, picks, locks })
    }).then((r) => r.json());
  } catch {
    return { error: "Couldn't reach the server to prepare your deposit — try again." };
  }
  if (txRes.escrow === "inactive") return { error: "escrow is inactive on the server" };
  // Already paid on chain → just claim the seat, no signing.
  if (txRes.alreadyDeposited) return { ...(await finishSeat(wallet, nickname, arena, undefined, openingCall, openingCallPct, picks, locks)), deposited: true };
  if (txRes.error || !txRes.base64) return { error: txRes.error ?? "could not build the deposit" };

  // Sign + broadcast via the connected wallet.
  let sig: string;
  onStep?.("deposit");
  try { sig = await signAndBroadcastLegacy(wallet, txRes.base64, "The deposit", () => onStep?.("confirming"), (name) => onStep?.("waiting", name), () => onStep?.("again")); }
  catch (err) { return { error: err instanceof Error ? err.message : "The deposit failed in your wallet." }; }

  onStep?.("seating");
  const done = await finishSeat(wallet, nickname, arena, sig, openingCall, openingCallPct, picks, locks);
  return { ...done, deposited: true, escrowSignature: sig };
}

/** Change my opening call (and optionally its size, % of the vault) while the arena is still enrolling. */
export async function setOpeningCall(wallet: string, arena: string, call: OpeningCall, pct?: number): Promise<{ ok?: boolean; error?: string; needsAuth?: boolean; pct?: number | null }> {
  try {
    const { data } = await postAsWallet("/api/round/call", wallet, { wallet, arena, call, pct });
    return data as { ok?: boolean; error?: string; needsAuth?: boolean; pct?: number | null };
  } catch {
    return { error: "network error" };
  }
}

/** Change some or all of my predictions picks, and/or my lock, while the arena is still enrolling. */
export async function setPicks(wallet: string, arena: string, picks?: Picks, locks?: string[]): Promise<{ ok?: boolean; error?: string; needsAuth?: boolean; picks?: Picks; locks?: string[] }> {
  try {
    const { data } = await postAsWallet("/api/round/picks", wallet, { wallet, arena, picks, locks });
    return data as { ok?: boolean; error?: string; needsAuth?: boolean; picks?: Picks; locks?: string[] };
  } catch {
    return { error: "network error" };
  }
}

/** Streak: pick this leg's answer while its window is open. */
export async function setStreakPick(wallet: string, arena: string, pick: string): Promise<{ ok?: boolean; error?: string; needsAuth?: boolean; pick?: string }> {
  try {
    const { data } = await postAsWallet("/api/round/picks", wallet, { wallet, arena, pick });
    return data as { ok?: boolean; error?: string; needsAuth?: boolean; pick?: string };
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
export async function claimFromEscrow(
  wallet: string, arena: string, recover = false, onSlow?: (walletName: string) => void, roundVault?: string, onRetry?: () => void
): Promise<{ signature?: string; error?: string; escrow?: string }> {
  let txRes: { escrow?: string; error?: string; base64?: string };
  try {
    txRes = await fetch("/api/escrow/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(arena ? { action: recover ? "recover" : "claim", wallet, arena } : { action: recover ? "recover" : "claim", wallet, roundVault })
    }).then((r) => r.json());
  } catch {
    return { error: "Couldn't reach the server — try again." };
  }
  if (txRes.escrow === "inactive") return { error: "escrow is inactive" };
  if (txRes.error || !txRes.base64) return { error: txRes.error ?? "couldn't build the withdrawal" };
  try {
    const signature = await signAndBroadcastLegacy(wallet, txRes.base64, recover ? "The refund" : "The withdrawal", undefined, onSlow, onRetry);
    return { signature };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "wallet signing failed" };
  }
}

export type TradeResult = {
  round?: Round; entrant?: Entrant; yesPrice?: number; standings?: Entrant[];
  /** e.g. "Bought UP at 44¢." */
  fill?: string;
  error?: string;
  /** The price moved from the one shown; `yesPrice` is the new one. */
  repriced?: boolean;
  /** Price momentarily unsettled — try again in a few seconds. */
  retry?: boolean;
  /** Last call passed; trading is closed for this round. */
  closed?: boolean;
};

/** `quotedYes` is the UP price the player was looking at — the server refuses a fill far from it. */
export async function tradeRound(args: { wallet: string; action: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number; arena?: string; quotedYes?: number }): Promise<TradeResult> {
  try {
    const { data } = await postAsWallet("/api/round/trade", args.wallet, args);
    return data as TradeResult;
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
