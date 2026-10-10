import { NextResponse } from "next/server";
import { STORE_ENABLED, withKeeperLock } from "@/lib/round-store";
import { advanceToNext, bootstrapRound, livePricing, pickMarket, tick, yesAfterTick, type Pricing } from "@/lib/round-keeper";
import { streakSpanSec } from "@/lib/streak";
import { getDraft, getPantaMarket } from "@/lib/panta-market";
import { PANTA_LIVE } from "@/lib/panta";
import { PICKS_PRACTICE_ARENA, STREAK_PRACTICE_ARENA, chainVaultUsdc, cutLine, humanCount, isPantaPit, isPracticeArena, newArenaCode, normalizeArenaCode, redactOpeningCalls, seatCostUsdc, seatPlayer, standings, type Round, logEvent } from "@/lib/royale";
import { escrowReady, initArenaOnChain, playerBalances } from "@/lib/escrow-server";
import { sessionWallet } from "@/lib/session";
import { NEEDS_X_MESSAGE, playerName } from "@/lib/identity";
import { limitByIp, overLimit } from "@/lib/rate-limit";
import { PublicKey } from "@solana/web3.js";
import { LOCK_HOLD_MAX_MS, unseatedDepositors, type SeatSync } from "@/lib/seat-sync";

export const dynamic = "force-dynamic";

// Keep a finished practice round on screen this long before the next one
// opens (hosted arenas keep their result until hosted again).
const HOLD_MS = 60_000;

/**
 * GET /api/round?arena=CODE
 *
 * Returns the current round FOR AN ARENA with live standings. Every arena is
 * independent; the reserved `PUBLIC` code is the walk-in bot lobby that
 * auto-bootstraps a round whenever none is live. Hosted arenas do NOT
 * auto-bootstrap — when their series ends, the URL shows the final scoreboard
 * (during the hold window) then goes empty.
 *
 * The whole tick/bootstrap/advance sequence runs under a per-arena advisory
 * lock so concurrent reads to one arena serialize while different arenas run
 * in parallel. External I/O is fetched BEFORE the lock.
 */
async function currentWithTick(arena: string, allowBootstrap: boolean): Promise<{ round: Round | null; pricing: Pricing; pricedId?: string }> {
  // Phase 1 — unlocked peek + external I/O (kept out of the lock).
  const peek = await import("@/lib/round-store").then((m) => m.getActiveRound(arena));
  const pricing = await livePricing(peek);
  // Only a royale has a next round.
  // A pit on a Panta market keeps its market for every round — the event is
  // still running; only crypto royales rotate to another coin.
  const mayAdvance = peek?.status === "live" && peek.config.format === "royale" && !isPantaPit(peek.config);
  const nextMarket = mayAdvance ? await pickMarket(peek?.config.marketId) : null;
  // Only the walk-in practice arenas auto-boot. Hosted arenas stay empty when
  // done. PUBLIC runs quick single rounds, PICKS predictions, and STREAK a
  // streak against a table of bots (elimination needs a crowd).
  const bootRound = !peek && allowBootstrap
    ? await bootstrapRound(
      arena === PICKS_PRACTICE_ARENA ? { format: "predictions" }
        : arena === STREAK_PRACTICE_ARENA ? { format: "streak", minEntrants: 6 }
        : { format: "single" }, arena)
    : null;
  // Paid-but-unseated wallets (escrow arenas while enrolling).
  const sync = await unseatedDepositors(peek);

  // Phase 2 — locked, atomic keeper (per-arena lock).
  const round = await withKeeperLock(arena, async (ctx) => {
    let round = await ctx.getActive();
    if (!round) {
      const latest = await ctx.getLatest();
      // Hold a finished result on screen briefly — except an empty practice
      // round, which is simply replaced.
      const emptyPractice = isPracticeArena(arena) && !!latest && humanCount(latest) === 0;
      if (latest && !emptyPractice && (latest.status === "complete" || latest.status === "cancelled")
          && latest.endedAt && Date.now() - latest.endedAt < HOLD_MS) {
        return latest;
      }
      if (bootRound) { await ctx.save(bootRound); await ctx.cancelOtherActive(bootRound.id); return bootRound; }
      return latest ?? null;
    }

    await ctx.cancelOtherActive(round.id);
    if (peek?.id === round.id && seatDepositors(round, sync)) {
      // Couldn't read the vault right at the lock — wait a few polls rather
      // than start (or cancel) the round without someone who paid.
      await ctx.save(round);
      return round;
    }
    const before = JSON.stringify(round);
    tick(round, pricing);
    if (round.status === "advancing") {
      const next = advanceToNext(round, nextMarket, pricing.spots);
      await ctx.save(round);
      await ctx.save(next);
      await ctx.cancelOtherActive(next.id);
      round = next;
    } else if (JSON.stringify(round) !== before) {
      // Most polls change nothing (e.g. an enrolling room) — skip the write.
      await ctx.save(round);
    }
    return round;
  });
  return { round, pricing, pricedId: peek?.id };
}

