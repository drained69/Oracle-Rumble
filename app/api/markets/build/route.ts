import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockUnsignedTx } from "@/lib/panta";

/**
 * POST /api/markets/build
 * Maps to Panta's POST /markets/build.
 *
 * Step 2 of the market creation lifecycle: given a live creation quoteId
 * and the host's wallet, return an unsigned VersionedTransaction that
 * deploys the USDC market on Solana. The wallet signs and broadcasts;
 * the signature is then reported to /markets/register.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { quoteId: string; wallet: string };
  if (!body?.quoteId || !body?.wallet) {
    return NextResponse.json({ error: "quoteId, wallet required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ serializedTx: string; lastValidBlockHeight?: number }>(
        "/markets/build",
        { method: "POST", body: JSON.stringify(body) }
      );
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/build failed, serving mock:", err);
    }
  }

  return NextResponse.json({
    source: "mock",
    serializedTx: mockUnsignedTx(),
    lastValidBlockHeight: 300_000_000 + Math.floor(Math.random() * 1_000_000)
  });
}
