import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockQuoteId } from "@/lib/panta";

/**
 * POST /api/markets/quote
 * Maps to Panta's POST /markets/quote.
 *
 * Step 1 of the market creation lifecycle: validate the market parameters
 * (question, category, resolution deadline) and return the USDC creation
 * fee. The client uses this to show a cost estimate before the user signs.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    question: string;
    category: string;
    endsAt: string;
    wallet: string;
  };
  if (!body?.question || !body?.category || !body?.endsAt || !body?.wallet) {
    return NextResponse.json(
      { error: "question, category, endsAt, wallet required" },
      { status: 400 }
    );
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ quoteId: string; creationFeeUsdc: string; expiresAt: string }>(
        "/markets/quote",
        { method: "POST", body: JSON.stringify(body) }
      );
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/quote failed, serving mock:", err);
    }
  }

  // Mock: 10 USDC creation fee. Panta returns amounts as base-unit
  // integer strings (6 decimals for USDC), which the client formats.
  return NextResponse.json({
    source: "mock",
    quoteId: mockQuoteId(),
    creationFeeUsdc: "10000000",
    expiresAt: new Date(Date.now() + 30_000).toISOString()
  });
}
