/**
 * Panta call telemetry.
 *
 * A single module-level ring buffer that every proxy route feeds. Powers:
 *
 *   1. The HUD live badge: "Live · Panta API v1" when the most recent
 *      calls succeeded, "Demo" when PANTA_LIVE is off, "Degraded" when
 *      the last few live calls fell back to mock.
 *   2. The request console drawer: a scrolling tape of every outbound
 *      Panta HTTP call with endpoint / method / status / latency / source.
 *   3. The loud fallback banner: derived from `degradedSince`.
 *   4. The per-trade attribution badge: `attributionCount` grows every
 *      time `/trades/report` returns `attributed`.
 *
 * Runs server-side only. The client polls `/api/panta/telemetry` to read a
 * lightweight snapshot.
 */

import { PANTA_KEY, PANTA_LIVE } from "@/lib/panta-env";

const CAP = 200;                 // ring buffer size
const DEGRADE_WINDOW_MS = 60_000; // fallback banner sticks around this long

export type TelemetryEvent = {
  id: number;
  ts: number;                    // epoch ms
  method: string;                // GET / POST / …
  endpoint: string;              // Panta path e.g. /markets/
  status: number;                // HTTP status; 0 = network / thrown
  latencyMs: number;
  source: "panta" | "mock";      // "mock" == this call fell through to mock
  outcome: "ok" | "error";
  errorClass?: string;           // when outcome === "error"
  note?: string;                 // human-readable extra ("attributed", etc.)
};

type State = {
  events: TelemetryEvent[];
  seq: number;
  attributionCount: number;      // /trades/report → attributed
  lastFallbackAt: number | null; // most recent event where PANTA_LIVE=true but call errored
  totals: {
    live: number;                // successful live calls
    fallback: number;            // errored live calls (fell to mock)
    mock: number;                // demo-mode calls (PANTA_LIVE=false)
  };
};

// Persist across dev hot-reloads / route module isolation by pinning to
// globalThis. Next.js hot-reloads route modules; without this the tape
// resets every 3 seconds under a running dev poll.
const g = globalThis as unknown as { __pantaTelemetry?: State };
const state: State = g.__pantaTelemetry ?? {
  events: [],
  seq: 0,
  attributionCount: 0,
  lastFallbackAt: null,
  totals: { live: 0, fallback: 0, mock: 0 }
};
g.__pantaTelemetry = state;

function push(ev: Omit<TelemetryEvent, "id">) {
  state.seq += 1;
  const full: TelemetryEvent = { id: state.seq, ...ev };
  state.events.push(full);
  if (state.events.length > CAP) state.events.splice(0, state.events.length - CAP);
  if (ev.source === "mock" && ev.outcome === "ok") state.totals.mock += 1;
  else if (ev.outcome === "ok") state.totals.live += 1;
  else if (ev.outcome === "error") {
    state.totals.fallback += 1;
    state.lastFallbackAt = ev.ts;
  }
  return full;
}

export function recordPantaCall(ev: {
  method: string;
  endpoint: string;
  status: number;
  latencyMs: number;
  source: "panta" | "mock";
  outcome: "ok" | "error";
  errorClass?: string;
  note?: string;
}) {
  push({ ts: Date.now(), ...ev });
}

/** Marks a `/trades/report` result as attributed to the partner key. */
export function recordAttribution(note?: string) {
  state.attributionCount += 1;
  push({
    ts: Date.now(),
    method: "POST",
    endpoint: "/trades/report",
    status: 200,
    latencyMs: 0,
    source: "panta",
    outcome: "ok",
    note: note ?? "attributed"
  });
}

/** Human-readable snapshot for the client HUD/drawer. */
export type TelemetrySnapshot = {
  live: boolean;                // PANTA_LIVE (server has a key)
  degraded: boolean;            // recent live call errored
  degradedSince: number | null; // epoch ms of the most recent fallback event
  keyHint: string | null;       // last 4 chars of the API key, if present
  attributionCount: number;
  totals: State["totals"];
  events: TelemetryEvent[];     // newest last
};

export function snapshot(limit = 50): TelemetrySnapshot {
  const events = state.events.slice(-limit);
  const degraded =
    PANTA_LIVE &&
    state.lastFallbackAt !== null &&
    Date.now() - state.lastFallbackAt < DEGRADE_WINDOW_MS;
  return {
    live: PANTA_LIVE,
    degraded,
    degradedSince: state.lastFallbackAt,
    keyHint: PANTA_KEY ? `…${PANTA_KEY.slice(-4)}` : null,
    attributionCount: state.attributionCount,
    totals: state.totals,
    events
  };
}
