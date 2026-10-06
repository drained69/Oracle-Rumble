/**
 * Username utilities.
 *
 * A player's username is their X handle (set at first sign-in, see
 * lib/profile-store). It maps to `Entrant.nickname` on the wire. Validation
 * below is for local development without X, where the server accepts a
 * self-chosen name (3–16 letters, numbers or underscores).
 */

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
 * The entrant's nickname (their X handle), else the shortened wallet address.
 */
export function displayName(entrant: { wallet: string; nickname?: string } | null | undefined): string {
  if (!entrant) return "";
  if (entrant.nickname && entrant.nickname.trim().length > 0) return entrant.nickname;
  return shortPk(entrant.wallet);
}
