/**
 * The one place the app talks to a Solana wallet extension (browser only).
 *
 * Uses the injected providers of Phantom, Backpack, Solflare, Brave Wallet
 * or any other `window.solana`. When several are installed the player picks
 * one and the choice is remembered, so connecting and signing always hit the
 * same wallet.
 *
 * After a page reload an extension is disconnected from the site until it is
 * asked again, and it refuses to sign in that state. Every signing call here
 * therefore reconnects first (silently when the site is already trusted) and
 * checks the wallet is on the account the page is playing as.
 */

export type WalletKind = "phantom" | "backpack" | "solflare" | "brave" | "injected";

type Pk = { toString(): string } | null | undefined;
type Listener = (...args: unknown[]) => void;

export type SolanaProvider = {
  publicKey?: Pk;
  isConnected?: boolean;
  isPhantom?: boolean;
  isBackpack?: boolean;
  isSolflare?: boolean;
  isBraveWallet?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<unknown>;
  disconnect?(): Promise<void>;
  signMessage?(message: Uint8Array, display?: unknown): Promise<unknown>;
  signTransaction?(tx: unknown): Promise<{ serialize(): Uint8Array }>;
  signAndSendTransaction?(tx: unknown, opts?: unknown): Promise<unknown>;
  on?(event: string, fn: Listener): void;
  off?(event: string, fn: Listener): void;
  removeListener?(event: string, fn: Listener): void;
};

export type WalletOption = { kind: WalletKind; name: string; icon: string | null; provider: SolanaProvider };

export class WalletError extends Error {
  constructor(public reason: "none" | "cancelled" | "wrong-account" | "unsupported" | "not-connected" | "failed", message: string) {
    super(message);
  }
}

const KIND_KEY = "oracle-rumble/wallet-kind/v1";
/** Wallets whose connect({ onlyIfTrusted }) reconnects without a popup. */
const SILENT = new Set<WalletKind>(["phantom", "backpack", "brave"]);

const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

function pkOf(res: unknown, p: SolanaProvider): string | null {
  const fromRes = (res as { publicKey?: Pk } | null)?.publicKey;
  const pk = fromRes ?? p.publicKey;
  const s = pk?.toString?.();
  return s && s.length >= 32 ? s : null;
}

// ---- Wallet Standard: only used to show each wallet's own icon ----------

const icons = new Map<string, string>();
let discovery = false;

function discoverIcons() {
  if (discovery || typeof window === "undefined") return;
  discovery = true;
  const api = {
    register: (...wallets: Array<{ name?: unknown; icon?: unknown }>) => {
      for (const w of wallets) {
        if (typeof w?.name === "string" && typeof w?.icon === "string" && /^data:image\/(svg\+xml|png|webp|jpeg|gif);base64,/.test(w.icon)) {
          icons.set(w.name.toLowerCase(), w.icon);
        }
      }
      return () => { /* unregister: icons are cosmetic, keep them */ };
    }
  };
  try {
    window.addEventListener("wallet-standard:register-wallet", (e) => {
      try { ((e as CustomEvent).detail as (a: typeof api) => void)(api); } catch { /* ignore a broken wallet */ }
    });
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  } catch { /* old browser */ }
}

// ---- Discovery ----------------------------------------------------------

function nameOfInjected(p: SolanaProvider): string {
  if (p.isPhantom) return "Phantom";
  if (p.isBraveWallet) return "Brave Wallet";
  if (p.isSolflare) return "Solflare";
  if (p.isBackpack) return "Backpack";
  return "Browser wallet";
}

/** Solana wallets installed in this browser, most specific first. */
export function listWallets(): WalletOption[] {
  if (typeof window === "undefined") return [];
  discoverIcons();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const found: Array<{ kind: WalletKind; name: string; provider: SolanaProvider | undefined }> = [
    { kind: "phantom", name: "Phantom", provider: w.phantom?.solana?.isPhantom ? w.phantom.solana : undefined },
    { kind: "backpack", name: "Backpack", provider: w.backpack?.solana ?? (w.backpack?.isBackpack ? w.backpack : undefined) },
    { kind: "solflare", name: "Solflare", provider: w.solflare?.isSolflare ? w.solflare : undefined },
    { kind: "brave", name: "Brave Wallet", provider: w.braveSolana }
  ];
  const generic: SolanaProvider | undefined = w.solana;
  if (generic) found.push({ kind: "injected", name: nameOfInjected(generic), provider: generic });

  const out: WalletOption[] = [];
  for (const f of found) {
    const p = f.provider;
    if (!p || typeof p.connect !== "function") continue;
    // window.solana is usually one of the named wallets again.
    if (out.some((o) => o.provider === p || o.name === f.name)) continue;
    out.push({ kind: f.kind, name: f.name, icon: icons.get(f.name.toLowerCase()) ?? null, provider: p });
  }
  return out;
}

