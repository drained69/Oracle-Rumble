import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type SubmitRequest, type SubmitResponse } from "@/lib/panta";

/**
 * POST /api/orders/submit
 * Maps to Panta's POST /orders/submit.
 *
 * After the wallet signs and the client broadcasts to Solana RPC, the
 * signature is reported here so Panta can pick up the confirmation and
 * attribute the fill to the quoteId session.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as SubmitRequest;
  if (!body?.quoteId || !body?.signature || !body?.wallet) {
    return NextResponse.json({ error: "quoteId, signature, wallet required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<SubmitResponse>("/orders/submit", {
        method: "POST",
        body: JSON.stringify(body)
      });
      return NextResponse.json({ ...data, source: "panta" });
    } catch (err) {
      console.error("panta /orders/submit failed, serving mock:", err);
    }
  }

  const resp: SubmitResponse = { signature: body.signature, status: "submitted", source: "mock" };
  return NextResponse.json(resp);
}
