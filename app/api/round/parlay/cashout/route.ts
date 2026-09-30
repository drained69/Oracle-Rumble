import { NextResponse } from "next/server";
import { requireWallet } from "@/lib/session";
import { getActiveRound, mutateActiveRound } from "@/lib/round-store";
import { markToMarket, normalizeArenaCode, standings, redactOpeningCalls, logEvent, tradingOpen, TRADE_CUTOFF_MS } from "@/lib/royale";
import { pantaPriceToCents, tradePricing } from "@/lib/round-keeper";
import { assetOfMarketId, type AssetSymbol } from "@/lib/assets";
import { quoteCashOut } from "@/lib/parlay";
import { findMockMarket } from "@/lib/arena-data";
import { PANTA_LIVE, pantaFetch, type PantaMarket } from "@/lib/panta";

/**
 * POST /api/round/parlay/cashout  { wallet, ticketId, arena }
 *
 * Early-exit / partial-cashout for an open parlay ticket. Fair value =
 * shares × Π(current side probability). A small cashout fee applies
 * (parlayit-style edge on early exit). The ticket is marked "cashed_out"
 * and its net cashout is credited to the entrant's cash bankroll.
 *
 * Guarantees:
 *   - Only the ticket's owner (matched by wallet) can cash out.
 *   - Round must be "live" — cashout is disabled at enrolling / settling /
 *     complete / cancelled.
 *   - Refuses on missing prices for every leg (falls back safely per-leg
 *     when a subset is missing).
 *   - Idempotent: a ticket already "cashed_out" or otherwise settled is
 *     refused rather than double-crediting.
 *   - Atomically credits cash + marks the ticket cashed_out + updates
 *     bankroll inside the round-store SELECT ... FOR UPDATE lock.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { wallet?: string; ticketId?: string; arena?: string };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  // Only the wallet itself (signed-in session) may act for its seat.
  const denied = requireWallet(request, body.wallet);
  if (denied) return denied;
  if (!body?.ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 });
  const arena = normalizeArenaCode(body.arena);

  const peek = await getActiveRound(arena);
  if (!peek) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  if (peek.status !== "live") return NextResponse.json({ error: `cashout only allowed while round is live (status: ${peek.status})` }, { status: 409 });

  const entrant = peek.entrants.find((e) => e.wallet === body.wallet);
  if (!entrant) return NextResponse.json({ error: "not enrolled in this round" }, { status: 403 });
  const ticket = entrant.parlays.find((t) => t.id === body.ticketId);
  if (!ticket) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
  if (ticket.status !== "open") return NextResponse.json({ error: `ticket is ${ticket.status}, not open` }, { status: 409 });

  if (!tradingOpen(peek)) return NextResponse.json({ error: `Cash-out is closed for the last ${TRADE_CUTOFF_MS / 1000} seconds of the round.` }, { status: 409 });
  // Direction legs are priced by the round's oracle, the same prices the
  // ticket settles against.
  const pricing = await tradePricing(peek, ticket.legs.map((l) => assetOfMarketId(l.marketId)).filter((a): a is AssetSymbol => !!a));
  if (pricing.pause) {
    return NextResponse.json({ error: `${pricing.pause} — cash-out pauses for a few seconds while the price settles. Try again shortly.`, retry: true }, { status: 409 });
  }

  // Fetch live YES prices for every leg's market. Reuses the same source
  // policy as /api/round/parlay: synthetic dir- ids are priced from the
  // arena-data board, real Panta ids come from Panta live-api.
  const currentYesPrices: Record<string, number> = {};
  for (const leg of ticket.legs) {
    const local = findMockMarket(leg.marketId);
    if (local) { currentYesPrices[leg.marketId] = pricing.priceMap[leg.marketId] ?? 50; continue; }
    if (PANTA_LIVE) {
      try {
        const live = await pantaFetch<PantaMarket & { yesPrice?: number | string }>(`/markets/${encodeURIComponent(leg.marketId)}`);
        currentYesPrices[leg.marketId] = pantaPriceToCents(live.yesPrice);
        continue;
      } catch { /* fall through */ }
    }
    // Leg without a price → intentionally omit; quoteCashOut will fall back
    // to the leg's entryPrice for that specific leg.
  }

  const quote = quoteCashOut({
    ticketId: ticket.id,
    shares: ticket.shares,
    originalStake: ticket.stake,
    legs: ticket.legs.map((l) => ({ marketId: l.marketId, question: l.question, side: l.side, entryPrice: l.entryPrice })),
    currentYesPrices
  });

  if (!quote.eligible) {
    return NextResponse.json({ error: quote.reason ?? "not eligible for cashout", quote }, { status: 409 });
  }

  // The round-view YES price + priceMap so markToMarket is fresh post-cashout.
  const yesForRound = pricing.yesPrice;
  const priceMap = { ...pricing.priceMap };
  for (const [mid, y] of Object.entries(currentYesPrices)) priceMap[mid] = y;

  let mutationError: string | undefined;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (!tradingOpen(r)) { mutationError = "Cash-out has closed for this round."; return; }
    const e = r.entrants.find((x) => x.wallet === body.wallet);
    if (!e) { mutationError = "not enrolled in this round"; return; }
    const t = e.parlays.find((x) => x.id === body.ticketId);
    if (!t) { mutationError = "ticket not found"; return; }
    if (t.status !== "open") { mutationError = `ticket is ${t.status}`; return; }

    e.cash += quote.netCashoutUsdc;
    t.status = "cashed_out";
    t.settledPayout = quote.netCashoutUsdc;
    t.cashedOutAt = Date.now();
    logEvent(r, 
      `${e.nickname} cashed out a ${t.legs.length}-leg parlay for $${quote.netCashoutUsdc.toFixed(2)} (staked $${quote.originalStakeUsdc.toFixed(2)}).`
    );
    markToMarket(e, yesForRound, priceMap);
  });

  if (!round) return NextResponse.json({ error: "no active round in this arena", arena }, { status: 404 });
  if (mutationError) return NextResponse.json({ error: mutationError }, { status: 409 });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const updated = round.entrants.find((e) => e.wallet === body.wallet);
  return NextResponse.json({ round: redactOpeningCalls(round, body.wallet), arena, entrant: updated, quote, yesPrice: yesForRound, standings: standings(round) });
}
