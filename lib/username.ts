/**
 * Username utilities — validation is shared with the server; the storage
 * helpers are browser-only.
 *
 * A username is what a player is called across the site (roster, arena
 * stage, activity feed, champion screen, invite views). It is stored per
 * wallet in localStorage so the same wallet reuses the same handle across
 * arenas. On the wire it maps to the existing `Entrant.nickname` field so
 * the server + persisted rounds keep working unchanged.
 *
 * Validation:
 *   - 3–16 characters
 *   - letters, numbers, underscores only
 *   - case-insensitive uniqueness inside a single arena (checked by caller)
 */

const STORAGE_KEY = "oracle-rumble/usernames/v1";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/** Trim + validate a candidate username. Returns the cleaned value or a reason. */
export function validateUsername(raw: string): UsernameValidation {
  const v = (raw ?? "").trim();
  if (v.length === 0) return { ok: false, reason: "Pick a username." };
  if (v.length < USERNAME_MIN) return { ok: false, reason: `At least ${USERNAME_MIN} characters.` };
  if (v.length > USERNAME_MAX) return { ok: false, reason: `At most ${USERNAME_MAX} characters.` };
  if (!USERNAME_PATTERN.test(v)) return { ok: false, reason: "Letters, numbers, or underscore only." };
  return { ok: true, value: v };
}

/** Case-insensitive equality — used for arena-scoped uniqueness. */
export function sameUsername(a: string, b: string): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

/** Check that a candidate username is not already used inside an arena. */
export function isUsernameFreeInArena(
  candidate: string,
  entrants: { wallet: string; nickname: string }[],
  selfWallet?: string
): boolean {
  const c = candidate.toLowerCase();
  return !entrants.some(
    (e) => e.nickname && e.nickname.toLowerCase() === c && e.wallet !== selfWallet
  );
}

// ── per-wallet persistence ─────────────────────────────────────────

type WalletMap = Record<string, string>;

function read(): WalletMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as WalletMap : {};
  } catch {
    return {};
  }
}

function write(map: WalletMap) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* quota / private mode */ }
}

/** Look up the stored username for a wallet (empty string if none). */
export function getStoredUsername(wallet: string | null | undefined): string {
  if (!wallet) return "";
  const map = read();
  return map[wallet] ?? "";
}

/** Save (or overwrite) the username for a wallet. */
export function saveStoredUsername(wallet: string, username: string): void {
  const v = validateUsername(username);
  if (!v.ok || !wallet) return;
  const map = read();
  map[wallet] = v.value;
  write(map);
}

/** Remove a wallet's stored username. */
export function clearStoredUsername(wallet: string): void {
  const map = read();
  delete map[wallet];
  write(map);
}

// ── display fallback ────────────────────────────────────────────────

/** Short (4…4) wallet address for display. */
export function shortPk(pk: string): string {
  if (!pk) return "";
  if (pk.startsWith("bot:")) return pk.slice(4).toUpperCase();
  if (pk.length <= 10) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

/**
 * Resolve what to show for a given entrant / wallet.
 * Prefers (in order): explicit nickname on the entrant, saved local username
 * for that wallet, shortened wallet address.
 */
export function displayName(entrant: { wallet: string; nickname?: string } | null | undefined): string {
  if (!entrant) return "";
  if (entrant.nickname && entrant.nickname.trim().length > 0) return entrant.nickname;
  const stored = getStoredUsername(entrant.wallet);
  if (stored) return stored;
  return shortPk(entrant.wallet);
}
