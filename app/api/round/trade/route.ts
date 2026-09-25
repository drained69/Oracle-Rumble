import { NextResponse } from "next/server";
import { getActiveRound, mutateActiveRound } from "@/lib/round-store";
import { buyShares, liquidate, markToMarket, standings } from "@/lib/royale";
import { marketYesPrice } from "@/lib/round-keeper";

/**
 * POST /api/round/trade  { wallet, action: "buy" | "sell", side?, usdc? }
 *
 * Executes a bankroll-scoped trade inside the live round at the current
 * Panta YES price. Runs inside an atomic round mutation so concurrent
 * trades / enrolls / keeper ticks serialize. The Panta price is fetched
 * before the transaction (external I/O stays out of the lock).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { wallet: string; action: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  if (body.action === "buy" && (!body.side || !body.usdc)) {
    return NextResponse.json({ error: "side and usdc required for buy" }, { status: 400 });
  }

  // Peek at the active round only to learn which market to price. The
  // authoritative mutation happens under lock below.
  const peek = await getActiveRound();
  if (!peek) return NextResponse.json({ error: "no active round" }, { status: 404 });
  const yes = await marketYesPrice(peek.config.marketId);

  let tradeError: string | undefined;
  const { round, error } = await mutateActiveRound((r) => {
    if (r.status !== "live") { tradeError = "round is not live"; return; }
    const entrant = r.entrants.find((e) => e.wallet === body.wallet);
    if (!entrant) { tradeError = "not enrolled in this round"; return; }
    if (entrant.eliminatedRound !== null) { tradeError = "eliminated"; return; }

    if (body.action === "sell") {
      liquidate(entrant, yes);
      r.history.push(`${entrant.nickname} liquidated at ${yes}¢.`);
    } else {
      const price = body.side === "YES" ? yes : 100 - yes;
      const res = buyShares(entrant, body.side!, body.usdc!, price, yes);
      if (!res.ok) { tradeError = res.reason; return; }
      r.history.push(`${entrant.nickname} bought ${body.side} $${body.usdc!.toFixed(0)} at ${price}¢.`);
    }
    markToMarket(entrant, yes);
  });

  if (!round) return NextResponse.json({ error: "no active round" }, { status: 404 });
  if (tradeError) return NextResponse.json({ error: tradeError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const entrant = round.entrants.find((e) => e.wallet === body.wallet);
  return NextResponse.json({ round, entrant, yesPrice: yes, standings: standings(round) });
}
