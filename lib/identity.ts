/**
 * The name a wallet plays under (server-only).
 *
 * With Privy configured, usernames are X handles: a wallet's name is the X
 * account it linked (set once, never changed), and a paid arena needs one.
 * Practice arenas let a wallet without X play under its short address.
 * Without Privy, players pick their own username as before.
 */

import { getProfile } from "@/lib/profile-store";
import { PRIVY_ENABLED } from "@/lib/privy-server";
import { validateUsername } from "@/lib/username";

export type PlayerName = { name: string; needsX: false } | { name: ""; needsX: true };

export async function playerName(wallet: string, requested: string | undefined, practice: boolean): Promise<PlayerName> {
  if (!PRIVY_ENABLED) {
    const v = validateUsername(requested ?? "");
    return { name: v.ok ? v.value : "", needsX: false };
  }
  const profile = await getProfile(wallet);
  if (profile) return { name: profile.username, needsX: false };
  // "" → the seat is named after the wallet (e.g. 4czi_54dn).
  return practice ? { name: "", needsX: false } : { name: "", needsX: true };
}

export const NEEDS_X_MESSAGE = "Connect your X account to play — your X handle becomes your username.";
