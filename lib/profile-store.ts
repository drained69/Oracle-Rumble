/**
 * Player profiles — a wallet's username, bound to its X (Twitter) account.
 *
 * A username is set once: the first time a signed-in wallet connects its X
 * account, its X handle becomes its username for good. An X account can be
 * bound to one wallet only, so nobody can play under someone else's handle.
 *
 * Postgres when DATABASE_URL is set, an in-memory map otherwise (local dev).
 */

import { dbPool, STORE_ENABLED } from "@/lib/round-store";

export type Profile = {
  wallet: string;
  /** Shown everywhere in the game; the X handle without "@". */
  username: string;
  xId: string;
  setAt: number;
};

const _g = globalThis as unknown as { __or_profiles?: Map<string, Profile>; __or_profilesReady?: Promise<void> };
const mem: Map<string, Profile> = (_g.__or_profiles ??= new Map());

function ready(): Promise<void> {
  if (!STORE_ENABLED) return Promise.resolve();
  _g.__or_profilesReady ??= dbPool().query(`
    CREATE TABLE IF NOT EXISTS profiles (
      wallet    TEXT PRIMARY KEY,
      username  TEXT NOT NULL,
      x_id      TEXT NOT NULL UNIQUE,
      set_at    BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_idx ON profiles (lower(username));
  `).then(() => undefined);
  return _g.__or_profilesReady;
}

type Row = { wallet: string; username: string; x_id: string; set_at: string };
const fromRow = (r: Row): Profile => ({ wallet: r.wallet, username: r.username, xId: r.x_id, setAt: Number(r.set_at) });

export async function getProfile(wallet: string): Promise<Profile | null> {
  if (!STORE_ENABLED) return mem.get(wallet) ?? null;
  await ready();
  const { rows } = await dbPool().query<Row>("SELECT * FROM profiles WHERE wallet = $1", [wallet]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getProfiles(wallets: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  if (wallets.length === 0) return out;
  if (!STORE_ENABLED) {
    for (const w of wallets) { const p = mem.get(w); if (p) out.set(w, p); }
    return out;
  }
  await ready();
  const { rows } = await dbPool().query<Row>("SELECT * FROM profiles WHERE wallet = ANY($1)", [wallets]);
  for (const r of rows) out.set(r.wallet, fromRow(r));
  return out;
}

export type BindResult =
  | { ok: true; profile: Profile; created: boolean }
  | { ok: false; reason: "x-taken" | "username-taken"; message: string };

/**
 * Bind `wallet` to an X account. The first bind sets the username for good;
 * later calls return the existing profile unchanged (the username can't be
 * changed, even by connecting a different X account).
 */
export async function bindXProfile(wallet: string, xId: string, xUsername: string): Promise<BindResult> {
  const existing = await getProfile(wallet);
  if (existing) return { ok: true, profile: existing, created: false };
  const profile: Profile = { wallet, username: xUsername, xId, setAt: Date.now() };
  if (!STORE_ENABLED) {
    for (const p of mem.values()) {
      if (p.xId === xId) return { ok: false, reason: "x-taken", message: `@${xUsername} is already linked to another wallet.` };
      if (p.username.toLowerCase() === xUsername.toLowerCase()) return { ok: false, reason: "username-taken", message: `The username ${xUsername} is already taken.` };
    }
    mem.set(wallet, profile);
    return { ok: true, profile, created: true };
  }
  await ready();
  try {
    const { rowCount } = await dbPool().query(
      "INSERT INTO profiles (wallet, username, x_id, set_at) VALUES ($1, $2, $3, $4) ON CONFLICT (wallet) DO NOTHING",
      [wallet, xUsername, xId, profile.setAt]
    );
    if (!rowCount) return { ok: true, profile: (await getProfile(wallet))!, created: false };
    return { ok: true, profile, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/x_id/.test(msg)) return { ok: false, reason: "x-taken", message: `@${xUsername} is already linked to another wallet.` };
    if (/username/.test(msg)) return { ok: false, reason: "username-taken", message: `The username ${xUsername} is already taken.` };
    throw err;
  }
}
