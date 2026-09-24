import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockPubkey } from "@/lib/panta";

/**
 * POST /api/markets/register
 * Proxies Panta's POST /markets/register/.
 *
 * Step 3 of the creation lifecycle. Body: { createId, signature }.
 * Response: { marketId, status } — Panta verifies the signature on-chain
 * and writes catalog metadata.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { createId: string; signature: string };
  if (!body?.createId || !body?.signature) {
    return NextResponse.json({ error: "createId, signature required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{
        marketId: string;
        status: "registered" | "pending";
        signature?: string;
        paymentUsdc?: string;
        paymentUsdcBase?: string;
        category?: string;
        title?: string;
      }>("/markets/register", { method: "POST", body: JSON.stringify(body) });
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/register failed:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "panta failed" }, { status: 502 });
    }
  }

  return NextResponse.json({
    source: "mock",
    marketId: mockPubkey(),
    status: "registered" as const
  });
}
