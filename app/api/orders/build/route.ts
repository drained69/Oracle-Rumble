import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockUnsignedTx, type BuildRequest, type BuildResponse } from "@/lib/panta";

/**
 * POST /api/orders/build
 * Maps to Panta's POST /orders/build.
 *
 * Given a live quoteId + wallet, returns an unsigned VersionedTransaction
 * (base64) that the user's wallet signs. The signed transaction is then
 * broadcast to your Solana RPC and the signature is reported back via
 * /api/orders/submit.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as BuildRequest;
  if (!body?.quoteId || !body?.wallet) {
    return NextResponse.json({ error: "quoteId, wallet required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<BuildResponse>("/orders/build", {
        method: "POST",
        body: JSON.stringify(body)
      });
      return NextResponse.json({ ...data, source: "panta" });
    } catch (err) {
      console.error("panta /orders/build failed, serving mock:", err);
    }
  }

  const resp: BuildResponse = {
    quoteId: body.quoteId,
    serializedTx: mockUnsignedTx(),
    lastValidBlockHeight: 300_000_000 + Math.floor(Math.random() * 1_000_000),
    source: "mock"
  };
  return NextResponse.json(resp);
}
