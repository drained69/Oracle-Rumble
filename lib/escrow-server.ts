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
  Transaction
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
  // Disable the WebSocket endpoint entirely — Railway's bundle drops the
  // optional `bufferutil` dep, which makes `Connection.confirmTransaction`
  // (WS-based) hang forever on `bufferUtil.mask is not a function`. Setting
  // wsEndpoint to a bogus value that never opens keeps HTTP calls working
  // while forcing us to poll via getSignatureStatus below.
  if (!_g.__or_conn) {
    _g.__or_conn = new Connection(RPC, { commitment: "confirmed", wsEndpoint: undefined });
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
};

export async function initArenaOnChain(p: InitArenaParams): Promise<{ ok: true; record: RoundEscrow } | { ok: false; error: string }> {
  const host = hostKeypair();
  if (!escrowReady() || !host || !USDC_MINT) return { ok: false, error: "escrow inactive" };
  const roundSeed = newRoundSeed();
  const [roundVault] = roundVaultPda(host.publicKey, roundSeed);
  // Recovery kicks in after enrollment + a generous slack, so players can
  // reclaim funds if the operator ever fails to settle.
  const settleDeadline = Math.floor(Date.now() / 1000) + Math.max(p.enrollmentSec, 30) + 60 * 60;
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

// ── CLIENT-SIGNED TX BUILDERS ────────────────────────────────────────────
/** Wrap instructions into a legacy Transaction; return base64 for wallet signing. */
async function buildTx(ixs: Awaited<ReturnType<typeof ixDeposit>>[], feePayer: PublicKey): Promise<string> {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  for (const ix of ixs) tx.add(ix);
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

export async function buildDepositTx(player: PublicKey, roundVault: PublicKey): Promise<{ base64: string } | { error: string }> {
  if (!escrowReady() || !USDC_MINT) return { error: "escrow inactive" };
  // Prepend an idempotent ATA-create for the player's USDC ATA. Without this
  // a fresh wallet that has never held USDC on this cluster has no ATA yet,
  // Deposit simulation fails, and Backpack/Phantom flag the tx "unsafe".
  // The idempotent variant is a no-op if the ATA already exists.
  const createAta = ixCreateAtaIdempotent({ payer: player, owner: player, mint: USDC_MINT });
  const deposit = ixDeposit({ player, roundVault, mint: USDC_MINT });
  const base64 = await buildTx([createAta, deposit], player);
  return { base64 };
}

export async function buildWithdrawTx(player: PublicKey, roundVault: PublicKey, recover = false): Promise<{ base64: string } | { error: string }> {
  if (!escrowReady() || !USDC_MINT) return { error: "escrow inactive" };
  // Ditto: recover/claim may be the first time the wallet touches USDC.
  const createAta = ixCreateAtaIdempotent({ payer: player, owner: player, mint: USDC_MINT });
  const withdraw = ixWithdraw({ player, roundVault, mint: USDC_MINT, recover });
  const base64 = await buildTx([createAta, withdraw], player);
  return { base64 };
}

// ── SETTLE: server signs + submits SettlePlayer + CloseSettlement ────────
export type SettleEntry = { wallet: string; entitlementUsdc: number };

export async function settleArenaOnChain(roundVaultPk: string, players: SettleEntry[]): Promise<{ ok: true; signatures: string[] } | { ok: false; error: string }> {
  const host = hostKeypair();
  if (!escrowReady() || !host) return { ok: false, error: "escrow inactive" };
  const roundVault = new PublicKey(roundVaultPk);
  const sigs: string[] = [];
  try {
    for (const p of players) {
      const playerPk = new PublicKey(p.wallet);
      const [playerEntry] = playerEntryPda(roundVault, playerPk);
      const ix = ixSettlePlayer({ host: host.publicKey, roundVault, playerEntry, entitlementUsdc: p.entitlementUsdc });
      const sig = await signSendConfirm(new Transaction().add(ix), [host]);
      sigs.push(sig);
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
export async function confirmSignature(signature: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const res = await connection().confirmTransaction(signature, "confirmed");
    if (res.value.err) return { ok: false, err: JSON.stringify(res.value.err) };
    return { ok: true };
  } catch (err) {
    return { ok: false, err: err instanceof Error ? err.message : "confirm failed" };
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

// re-exports so routes only import from this one server module
export { associatedTokenAddress, roundVaultPda, playerEntryPda };
