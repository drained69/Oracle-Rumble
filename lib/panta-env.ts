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