/**
 * Seat every wallet that deposited on chain but isn't on the roster yet.
 * Returns true when the lock should be held because the chain check failed.
 */
function seatDepositors(round: Round, sync: SeatSync): boolean {
  if (round.status !== "enrolling") return false;
  for (const wallet of sync.wallets) {
    if (round.entrants.some((e) => e.wallet === wallet)) continue;
    const pending = round.escrow?.pendingSeats?.[wallet];
    const res = seatPlayer(round, wallet, pending?.nickname ?? "", {
      openingCall: pending?.openingCall ?? null,
      openingCallPct: pending?.openingCallPct,
      picks: pending?.picks,
      locks: pending?.locks,
      restored: true
    });
    if (res.ok && round.escrow?.pendingSeats) delete round.escrow.pendingSeats[wallet];
  }
  const now = Date.now();
  return sync.failed && now >= round.enrollDeadline && now < round.enrollDeadline + LOCK_HOLD_MAX_MS;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const arena = normalizeArenaCode(url.searchParams.get("arena"));
    // Only the signed-in wallet sees its own hidden picks / opening call.
    const viewer = sessionWallet(request);
    const allowBootstrap = isPracticeArena(arena);
    const { round, pricing, pricedId } = await currentWithTick(arena, allowBootstrap);
    if (!round) {
      const status = isPracticeArena(arena) ? 503 : 404;
      const error = isPracticeArena(arena)
        ? "no market available to open a round"
        : `pit ${arena} not found`;
      return NextResponse.json({ round: null, arena, error }, { status });
    }
    // Price the round that is actually returned (it can differ from the one
    // priced before the lock: a fresh boot, or the next royale round).
    const yesPrice = round.id === pricedId || round.status === "live"
      ? yesAfterTick(round, pricing)
      : (await livePricing(round)).yesPrice;
    const pub = redactOpeningCalls(round, viewer);
    const asset = round.config.asset;
    return NextResponse.json({
      round: pub,
      arena: round.arenaCode,
      yesPrice,
      spot: (pricing.spots as Record<string, number | undefined>)[asset] ?? round.oracle?.last?.[asset] ?? null,
    // Panta pits: Panta's own line, shown next to the room's odds.
    line: isPantaPit(round.config) ? (pricing.line ?? round.book?.lastLine ?? round.book?.line ?? null) : null,
      cutLine: cutLine(round),
      standings: standings(pub),
      persisted: STORE_ENABLED
    });
  } catch (err) {
    console.error("GET /api/round failed:", err);
    return NextResponse.json({ round: null, error: err instanceof Error ? err.message : "round error" }, { status: 500 });
  }
}

