import { NextResponse } from "next/server";
import { getActiveRound, mutateActiveRound } from "@/lib/round-store";
import { markToMarket, normalizeArenaCode, placeParlay, standings, type ParlayLegState, type ParlayTicket } from "@/lib/royale";
import { buildPriceMap, marketYesPrice, pantaPriceToCents } from "@/lib/round-keeper";
import { quoteParlay, validateParlay, type ParlayLeg } from "@/lib/parlay";
import { findMockMarket } from "@/lib/arena-data";
import { assetOfMarketId } from "@/lib/assets";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";

/**
 * POST /api/round/parlay  { wallet, legs: [{ marketId, side }], stakeUsdc }
 *
 * Place a native parlay from the player's vault inside the live round. Leg
 * prices are refreshed from the market layer, the parlay is priced by the
 * variance-fee engine (lib/parlay.ts), and the resulting ticket is placed
 * atomically. It marks-to-market and settles alongside the round.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    wallet: string;
    legs: Array<{ marketId: string; side: "YES" | "NO" }>;
    stakeUsdc: number | string;
    arena?: string;
  };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  if (!Array.isArray(body.legs) || body.legs.length < 2) {
    return NextResponse.json({ error: "a parlay needs at least 2 legs" }, { status: 400 });
  }
  const stake = Number(body.stakeUsdc);
  if (!Number.isFinite(stake) || stake <= 0) {
    return NextResponse.json({ error: "stakeUsdc > 0 required" }, { status: 400 });
  }
  const arena = normalizeArenaCode(body.arena);

  // Refresh each leg's price + metadata. Our own BTC/ETH/SOL board markets are
  // synthetic — price them from the board, never the Panta sandbox (which
  // returns a 50¢ fixture for any id). Only real Panta ids hit Panta.
  const refreshed: ParlayLeg[] = [];
  const legState: ParlayLegState[] = [];
  for (const leg of body.legs) {
    let question = "";
    let yes = 50;
    let correlationGroup: string | undefined;
    let asset: string = assetOfMarketId(leg.marketId) ?? "";

    const local = findMockMarket(leg.marketId);
    if (local && assetOfMarketId(leg.marketId)) {
      question = local.market.question;
      correlationGroup = local.market.correlationGroup;
      asset = local.market.asset;
      yes = local.market.yesPrice;
    } else if (PANTA_LIVE) {
      try {
        const live = await pantaFetch<PantaMarket & { yesPrice?: number | string }>(`/markets/${encodeURIComponent(leg.marketId)}`);
        question = live.question;
        yes = pantaPriceToCents(live.yesPrice);
      } catch {
        if (!local) return NextResponse.json({ error: `market not found: ${leg.marketId}` }, { status: 404 });
        question = local.market.question; correlationGroup = local.market.correlationGroup; asset = local.market.asset; yes = local.market.yesPrice;
      }
    } else {
      if (!local) return NextResponse.json({ error: `market not found: ${leg.marketId}` }, { status: 404 });
      question = local.market.question; correlationGroup = local.market.correlationGroup; asset = local.market.asset; yes = local.market.yesPrice;
    }

    const price = leg.side === "YES" ? yes : 100 - yes;
    refreshed.push({ marketId: leg.marketId, side: leg.side, question, price, correlationGroup });
    legState.push({ marketId: leg.marketId, asset: String(asset), question, side: leg.side, entryPrice: price });
  }

  const valid = validateParlay(refreshed);
  if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: 422 });

  const quote = quoteParlay(refreshed, stake);

  const peek = await getActiveRound(arena);
  if (!peek) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  const yes = await marketYesPrice(peek.config.marketId);
  const priceMap = buildPriceMap({ marketId: peek.config.marketId, yesPrice: yes });

  let placeError: string | undefined;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (r.status !== "live") { placeError = "round is not live"; return; }
    const entrant = r.entrants.find((e) => e.wallet === body.wallet);
    if (!entrant) { placeError = "not enrolled in this round"; return; }

    const ticket: ParlayTicket = {
      id: `play_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      legs: legState,
      stake: quote.stakeUsdc,
      fee: quote.feeUsdc,
      shares: quote.shares,
      combinedEntryPrice: quote.combinedPrice,
      potentialPayout: quote.potentialPayoutUsdc,
      status: "open",
      settledPayout: 0,
      placedAt: Date.now()
    };
    const res = placeParlay(entrant, ticket);
    if (!res.ok) { placeError = res.reason; return; }
    r.history.push(`${entrant.nickname} placed a ${legState.length}-leg parlay for $${quote.stakeUsdc.toFixed(0)} (pays $${quote.potentialPayoutUsdc.toFixed(0)}).`);
    markToMarket(entrant, yes, priceMap);
  });

  if (!round) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  if (placeError) return NextResponse.json({ error: placeError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const entrant = round.entrants.find((e) => e.wallet === body.wallet);
  return NextResponse.json({ round, arena, entrant, quote, yesPrice: yes, standings: standings(round) });
}
