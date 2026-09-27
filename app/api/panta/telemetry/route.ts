import { NextResponse } from "next/server";
import { snapshot } from "@/lib/panta-telemetry";

export const dynamic = "force-dynamic";

/**
 * GET /api/panta/telemetry
 *
 * Snapshot of the Panta API observer:
 *   - live: PANTA_API_KEY is configured server-side
 *   - degraded: recent live call errored → fallback banner
 *   - events: last 50 outbound calls with latency + status
 *   - totals: counters (live ok / fallback / mock)
 *   - attributionCount: how many trades reported successfully
 *
 * Client HUD polls this every few seconds.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50));
  return NextResponse.json(snapshot(limit));
}
