import { NextResponse } from "next/server";
import { requireWallet } from "@/lib/session";
import { getActiveRound, mutateActiveRound } from "@/lib/round-store";
import {
  buyPriceOf, isPicksFormat, buyShares, liquidate, logEvent, markToMarket, normalizeArenaCode, redactOpeningCalls, sellPriceOf,
  sideWord, standings, tradingOpen, TRADE_CUTOFF_MS, TRADE_SPREAD
} from "@/lib/royale";
import { bookBuy, bookCents, bookSell, recordTape } from "@/lib/room-book";
import { tradePricing } from "@/lib/round-keeper";
import type { AssetSymbol } from "@/lib/assets";

export const dynamic = "force-dynamic";

/** Refuse a fill this far (cents) from the price the player was shown. */
const MAX_SLIPPAGE = 5;

/**
 * POST /api/round/trade  { wallet, action: "buy" | "sell", side?, usdc?, arena?, quotedYes? }
 *
 * A single UP/DOWN trade from the player's vault, fair to everyone in the room:
 *   - priced on quotes taken at trade time, not a cached price, and paused
 *     for a moment while the asset is jumping or exchanges disagree;
 *   - 1¢ spread (buy above, sell below the market price);
 *   - closed for the last 30 seconds of the round ("last call");
 *   - refused if the price moved more than 5¢ from the one the player saw
 *     (`quotedYes`), with the new price returned.
 * Runs inside the arena lock so concurrent trades and keeper ticks serialize.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    wallet?: string; action?: "buy" | "sell"; side?: "YES" | "NO"; usdc?: number; arena?: string; quotedYes?: number;
  };
  if (!body?.wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  // Only the wallet itself (signed-in session) may act for its seat.
  const denied = requireWallet(request, body.wallet);
  if (denied) return denied;
  if (body.action !== "buy" && body.action !== "sell") {
    return NextResponse.json({ error: "action must be buy or sell" }, { status: 400 });
  }
  if (body.action === "buy") {
    if (body.side !== "YES" && body.side !== "NO") return NextResponse.json({ error: "side must be YES (UP) or NO (DOWN)" }, { status: 400 });
    if (typeof body.usdc !== "number" || !Number.isFinite(body.usdc) || body.usdc <= 0) {
      return NextResponse.json({ error: "usdc must be a positive amount" }, { status: 400 });
    }
  }
  const arena = normalizeArenaCode(body.arena);

  const peek = await getActiveRound(arena);
  if (!peek) return NextResponse.json({ error: "no active round in this pit", arena }, { status: 404 });
  if (peek.status !== "live") return NextResponse.json({ error: "round is not live" }, { status: 409 });
  if (isPicksFormat(peek.config.format)) return NextResponse.json({ error: "This pit is played by picking answers — there's nothing to trade." }, { status: 409 });
  if (!tradingOpen(peek)) {
    return NextResponse.json({ error: `Trading is closed for the last ${TRADE_CUTOFF_MS / 1000} seconds of the round — positions are locked until it settles.`, closed: true }, { status: 409 });
  }

  const pricing = await tradePricing(peek, [peek.config.asset as AssetSymbol]);
  if (pricing.pause) {
    return NextResponse.json({ error: `${pricing.pause} — trading pauses for a few seconds while the price settles. Try again shortly.`, retry: true, yesPrice: pricing.yesPrice }, { status: 409 });
  }
  const yes = pricing.yesPrice;
  // Room-book pits check slippage inside the lock against the live book.
  if (!peek.book && typeof body.quotedYes === "number" && Number.isFinite(body.quotedYes)) {
    const side = body.action === "buy" ? body.side! : null;
    const shownSide = side === "NO" ? 100 - body.quotedYes : body.quotedYes;
    const nowSide = side === "NO" ? 100 - yes : yes;
    if (Math.abs(nowSide - shownSide) > MAX_SLIPPAGE) {
      const label = side ? sideWord(side) : "UP";
      return NextResponse.json({
        error: `The price moved from ${Math.round(shownSide)}¢ to ${nowSide}¢ ${label} — check the new price and trade again.`,
        repriced: true, yesPrice: yes
      }, { status: 409 });
    }
  }

  let tradeError: string | undefined;
  let fill = "";
  let bookYes: number | undefined;
  let repricedYes: number | undefined;
  const { round, error } = await mutateActiveRound(arena, (r) => {
    if (r.id !== peek.id || r.config.marketId !== peek.config.marketId || r.config.asset !== peek.config.asset) {
      tradeError = "The round changed while this trade was being priced. Refresh and try again.";
      return;
    }
    if (!tradingOpen(r)) { tradeError = "Trading has closed for this round."; return; }
    const entrant = r.entrants.find((e) => e.wallet === body.wallet);
    if (!entrant) { tradeError = "not enrolled in this round"; return; }
    if (entrant.eliminatedRound !== null) { tradeError = "eliminated"; return; }

    if (r.book) {
      // A pit on a Panta market: the trade fills against the room's book and
      // moves its odds for everyone.
      const book = r.book;
      const now = bookCents(book);
      if (typeof body.quotedYes === "number" && Number.isFinite(body.quotedYes)) {
        const side = body.action === "buy" ? body.side! : entrant.side;
        const shown = side === "NO" ? 100 - body.quotedYes : body.quotedYes;
        const live = side === "NO" ? 100 - now : now;
        if (Math.abs(live - shown) > MAX_SLIPPAGE) {
          tradeError = `The room moved from ${Math.round(shown)}¢ to ${Math.round(live)}¢ ${side ?? "YES"} — check the new price and trade again.`;
          repricedYes = now;
          return;
        }
      }
      if (body.action === "sell") {
        if (!entrant.side || entrant.shares <= 0) { tradeError = "You have no position to sell."; return; }
        const word = entrant.side;
        const proceeds = bookSell(book, entrant);
        fill = `Sold your ${word} for $${proceeds.toFixed(2)}.`;
        logEvent(r, `${entrant.nickname} sold ${word} for $${proceeds.toFixed(2)} — room now ${Math.round(bookCents(book))}¢ YES.`);
      } else {
        const res = bookBuy(book, entrant, body.side!, body.usdc!);
        if (!res.ok) { tradeError = res.reason; return; }
        fill = `Bought ${body.side} at ${res.avgCents.toFixed(1)}¢ avg — room now ${Math.round(res.priceAfter)}¢ YES.`;
        logEvent(r, `${entrant.nickname} bought ${body.side} $${body.usdc!.toFixed(2)} at ${res.avgCents.toFixed(1)}¢ — room now ${Math.round(res.priceAfter)}¢ YES.`);
      }
      bookYes = bookCents(book);
      r.tape = recordTape(r.tape ?? [], Date.now(), bookYes);
      return;
    }

    if (body.action === "sell") {
      if (!entrant.side || entrant.shares <= 0) { tradeError = "You have no position to sell."; return; }
      const at = sellPriceOf(entrant.side === "YES" ? yes : 100 - yes);
      const word = sideWord(entrant.side);
      liquidate(entrant, yes, TRADE_SPREAD);
      fill = `Sold your ${word} at ${at}¢.`;
      logEvent(r, `${entrant.nickname} sold ${word} at ${at}¢.`);
    } else {
      const price = buyPriceOf(body.side === "YES" ? yes : 100 - yes);
      const res = buyShares(entrant, body.side!, body.usdc!, price, yes, TRADE_SPREAD);
      if (!res.ok) { tradeError = res.reason; return; }
      fill = `Bought ${sideWord(body.side!)} at ${price}¢.`;
      logEvent(r, `${entrant.nickname} bought ${sideWord(body.side!)} $${body.usdc!.toFixed(2)} at ${price}¢.`);
    }
    markToMarket(entrant, yes, pricing.priceMap);
  });

  if (!round) return NextResponse.json({ error: "no active round in this pit", arena }, { status: 404 });
  if (tradeError) {
    return NextResponse.json(repricedYes !== undefined ? { error: tradeError, repriced: true, yesPrice: repricedYes } : { error: tradeError }, { status: 409 });
  }
  if (error) return NextResponse.json({ error }, { status: 500 });

  const entrant = round.entrants.find((e) => e.wallet === body.wallet);
  return NextResponse.json({ round: redactOpeningCalls(round, body.wallet), arena, entrant, yesPrice: bookYes ?? yes, fill, standings: standings(round) });
}
