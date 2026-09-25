import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, mockUnsignedTx } from "@/lib/panta";

/**
 * POST /api/markets/build
 * Proxies Panta's POST /markets/create/build/.
 *
 * Step 2 of the creation lifecycle. Client sends { createId, wallet? } and
 * receives an unsigned VersionedTransaction (base64) that the wallet
 * signs. In sandbox mode Panta returns an empty `transaction` string;
 * callers should treat that as a signal to skip signing and register
 * with a sandbox signature.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { createId: string; wallet?: string };
  if (!body?.createId) return NextResponse.json({ error: "createId required" }, { status: 400 });

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{
        transaction: string;
        buildFingerprint?: string;
        expectedEventPda?: string;
        recentBlockhash?: string;
        lastValidBlockHeight?: number;
        expiresAt?: string;
      }>("/markets/create/build", { method: "POST", body: JSON.stringify(body) });
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/create/build failed:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "panta failed" }, { status: 502 });
    }
  }

  return NextResponse.json({
    source: "mock",
    transaction: mockUnsignedTx(),
    buildFingerprint: "mock",
    lastValidBlockHeight: 300_000_000 + Math.floor(Math.random() * 1_000_000),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
}
