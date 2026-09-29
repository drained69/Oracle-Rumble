/**
 * Server-only escrow helpers — never imported from client code.
 *
 * Model: the SERVER'S operator key (ESCROW_HOST_SECRET_KEY) is the "host"
 * for every arena. It signs and submits:
 *   - InitRound   (when a user requests a fresh arena)
 *   - SettlePlayer + CloseSettlement (at round settle)
 * The CLIENT WALLET signs (via /api/escrow/tx):
 *   - Deposit  (the player funds their seat)
 *   - Claim    (the player withdraws their settled entitlement)
 *   - Recover  (the player reclaims entry + vault after deadline)
 *
 * Every server-signed call runs OFF the round-store advisory lock (network
 * I/O) and reports its signature back through `Round.escrow.history`.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction
} from "@solana/web3.js";
import {
  ESCROW_ACTIVE,
  ESCROW_PROGRAM_ID,
  USDC_MINT,
  associatedTokenAddress,
  ixCloseSettlement,
  ixCreateAtaIdempotent,
  ixDeposit,
  ixInitRound,
  ixSettlePlayer,
  ixWithdraw,
  newRoundSeed,
  playerEntryPda,
  roundVaultPda
} from "@/lib/escrow";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

const _g = globalThis as unknown as { __or_hostKey?: Keypair; __or_conn?: Connection };

/** Server-held host keypair. Same key used for every arena's InitRound. */
export function hostKeypair(): Keypair | null {
  if (_g.__or_hostKey) return _g.__or_hostKey;
  const raw = process.env.ESCROW_HOST_SECRET_KEY ?? "";
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as number[];
    _g.__or_hostKey = Keypair.fromSecretKey(Uint8Array.from(arr));
    return _g.__or_hostKey;
  } catch {
    return null;
  }
}

export function connection(): Connection {
  // HTTP only. Railway's bundle drops the optional `bufferutil` dep, so any
  // WebSocket call (`confirmTransaction`, `sendAndConfirmTransaction`,
  // `onSignature`, `onAccountChange`) fails with `b.mask is not a function`,
  // retries forever, floods the logs and eventually runs the server out of
  // memory. Nothing server-side may use those — confirm by polling
  // `getSignatureStatus` (see `signSendConfirm` / `confirmSignature`).
  if (!_g.__or_conn) {
    _g.__or_conn = new Connection(RPC, { commitment: "confirmed" });
  }
  return _g.__or_conn;
}

const CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_MS = 1_500;

/**
 * Sign a legacy Transaction with `signers[0]` as fee payer, broadcast, then
 * poll `getSignatureStatus` until confirmed. Never uses a WebSocket, so it
 * works in bundled server builds that drop `bufferutil` (Railway/Vercel).
 */