export function rememberedKind(): WalletKind | null {
  try { return (localStorage.getItem(KIND_KEY) as WalletKind | null) ?? null; } catch { return null; }
}

function remember(kind: WalletKind | null) {
  try { if (kind) localStorage.setItem(KIND_KEY, kind); else localStorage.removeItem(KIND_KEY); } catch { /* ignore */ }
}

/** The wallet the player connected with, or the only/first one installed. */
export function activeWallet(): WalletOption | null {
  const all = listWallets();
  const kind = rememberedKind();
  return all.find((o) => o.kind === kind) ?? all[0] ?? null;
}

// ---- Errors ---------------------------------------------------------------

/** Turn anything a wallet throws into one plain sentence for the player. */
export function describeWalletError(err: unknown, action = "The request"): string {
  if (err instanceof WalletError) return err.message;
  const e = err as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } } | null;
  const code = Number(e?.code ?? e?.error?.code);
  const msg = String(e?.message ?? e?.error?.message ?? (typeof err === "string" ? err : "")).trim();
  if (code === 4001 || /user rejected|rejected the request|denied|declined|cancel|user closed|window closed/i.test(msg)) {
    return `${action} was cancelled in your wallet.`;
  }
  if (code === 4100 || code === 4900 || /not been authorized|unauthori[sz]ed|not connected|disconnected/i.test(msg)) {
    return "Your wallet isn't connected to this site — reconnect it and try again.";
  }
  if (code === -32002 || /already pending|already processing/i.test(msg)) {
    return "Your wallet already has a request open — finish or close it, then try again.";
  }
  if (/locked/i.test(msg)) return "Your wallet is locked — unlock it and try again.";
  return msg ? `${action} failed in your wallet: ${msg.slice(0, 180)}` : `${action} failed in your wallet.`;
}

function asWalletError(err: unknown, action: string): WalletError {
  if (err instanceof WalletError) return err;
  const text = describeWalletError(err, action);
  return new WalletError(/cancelled/.test(text) ? "cancelled" : "failed", text);
}

// ---- Connect ----------------------------------------------------------------

/** Ask a wallet to connect (shows its popup). Returns the account address. */
export async function connectWallet(kind?: WalletKind): Promise<string> {
  const all = listWallets();
  const opt = (kind && all.find((o) => o.kind === kind)) || activeWallet();
  if (!opt) throw new WalletError("none", "No Solana wallet found in this browser. Install Phantom, Backpack or Solflare, then reload.");
  let addr: string | null;
  try {
    addr = pkOf(await opt.provider.connect(), opt.provider);
  } catch (err) {
    throw asWalletError(err, "The connection request");
  }
  if (!addr) throw new WalletError("not-connected", `${opt.name} didn't share an account — open it, unlock it and try again.`);
  remember(opt.kind);
  bindEvents();
  return addr;
}

/** Reconnect the remembered wallet without a popup (site already trusted). */
export async function reconnectSilently(): Promise<string | null> {
  const opt = activeWallet();
  if (!opt) return null;
  const now = opt.provider.isConnected !== false ? pkOf(null, opt.provider) : null;
  if (now) return now;
  if (!SILENT.has(opt.kind)) return null;
  try { return pkOf(await opt.provider.connect({ onlyIfTrusted: true }), opt.provider); }
  catch { return null; }
}

export async function disconnectWallet(): Promise<void> {
  const opt = activeWallet();
  try { await opt?.provider.disconnect?.(); } catch { /* already gone */ }
}

/**
 * Make sure the wallet is connected to this site on `expected`'s account and
 * return it. Prompts to connect only when a silent reconnect isn't possible.
 */
