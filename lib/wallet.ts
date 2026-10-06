/**
 * The one place the app talks to the player's Solana wallet (browser only).
 *
 * The Pit is X-only: the wallet is always the Solana wallet Privy keeps for
 * the player's X account (see lib/privy-client). It signs inside the page —
 * Privy shows its own confirmation — and the app sends every transaction
 * through its own RPC, so it always lands on this app's cluster.
 */

import { getPrivyBridge, privyProvider, XSignInError } from "@/lib/privy-client";

type Pk = { toString(): string } | null | undefined;

export type SolanaProvider = {
  publicKey?: Pk;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<unknown>;
  disconnect?(): Promise<void>;
  signTransaction?(tx: unknown): Promise<{ serialize(): Uint8Array }>;
};

export type WalletOption = { name: string; provider: SolanaProvider };

export class WalletError extends Error {
  constructor(public reason: "none" | "cancelled" | "wrong-account" | "unsupported" | "not-connected" | "failed" | "expired", message: string) {
    super(message);
  }
}

const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

function pkOf(res: unknown, p: SolanaProvider): string | null {
  const fromRes = (res as { publicKey?: Pk } | null)?.publicKey;
  const pk = fromRes ?? p.publicKey;
  const s = pk?.toString?.();
  return s && s.length >= 32 ? s : null;
}

const X_WALLET: WalletOption = { name: "your X wallet", provider: privyProvider };

// ---- Errors ---------------------------------------------------------------

/** Turn anything a wallet throws into one plain sentence for the player. */
export function describeWalletError(err: unknown, action = "The request"): string {
  if (err instanceof WalletError || err instanceof XSignInError) return err.message;
  const e = err as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } } | null;
  const code = Number(e?.code ?? e?.error?.code);
  const msg = String(e?.message ?? e?.error?.message ?? (typeof err === "string" ? err : "")).trim();
  if (code === 4001 || /user rejected|rejected the request|denied|declined|cancel|user closed|window closed/i.test(msg)) {
    return `${action} was cancelled in your X wallet.`;
  }
  if (code === 4100 || code === 4900 || /not been authorized|unauthori[sz]ed|not connected|disconnected/i.test(msg)) {
    return "Your X wallet isn't ready — sign in with X again and retry.";
  }
  if (code === -32002 || /already pending|already processing/i.test(msg)) {
    return "Your wallet already has a request open — finish or close it, then try again.";
  }
  return msg ? `${action} failed in your X wallet: ${msg.slice(0, 180)}` : `${action} failed in your X wallet.`;
}

function asWalletError(err: unknown, action: string): WalletError {
  if (err instanceof WalletError) return err;
  const text = describeWalletError(err, action);
  return new WalletError(/cancelled/.test(text) ? "cancelled" : "failed", text);
}

// ---- Connect ----------------------------------------------------------------

/**
 * Make sure the X wallet is ready and is `expected` (the wallet this page is
 * signed in as) and return it.
 */
export async function ensureWalletFor(expected: string): Promise<WalletOption> {
  let addr: string | null;
  try { addr = pkOf(await X_WALLET.provider.connect(), X_WALLET.provider); }
  catch (err) { throw asWalletError(err, "Getting your X wallet ready"); }
  if (!addr) throw new WalletError("not-connected", "Your X wallet isn't ready — sign in with X again.");
  if (addr !== expected) {
    const who = getPrivyBridge()?.xUsername;
    throw new WalletError(
      "wrong-account",
      `You're signed in to X${who ? ` as @${who}` : ""} with wallet ${short(addr)}, but this page is playing as ${short(expected)}. Sign out and sign in again.`
    );
  }
  return X_WALLET;
}

// ---- Diagnostics ---------------------------------------------------------------

/**
 * Wallet prompts run in the browser, out of the server's sight. Failures and
 * slow prompts are reported to /api/client-log so they show in server logs.
 * Public data only.
 */
export function reportWallet(event: string, data: { wallet?: string; walletName?: string; action?: string; message?: string; ms?: number }): void {
  try {
    const body = JSON.stringify({ event, page: location.pathname, ...data });
    if (!navigator.sendBeacon?.("/api/client-log", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/client-log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* diagnostics must never break a flow */ }
}

/** A wallet prompt left unanswered this long gets a "where is it?" hint. */
const SLOW_MS = 15_000;

function errText(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  return `${e?.code ?? ""} ${String(e?.message ?? err ?? "")}`.trim().slice(0, 200);
}

// ---- Signing -----------------------------------------------------------------

/** Solana's reply to a send, in a sentence (the wallet already signed). */
function explainSendError(err: unknown, action: string): WalletError {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) {
    return new WalletError("expired", `${action} expired while it waited in your X wallet (Solana transactions last about a minute). Nothing was taken — try again and approve it straight away.`);
  }
  if (/insufficient (funds|lamports)|no record of a prior credit|0x1\b/i.test(msg)) {
    return new WalletError("failed", `${action} was rejected by Solana: not enough USDC or SOL in your X wallet. Nothing was taken.`);
  }
  if (/already been processed/i.test(msg)) return new WalletError("failed", `${action} was already sent.`);
  return new WalletError("failed", `${action} was signed but Solana rejected it: ${msg.replace(/^.*?Transaction simulation failed: /, "").slice(0, 160)}. Nothing was taken.`);
}

/**
 * Sign a transaction as `expected` and send it. The wallet only signs; the
 * app sends through its own RPC (`broadcast`), so the transaction always
 * goes to this app's cluster whatever network the wallet is set to — a
 * wallet's own "sign and send" uses the wallet's network. Returns the
 * transaction signature.
 */
export async function signAndSendAs(
  expected: string,
  tx: unknown,
  broadcast: (raw: Uint8Array) => Promise<string>,
  action = "The transaction",
  onSlow?: (walletName: string) => void
): Promise<string> {
  const started = Date.now();
  const timer = setTimeout(() => {
    onSlow?.(X_WALLET.name);
    reportWallet("slow", { wallet: expected, walletName: "x-wallet", action, ms: SLOW_MS });
  }, SLOW_MS);
  let name = X_WALLET.name;
  try {
    const ready = await ensureWalletFor(expected);
    const p = ready.provider;
    name = ready.name;

    if (typeof p.signTransaction === "function") {
      let signed: { serialize(): Uint8Array };
      try { signed = await p.signTransaction(tx); }
      catch (err) {
        reportWallet("error", { wallet: expected, walletName: name, action, message: errText(err), ms: Date.now() - started });
        throw asWalletError(err, action);
      }
      clearTimeout(timer);
      let raw: Uint8Array;
      try { raw = signed.serialize(); }
      catch { throw new WalletError("failed", "Your X wallet returned the transaction without a signature — try again."); }
      try {
        return await broadcast(raw);
      } catch (err) {
        reportWallet("send-failed", { wallet: expected, walletName: name, action, message: errText(err), ms: Date.now() - started });
        throw explainSendError(err, action);
      }
    }

    throw new WalletError("unsupported", `${name} can't sign transactions.`);
  } catch (err) {
    if (err instanceof WalletError && (err.reason === "wrong-account" || err.reason === "not-connected" || err.reason === "none" || err.reason === "unsupported")) {
      reportWallet("error", { wallet: expected, walletName: name, action, message: err.message, ms: Date.now() - started });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
