import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";
import { arenas } from "@/lib/arena-data";

/**
 * GET /api/markets
 *
 * Proxies Panta's GET /markets when a PANTA_API_KEY is configured. In demo
 * mode (no key) returns the local mock arenas so the UI can render.
 *
 * Query params:
 *   ?arena=<id>        restrict mock response to a single arena
 *   ?category=<slug>   forwarded to Panta as a filter
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const arenaId = url.searchParams.get("arena");
  const category = url.searchParams.get("category");

  if (PANTA_LIVE) {
    try {
      const qs = new URLSearchParams();
      if (category) qs.set("category", category);
      const data = await pantaFetch<{ markets: PantaMarket[] }>(`/markets${qs.toString() ? `?${qs}` : ""}`);
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      // Fall through to mock so the UI keeps working when Panta blips.
      console.error("panta /markets failed, serving mock:", err);
    }
  }

  if (arenaId) {
    const arena = arenas.find((a) => a.id === arenaId);
    if (!arena) return NextResponse.json({ source: "mock", error: "arena not found" }, { status: 404 });
    return NextResponse.json({ source: "mock", arena: arena.id, markets: arena.markets });
  }
  return NextResponse.json({
    source: "mock",
    arenas: arenas.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, endsInMs: a.endsInMs, markets: a.markets }))
  });
}
