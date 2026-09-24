import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockUnsignedTx, type ClaimBuildRequest, type ClaimBuildResponse } from "@/lib/panta";

/**
 * POST /api/claims/build
 * Maps to Panta's POST /claims/build (claim_win_usdc).
 *
 * Returns an unsigned claim transaction for the given wallet + resolved
 * market. Front-end signs and broadcasts.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as ClaimBuildRequest;
  if (!body?.wallet || !body?.marketId) {
    return NextResponse.json({ error: "wallet, marketId required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<ClaimBuildResponse>("/claims/build", {
        method: "POST",
        body: JSON.stringify(body)
      });
      return NextResponse.json({ ...data, source: "panta" });
    } catch (err) {
      console.error("panta /claims/build failed, serving mock:", err);
    }
  }

  const resp: ClaimBuildResponse = {
    serializedTx: mockUnsignedTx(),
    amountUsdc: (Math.random() * 200 + 10).toFixed(2),
    source: "mock"
  };
  return NextResponse.json(resp);
}
