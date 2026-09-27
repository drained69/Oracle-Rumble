import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";
import { arenas as mockArenas } from "@/lib/arena-data";
import { pantaMarketToUi, type PantaLiveMarket } from "@/lib/panta-shape";

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

function buildArenasFromPantaMarkets(markets: PantaLiveMarket[]) {
  // Preserve each market's endTime so the arena countdown reflects reality
  // (min endTime across the arena's markets = the next resolution boundary).
  const byCategory = new Map<string, Array<{ ui: PantaMarket; endTime?: string }>>();
  for (const m of markets) {
    const ui = pantaMarketToUi(m);
    const key = slug(ui.category || "general");
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push({ ui, endTime: m.endTime });
  }
  return Array.from(byCategory.entries()).map(([id, rows]) => {
    const meta = REALM_NAMES[id] ?? { name: rows[0].ui.category, tagline: `Live Panta markets in the ${rows[0].ui.category} category.` };
    // Next resolution boundary — earliest endTime in the arena. Falls
    // back to 24h if Panta didn't send endTimes.
    let earliest = Number.POSITIVE_INFINITY;
    for (const r of rows) {
      const t = r.endTime ? Date.parse(r.endTime) : NaN;
      if (Number.isFinite(t)) earliest = Math.min(earliest, t);
    }
    const endsInMs = Number.isFinite(earliest)
      ? Math.max(0, earliest - Date.now())
      : 24 * 3_600_000;
    return { id, name: meta.name, tagline: meta.tagline, endsInMs, markets: rows.map((r) => r.ui) };
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
      // Panta returns `{ items: [...] }` (paginated). Older docs referred
      // to `{ markets: [...] }`. Handle both plus bare arrays for safety.
      const data = await pantaFetch<{ items?: PantaLiveMarket[]; markets?: PantaLiveMarket[] } | PantaLiveMarket[]>(
        `/markets${qs.toString() ? `?${qs}` : ""}`
      );
      const list: PantaLiveMarket[] = Array.isArray(data)
        ? data
        : (data.items ?? data.markets ?? []);
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
