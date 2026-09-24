import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch } from "@/lib/panta";

/**
 * POST /api/markets/quote
 * Proxies Panta's POST /markets/create/quote/.
 *
 * Step 1 of the market creation lifecycle. The wire body follows Panta's
 * schema exactly — the client is responsible for supplying:
 *
 *   wallet             fee payer + on-chain signer (base58 pubkey)
 *   question           ≤512 chars
 *   resolutionRule     ≤2048 chars — how the market resolves
 *   sourcesOfTruth     string[]  1..20 URLs
 *   category           one of sports, crypto, politics, entertainment,
 *                      finance, science, world, other
 *   startTime          unix seconds
 *   endTime            unix seconds
 *   resolutionTime     unix seconds
 *   imageUrl           http/https, ≤2048 chars
 *
 * Response includes the `createId`, `paymentUsdc` (base units) and the
 * `expectedEventPda`.
 */
type Body = {
  wallet: string;
  question: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: string;
  startTime: number;
  endTime: number;
  resolutionTime: number;
  imageUrl: string;
};

const REQUIRED: (keyof Body)[] = ["wallet", "question", "resolutionRule", "sourcesOfTruth", "category", "startTime", "endTime", "resolutionTime", "imageUrl"];

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  for (const k of REQUIRED) {
    if (body[k] === undefined || body[k] === null || (typeof body[k] === "string" && body[k] === "")) {
      return NextResponse.json({ error: `${k} required` }, { status: 400 });
    }
  }
  if (!Array.isArray(body.sourcesOfTruth) || body.sourcesOfTruth.length === 0) {
    return NextResponse.json({ error: "sourcesOfTruth must be a non-empty string array" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{
        createId: string;
        paymentUsdc: string;
        liquidityInjectionUsdc?: string;
        platformRevenueUsdc?: string;
        expectedEventPda: string;
        expiresAt?: string;
      }>("/markets/create/quote", { method: "POST", body: JSON.stringify(body) });
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /markets/create/quote failed:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "panta failed" }, { status: 502 });
    }
  }

  // Mock: match the shape so the UI keeps working without a Panta key.
  return NextResponse.json({
    source: "mock",
    createId: `cr_mock_${Date.now().toString(36)}`,
    paymentUsdc: "50000000",
    liquidityInjectionUsdc: "10000000",
    platformRevenueUsdc: "40000000",
    expectedEventPda: "MockMarket11111111111111111111111111111111",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
}
