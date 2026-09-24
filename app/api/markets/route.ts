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

/**
 * Panta's live `/markets/` response is `{ items: PantaLiveMarket[] }`,
 * where each item uses `marketId`/`title`/`yesPrice: "0.50"` and reports
 * a lifecycle `phase` like `"primary"` or `"resolved"`. Map it into the
 * internal PantaMarket shape the UI expects (`id`/`question`/cents/etc.).
 */
type PantaLiveMarket = {
  marketId?: string;
  id?: string;
  title?: string;
  question?: string;
  category?: string;
  yesPrice?: number | string;
  noPrice?: number | string;
  volumeUsdc?: string;
  volume?: string;
  endTime?: string;
  closes?: string;
  phase?: string;
  resolved?: boolean;
  outcome?: "YES" | "NO" | null;
};

function toCents(v: number | string | undefined): number {
  if (v === undefined || v === null) return 50;
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n > 1 ? Math.round(n) : Math.round(n * 100)));
}

function formatVolume(v: string | undefined): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return v;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function formatCloses(endTime: string | undefined): string {
  if (!endTime) return "—";
  const t = Date.parse(endTime);
  if (Number.isNaN(t)) return "—";
  const ms = t - Date.now();
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  if (d > 0) return `Closes in ${d}d`;
  if (h > 0) return `Closes in ${h}h`;
  return "Closes soon";
}

function mapPhase(p: string | undefined, resolved: boolean | undefined): "active" | "resolved" | "graduated" | "pending" {
  if (resolved) return "resolved";
  switch ((p ?? "").toLowerCase()) {
    case "primary": return "active";
    case "graduated": return "graduated";
    case "resolved": return "resolved";
    case "pending": return "pending";
    default: return "active";
  }
}

function pantaMarketToUi(m: PantaLiveMarket): PantaMarket {
  return {
    id: m.marketId ?? m.id ?? "",
    question: m.title ?? m.question ?? "(untitled market)",
    category: m.category ?? "General",
    yesPrice: toCents(m.yesPrice),
    change: 0,
    volume: m.volume ?? formatVolume(m.volumeUsdc),
    closes: m.closes ?? formatCloses(m.endTime),
    phase: mapPhase(m.phase, m.resolved),
    outcome: m.outcome ?? null
  };
}

function buildArenasFromPantaMarkets(markets: PantaLiveMarket[]) {
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
