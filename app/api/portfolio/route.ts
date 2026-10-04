import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { escrowReady, listWalletDeposits, type WalletDeposit } from "@/lib/escrow-server";
import { latestRoundsForWallet } from "@/lib/round-store";
import { livePricing, yesAfterTick } from "@/lib/round-keeper";
import { cutLine, finishingOrder, markToMarket, paidPlaces, scorePlace, standings, type Entrant, type Round } from "@/lib/royale";
import { pickCount } from "@/lib/predictions";
import { sessionWallet } from "@/lib/session";
import { limitByIp } from "@/lib/rate-limit";
import type { Portfolio, PortfolioAction, PortfolioItem } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

const CACHE_MS = 6_000;
const _g = globalThis as unknown as { __or_portfolio?: Map<string, { at: number; deposits: WalletDeposit[] }> };
const depositCache: Map<string, { at: number; deposits: WalletDeposit[] }> = (_g.__or_portfolio ??= new Map());

const round2 = (n: number) => Math.round(n * 100) / 100;
const ACTIVE = new Set(["enrolling", "live", "settling", "advancing"]);
/** Below this an entitlement isn't worth a withdrawal (a predictions seat's 1-unit vault). */
const DUST_USDC = 0.0001;

/** On-chain deposits of a wallet, cached briefly (getProgramAccounts is heavy). */
async function deposits(wallet: string): Promise<WalletDeposit[]> {
  const hit = depositCache.get(wallet);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.deposits;
  const list = escrowReady() ? await listWalletDeposits(wallet) : [];
  if (depositCache.size > 2_000) depositCache.clear();
  depositCache.set(wallet, { at: Date.now(), deposits: list });
  return list;
}

function actionFor(round: Round | null, dep: WalletDeposit | undefined): { action: PortfolioAction; usdc: number } {
  if (!dep) return { action: "none", usdc: 0 };
  if (dep.claimed) return { action: "claimed", usdc: dep.entitlementUsdc };
  const seat = dep.vault ? dep.vault.entryUsdc + dep.vault.vaultUsdc : 0;
  if (dep.vault?.settled) {
    return dep.settled && dep.entitlementUsdc > DUST_USDC ? { action: "claim", usdc: dep.entitlementUsdc } : { action: "none", usdc: 0 };
  }
  const finished = !round || round.status === "complete" || round.status === "cancelled";
  if (!finished) return { action: "none", usdc: 0 };
  const recoverAt = dep.vault ? dep.vault.settleDeadline * 1000 : Infinity;
  return Date.now() >= recoverAt ? { action: "recover", usdc: seat } : { action: "settling", usdc: 0 };
}

function myView(round: Round, me: Entrant, yes: number | null, showCall: boolean): PortfolioItem["me"] {
  const e: Entrant = { ...me, parlays: me.parlays.map((t) => ({ ...t })) };
  if (round.status === "live" && yes !== null) markToMarket(e, yes);
  const done = round.status === "complete" || round.status === "cancelled";
  const order = done ? finishingOrder(round) : standings(round).filter((x) => x.eliminatedRound === null);
  const idx = order.findIndex((x) => x.wallet === me.wallet);
  const markPrice = yes === null || !e.side ? null : e.side === "YES" ? yes : 100 - yes;
  const predictions = round.config.format === "predictions";
  const questions = round.predictions?.questions.length ?? 0;
  return {
    nickname: me.nickname,
    startingVault: round.config.startingBankroll,
    vault: round2(e.bankroll),
    cash: round2(e.cash),
    side: e.side,
    shares: round2(e.shares),
    avgPrice: Math.round(e.avgPrice),
    markPrice,
    openingCall: showCall ? me.openingCall ?? null : null,
    openingCallPct: showCall && me.openingCall ? me.openingCallPct ?? 100 : null,
    openParlays: me.parlays.filter((t) => t.status === "open").length,
    place: predictions ? scorePlace(round, me) : idx >= 0 && (done || me.eliminatedRound === null) ? idx + 1 : null,
    players: done ? round.entrants.length : order.length,
    survivors: predictions ? paidPlaces(round) : cutLine(round),
    eliminatedRound: me.eliminatedRound,
    prizeUsdc: round2(me.prizeUsdc),
    score: predictions ? me.score ?? 0 : null,
    questions,
    picksMade: predictions && showCall ? pickCount(round.predictions?.questions, me.picks) : null,
    inMoney: predictions && round.status === "live" ? scorePlace(round, me, true) <= paidPlaces(round) : null
  };
}

