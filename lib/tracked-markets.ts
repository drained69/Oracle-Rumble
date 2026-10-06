/**
 * Tracked-markets store (client-only).
 *
 * When The Pit hosts a Panta market on behalf of a player (via
 * marketCreateRegister) OR when the player enters an arena that trades a
 * real Panta market id, we record that market in localStorage so the
 * graduation banner can watch for the "primary → graduated" phase
 * transition.
 *
 * Panta credits the market creator 20% of trading fees forever once a
 * market graduates to the secondary book. Surfacing that moment is
 * important for hosts — otherwise the fee stream is invisible.
 */

export type TrackedMarket = {
  marketId: string;
  question?: string;
  addedAt: number;
  role: "creator" | "player"; // creator = we hosted it, player = we traded it
  celebratedGraduated?: boolean;
};

const KEY = "oracle-rumble/tracked-markets/v1";
const CAP = 50;

function read(): TrackedMarket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j) ? (j as TrackedMarket[]).slice(0, CAP) : [];
  } catch { return []; }
}

function write(list: TrackedMarket[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP))); } catch { /* quota */ }
}

/** Idempotent — repeat calls with the same marketId only update metadata. */
export function trackMarket(entry: Omit<TrackedMarket, "addedAt"> & { addedAt?: number }): void {
  if (!entry.marketId) return;
  const list = read();
  const idx = list.findIndex((m) => m.marketId === entry.marketId);
  const now = Date.now();
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry, addedAt: list[idx].addedAt };
  } else {
    list.unshift({ addedAt: now, ...entry });
  }
  write(list);
}

export function listTrackedMarkets(): TrackedMarket[] { return read(); }

export function markGraduatedCelebrated(marketId: string): void {
  const list = read();
  const idx = list.findIndex((m) => m.marketId === marketId);
  if (idx < 0) return;
  list[idx].celebratedGraduated = true;
  write(list);
}

/**
 * Heuristic: does this look like a real Panta market id (Solana pubkey)
 * rather than one of our synthetic direction-board ids like "dir-BTC-MIN5"?
 * Panta ids are base58 strings, 32-44 chars, no dashes.
 */
export function looksLikePantaMarketId(id: string): boolean {
  if (!id) return false;
  if (id.startsWith("dir-")) return false;
  if (id.includes("-")) return false;
  if (id.length < 32 || id.length > 48) return false;
  return /^[A-HJ-NP-Za-km-z1-9]+$/.test(id);
}
