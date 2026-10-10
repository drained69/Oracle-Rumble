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
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" && !/^pk_live_/.test(process.env.PANTA_API_KEY ?? "")) {
    return NextResponse.json({ error: "Live Panta orders are unavailable on this deployment." }, { status: 503 });
  }
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
      console.error("panta /primaryordersubmit failed:", err);
      return NextResponse.json({ error: "Panta submission is unavailable; check the transaction signature before retrying." }, { status: 502 });
    }
  }

  const resp: SubmitResponse = { signature: body.signature, status: "submitted", source: "mock" };
  return NextResponse.json(resp);
}
