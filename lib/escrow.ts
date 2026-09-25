/**
 * Oracle Rumble escrow — TypeScript client for the on-chain program.
 *
 * Pure @solana/web3.js (no @solana/spl-token dependency): PDAs, associated
 * token addresses and instruction data are all derived/encoded by hand so this
 * module works unchanged in the browser and on the server.
 *
 * The program (program/src/lib.rs) is a non-custodial escrow: a program-owned
 * token account holds every player's entry + trading vault; the host can only
 * assign entitlements bounded by what was escrowed; players claim their own
 * entitlement; and if the host stalls, players recover their funds after the
 * deadline.
 *
 * Escrow is ACTIVE only when NEXT_PUBLIC_ESCROW_PROGRAM_ID is set (i.e. the
 * program is deployed and configured). Until then the app runs in ledger mode
 * and `ESCROW_ACTIVE` is false.
 */

import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction
} from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? process.env.ESCROW_PROGRAM_ID ?? "";
const USDC_MINT_STR =
  process.env.NEXT_PUBLIC_USDC_MINT ?? process.env.USDC_MINT ?? "";

/** Whether the escrow program is deployed + configured for this deployment. */
export const ESCROW_ACTIVE = PROGRAM_ID_STR.length > 0 && USDC_MINT_STR.length > 0;

export const ESCROW_PROGRAM_ID = PROGRAM_ID_STR ? new PublicKey(PROGRAM_ID_STR) : null;
export const USDC_MINT = USDC_MINT_STR ? new PublicKey(USDC_MINT_STR) : null;

/** USDC has 6 decimals — convert a human USDC amount to base units. */
export function toBaseUnits(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1e6));
}
export function fromBaseUnits(units: bigint | number): number {
  return Number(units) / 1e6;
}

// ── seeds (must match program/src/lib.rs) ───────────────────────────────
const ROUND_SEED = Buffer.from("round");
const AUTH_SEED = Buffer.from("auth");
const PLAYER_SEED = Buffer.from("player");

function pid(): PublicKey {
  if (!ESCROW_PROGRAM_ID) throw new Error("ESCROW_INACTIVE: NEXT_PUBLIC_ESCROW_PROGRAM_ID not set");
  return ESCROW_PROGRAM_ID;
}

/** RoundVault PDA — one per hosted rumble. `roundSeed` is 32 bytes. */
export function roundVaultPda(host: PublicKey, roundSeed: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ROUND_SEED, host.toBuffer(), Buffer.from(roundSeed)], pid());
}

/** Vault authority PDA — owns the escrow token account, signs payouts. */
export function vaultAuthorityPda(roundVault: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([AUTH_SEED, roundVault.toBuffer()], pid());
}

/** PlayerEntry PDA — one seat per wallet per round. */
export function playerEntryPda(roundVault: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PLAYER_SEED, roundVault.toBuffer(), wallet.toBuffer()], pid());
}

/** Associated token account address for (owner, mint). */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// ── instruction encoding (borsh: u8 tag + LE fields) ────────────────────
function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function u16le(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}

/** A fresh 32-byte round seed (base for the RoundVault PDA). */
export function newRoundSeed(): Uint8Array {
  const s = new Uint8Array(32);
  globalThis.crypto.getRandomValues(s); // available in modern browsers and Node 20+
  return s;
}

export type InitRoundParams = {
  host: PublicKey;
  roundSeed: Uint8Array;
  mint: PublicKey;
  entryUsdc: number;
  vaultUsdc: number;
  capacity: number;
  settleDeadline: number; // unix seconds
};

/** InitRound (tag 0). */
export function ixInitRound(p: InitRoundParams): TransactionInstruction {
  const [roundVault] = roundVaultPda(p.host, p.roundSeed);
  const [vaultAuthority] = vaultAuthorityPda(roundVault);
  const escrowTa = associatedTokenAddress(vaultAuthority, p.mint);
  const data = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(p.roundSeed),
    u64le(toBaseUnits(p.entryUsdc)),
    u64le(toBaseUnits(p.vaultUsdc)),
    u16le(p.capacity),
    i64le(BigInt(Math.floor(p.settleDeadline)))
  ]);
  return new TransactionInstruction({
    programId: pid(),
    keys: [
      { pubkey: p.host, isSigner: true, isWritable: true },
      { pubkey: roundVault, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: escrowTa, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ],
    data
  });
}

/** Deposit (tag 1) — player funds entry + vault. */
export function ixDeposit(params: {
  player: PublicKey;
  roundVault: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  const { player, roundVault, mint } = params;
  const [vaultAuthority] = vaultAuthorityPda(roundVault);
  const escrowTa = associatedTokenAddress(vaultAuthority, mint);
  const [playerEntry] = playerEntryPda(roundVault, player);
  const playerAta = associatedTokenAddress(player, mint);
  return new TransactionInstruction({
    programId: pid(),
    keys: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: roundVault, isSigner: false, isWritable: true },
      { pubkey: playerEntry, isSigner: false, isWritable: true },
      { pubkey: playerAta, isSigner: false, isWritable: true },
      { pubkey: escrowTa, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ],
    data: Buffer.from([1])
  });
}

/** SettlePlayer (tag 2) — host assigns a player's entitlement. */
export function ixSettlePlayer(params: {
  host: PublicKey;
  roundVault: PublicKey;
  playerEntry: PublicKey;
  entitlementUsdc: number;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: pid(),
    keys: [
      { pubkey: params.host, isSigner: true, isWritable: false },
      { pubkey: params.roundVault, isSigner: false, isWritable: true },
      { pubkey: params.playerEntry, isSigner: false, isWritable: true }
    ],
    data: Buffer.concat([Buffer.from([2]), u64le(toBaseUnits(params.entitlementUsdc))])
  });
}

/** CloseSettlement (tag 3) — host locks settlement so players can claim. */
export function ixCloseSettlement(params: { host: PublicKey; roundVault: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: pid(),
    keys: [
      { pubkey: params.host, isSigner: true, isWritable: false },
      { pubkey: params.roundVault, isSigner: false, isWritable: true }
    ],
    data: Buffer.from([3])
  });
}

/** Claim (tag 4) / Recover (tag 5) — player withdraws to their own wallet. */
export function ixWithdraw(params: {
  player: PublicKey;
  roundVault: PublicKey;
  mint: PublicKey;
  recover?: boolean;
}): TransactionInstruction {
  const { player, roundVault, mint } = params;
  const [vaultAuthority] = vaultAuthorityPda(roundVault);
  const escrowTa = associatedTokenAddress(vaultAuthority, mint);
  const [playerEntry] = playerEntryPda(roundVault, player);
  const playerAta = associatedTokenAddress(player, mint);
  const keys = [
    { pubkey: player, isSigner: true, isWritable: true },
    { pubkey: roundVault, isSigner: false, isWritable: true },
    { pubkey: playerEntry, isSigner: false, isWritable: true },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: escrowTa, isSigner: false, isWritable: true },
    { pubkey: playerAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  ];
  if (params.recover) keys.push({ pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false });
  return new TransactionInstruction({ programId: pid(), keys, data: Buffer.from([params.recover ? 5 : 4]) });
}