async function signSendConfirm(tx: Transaction, signers: Keypair[]): Promise<string> {
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" });

  // HTTP-only polling — never opens the WS.
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
    const s = st?.value?.confirmationStatus;
    if (st?.value?.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.value.err)}`);
    if (s === "confirmed" || s === "finalized") return sig;
    // If the blockhash expired without confirmation, bail out early.
    const height = await conn.getBlockHeight("confirmed").catch(() => 0);
    if (height && height > lastValidBlockHeight) {
      throw new Error(`tx ${sig} blockhash expired before confirmation`);
    }
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
  }
  throw new Error(`tx ${sig} not confirmed within ${CONFIRM_TIMEOUT_MS}ms`);
}

/** Fully-configured escrow: program id, USDC mint, and host key present. */
export function escrowReady(): boolean {
  return ESCROW_ACTIVE && !!hostKeypair() && !!USDC_MINT;
}

/**
 * The record we stash on Round.escrow so downstream calls know the on-chain
 * identity of the arena.
 */
export type RoundEscrow = {
  host: string;         // pubkey of the on-chain host (server's operator key)
  roundVault: string;   // PDA holding this arena's funds
  seedBase64: string;   // the 32-byte round_seed used to derive roundVault
  initSignature: string;
  mint: string;
  history: string[];    // human-readable log of on-chain events
};

// ── HOST: server signs + submits InitRound, returns the escrow record ───
export type InitArenaParams = {
  entryUsdc: number;
  vaultUsdc: number;
  capacity: number;
  enrollmentSec: number;
  liveSec: number;
  roundLimit: number;
};

export async function initArenaOnChain(p: InitArenaParams): Promise<{ ok: true; record: RoundEscrow } | { ok: false; error: string }> {
  const host = hostKeypair();
  if (!escrowReady() || !host || !USDC_MINT) return { ok: false, error: "escrow inactive" };
  const roundSeed = newRoundSeed();
  const [roundVault] = roundVaultPda(host.publicKey, roundSeed);
  // Recovery (players reclaiming their seat without a settlement) must never
  // open while the game can still be running, or a player could pull their
  // deposit mid-game and leave the others' settlement short. So the deadline
  // covers the longest possible game: host-seat grace + enrollment + every
  // round with its oracle wait, plus an hour of slack for settlement.
  const longestGameSec = 3 * 60 + Math.max(p.enrollmentSec, 30) + Math.max(1, p.roundLimit) * (p.liveSec + 120);
  const settleDeadline = Math.floor(Date.now() / 1000) + longestGameSec + 60 * 60;
  const ix = ixInitRound({
    host: host.publicKey,
    roundSeed,
    mint: USDC_MINT,
    entryUsdc: p.entryUsdc,
    vaultUsdc: p.vaultUsdc,
    capacity: p.capacity,
    settleDeadline
  });
  try {
    const sig = await signSendConfirm(new Transaction().add(ix), [host]);
    return {
      ok: true,
      record: {
        host: host.publicKey.toBase58(),
        roundVault: roundVault.toBase58(),
        seedBase64: Buffer.from(roundSeed).toString("base64"),
        initSignature: sig,
        mint: USDC_MINT.toBase58(),
        history: [`InitRound ✓ ${sig.slice(0, 12)}…`]
      }
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "InitRound failed" };
  }
}

/** Player's devnet USDC + SOL balances, for a friendly pre-sign funds check. */
export async function playerBalances(owner: PublicKey): Promise<{ usdc: number; sol: number }> {
  const conn = connection();
  const lamports = await conn.getBalance(owner, "confirmed").catch(() => 0);
  let usdc = 0;
  if (USDC_MINT) {
    const ata = associatedTokenAddress(owner, USDC_MINT);
    const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
    usdc = bal?.value.uiAmount ?? 0;
  }
  return { usdc, sol: lamports / 1e9 };
}

// ── CLIENT-SIGNED TX BUILDERS ────────────────────────────────────────────

/** Escrow program errors are Custom(100 + index) — see program/src/lib.rs. */
const ESCROW_ERRORS = [
  "account already initialized", "account not initialized", "not the round host", "the arena is full",
  "the arena is not open", "the arena is not settled", "already claimed", "your payout isn't recorded yet",
  "entitlements exceed escrowed funds", "the recovery deadline hasn't passed", "account mismatch",
  "numeric overflow", "invalid amount"
];

function explainSimulation(err: unknown, logs: string[] | null): string {
  const text = JSON.stringify(err ?? "");
  const custom = /"Custom":(\d+)/.exec(text);
  if (custom) {
    const code = Number(custom[1]);
    if (code >= 100 && code < 100 + ESCROW_ERRORS.length) return ESCROW_ERRORS[code - 100];
    if (code === 1) return "not enough USDC in your wallet";
  }
  if (/InsufficientFundsForFee|insufficient lamports/i.test(text + (logs ?? []).join(" "))) return "not enough SOL for the network fee";
  const line = (logs ?? []).reverse().find((l) => /error|failed/i.test(l));
  return line ? line.replace(/^Program log: /, "").slice(0, 160) : text.slice(0, 160);
}

/**
 * Wrap instructions into a legacy Transaction for the wallet to sign and
 * dry-run it first, so a transaction that would fail on chain is never put
 * in front of the player.
 */
async function buildTx(ixs: Awaited<ReturnType<typeof ixDeposit>>[], feePayer: PublicKey): Promise<{ base64: string } | { error: string }> {
  const conn = connection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  for (const ix of ixs) tx.add(ix);
  try {
    const sim = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, commitment: "confirmed" });
    if (sim.value.err) {
      const why = explainSimulation(sim.value.err, sim.value.logs);
      console.warn(`[escrow] simulation failed payer=${feePayer.toBase58()}: ${why} ${JSON.stringify(sim.value.err)}`);
      return { error: `This transaction would fail on Solana (${why}), so it wasn't sent to your wallet.` };
    }
  } catch (err) {
    // The dry run is a courtesy — an RPC hiccup must not block the player.
    console.warn(`[escrow] simulation unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { base64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64") };
}

/** SPL Memo v2 — a readable note on the deposit (arena, seat, opening call). */
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function ixMemo(text: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text.slice(0, 200), "utf8")
  });
}

export async function buildDepositTx(player: PublicKey, roundVault: PublicKey, memo?: string): Promise<{ base64: string } | { error: string }> {
  if (!escrowReady() || !USDC_MINT) return { error: "escrow inactive" };
  // Prepend an idempotent ATA-create for the player's USDC ATA. Without this
  // a fresh wallet that has never held USDC on this cluster has no ATA yet,
  // Deposit simulation fails, and Backpack/Phantom flag the tx "unsafe".
  // The idempotent variant is a no-op if the ATA already exists.
  const createAta = ixCreateAtaIdempotent({ payer: player, owner: player, mint: USDC_MINT });
  const deposit = ixDeposit({ player, roundVault, mint: USDC_MINT });
  return buildTx(memo ? [createAta, deposit, ixMemo(memo, player)] : [createAta, deposit], player);
}

export async function buildWithdrawTx(player: PublicKey, roundVault: PublicKey, recover = false): Promise<{ base64: string } | { error: string }> {
  if (!escrowReady() || !USDC_MINT) return { error: "escrow inactive" };
  // Ditto: recover/claim may be the first time the wallet touches USDC.
  const createAta = ixCreateAtaIdempotent({ payer: player, owner: player, mint: USDC_MINT });
  const withdraw = ixWithdraw({ player, roundVault, mint: USDC_MINT, recover });
  return buildTx([createAta, withdraw], player);
}

// ── SETTLE: server signs + submits SettlePlayer + CloseSettlement ────────
export type SettleEntry = { wallet: string; entitlementUsdc: number };

/**
 * SettlePlayer for every entry, then CloseSettlement. `expectDeposited` is
 * the vault's deposit count the entries were computed from: if a deposit
 * lands meanwhile, closing would lock that player's USDC for good (an
 * unsettled entry can't claim, a closed vault can't recover), so we stop
 * before closing and report `retry` — SettlePlayer is idempotent.
 */
export async function settleArenaOnChain(roundVaultPk: string, players: SettleEntry[], expectDeposited?: number): Promise<{ ok: true; signatures: string[] } | { ok: false; error: string; retry?: boolean }> {
  const host = hostKeypair();
  if (!escrowReady() || !host) return { ok: false, error: "escrow inactive" };
  const roundVault = new PublicKey(roundVaultPk);
  const sigs: string[] = [];
  try {
    // Several SettlePlayer instructions per transaction (each is tiny), so a
    // full arena records in one or two confirmations instead of one per player.
    const PER_TX = 6;
    for (let i = 0; i < players.length; i += PER_TX) {
      const tx = new Transaction();
      for (const p of players.slice(i, i + PER_TX)) {
        const [playerEntry] = playerEntryPda(roundVault, new PublicKey(p.wallet));
        tx.add(ixSettlePlayer({ host: host.publicKey, roundVault, playerEntry, entitlementUsdc: p.entitlementUsdc }));
      }
      sigs.push(await signSendConfirm(tx, [host]));
    }
    if (expectDeposited !== undefined) {
      const now = await readVault(roundVaultPk);
      if (!now || now.deposited !== expectDeposited) {
        return { ok: false, retry: true, error: "a new deposit landed during settlement — settling again" };
      }
    }
    const closeIx = ixCloseSettlement({ host: host.publicKey, roundVault });
    const closeSig = await signSendConfirm(new Transaction().add(closeIx), [host]);
    sigs.push(closeSig);
    return { ok: true, signatures: sigs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "settle failed" };
  }
}

// ── VERIFICATION ─────────────────────────────────────────────────────────
/**
 * Poll a signature over HTTP until it is confirmed, fails, or `timeoutMs`
 * passes. `pending` means "not seen as confirmed yet" — not a failure.
 */
export async function confirmSignature(signature: string, timeoutMs = 20_000): Promise<{ ok: boolean; err?: string; pending?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const st = await connection().getSignatureStatus(signature, { searchTransactionHistory: true });
      if (st?.value?.err) return { ok: false, err: JSON.stringify(st.value.err) };
      const s = st?.value?.confirmationStatus;
      if (s === "confirmed" || s === "finalized") return { ok: true };
    } catch { /* transient RPC error — keep polling */ }
    if (Date.now() >= deadline) return { ok: false, pending: true, err: "not confirmed yet" };
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
  }
}

/**
 * Ground-truth check: the player's PlayerEntry PDA is initialized on-chain
 * and owned by our program. This is what actually gates enrollment — the
 * signature alone is not enough (an attacker could paste any confirmed sig).
 * The PlayerEntry PDA only exists after a successful Deposit against this
 * arena's roundVault.
 */
export async function verifyPlayerDeposited(walletPk: string, roundVaultPk: string): Promise<{ ok: boolean; err?: string }> {
  if (!escrowReady() || !ESCROW_PROGRAM_ID) return { ok: false, err: "escrow inactive" };
  try {
    const wallet = new PublicKey(walletPk);
    const roundVault = new PublicKey(roundVaultPk);
    const [playerEntry] = playerEntryPda(roundVault, wallet);
    const info = await connection().getAccountInfo(playerEntry, "confirmed");
    if (!info) return { ok: false, err: "no PlayerEntry on-chain" };
    if (!info.owner.equals(ESCROW_PROGRAM_ID)) return { ok: false, err: "PlayerEntry not owned by escrow program" };
    return { ok: true };
  } catch (err) {
    return { ok: false, err: err instanceof Error ? err.message : "verify failed" };
  }
}

// ── On-chain reads for refunds ───────────────────────────────────────────

const PLAYER_ENTRY_SIZE = 84;

export type VaultState = {
  entryUsdc: number;
  vaultUsdc: number;
  deposited: number;
  totalEscrowedUsdc: number;
  settledTotalUsdc: number;
  settleDeadline: number; // unix seconds
  settled: boolean;       // CloseSettlement ran — claims are open
};

/** Decode a RoundVault account's data (layout mirrors program/src/lib.rs). */
function decodeVault(d: Buffer): VaultState | null {
  if (d.length < 160) return null;
  let o = 1 + 96;
  const u64 = () => { const v = Number(d.readBigUInt64LE(o)); o += 8; return v; };
  const entry = u64();
  const vault = u64();
  o += 2; // capacity
  const deposited = d.readUInt16LE(o); o += 2;
  u64(); // pool_total
  const escrowed = u64();
  const settledTotal = u64();
  u64(); // claimed_total
  const deadline = Number(d.readBigInt64LE(o)); o += 8;
  const status = d.readUInt8(o);
  return {
    entryUsdc: entry / 1e6,
    vaultUsdc: vault / 1e6,
    deposited,
    totalEscrowedUsdc: escrowed / 1e6,
    settledTotalUsdc: settledTotal / 1e6,
    settleDeadline: deadline,
    settled: status !== 0
  };
}

/** Read the RoundVault account. */
export async function readVault(roundVaultPk: string): Promise<VaultState | null> {
  const info = await connection().getAccountInfo(new PublicKey(roundVaultPk), "confirmed").catch(() => null);
  return info ? decodeVault(info.data) : null;
}

export type DepositorEntry = { wallet: string; entitlementUsdc: number; settled: boolean; claimed: boolean };

/** Every wallet with a PlayerEntry in this vault — the on-chain truth, not the ledger. */
export async function listDepositors(roundVaultPk: string): Promise<DepositorEntry[]> {
  if (!ESCROW_PROGRAM_ID) return [];
  const accounts = await connection().getProgramAccounts(ESCROW_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: PLAYER_ENTRY_SIZE }, { memcmp: { offset: 1, bytes: roundVaultPk } }]
  });
  return accounts.map(({ account }) => {
    const d = account.data;
    return {
      wallet: new PublicKey(d.subarray(33, 65)).toBase58(),
      entitlementUsdc: Number(d.readBigUInt64LE(73)) / 1e6,
      settled: d.readUInt8(81) === 1,
      claimed: d.readUInt8(82) === 1
    };
  });
}

export type WalletDeposit = DepositorEntry & { roundVault: string; vault: VaultState | null };

/**
 * Every deposit a wallet has made into the escrow program (one PlayerEntry
 * per arena vault), with each vault's state — the on-chain truth for the
 * Positions page, independent of the game ledger.
 */
export async function listWalletDeposits(walletPk: string): Promise<WalletDeposit[]> {
  if (!ESCROW_PROGRAM_ID) return [];
  const conn = connection();
  const accounts = await conn.getProgramAccounts(ESCROW_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: PLAYER_ENTRY_SIZE }, { memcmp: { offset: 33, bytes: walletPk } }]
  });
  const entries = accounts.map(({ account }) => {
    const d = account.data;
    return {
      roundVault: new PublicKey(d.subarray(1, 33)).toBase58(),
      wallet: walletPk,
      entitlementUsdc: Number(d.readBigUInt64LE(73)) / 1e6,
      settled: d.readUInt8(81) === 1,
      claimed: d.readUInt8(82) === 1
    };
  });
  const infos = entries.length
    ? await conn.getMultipleAccountsInfo(entries.map((e) => new PublicKey(e.roundVault)), "confirmed")
    : [];
  return entries.map((e, i) => ({ ...e, vault: infos[i] ? decodeVault(infos[i]!.data) : null }));
}

/** One wallet's PlayerEntry in a vault, or null if it never deposited. */
export async function readPlayerEntry(walletPk: string, roundVaultPk: string): Promise<DepositorEntry | null> {
  if (!ESCROW_PROGRAM_ID) return null;
  try {
    const [pda] = playerEntryPda(new PublicKey(roundVaultPk), new PublicKey(walletPk));
    const info = await connection().getAccountInfo(pda, "confirmed");
    if (!info || !info.owner.equals(ESCROW_PROGRAM_ID) || info.data.length < PLAYER_ENTRY_SIZE) return null;
    const d = info.data;
    return {
      wallet: walletPk,
      entitlementUsdc: Number(d.readBigUInt64LE(73)) / 1e6,
      settled: d.readUInt8(81) === 1,
      claimed: d.readUInt8(82) === 1
    };
  } catch {
    return null;
  }
}

/**
 * Successful transactions on a vault since `sinceMs`, oldest first — used to
 * adopt a settlement that landed on chain but never reached the game record
 * (e.g. the server restarted between CloseSettlement and saving).
 */
export async function vaultSignaturesSince(roundVaultPk: string, sinceMs: number): Promise<string[]> {
  try {
    const sigs = await connection().getSignaturesForAddress(new PublicKey(roundVaultPk), { limit: 40 }, "confirmed");
    return sigs
      .filter((x) => !x.err && (x.blockTime ?? 0) * 1000 >= sinceMs)
      .map((x) => x.signature)
      .reverse();
  } catch {
    return [];
  }
}

// re-exports so routes only import from this one server module
export { associatedTokenAddress, roundVaultPda, playerEntryPda };
