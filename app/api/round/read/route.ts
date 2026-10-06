import { NextResponse } from "next/server";
import { getActiveRound, getLatestRound } from "@/lib/round-store";
import { isPicksFormat, normalizeArenaCode } from "@/lib/royale";
import { livePricing } from "@/lib/round-keeper";
import { computeSignals, deterministicRead, type MarketRead } from "@/lib/market-read";
import { claudeHeadline, ORACLE_MODEL, oracleAiEnabled } from "@/lib/oracle-ai";
import { limitByIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Cached = { key: string; at: number; body: ReadBody };
type ReadBody = MarketRead & { source: "claude" | "signals"; model?: string; at: number };

const TTL_MS = 20_000;
const _g = globalThis as unknown as { __pit_reads?: Map<string, Cached>; __pit_reads_inflight?: Map<string, Promise<ReadBody>> };
const cache = (_g.__pit_reads ??= new Map());
const inflight = (_g.__pit_reads_inflight ??= new Map());

/**
 * GET /api/round/read?arena=CODE — the Oracle read for a trading pit.
 *
 * The lean and confidence come from the pit's own data; Claude (when
 * configured) phrases the headline. One read per pit state every ~20s, shared
 * by every viewer, so a busy room costs one model call, not one per player.
 */
export async function GET(request: Request) {
  const limited = limitByIp(request, "read", 40, 60_000);
  if (limited) return limited;
  const arena = normalizeArenaCode(new URL(request.url).searchParams.get("arena"));
  const round = (await getActiveRound(arena)) ?? (await getLatestRound(arena));
  if (!round) return NextResponse.json({ error: "pit not found" }, { status: 404 });
  if (isPicksFormat(round.config.format)) return NextResponse.json({ error: "No market read for a picks game." }, { status: 409 });

  const pricing = await livePricing(round);
  const signals = computeSignals(round, pricing.yesPrice, pricing.line ?? null);
  const read = deterministicRead(signals);
  // Same pit state → same read: round, status, price to the cent, 20s bucket.
  const key = `${round.id}|${round.status}|${Math.round(signals.yes)}|${Math.floor(Date.now() / TTL_MS)}`;
  const hit = cache.get(arena);
  if (hit && hit.key === key) return NextResponse.json(hit.body);

  let job = inflight.get(key);
  if (!job) {
    job = (async (): Promise<ReadBody> => {
      const at = Date.now();
      // Only spend a model call while the market is moving.
      const phrased = round.status === "live" && oracleAiEnabled() ? await claudeHeadline(signals, read) : null;
      return phrased
        ? { ...read, headline: phrased, source: "claude", model: ORACLE_MODEL, at }
        : { ...read, source: "signals", at };
    })();
    inflight.set(key, job);
  }
  try {
    const body = await job;
    cache.set(arena, { key, at: Date.now(), body });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    return NextResponse.json(body);
  } finally {
    inflight.delete(key);
  }
}
