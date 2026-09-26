/**
 * Round store — Postgres persistence for Market Royale rounds.
 *
 * A single `rounds` table holds each round as a JSONB blob plus a status
 * column for cheap filtering. Every round belongs to an ARENA (a shareable
 * room code); the walk-in bot lobby lives under the reserved `PUBLIC` code
 * and hosted rumbles under a 6-char code. All reads/writes are arena-scoped
 * so many arenas run concurrently without interference.
 *
 * The pool is module-level; Railway runs a long-lived Node process so one
 * pool is reused across requests. Without DATABASE_URL the store is
 * disabled and `enabled` is false (the app falls back to a client-only
 * demo round).
 */

import { Pool } from "pg";
import { PUBLIC_ARENA, normalizeArenaCode, type Round } from "@/lib/royale";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const STORE_ENABLED = DATABASE_URL.length > 0;

// In-memory fallback for local dev / no-DB deployments. Persists across
// requests within one Node process (fine for a single Railway replica or
// `next dev`), resets on restart. Postgres is used whenever available.
// Hung off globalThis so every route module shares one Map even when the
// bundler gives each route its own module registry.
const _g = globalThis as unknown as { __rr_mem?: Map<string, Round> };
const _mem: Map<string, Round> = _g.__rr_mem ?? (_g.__rr_mem = new Map<string, Round>());