/**
 * POST /api/round  { action:"new", config? }
 *
 * Host a pit. Every call MINTS A NEW PIT (short shareable code) for the
 * signed-in host, who then takes seat 1. The response includes the code and
 * its invite slug (`/a/{code}`). Only the operator (ROUND_HOST_SECRET) can
 * open a specific code.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    config?: Record<string, unknown>;
    force?: boolean;
    arena?: string;
  };
  if (body.action !== "new") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const forceOk = body.force === true && !!process.env.ROUND_HOST_SECRET
    && request.headers.get("x-host-secret") === process.env.ROUND_HOST_SECRET;

  const wantArena = body.arena ? normalizeArenaCode(body.arena) : "";
  // Every host call mints a brand-new pit. Only the operator (host secret)
  // can open a specific code, such as a walk-in practice lobby — those run
  // themselves and must not be reconfigured by a player.
  if (wantArena && !forceOk) {
    return NextResponse.json({ error: "Pit codes are assigned automatically — host without a code." }, { status: 400 });
  }
  const arena = wantArena && forceOk ? wantArena : newArenaCode();

  const onChain = escrowReady() && !isPracticeArena(arena);
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" && !isPracticeArena(arena)) {
    const liveKey = /^pk_live_/.test(process.env.PANTA_API_KEY ?? "");
    const mainnetMint = process.env.NEXT_PUBLIC_USDC_MINT === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    if (!onChain || !STORE_ENABLED || !liveKey || !mainnetMint || !process.env.SESSION_SECRET
        || !process.env.NEXT_PUBLIC_PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
      return NextResponse.json({ error: "Mainnet hosting is disabled until escrow, persistent storage, live Panta, USDC, and identity/session configuration are complete." }, { status: 503 });
    }
  }
  if (onChain && !STORE_ENABLED) {
    return NextResponse.json({ error: "Paid pits require persistent database storage." }, { status: 503 });
  }
  const limited = limitByIp(request, "host", 12, 10 * 60_000);
  if (limited) return limited;
  // Every hosted pit has a signed-in host (an X account where X sign-in is
  // set up) who takes seat 1 — practice mode included. On chain each pit
  // also costs the operator an InitRound (fee + rent).
  const host = sessionWallet(request);
  if (!host && !forceOk) {
    return NextResponse.json({ error: "Sign in with X to host a pit.", needsAuth: true }, { status: 401 });
  }
  if (host && (await playerName(host, undefined, false)).needsX) {
    return NextResponse.json({ error: NEEDS_X_MESSAGE.replace(" to play", " to host"), needsX: true }, { status: 403 });
  }
  if (host && overLimit("host-wallet", host, 6, 10 * 60_000)) {
    return NextResponse.json({ error: "You've opened several pits in the last few minutes — wait a little before hosting another." }, { status: 429 });
  }

  // A pit on a Panta market — an existing one from the catalog, or one the
  // host just created through The Pit (a verified draft). The question and
  // category are taken from Panta / the draft, never from the request body.
  let panta: { marketId: string; question: string; category: string } | undefined;
  const cfg = (body.config ?? {}) as { marketSource?: unknown; pantaMarketId?: unknown; draftId?: unknown };
  if (cfg.marketSource === "panta") {
    if (!PANTA_LIVE) return NextResponse.json({ error: "Panta markets aren't available on this server (no Panta API key)." }, { status: 503 });
    if (isPracticeArena(arena)) return NextResponse.json({ error: "Practice pits run on crypto markets." }, { status: 400 });
    if (typeof cfg.draftId === "string" && cfg.draftId) {
      const draft = await getDraft(cfg.draftId);
      if (!draft || !draft.marketId) return NextResponse.json({ error: "That market draft expired or was never registered — create it again." }, { status: 410 });
      if (!host || draft.wallet !== host) return NextResponse.json({ error: "Only the wallet that created this market can host a pit on it." }, { status: 403 });
      const snap = await getPantaMarket(draft.marketId, true);
      if (!snap || snap.unavailable || snap.resolved || snap.phase === "pending") return NextResponse.json({ error: "Panta has not made this market available for trading. The creation fee was already sent; retry hosting later without paying again." }, { status: 409 });
      if (snap.startMs !== null && snap.startMs > Date.now()) return NextResponse.json({ error: "Your market is registered but Panta trading has not opened yet. Return when it opens; you will not pay the creation fee again." }, { status: 409 });
      if (snap.endMs !== null && snap.endMs <= Date.now()) return NextResponse.json({ error: "Trading on your Panta market has ended. The creation fee was already sent; choose another market for the pit." }, { status: 409 });
      if (!snap.priceAvailable) return NextResponse.json({ error: "Panta has not published a live YES price for this market yet. Retry hosting when its line is available; you will not pay the creation fee again." }, { status: 409 });
      panta = { marketId: draft.marketId, question: draft.question, category: draft.category };
    } else if (typeof cfg.pantaMarketId === "string" && cfg.pantaMarketId) {
      const snap = await getPantaMarket(cfg.pantaMarketId, true);
      if (!snap) return NextResponse.json({ error: "Panta could not confirm that market right now — retry shortly or pick another." }, { status: 503 });
      if (snap.unavailable) return NextResponse.json({ error: "Panta cancelled that market — pick another." }, { status: 409 });
      if (snap.resolved) return NextResponse.json({ error: "That market has already resolved — pick an open one." }, { status: 409 });
      if (snap.phase === "pending") return NextResponse.json({ error: "Trading on that Panta market has not opened yet — pick an active one." }, { status: 409 });
      if (snap.startMs !== null && snap.startMs > Date.now()) return NextResponse.json({ error: "Trading on that Panta market has not opened yet — pick an active one." }, { status: 409 });
      if (snap.endMs !== null && snap.endMs <= Date.now()) return NextResponse.json({ error: "Trading on that market has ended — pick an open one." }, { status: 409 });
      if (!snap.priceAvailable) return NextResponse.json({ error: "Panta's live price is unavailable for that market right now — retry shortly or pick another." }, { status: 503 });
      panta = { marketId: snap.id, question: snap.question || "Panta market", category: snap.category };
    } else {
      return NextResponse.json({ error: "Pick a Panta market or create one." }, { status: 400 });
    }
  }

  const fresh = await bootstrapRound(body.config as never, arena, panta);
  if (!fresh) return NextResponse.json({ error: "no market available" }, { status: 503 });
  // The host is whoever is signed in — never a value from the request body.
  fresh.config.host = host ?? "";

  if (onChain) {
    const seat = seatCostUsdc(fresh.config);
    const bal = await playerBalances(new PublicKey(host!));
    const mainnet = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta";
    if (bal.usdc + 1e-9 < seat) {
      return NextResponse.json({ error: mainnet
        ? `This seat costs ${seat.toFixed(2)} USDC but your X wallet holds ${bal.usdc.toFixed(2)} mainnet USDC. Fund that wallet before hosting.`
        : `This seat costs ${seat.toFixed(2)} USDC but your X wallet holds ${bal.usdc.toFixed(2)} devnet USDC. Get test USDC at faucet.circle.com (Solana Devnet).` }, { status: 402 });
    }
    if (bal.sol < 0.005) {
      return NextResponse.json({ error: mainnet
        ? `You need about 0.005 SOL for fees (you hold ${bal.sol.toFixed(4)}). Fund that wallet before hosting.`
        : `You need about 0.005 devnet SOL for fees (you hold ${bal.sol.toFixed(4)}). Get some at faucet.solana.com.` }, { status: 402 });
    }
  }

  // If the on-chain escrow is deployed + configured AND this arena isn't the
  // walk-in PUBLIC lobby, mint the on-chain vault here so subsequent Deposit
  // calls have a real vault to land in. PUBLIC stays ledger-only — it's the
  // free bot practice arena.
  if (onChain) {
    const res = await initArenaOnChain({
      entryUsdc: fresh.config.entryUsdc,
      vaultUsdc: chainVaultUsdc(fresh.config),
      capacity: fresh.config.capacity,
      enrollmentSec: fresh.config.enrollmentSec,
      // A streak runs up to MAX_LEGS legs plus pick windows.
      liveSec: fresh.config.format === "streak" ? streakSpanSec(fresh.config.liveSec) : fresh.config.liveSec,
      roundLimit: fresh.config.roundLimit
    });
    if (res.ok) {
      fresh.escrow = res.record;
      logEvent(fresh, `On-chain vault ✓ ${res.record.roundVault.slice(0, 8)}…`);
    } else {
      // Escrow init failed — refuse to open the arena rather than silently
      // running it ledger-only under a shareable code. The user can retry.
      return NextResponse.json({ error: `escrow init failed: ${res.error}` }, { status: 502 });
    }
  }

  const result = await withKeeperLock(arena, async (ctx) => {
    const active = await ctx.getActive();
    // In a private (fresh-code) arena there is no active yet, so this is a no-op.
    // For PUBLIC we still allow replacing an empty lobby only.
    if (active && !forceOk) {
      const emptyLobby = active.status === "enrolling" && humanCount(active) === 0;
      if (!emptyLobby) return { conflict: active } as const;
    }
    await ctx.save(fresh);
    await ctx.cancelOtherActive(fresh.id);
    return { round: fresh } as const;
  });

  if ("conflict" in result) {
    return NextResponse.json({ error: "a game is already in progress in this pit", round: result.conflict ? redactOpeningCalls(result.conflict) : null }, { status: 409 });
  }
  const { yesPrice } = await livePricing(fresh);
  return NextResponse.json({
    round: fresh,
    arena: fresh.arenaCode,
    inviteSlug: `/a/${fresh.arenaCode}`,
    yesPrice,
    cutLine: cutLine(fresh),
    standings: standings(fresh),
    persisted: STORE_ENABLED
  });
}
