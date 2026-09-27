/**
 * Panta connection env — the single source of truth for PANTA_BASE /
 * PANTA_KEY / PANTA_LIVE. Split out from `lib/panta.ts` so the telemetry
 * module can read them without triggering a circular import (panta.ts
 * itself imports the telemetry recorder).
 */

const DEFAULT_BASE = "https://live-api.panta.market/api/v1";

export const PANTA_BASE = process.env.PANTA_API_BASE ?? DEFAULT_BASE;
export const PANTA_KEY = process.env.PANTA_API_KEY ?? "";
export const PANTA_LIVE = PANTA_KEY.length > 0;

/**
 * Attribution identifier — Panta's `/primaryorder*` endpoints accept an
 * optional `X-User-Id` header (or `userId` body field) that credits
 * partner attribution back to a specific account. Set this to the Oracle
 * Rumble owner's userId (e.g. usr_kU6DH…) so live trades get attributed.
 *
 * If unset, attribution still happens implicitly via the API key's owner
 * account — Panta's docs say userId defaults to that. Passing it explicitly
 * makes attribution deterministic in demos and multi-key setups.
 */
export const PANTA_USER_ID =
  process.env.PANTA_USER_ID ??
  process.env.PANTA_ATTRIBUTION_KEY ??  // legacy alias — Oracle Rumble used this name before
  "";
