/**
 * The name a wallet plays under (server-only).
 *
 * With Privy configured the app is X-only: a wallet's name is its X
 * account's handle (set once at first sign-in) and every pit — practice
 * included — needs one. Without Privy (local development), players pick
 * their own username.
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
  // X-only: every player is an X account, practice included.
  void practice;
  const profile = await getProfile(wallet);
  return profile ? { name: profile.username, needsX: false } : { name: "", needsX: true };
}

export const NEEDS_X_MESSAGE = "Sign in with X to play — your X handle is your username.";
