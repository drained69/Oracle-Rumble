import { limitByIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type VerifyRequest, type VerifyResponse } from "@/lib/panta";

/**
 * POST /api/orders/verify
 *
 * Proxies Panta's POST /primaryorderverify/. Accepts orderId (from
 * /orders/build) with an optional signature to associate. Returns the
 * current lifecycle status. Panta's status enum is a superset of what
 * The Pit's UI needs — we surface all values so the request
 * console shows the exact wire value.
 */
export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-write", 60, 60_000);
  if (limited) return limited;
  const body = (await request.json()) as VerifyRequest & { signature?: string; orderId?: string };
  if (!body?.orderId && !body?.signature) {
    return NextResponse.json({ error: "orderId or signature required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const payload: Record<string, unknown> = {};
      if (body.orderId) payload.orderId = body.orderId;
      if (body.signature) payload.signature = body.signature;
      if (body.wallet) payload.wallet = body.wallet;
      const data = await pantaFetch<{
        orderId?: string;
        status?: string;
        signature?: string;
        marketId?: string;
        side?: "yes" | "no";
        amountUsdc?: string;
      }>("/primaryorderverify", { method: "POST", body: JSON.stringify(payload) });
      const resp: VerifyResponse = {
        orderId: data.orderId ?? body.orderId ?? "",
        status: (data.status as VerifyResponse["status"]) ?? "submitted",
        signature: data.signature ?? body.signature,
        marketId: data.marketId,
        side: data.side,
        amountUsdc: data.amountUsdc,
        source: "panta"
      };
      return NextResponse.json(resp);
    } catch (err) {
      console.error("panta /primaryorderverify failed, serving mock:", err);
    }
  }

  // Mock: always resolve to "confirmed" so the demo flow completes.
  const resp: VerifyResponse = {
    orderId: body.orderId ?? "ord_mock",
    status: "confirmed",
    signature: body.signature,
    source: "mock"
  };
  return NextResponse.json(resp);
}
