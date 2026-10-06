/**
 * Seat sync — keeps an escrow arena's roster in step with its on-chain vault.
 *
 * A seat is paid for on chain (the wallet's PlayerEntry PDA) and registered
 * in the ledger by a follow-up enroll request. If that request never arrives
 * — tab closed, connection dropped, server restarted — the player has paid
 * but isn't in the game, and an arena can even be cancelled as "empty" with
 * deposits in it. The keeper calls this before ticking so every paid wallet
 * is seated, and always re-checks right before the round locks.
 */

import { escrowReady, listDepositors, readVault } from "@/lib/escrow-server";
import { humanCount, type Round } from "@/lib/royale";
import { getProfiles } from "@/lib/profile-store";
import { PRIVY_ENABLED } from "@/lib/privy-server";

/** How often an enrolling arena re-checks its vault between polls. */
const CHECK_EVERY_MS = 8_000;
/** Always check this close to the lock, regardless of the throttle. */
const PRE_LOCK_MS = 4_000;
/** If the chain can't be read at lock time, hold the lock at most this long. */
export const LOCK_HOLD_MAX_MS = 60_000;

const _g = globalThis as unknown as { __or_seatSync?: Map<string, number> };
const lastCheck: Map<string, number> = (_g.__or_seatSync ??= new Map());

export type SeatSync = {
  /** Wallets with an on-chain deposit but no seat in the ledger. */
  wallets: string[];
  /** The chain couldn't be read reliably this time. */
  failed: boolean;
};

export async function unseatedDepositors(round: Round | null): Promise<SeatSync> {
  const none: SeatSync = { wallets: [], failed: false };
  if (!round || round.status !== "enrolling" || !round.escrow || !escrowReady()) return none;

  const now = Date.now();
  const humans = humanCount(round);
  const aboutToLock = now >= round.enrollDeadline - PRE_LOCK_MS || humans >= round.config.capacity;
  if (!aboutToLock && now - (lastCheck.get(round.id) ?? 0) < CHECK_EVERY_MS) return none;
  lastCheck.set(round.id, now);
  if (lastCheck.size > 500) {
    for (const [id, t] of lastCheck) if (now - t > 3_600_000) lastCheck.delete(id);
  }

  try {
    const vault = await readVault(round.escrow.roundVault);
    if (!vault) return { wallets: [], failed: true };
    if (vault.deposited <= humans) return none;
    const seated = new Set(round.entrants.filter((e) => !e.isBot).map((e) => e.wallet));
    const deps = await listDepositors(round.escrow.roundVault);
    let wallets = deps.map((d) => d.wallet).filter((w) => !seated.has(w));
    // X-only: a deposit made straight to the program from a wallet with no X
    // account is not a seat — it stays unseated and is refunded in full.
    if (PRIVY_ENABLED && wallets.length) {
      const profiles = await getProfiles(wallets);
      wallets = wallets.filter((w) => profiles.has(w));
    }
    return {
      wallets,
      // The account index can lag the vault counter by a moment.
      failed: deps.length < vault.deposited
    };
  } catch {
    return { wallets: [], failed: true };
  }
}
