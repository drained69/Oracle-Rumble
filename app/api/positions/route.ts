import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type PantaPosition } from "@/lib/panta";

/**
 * GET /api/positions?wallet=<pubkey>
 * Maps to Panta's GET /positions.
 *
 * In demo mode we return an empty ledger — positions live in the browser
 * (localStorage). When wired to Panta, this endpoint is authoritative for
 * on-chain holdings + claim eligibility.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ positions: PantaPosition[] }>(
        `/positions?wallet=${encodeURIComponent(wallet)}`
      );
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /positions failed, serving mock:", err);
    }
  }
  return NextResponse.json({ source: "mock", positions: [] });
}
