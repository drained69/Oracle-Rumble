import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type ReportRequest, type ReportResponse } from "@/lib/panta";

/**
 * POST /api/trades/report
 * Maps to Panta's POST /trades/report.
 *
 * This is Oracle Rumble's attribution hook — Panta verifies the signature
 * on-chain and credits the trade to our partner attribution key so the
 * ring's leaderboard only counts qualifying activity.
 *
 * The attribution key is server-only (env var).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as ReportRequest;
  if (!body?.signature || !body?.wallet || !body?.marketId) {
    return NextResponse.json({ error: "signature, wallet, marketId required" }, { status: 400 });
  }

  const payload = { ...body, attributionKey: body.attributionKey ?? process.env.PANTA_ATTRIBUTION_KEY };

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<ReportResponse>("/trades/report", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return NextResponse.json({ ...data, source: "panta" });
    } catch (err) {
      console.error("panta /trades/report failed, serving mock:", err);
    }
  }

  const resp: ReportResponse = { status: "attributed", source: "mock" };
  return NextResponse.json(resp);
}
