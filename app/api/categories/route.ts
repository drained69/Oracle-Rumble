import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaCategory } from "@/lib/panta";
import { arenas } from "@/lib/arena-data";

/**
 * GET /api/categories
 *
 * Docs list `GET /markets/categories/` as an allowlist endpoint, but in
 * test mode Panta routes that path as a `{id}` market lookup and returns
 * a sandbox fixture. Prefer a defensive strategy:
 *
 *   1. Try the documented endpoint. If it responds with a real
 *      `{ categories: [...] }` array, use it.
 *   2. Otherwise derive categories from the current `/markets/` catalog.
 *   3. Fall back to mock arenas when Panta is offline.
 */
export async function GET() {
  if (PANTA_LIVE) {
    try {
      // 1) Documented shape.
      const raw = await pantaFetch<{ categories?: PantaCategory[]; items?: unknown[] }>("/markets/categories");
      if (Array.isArray(raw?.categories) && raw.categories.length) {
        return NextResponse.json({ source: "panta", categories: raw.categories });
      }
      // 2) Derive from live catalog.
      const cat = await pantaFetch<{ items?: Array<{ category?: string }>; markets?: Array<{ category?: string }> }>("/markets");
      const list = cat.items ?? cat.markets ?? [];
      const seen = new Set<string>();
      const categories: PantaCategory[] = [];
      for (const m of list) {
        const c = (m.category ?? "").trim();
        if (!c || seen.has(c)) continue;
        seen.add(c);
        categories.push({ id: c.toLowerCase().replace(/\s+/g, "-"), label: c });
      }
      if (categories.length) return NextResponse.json({ source: "panta", categories });
    } catch (err) {
      console.error("panta categories failed, serving mock:", err);
    }
  }

  // 3) Mock fallback — derive from the seed arenas.
  const seen = new Set<string>();
  const categories: PantaCategory[] = [];
  for (const a of arenas) for (const m of a.markets) {
    if (!seen.has(m.category)) {
      seen.add(m.category);
      categories.push({ id: m.category.toLowerCase().replace(/\s+/g, "-"), label: m.category });
    }
  }
  return NextResponse.json({ source: "mock", categories });
}