export async function ensureWalletFor(expected: string): Promise<WalletOption> {
  const opt = activeWallet();
  if (!opt) throw new WalletError("none", "No Solana wallet found in this browser. Install Phantom, Backpack or Solflare, then reload.");
  const p = opt.provider;

  let addr = p.isConnected !== false ? pkOf(null, p) : null;
  if (addr === expected) { bindEvents(); return opt; }

  if (addr !== expected && SILENT.has(opt.kind)) {
    try { addr = pkOf(await p.connect({ onlyIfTrusted: true }), p); } catch { /* not trusted yet */ }
  }
  if (addr !== expected) {
    try { addr = pkOf(await p.connect(), p); }
    catch (err) { throw asWalletError(err, "The connection request"); }
  }
  if (!addr) throw new WalletError("not-connected", `${opt.name} didn't connect — open it, unlock it and try again.`);
  if (addr !== expected) {
    throw new WalletError(
      "wrong-account",
      `${opt.name} is using account ${short(addr)}, but you're playing as ${short(expected)}. Switch to ${short(expected)} in ${opt.name} and try again — or disconnect here and reconnect to play as ${short(addr)}.`
    );
  }
  bindEvents();
  return opt;
}

// ---- Signing -----------------------------------------------------------------

/** Sign an off-chain message as `expected`. Returns the 64-byte signature. */
export async function signMessageAs(expected: string, message: Uint8Array): Promise<Uint8Array> {
  const { provider: p, name, kind } = await ensureWalletFor(expected);
  if (typeof p.signMessage !== "function") {
    throw new WalletError("unsupported", `${name} can't sign messages, which sign-in needs — update it or connect a different wallet.`);
  }
  let out: unknown;
  try {
    // Backpack's second argument is an account, not a display encoding.
    out = kind === "backpack" ? await p.signMessage(message) : await p.signMessage(message, "utf8");
  } catch (err) {
    throw asWalletError(err, "Sign-in");
  }
  const raw = out instanceof Uint8Array || Array.isArray(out) ? out : (out as { signature?: unknown } | null)?.signature;
  const sig = raw instanceof Uint8Array ? raw : Array.isArray(raw) ? Uint8Array.from(raw as number[]) : null;
  if (!sig || sig.length !== 64) throw new WalletError("failed", `${name} didn't return a valid signature.`);
  return sig;
}

/**
 * Sign and send a transaction as `expected`. Uses the wallet's own
 * sign-and-send when it has one, otherwise signs and hands the bytes to
 * `broadcast`. Returns the transaction signature.
 */
export async function signAndSendAs(
  expected: string,
  tx: unknown,
  broadcast: (raw: Uint8Array) => Promise<string>,
  action = "The transaction"
): Promise<string> {
  const { provider: p, name } = await ensureWalletFor(expected);
  let sig: unknown;
  try {
    if (typeof p.signAndSendTransaction === "function") {
      const res = await p.signAndSendTransaction(tx);
      // Phantom/Brave return { signature }, Solflare returns the string.
      sig = typeof res === "string" ? res : (res as { signature?: unknown } | null)?.signature;
    } else if (typeof p.signTransaction === "function") {
      const signed = await p.signTransaction(tx);
      sig = await broadcast(signed.serialize());
    } else {
      throw new WalletError("unsupported", `${name} can't sign transactions.`);
    }
  } catch (err) {
    throw asWalletError(err, action);
  }
  if (typeof sig !== "string" || !sig) throw new WalletError("failed", `${name} didn't return a transaction signature.`);
  return sig;
}

// ---- Account changes -------------------------------------------------------

const watchers = new Set<(address: string | null) => void>();
let bound: { provider: SolanaProvider; onAccount: Listener; onDisconnect: Listener } | null = null;

function bindEvents() {
  const opt = activeWallet();
  if (!opt || bound?.provider === opt.provider) return;
  if (bound) {
    const off = bound.provider.off?.bind(bound.provider) ?? bound.provider.removeListener?.bind(bound.provider);
    try { off?.("accountChanged", bound.onAccount); off?.("disconnect", bound.onDisconnect); } catch { /* ignore */ }
  }
  const p = opt.provider;
  const onAccount: Listener = (pk) => {
    const addr = (pk as Pk)?.toString?.() ?? null;
    watchers.forEach((fn) => fn(addr && addr.length >= 32 ? addr : null));
  };
  const onDisconnect: Listener = () => watchers.forEach((fn) => fn(null));
  try { p.on?.("accountChanged", onAccount); p.on?.("disconnect", onDisconnect); } catch { /* wallet has no events */ }
  bound = { provider: p, onAccount, onDisconnect };
}

/**
 * Called when the wallet switches account (new address) or disconnects the
 * site (null). Returns an unsubscribe function.
 */
export function watchWallet(fn: (address: string | null) => void): () => void {
  watchers.add(fn);
  bindEvents();
  return () => { watchers.delete(fn); };
}
