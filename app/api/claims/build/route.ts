import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch, type ClaimBuildRequest, type ClaimBuildResponse, type PantaInstruction } from "@/lib/panta";

/**
 * POST /api/claims/build
 *
 * Proxies Panta's POST /claim/build/ (note: singular `claim`, not
 * `claims`). Returns raw Solana `instructions[]` + `recentBlockhash`,
 * NOT a pre-serialized VersionedTransaction — the client compiles the
 * tx locally with the wallet's pubkey as fee payer (see
 * lib/panta-client.ts compileAndSign).
 */
type PantaClaimBuild = {
  wallet: string;
  marketId: string;
  outcome?: "YES" | "NO";
  winningShares?: string;
  instructions?: PantaInstruction[];
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
};

function sharesToUsdc(shares: string | number | undefined): string {
  if (shares === undefined) return "0.00";
  const n = typeof shares === "number" ? shares : Number(shares);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export async function POST(request: Request) {
  const body = (await request.json()) as ClaimBuildRequest;
  if (!body?.wallet || !body?.marketId) {
    return NextResponse.json({ error: "wallet, marketId required" }, { status: 400 });
  }

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<PantaClaimBuild>("/claim/build", {
        method: "POST",
        body: JSON.stringify({ wallet: body.wallet, marketId: body.marketId })
      });
      const resp: ClaimBuildResponse = {
        instructions: data.instructions ?? [],
        recentBlockhash: data.recentBlockhash ?? "",
        lastValidBlockHeight: data.lastValidBlockHeight,
        outcome: data.outcome,
        winningShares: data.winningShares,
        // A winning-share equals 1 USDC on payout, so shares → USDC 1:1.
        amountUsdc: sharesToUsdc(data.winningShares),
        source: "panta"
      };
      return NextResponse.json(resp);
    } catch (err) {
      console.error("panta /claim/build failed, serving mock:", err);
    }
  }

  const resp: ClaimBuildResponse = {
    instructions: [],
    recentBlockhash: "MockBlockhash11111111111111111111111111111111",
    outcome: "YES",
    winningShares: (Math.random() * 200 + 10).toFixed(2),
    amountUsdc: (Math.random() * 200 + 10).toFixed(2),
    source: "mock"
  };
  return NextResponse.json(resp);
}