/**
 * GET /api/portfolio?wallet=…
 *
 * Everything a wallet has in play: every arena it's seated in (from the
 * game ledger) merged with every deposit it made (from the escrow program on
 * chain), so a paid seat, an unclaimed payout or a refund is never missing.
 * Opening calls are only included for the signed-in wallet itself.
 */
export async function GET(request: Request) {
  const limited = limitByIp(request, "portfolio", 60, 60_000);
  if (limited) return limited;
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  try { new PublicKey(wallet); } catch { return NextResponse.json({ error: "invalid wallet" }, { status: 400 }); }
  const showCalls = sessionWallet(request) === wallet;

  let chainError: string | undefined;
  const deps = await deposits(wallet).catch((err) => {
    chainError = `Couldn't read your on-chain deposits right now (${err instanceof Error ? err.message.slice(0, 80) : "RPC error"}).`;
    return [] as WalletDeposit[];
  });
  const byVault = new Map(deps.map((d) => [d.roundVault, d]));
  const rounds = await latestRoundsForWallet(wallet, [...byVault.keys()], 100);

  const items: PortfolioItem[] = [];
  const seenVaults = new Set<string>();
  for (const round of rounds) {
    const me = round.entrants.find((e) => e.wallet === wallet && !e.isBot) ?? null;
    const dep = round.escrow ? byVault.get(round.escrow.roundVault) : undefined;
    if (round.escrow) seenVaults.add(round.escrow.roundVault);
    if (!me && !dep) continue;
    const yes = me && round.status === "live" ? yesAfterTick(round, await livePricing(round)) : null;
    const { action, usdc } = actionFor(round, dep);
    items.push({
      arena: round.arenaCode,
      status: round.status,
      question: round.config.marketQuestion,
      asset: round.config.asset,
      format: round.config.format,
      roundNumber: round.roundNumber,
      roundLimit: round.config.roundLimit,
      createdAt: round.createdAt,
      endedAt: round.endedAt,
      deadline: round.status === "enrolling" ? round.enrollDeadline : round.status === "live" ? round.liveDeadline : 0,
      practice: !round.escrow,
      me: me ? myView(round, me, yes, showCalls) : null,
      chain: dep ? {
        roundVault: dep.roundVault,
        seatUsdc: dep.vault ? dep.vault.entryUsdc + dep.vault.vaultUsdc : 0,
        entitlementUsdc: dep.entitlementUsdc,
        settled: dep.settled,
        claimed: dep.claimed,
        claimsOpen: !!dep.vault?.settled,
        recoverAt: dep.vault ? dep.vault.settleDeadline * 1000 : null
      } : null,
      action,
      actionUsdc: round2(usdc)
    });
  }
  // Deposits in vaults the game no longer knows (e.g. a wiped ledger).
  for (const dep of deps) {
    if (seenVaults.has(dep.roundVault)) continue;
    const { action, usdc } = actionFor(null, dep);
    items.push({
      arena: "", status: "unknown", question: "Arena not found", asset: "", format: "single",
      roundNumber: 0, roundLimit: 0, createdAt: 0, endedAt: 0, deadline: 0, practice: false, me: null,
      chain: {
        roundVault: dep.roundVault,
        seatUsdc: dep.vault ? dep.vault.entryUsdc + dep.vault.vaultUsdc : 0,
        entitlementUsdc: dep.entitlementUsdc,
        settled: dep.settled,
        claimed: dep.claimed,
        claimsOpen: !!dep.vault?.settled,
        recoverAt: dep.vault ? dep.vault.settleDeadline * 1000 : null
      },
      action, actionUsdc: round2(usdc)
    });
  }

  const summary = {
    active: items.filter((i) => ACTIVE.has(i.status) && i.me).length,
    inPlayUsdc: round2(items.filter((i) => ACTIVE.has(i.status) && !i.practice && i.me).reduce((s, i) => s + (i.me?.vault ?? 0), 0)),
    claimableUsdc: round2(items.filter((i) => i.action === "claim" || i.action === "recover").reduce((s, i) => s + i.actionUsdc, 0)),
    prizesUsdc: round2(items.filter((i) => !i.practice).reduce((s, i) => s + (i.me?.prizeUsdc ?? 0), 0))
  };
  const body: Portfolio = { wallet, items, summary, ...(chainError ? { error: chainError } : {}) };
  return NextResponse.json(body);
}
