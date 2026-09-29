import { limitByIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type SubmitRequest, type SubmitResponse } from "@/lib/panta";

/**
 * POST /api/orders/submit
 *
 * Proxies Panta's POST /primaryordersubmit/. The client passes the
 * orderId from /orders/build plus the broadcast tx signature. Panta
 * records the association without waiting for finalization; poll
 * /orders/verify to learn when it confirms.
 */
export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-write", 30, 60_000);
  if (limited) return limited;
  const body = (await request.json()) as SubmitRequest;
  if (!body?.orderId || !body?.signature) {
    return NextResponse.json({ error: "orderId, signature required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ status?: string }>("/primaryordersubmit", {
        method: "POST",
        body: JSON.stringify({
          orderId: body.orderId,
          signature: body.signature,
          ...(body.wallet ? { wallet: body.wallet } : {})
        })
      });
      const resp: SubmitResponse = {
        signature: body.signature,
        status: (data.status as SubmitResponse["status"]) ?? "submitted",
        source: "panta"
      };
      return NextResponse.json(resp);
    } catch (err) {
      console.error("panta /primaryordersubmit failed, serving mock:", err);
    }
  }

  const resp: SubmitResponse = { signature: body.signature, status: "submitted", source: "mock" };
  return NextResponse.json(resp);
}
