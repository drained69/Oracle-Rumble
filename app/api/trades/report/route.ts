import { limitByIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type TradeStatusResponse } from "@/lib/panta";
import { recordAttribution } from "@/lib/panta-telemetry";

/**
 * GET /api/trades/report?signature=<sig>
 *
 * Panta doesn't expose a POST /trades/report endpoint — attribution is
 * automatic via the API key (or explicit X-User-Id header) on every
 * order lifecycle call. This route reads back the current status of a
 * signature using GET /trades/{signature}/ so the UI can confirm
 * whether attribution has been picked up.
 *
 * Historical note: earlier code hit POST /trades/report which returned
 * HTTP 405 in production. That call has been removed; the client now
 * either polls this endpoint or gets its confirmation via /orders/verify.
 *
 * A POST-shaped legacy handler is kept for backwards compatibility with
 * clients still calling POST /api/trades/report; it just proxies the
 * signature through the GET path.
 */

async function readStatus(signature: string): Promise<TradeStatusResponse> {
  if (!PANTA_LIVE) {
    return { signature, status: "processed", source: "mock" };
  }
  try {
    const data = await pantaFetch<{ signature?: string; status?: string; marketId?: string; wallet?: string; side?: "yes" | "no"; kind?: "buy" | "claim" }>(
      `/trades/${encodeURIComponent(signature)}`
    );
    return {
      signature,
      status: (data.status as TradeStatusResponse["status"]) ?? "unknown",
      marketId: data.marketId,
      wallet: data.wallet,
      side: data.side,
      kind: data.kind,
      source: "panta"
    };
  } catch (err) {
    console.error("panta /trades/{sig} failed:", err);
    return { signature, status: "unknown", source: "panta" };
  }
}

export async function GET(request: Request) {
  const limited = limitByIp(request, "panta-read", 120, 60_000);
  if (limited) return limited;
  const signature = new URL(request.url).searchParams.get("signature");
  if (!signature) return NextResponse.json({ error: "signature required" }, { status: 400 });
  const resp = await readStatus(signature);
  if (resp.status === "processed" || resp.status === "confirmed") {
    recordAttribution(`sig=${signature.slice(0, 8)}… kind=${resp.kind ?? "buy"}`);
  }
  return NextResponse.json(resp);
}

export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-read", 120, 60_000);
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { signature?: string };
  if (!body?.signature) return NextResponse.json({ error: "signature required" }, { status: 400 });
  const resp = await readStatus(body.signature);
  if (resp.status === "processed" || resp.status === "confirmed") {
    recordAttribution(`sig=${body.signature.slice(0, 8)}… kind=${resp.kind ?? "buy"}`);
  }
  return NextResponse.json(resp);
}
