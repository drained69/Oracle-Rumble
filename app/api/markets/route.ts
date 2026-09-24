import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";
import { arenas as mockArenas } from "@/lib/arena-data";

/**
 * GET /api/markets
 *
 * Returns { source, arenas: Array<{ id, name, tagline, endsInMs, markets }> }.
 *
 * When `PANTA_API_KEY` is set, arenas are built dynamically by grouping the
 * live Panta market catalog by category. Without a key we return the
 * seeded arenas from `lib/arena-data.ts` so the UI still renders in demo
 * mode.
 *
 * Query params:
 *   ?arena=<id>        restrict response to a single arena (mock only)
 *   ?category=<slug>   forwarded to Panta as a filter
 */

const REALM_NAMES: Record<string, { name: string; tagline: string }> = {
  crypto: { name: "Solana Signals", tagline: "Where the Solana community puts its conviction on-chain." },
  "on-chain": { name: "Solana Signals", tagline: "Where the Solana community puts its conviction on-chain." },
  ecosystem: { name: "Ecosystem Watch", tagline: "Momentum from the builders shipping this week." },
  sports: { name: "Fight Night", tagline: "Combat sports, one round at a time. Call the fight before the bell." },
  tech: { name: "Shipmas", tagline: "Twelve days of launches. Which products actually ship?" },
  ai: { name: "Model Wars", tagline: "Which lab lands the next release, and when." },
  politics: { name: "Rostrum", tagline: "Poll shifts, primaries, floor votes." },
  entertainment: { name: "The Amphitheatre", tagline: "Awards, box office, cultural moments." }
};

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pantaMarketToUi(m: PantaMarket): PantaMarket {
  // Panta may return prices in different units; we normalize to cents 0..100.
  const yesPrice = typeof m.yesPrice === "number" && m.yesPrice > 1 ? Math.round(m.yesPrice) : Math.round((m.yesPrice ?? 0.5) * 100);
  const change = typeof m.change === "number" ? m.change : 0;
  return {
    id: m.id,
    question: m.question,
    category: m.category ?? "General",
    yesPrice,
    change,
    volume: m.volume ?? "—",
    closes: m.closes ?? "—",
    phase: m.phase ?? "active",
    outcome: m.outcome ?? null
  };
}

function buildArenasFromPantaMarkets(markets: PantaMarket[]) {
  const byCategory = new Map<string, PantaMarket[]>();
  for (const m of markets.map(pantaMarketToUi)) {
    const key = slug(m.category || "general");
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(m);
  }
  return Array.from(byCategory.entries()).map(([id, marketsInArena]) => {
    const meta = REALM_NAMES[id] ?? { name: marketsInArena[0].category, tagline: `Live Panta markets in the ${marketsInArena[0].category} category.` };
    // Longest 8h horizon so the countdown looks alive; the source of truth
    // for resolution is each market's individual `closes` string.
    const endsInMs = 8 * 3_600_000;
    return { id, name: meta.name, tagline: meta.tagline, endsInMs, markets: marketsInArena };
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const arenaId = url.searchParams.get("arena");
  const category = url.searchParams.get("category");

  if (PANTA_LIVE) {
    try {
      const qs = new URLSearchParams();
      if (category) qs.set("category", category);
      const data = await pantaFetch<{ markets: PantaMarket[] } | PantaMarket[]>(`/markets${qs.toString() ? `?${qs}` : ""}`);
      const list: PantaMarket[] = Array.isArray(data) ? data : (data.markets ?? []);
      const arenas = buildArenasFromPantaMarkets(list);
      if (arenaId) {
        const arena = arenas.find((a) => a.id === arenaId);
        if (!arena) return NextResponse.json({ source: "panta", error: "arena not found" }, { status: 404 });
        return NextResponse.json({ source: "panta", arena: arena.id, markets: arena.markets });
      }
      return NextResponse.json({ source: "panta", arenas });
    } catch (err) {
      // Fall through to mock so the UI keeps working when Panta blips.
      console.error("panta /markets failed, serving mock:", err);
    }
  }

  if (arenaId) {
    const arena = mockArenas.find((a) => a.id === arenaId);
    if (!arena) return NextResponse.json({ source: "mock", error: "arena not found" }, { status: 404 });
    return NextResponse.json({ source: "mock", arena: arena.id, markets: arena.markets });
  }
  return NextResponse.json({
    source: "mock",
    arenas: mockArenas.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, endsInMs: a.endsInMs, markets: a.markets }))
  });
}