/** Force an in-memory Round to have an arenaCode (for pre-multi-arena blobs). */
function withArena(r: Round): Round {
  return r.arenaCode ? r : { ...r, arenaCode: PUBLIC_ARENA };
}
function memSave(round: Round) { _mem.set(round.id, withArena(round)); }
function memActive(arena: string): Round | null {
  const all = [..._mem.values()]
    .map(withArena)
    .filter((r) => r.arenaCode === arena && ["enrolling", "live", "settling", "advancing"].includes(r.status));
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
function memLatest(arena: string): Round | null {
  return [..._mem.values()]
    .map(withArena)
    .filter((r) => r.arenaCode === arena)
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

const _gp = globalThis as unknown as { __rr_pool?: Pool; __rr_ready?: Promise<void> };
function pool(): Pool {
  if (!_gp.__rr_pool) {
    _gp.__rr_pool = new Pool({
      connectionString: DATABASE_URL,
      // Railway internal network doesn't need SSL; public URLs do.
      ssl: DATABASE_URL.includes("railway.internal") ? undefined : { rejectUnauthorized: false },
      max: 5
    });
  }
  return _gp.__rr_pool;
}

export function initSchema(): Promise<void> {
  if (!STORE_ENABLED) return Promise.resolve();
  if (!_gp.__rr_ready) {
    _gp.__rr_ready = pool().query(`
      CREATE TABLE IF NOT EXISTS rounds (
        id          TEXT PRIMARY KEY,
        status      TEXT NOT NULL,
        round_no    INTEGER NOT NULL,
        arena_code  TEXT NOT NULL DEFAULT 'PUBLIC',
        data        JSONB NOT NULL,
        created_at  BIGINT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE rounds ADD COLUMN IF NOT EXISTS arena_code TEXT NOT NULL DEFAULT 'PUBLIC';
      CREATE INDEX IF NOT EXISTS rounds_status_idx ON rounds (status);
      CREATE INDEX IF NOT EXISTS rounds_created_idx ON rounds (created_at DESC);
      CREATE INDEX IF NOT EXISTS rounds_arena_idx ON rounds (arena_code, created_at DESC);
    `).then(() => undefined);
  }
  return _gp.__rr_ready;
}

const ACTIVE = ["enrolling", "live", "settling", "advancing"];

/**
 * 64-bit FNV-1a hash of an arena code, as a bigint. Used as the key for
 * `pg_advisory_xact_lock` so each arena's keeper serializes independently.
 */
function arenaLockKey(arena: string): bigint {
  let h = 0xcbf29ce484222325n;
  const s = arena || PUBLIC_ARENA;
  for (let i = 0; i < s.length; i++) {
    h = BigInt.asIntN(64, (h ^ BigInt(s.charCodeAt(i))) * 0x100000001b3n);
  }
  return h;
}

export async function getActiveRound(arena: string = PUBLIC_ARENA): Promise<Round | null> {
  const code = normalizeArenaCode(arena);
  if (!STORE_ENABLED) return memActive(code);
  await initSchema();
  const { rows } = await pool().query(
    `SELECT data FROM rounds WHERE status = ANY($1) AND arena_code = $2 ORDER BY created_at DESC LIMIT 1`,
    [ACTIVE, code]
  );
  const r = rows[0]?.data as Round | undefined;
  return r ? withArena(r) : null;
}

export async function getLatestRound(arena: string = PUBLIC_ARENA): Promise<Round | null> {
  const code = normalizeArenaCode(arena);
  if (!STORE_ENABLED) return memLatest(code);
  await initSchema();
  const { rows } = await pool().query(
    `SELECT data FROM rounds WHERE arena_code = $1 ORDER BY created_at DESC LIMIT 1`,
    [code]
  );
  const r = rows[0]?.data as Round | undefined;
  return r ? withArena(r) : null;
}

export async function getRound(id: string): Promise<Round | null> {
  if (!STORE_ENABLED) return _mem.get(id) ? withArena(_mem.get(id)!) : null;
  await initSchema();
  const { rows } = await pool().query(`SELECT data FROM rounds WHERE id = $1`, [id]);
  const r = rows[0]?.data as Round | undefined;
  return r ? withArena(r) : null;
}

export async function saveRound(round: Round): Promise<void> {
  const r = withArena(round);
  if (!STORE_ENABLED) { memSave(r); return; }
  await initSchema();
  await pool().query(
    `INSERT INTO rounds (id, status, round_no, arena_code, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       round_no = EXCLUDED.round_no,
       arena_code = EXCLUDED.arena_code,
       data = EXCLUDED.data,
       updated_at = now()`,
    [r.id, r.status, r.roundNumber, r.arenaCode, JSON.stringify(r), r.createdAt]
  );
}

/**
 * Atomically mutate the current active round IN THIS ARENA. On Postgres this
 * runs inside a transaction with `SELECT … FOR UPDATE` so concurrent
 * enroll/trade calls to the same arena serialize instead of clobbering each
 * other. Different arenas are fully independent. Fetch any external data
 * (e.g. the Panta price) BEFORE calling this and close over it.
 *
 * Returns the mutated round, or null if there's no active round for `arena`.
 */
export async function mutateActiveRound(
  arena: string,
  mutator: (round: Round) => void
): Promise<{ round: Round | null; error?: string }> {
  const code = normalizeArenaCode(arena);
  if (!STORE_ENABLED) {
    const r = memActive(code);
    if (!r) return { round: null };
    try { mutator(r); } catch (e) { return { round: r, error: e instanceof Error ? e.message : "mutate error" }; }
    memSave(r);
    return { round: r };
  }
  await initSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT data FROM rounds WHERE status = ANY($1) AND arena_code = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [ACTIVE, code]
    );
    const round = rows[0]?.data ? withArena(rows[0].data as Round) : undefined;
    if (!round) { await client.query("ROLLBACK"); return { round: null }; }
    try {
      mutator(round);
    } catch (e) {
      await client.query("ROLLBACK");
      return { round, error: e instanceof Error ? e.message : "mutate error" };
    }
    await client.query(
      `UPDATE rounds SET status = $2, round_no = $3, arena_code = $4, data = $5, updated_at = now() WHERE id = $1`,
      [round.id, round.status, round.roundNumber, round.arenaCode, JSON.stringify(round)]
    );
    await client.query("COMMIT");
    return { round };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Keeper context — reads/writes bound to one locked transaction so the whole
 * tick/bootstrap/advance sequence is atomic FOR ONE ARENA. Different arenas
 * hold different advisory locks and run in parallel.
 */
export type KeeperCtx = {
  getActive: () => Promise<Round | null>;
  getLatest: () => Promise<Round | null>;
  save: (r: Round) => Promise<void>;
  /** Retire any other active round IN THIS ARENA than `keepId` (zombie clean). */
  cancelOtherActive: (keepId: string) => Promise<void>;
};

/**
 * Run the keeper under a PER-ARENA advisory lock, so ticks in different
 * arenas run in parallel while ticks in the same arena serialize. Fetch any
 * external data (Panta price, market pick) BEFORE calling this — the lock is
 * held only for the fast DB ops inside `fn`.
 */
export async function withKeeperLock<T>(arena: string, fn: (ctx: KeeperCtx) => Promise<T>): Promise<T> {
  const code = normalizeArenaCode(arena);
  if (!STORE_ENABLED) {
    return fn({
      getActive: async () => memActive(code),
      getLatest: async () => memLatest(code),
      save: async (r) => { memSave(r); },
      cancelOtherActive: async (keepId) => {
        for (const raw of _mem.values()) {
          const r = withArena(raw);
          if (r.arenaCode === code && r.id !== keepId && ["enrolling", "live", "settling", "advancing"].includes(r.status)) {
            r.status = "cancelled";
            if (!r.endedAt) r.endedAt = Date.now();
            memSave(r);
          }
        }
      }
    });
  }
  await initSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [arenaLockKey(code).toString()]);
    const ctx: KeeperCtx = {
      getActive: async () => {
        const { rows } = await client.query(
          `SELECT data FROM rounds WHERE status = ANY($1) AND arena_code = $2 ORDER BY created_at DESC LIMIT 1`,
          [ACTIVE, code]
        );
        const r = rows[0]?.data as Round | undefined;
        return r ? withArena(r) : null;
      },
      getLatest: async () => {
        const { rows } = await client.query(
          `SELECT data FROM rounds WHERE arena_code = $1 ORDER BY created_at DESC LIMIT 1`,
          [code]
        );
        const r = rows[0]?.data as Round | undefined;
        return r ? withArena(r) : null;
      },
      save: async (r) => {
        const rr = withArena(r);
        await client.query(
          `INSERT INTO rounds (id, status, round_no, arena_code, data, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6, now())
           ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, round_no=EXCLUDED.round_no, arena_code=EXCLUDED.arena_code, data=EXCLUDED.data, updated_at=now()`,
          [rr.id, rr.status, rr.roundNumber, rr.arenaCode, JSON.stringify(rr), rr.createdAt]
        );
      },
      cancelOtherActive: async (keepId) => {
        // Retire zombie active rounds IN THIS ARENA + stamp endedAt in the JSON.
        await client.query(
          `UPDATE rounds
              SET status='cancelled',
                  data = jsonb_set(jsonb_set(data, '{status}', '"cancelled"'),
                                   '{endedAt}', to_jsonb((extract(epoch from now())*1000)::bigint), true),
                  updated_at = now()
            WHERE status = ANY($1) AND arena_code = $2 AND id <> $3`,
          [ACTIVE, code, keepId]
        );
      }
    };
    const result = await fn(ctx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function recentRounds(limit = 10): Promise<Round[]> {
  if (!STORE_ENABLED) return [..._mem.values()].map(withArena).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  await initSchema();
  const { rows } = await pool().query(`SELECT data FROM rounds ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => withArena(r.data as Round));
}

/** List the most recent arenas the store knows about — for a lobby / directory. */
export async function recentArenas(limit = 20): Promise<Array<{ arenaCode: string; latest: Round }>> {
  if (!STORE_ENABLED) {
    const map = new Map<string, Round>();
    for (const r of [..._mem.values()].map(withArena).sort((a, b) => b.createdAt - a.createdAt)) {
      if (!map.has(r.arenaCode)) map.set(r.arenaCode, r);
      if (map.size >= limit) break;
    }
    return [...map.entries()].map(([arenaCode, latest]) => ({ arenaCode, latest }));
  }
  await initSchema();
  const { rows } = await pool().query(
    `SELECT DISTINCT ON (arena_code) arena_code, data
       FROM rounds
       ORDER BY arena_code, created_at DESC
       LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ arenaCode: r.arena_code as string, latest: withArena(r.data as Round) }));
}
