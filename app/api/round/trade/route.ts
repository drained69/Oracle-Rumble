import { NextResponse } from "next/server";
import { getActiveRound, saveRound } from "@/lib/round-store";
import { buyShares, liquidate, markToMarket, standings } from "@/lib/royale";
import { marketYesPrice } from "@/lib/round-keeper";

/**
 * POST /api/round/trade  { wallet, action: "buy" | "sell", side?, usdc? }
 *
 * Executes a bankroll-scoped trade inside the live round at the current
 * Panta YES price. "buy" opens/adds a YES or NO position; "sell" liquidates
 * the whole position at the mark. Bankroll accounting is server-side; the
 * matching real Panta order is placed by the client in parallel so the
 * on-chain fill and the round ledger stay in step.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { wallet: string; action: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const round = await getActiveRound();
  if (!round) return NextResponse.json({ error: "no active round" }, { status: 404 });
  if (round.status !== "live") return NextResponse.json({ error: "round is not live" }, { status: 409 });

  const entrant = round.entrants.find((e) => e.wallet === body.wallet);
  if (!entrant) return NextResponse.json({ error: "not enrolled in this round" }, { status: 403 });
  if (entrant.eliminatedRound !== null) return NextResponse.json({ error: "eliminated" }, { status: 409 });

  const yes = await marketYesPrice(round.config.marketId);

  if (body.action === "sell") {
    liquidate(entrant, yes);
    round.history.push(`${entrant.nickname} liquidated at ${yes}¢.`);
  } else {
    if (!body.side || !body.usdc) return NextResponse.json({ error: "side and usdc required for buy" }, { status: 400 });
    const price = body.side === "YES" ? yes : 100 - yes;
    const res = buyShares(entrant, body.side, body.usdc, price, yes);
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 409 });
    round.history.push(`${entrant.nickname} bought ${body.side} $${body.usdc.toFixed(0)} at ${price}¢.`);
  }
  markToMarket(entrant, yes);

  await saveRound(round);
  return NextResponse.json({ round, entrant, yesPrice: yes, standings: standings(round) });
}
