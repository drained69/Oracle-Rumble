import { NextResponse } from "next/server";
import { PANTA_LIVE, PANTA_USER_ID, pantaFetch, type BuildRequest, type BuildResponse, type PantaInstruction } from "@/lib/panta";

/**
 * POST /api/orders/build
 *
 * Proxies Panta's POST /primaryorderbuild/.
 *
 * Panta does NOT return a pre-serialized VersionedTransaction — the
 * response carries `instructions[]` + `recentBlockhash` and the client
 * compiles a v0 tx locally against the wallet's pubkey (see
 * lib/panta-client.ts compileAndSign).
 */

type PantaPrimaryBuild = {
  orderId: string;
  instructions: PantaInstruction[];
  expectedShares?: number | string;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  expiresAt?: string;
  blockhashExpiryHintSec?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as BuildRequest & { userId?: string };
  if (!body?.quoteId || !body?.wallet) {
    return NextResponse.json({ error: "quoteId, wallet required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const payload = {
        quoteId: body.quoteId,
        wallet: body.wallet,
        ...(body.userId ? { userId: body.userId } : PANTA_USER_ID ? { userId: PANTA_USER_ID } : {})
      };
      const data = await pantaFetch<PantaPrimaryBuild>("/primaryorderbuild", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const resp: BuildResponse = {
        orderId: data.orderId,
        quoteId: body.quoteId,
        instructions: data.instructions ?? [],
        recentBlockhash: data.recentBlockhash,
        lastValidBlockHeight: data.lastValidBlockHeight,
        expectedShares: typeof data.expectedShares === "string" ? Number(data.expectedShares) : data.expectedShares,
        expiresAt: data.expiresAt,
        source: "panta"
      };
      return NextResponse.json(resp);
    } catch (err) {
      console.error("panta /primaryorderbuild failed, serving mock:", err);
    }
  }

  // Mock: return a plausible empty tx envelope; the client's compileAndSign
  // treats an empty instructions[] as a demo-mode no-op.
  const resp: BuildResponse = {
    orderId: `ord_mock_${Date.now().toString(36)}`,
    quoteId: body.quoteId,
    instructions: [],
    recentBlockhash: "MockBlockhash11111111111111111111111111111111",
    lastValidBlockHeight: 300_000_000 + Math.floor(Math.random() * 1_000_000),
    source: "mock"
  };
  return NextResponse.json(resp);
}
