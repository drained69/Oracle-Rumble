import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaCategory } from "@/lib/panta";
import { arenas } from "@/lib/arena-data";

/**
 * GET /api/categories — allowlist of Panta market categories.
 * Maps to Panta's GET /markets/categories.
 */
export async function GET() {
  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ categories: PantaCategory[] }>("/markets/categories");
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/categories failed, serving mock:", err);
    }
  }
  const seen = new Set<string>();
  const categories: PantaCategory[] = [];
  for (const a of arenas) for (const m of a.markets) {
    if (!seen.has(m.category)) { seen.add(m.category); categories.push({ id: m.category.toLowerCase().replace(/\s+/g, "-"), label: m.category }); }
  }
  return NextResponse.json({ source: "mock", categories });
}
