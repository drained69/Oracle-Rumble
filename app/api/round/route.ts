import { NextResponse } from "next/server";
import { STORE_ENABLED, withKeeperLock } from "@/lib/round-store";
import { advanceToNext, bootstrapRound, livePricing, oraclePriceMap, pickMarket, tick, yesAfterTick, type Pricing } from "@/lib/round-keeper";
import { PUBLIC_ARENA, cutLine, humanCount, newArenaCode, normalizeArenaCode, redactOpeningCalls, seatPlayer, standings, type Round, logEvent } from "@/lib/royale";
import { escrowReady, initArenaOnChain, playerBalances } from "@/lib/escrow-server";
import { sessionWallet } from "@/lib/session";
import { limitByIp, overLimit } from "@/lib/rate-limit";
import { PublicKey } from "@solana/web3.js";
import { LOCK_HOLD_MAX_MS, unseatedDepositors, type SeatSync } from "@/lib/seat-sync";

export const dynamic = "force-dynamic";

const HOLD_MS = 20_000; // keep a finished round on screen this long

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
  const mayAdvance = peek?.status === "live";
  const nextMarket = mayAdvance ? await pickMarket(peek?.config.marketId) : null;
  // Only the walk-in PUBLIC arena auto-boots. Hosted arenas stay empty when done.
  const bootRound = !peek && allowBootstrap ? await bootstrapRound(undefined, arena) : null;
  // Paid-but-unseated wallets (escrow arenas while enrolling).
  const sync = await unseatedDepositors(peek);

  // Phase 2 — locked, atomic keeper (per-arena lock).
  const round = await withKeeperLock(arena, async (ctx) => {
    let round = await ctx.getActive();
    if (!round) {
      const latest = await ctx.getLatest();
      if (latest && (latest.status === "complete" || latest.status === "cancelled")
          && latest.endedAt && Date.now() - latest.endedAt < HOLD_MS) {
        return latest; // hold the result on screen briefly
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
    tick(round, pricing);
    if (round.status === "advancing") {
      const next = advanceToNext(round, nextMarket, pricing.spots);
      await ctx.save(round);
      await ctx.save(next);
      await ctx.cancelOtherActive(next.id);
      round = next;
    } else {
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
    const viewer = url.searchParams.get("wallet");
    const allowBootstrap = arena === PUBLIC_ARENA;
    const { round, pricing, pricedId } = await currentWithTick(arena, allowBootstrap);
    if (!round) {
      const status = arena === PUBLIC_ARENA ? 503 : 404;
      const error = arena === PUBLIC_ARENA
        ? "no market available to open a round"
        : `arena ${arena} not found`;
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
      prices: round.id === pricedId ? oraclePriceMap(round, pricing.spots) : undefined,
      spot: (pricing.spots as Record<string, number | undefined>)[asset] ?? round.oracle?.last?.[asset] ?? null,
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
 * POST /api/round  { action:"new", config?, arena? }
 *
 * Host a rumble. Every host call MINTS A NEW ARENA (short shareable code)
 * unless one is provided and the caller is trusted (ROUND_HOST_SECRET). Because
 * arenas are independent, hosting always succeeds — no more single-active
 * conflict. The response includes the new arena code and its invite URL slug
 * (`/a/{code}`) which the client can share with friends.
 *
 * Special case: passing `arena: "PUBLIC"` and no force header replaces the
 * walk-in public lobby only when it's still empty (no humans joined).
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
  // Default: mint a brand-new arena for every host call. The client can force
  // a specific code (including PUBLIC) with the host secret.
  const arena = wantArena && forceOk ? wantArena : (wantArena === PUBLIC_ARENA ? PUBLIC_ARENA : newArenaCode());

  const onChain = escrowReady() && arena !== PUBLIC_ARENA;
  // Every on-chain arena costs the operator an InitRound (fee + rent), so
  // hosting one needs a signed-in, funded wallet and is rate-limited.
  const limited = limitByIp(request, "host", 12, 10 * 60_000);
  if (limited) return limited;
  const host = sessionWallet(request);
  if (onChain && !host) {
    return NextResponse.json({ error: "Sign in with your wallet to host an arena.", needsAuth: true }, { status: 401 });
  }
  if (onChain && overLimit("host-wallet", host!, 6, 10 * 60_000)) {
    return NextResponse.json({ error: "You've opened several arenas in the last few minutes — wait a little before hosting another." }, { status: 429 });
  }

  const fresh = await bootstrapRound(body.config as never, arena);
  if (!fresh) return NextResponse.json({ error: "no market available" }, { status: 503 });
  // The host is whoever is signed in — never a value from the request body.
  fresh.config.host = host ?? "";

  if (onChain) {
    const seat = fresh.config.entryUsdc + fresh.config.startingBankroll;
    const bal = await playerBalances(new PublicKey(host!));
    if (bal.usdc + 1e-9 < seat) {
      return NextResponse.json({ error: `This seat costs ${seat.toFixed(2)} USDC but your wallet holds ${bal.usdc.toFixed(2)} devnet USDC. Get test USDC at faucet.circle.com (Solana Devnet).` }, { status: 402 });
    }
    if (bal.sol < 0.005) {
      return NextResponse.json({ error: `You need about 0.005 devnet SOL for fees (you hold ${bal.sol.toFixed(4)}). Get some at faucet.solana.com.` }, { status: 402 });
    }
  }

  // If the on-chain escrow is deployed + configured AND this arena isn't the
  // walk-in PUBLIC lobby, mint the on-chain vault here so subsequent Deposit
  // calls have a real vault to land in. PUBLIC stays ledger-only — it's the
  // free bot practice arena.
  if (onChain) {
    const res = await initArenaOnChain({
      entryUsdc: fresh.config.entryUsdc,
      vaultUsdc: fresh.config.startingBankroll,
      capacity: fresh.config.capacity,
      enrollmentSec: fresh.config.enrollmentSec,
      liveSec: fresh.config.liveSec,
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
    return NextResponse.json({ error: "a rumble is already in progress in this arena", round: result.conflict ? redactOpeningCalls(result.conflict) : null }, { status: 409 });
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
