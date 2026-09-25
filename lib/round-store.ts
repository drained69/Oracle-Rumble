/**
 * Round store — Postgres persistence for Market Royale rounds.
 *
 * A single `rounds` table holds each round as a JSONB blob plus a status
 * column for cheap filtering. The "current" round is the newest round that
 * isn't complete/cancelled. State transitions run through the API routes
 * and the keeper; this module only reads and writes.
 *
 * The pool is module-level; Railway runs a long-lived Node process so one
 * pool is reused across requests. Without DATABASE_URL the store is
 * disabled and `enabled` is false (the app falls back to a client-only
 * demo round).
 */

import { Pool } from "pg";
import type { Round } from "@/lib/royale";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const STORE_ENABLED = DATABASE_URL.length > 0;

// In-memory fallback for local dev / no-DB deployments. Persists across
// requests within one Node process (fine for a single Railway replica or
// `next dev`), resets on restart. Postgres is used whenever available.
// Hung off globalThis so every route module shares one Map even when the
// bundler gives each route its own module registry.
const _g = globalThis as unknown as { __rr_mem?: Map<string, Round> };
const _mem: Map<string, Round> = _g.__rr_mem ?? (_g.__rr_mem = new Map<string, Round>());
function memSave(round: Round) { _mem.set(round.id, round); }
function memActive(): Round | null {
  const all = [..._mem.values()].filter((r) => ["enrolling", "live", "settling", "advancing"].includes(r.status));
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
function memLatest(): Round | null {
  return [..._mem.values()].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
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
        data        JSONB NOT NULL,
        created_at  BIGINT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS rounds_status_idx ON rounds (status);
      CREATE INDEX IF NOT EXISTS rounds_created_idx ON rounds (created_at DESC);
    `).then(() => undefined);
  }
  return _gp.__rr_ready;
}

const ACTIVE = ["enrolling", "live", "settling", "advancing"];

export async function getActiveRound(): Promise<Round | null> {
  if (!STORE_ENABLED) return memActive();
  await initSchema();
  const { rows } = await pool().query(
    `SELECT data FROM rounds WHERE status = ANY($1) ORDER BY created_at DESC LIMIT 1`,
    [ACTIVE]
  );
  return rows[0]?.data ?? null;
}

export async function getLatestRound(): Promise<Round | null> {
  if (!STORE_ENABLED) return memLatest();
  await initSchema();
  const { rows } = await pool().query(`SELECT data FROM rounds ORDER BY created_at DESC LIMIT 1`);
  return rows[0]?.data ?? null;
}

export async function getRound(id: string): Promise<Round | null> {
  if (!STORE_ENABLED) return _mem.get(id) ?? null;
  await initSchema();
  const { rows } = await pool().query(`SELECT data FROM rounds WHERE id = $1`, [id]);
  return rows[0]?.data ?? null;
}

export async function saveRound(round: Round): Promise<void> {
  if (!STORE_ENABLED) { memSave(round); return; }
  await initSchema();
  await pool().query(
    `INSERT INTO rounds (id, status, round_no, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       round_no = EXCLUDED.round_no,
       data = EXCLUDED.data,
       updated_at = now()`,
    [round.id, round.status, round.roundNumber, JSON.stringify(round), round.createdAt]
  );
}

/**
 * Atomically mutate the current active round. On Postgres this runs inside
 * a transaction with `SELECT … FOR UPDATE` so concurrent enroll/trade calls
 * serialize instead of clobbering each other. The mutator must be
 * self-contained (no external awaits that need the latest state) — fetch any
 * external data (e.g. the Panta price) BEFORE calling this and close over it.
 *
 * Returns the mutated round, or null if there's no active round. If the
 * mutator throws, the transaction rolls back.
 */
export async function mutateActiveRound(
  mutator: (round: Round) => void
): Promise<{ round: Round | null; error?: string }> {
  if (!STORE_ENABLED) {
    const r = memActive();
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
      `SELECT data FROM rounds WHERE status = ANY($1) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [ACTIVE]
    );
    const round = rows[0]?.data as Round | undefined;
    if (!round) { await client.query("ROLLBACK"); return { round: null }; }
    try {
      mutator(round);
    } catch (e) {
      await client.query("ROLLBACK");
      return { round, error: e instanceof Error ? e.message : "mutate error" };
    }
    await client.query(
      `UPDATE rounds SET status = $2, round_no = $3, data = $4, updated_at = now() WHERE id = $1`,
      [round.id, round.status, round.roundNumber, JSON.stringify(round)]
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

export async function recentRounds(limit = 10): Promise<Round[]> {
  if (!STORE_ENABLED) return [..._mem.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  await initSchema();
  const { rows } = await pool().query(`SELECT data FROM rounds ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => r.data as Round);
}
