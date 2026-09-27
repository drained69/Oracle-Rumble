import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaCategory } from "@/lib/panta";
import { arenas } from "@/lib/arena-data";

/**
 * GET /api/categories
 *
 * Proxies Panta's GET /categories/. Response shape is
 * `{ categories: string[] }` (e.g. ["crypto","politics","sports","entertainment"]).
 * The UI wants `{ id, label }` objects, so we normalize server-side.
 *
 * Fallback chain:
 *   1. GET /categories/ (real endpoint).
 *   2. Derive from GET /markets/ by unique category values.
 *   3. Mock arenas as last resort.
 */
export async function GET() {
  if (PANTA_LIVE) {
    try {
      const raw = await pantaFetch<{ categories?: unknown } | { categories?: string[] }>("/categories");
      const arr = Array.isArray((raw as { categories?: unknown }).categories) ? (raw as { categories: unknown[] }).categories : [];
      const categories: PantaCategory[] = arr
        .map((c) => (typeof c === "string" ? c : typeof c === "object" && c && "label" in c ? String((c as { label: unknown }).label ?? "") : ""))
        .filter((s) => s.length > 0)
        .map((label) => ({ id: label.toLowerCase().replace(/\s+/g, "-"), label }));
      if (categories.length) return NextResponse.json({ source: "panta", categories });
      // Derive from the market catalog.
      const cat = await pantaFetch<{ items?: Array<{ category?: string }>; markets?: Array<{ category?: string }> }>("/markets");
      const list = cat.items ?? cat.markets ?? [];
      const seen = new Set<string>();
      const derived: PantaCategory[] = [];
      for (const m of list) {
        const c = (m.category ?? "").trim();
        if (!c || seen.has(c)) continue;
        seen.add(c);
        derived.push({ id: c.toLowerCase().replace(/\s+/g, "-"), label: c });
      }
      if (derived.length) return NextResponse.json({ source: "panta", categories: derived });
    } catch (err) {
      console.error("panta /categories failed, serving mock:", err);
    }
  }

  // Mock fallback — derive from the seed arenas.
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
