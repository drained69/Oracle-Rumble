import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockPubkey } from "@/lib/panta";

/**
 * POST /api/markets/register
 * Maps to Panta's POST /markets/register.
 *
 * Step 3 of the market creation lifecycle: after the host's wallet signs
 * and broadcasts the create-market transaction, this endpoint tells Panta
 * to verify the on-chain event and write catalog metadata (question,
 * category, image, resolution rules). Returns the new market's pubkey.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { quoteId: string; signature: string; wallet: string };
  if (!body?.quoteId || !body?.signature || !body?.wallet) {
    return NextResponse.json(
      { error: "quoteId, signature, wallet required" },
      { status: 400 }
    );
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ marketId: string; status: "registered" | "pending" }>(
        "/markets/register",
        { method: "POST", body: JSON.stringify(body) }
      );
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/register failed, serving mock:", err);
    }
  }

  return NextResponse.json({
    source: "mock",
    marketId: mockPubkey(),
    status: "registered" as const
  });
}
