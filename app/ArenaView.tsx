"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookAvailableFor, closingWindowMs, proceedsForSell, sharesForSpend } from "@/lib/room-book";
import { availableFor, buyPriceOf, DEFAULT_OPENING_CALL_PCT, paidPlaces, payoutShares, scorePlace, seatCostUsdc, sellPriceOf, tradingOpen, TRADE_CUTOFF_MS, TRADE_SPREAD } from "@/lib/royale";
import { changeOf, LOCK_MAX, pickCount, ptsText, scoreCard, type Picks } from "@/lib/predictions";
import { claimFeeOf, netOfClaimFee, PLATFORM_CLAIM_FEE_BPS } from "@/lib/fees";
import { PicksBoard, PicksEditor, PicksRoster, judgedPrices, pctText, picksMade } from "@/app/Predictions";
import { StreakHistory, StreakLegCard, StreakRoster, phaseText } from "@/app/Streak";
import { canPick, currentLeg, MAX_LEGS, PICK_MS } from "@/lib/streak";
import { useEscapeKey } from "@/lib/use-escape";
import CallSizePicker, { callSizeText } from "@/app/CallSizePicker";
import { getRound, enrollWithEscrow, tradeRound, claimFromEscrow, serverSettleArena, setOpeningCall, setPicks, setStreakPick, prepareWallet, seatStepText, type OpeningCall, type RoundView, type SeatStep } from "@/lib/round-client";
import { useEscrowStatus, useWalletIdentity, useXNotices } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import type { Entrant, Round } from "@/lib/royale";
import { PUBLIC_ARENA, isPracticeArena } from "@/lib/royale";
import { avatarDataUrl } from "@/lib/avatars";
import { displayName } from "@/lib/username";
import ArenaStage from "@/app/ArenaStage";
import PitTerminal from "@/app/PitTerminal";
import CreatorKit from "@/app/CreatorKit";
import PantaTradeTape from "@/app/PantaTradeTape";
import PantaResolution from "@/app/PantaResolution";
import PantaGraduationBanner from "@/app/PantaGraduationBanner";
import PantaOrderStatus from "@/app/PantaOrderStatus";
import { executePantaOrder, type LifecycleUpdate } from "@/lib/panta-order";
import { looksLikePantaMarketId } from "@/lib/tracked-markets";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

/** USD spot price, e.g. $119.02 or $0.0123. */
function usdPx(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;
}

function fmtClock(ms: number) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  enrolling: "Enrolling",
  live: "Live",
  settling: "Settling",
  advancing: "Advancing",
  complete: "Complete",
  cancelled: "Cancelled"
};

export default function ArenaView({ arenaCode }: { arenaCode: string }) {
  const isPublic = isPracticeArena(arenaCode);
  const { wallet, username, signIn, xEnabled } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [view, setView] = useState<RoundView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [busy, setBusy] = useState(false);
  // Which wallet step a seat/host request is waiting on (null = idle).
  const [seatStep, setSeatStep] = useState<SeatStep | null>(null);
  const [toast, setToast] = useState("");
  useXNotices(setToast);
  const [showEnroll, setShowEnroll] = useState(false);
  // UP / DOWN / decide-later pick in the seat modal ("" = not chosen yet).
  const [callPick, setCallPick] = useState<"YES" | "NO" | "LATER" | "">("");
  const [callPct, setCallPct] = useState<number>(DEFAULT_OPENING_CALL_PCT);
  // Real Panta order lifecycle — opt-in, disabled when market is a
  // synthetic direction-board id or no wallet is connected. When on,
  // `doBuy` also drives quote → build → sign → submit → verify → report
  // through Panta's own APIs and streams progress here.
  const [pantaFillOn, setPantaFillOn] = useState(false);
  const [pantaOrder, setPantaOrder] = useState<LifecycleUpdate | null>(null);
  // Predictions: answers chosen in the seat modal, and edits to my saved
  // picks that are on their way to the server.
  const [seatPicks, setSeatPicks] = useState<Picks>({});
  const [pickEdits, setPickEdits] = useState<Picks>({});
  // Predictions lock: the seat modal's choice, and an edit to my saved lock on its way.
  const [seatLocks, setSeatLocks] = useState<string[]>([]);
  const [lockEdit, setLockEdit] = useState<string[] | null>(null);
  // Streak: my pick for the current leg while it's on its way to the server.
  const [streakDraft, setStreakDraft] = useState<{ n: number; pick: string } | null>(null);
  const pollRef = useRef<number | null>(null);

  // Live invite URL for THIS arena (visible in the HUD when non-public).
  const currentInviteUrl = useMemo(() => {
    if (typeof window === "undefined" || isPublic) return "";
    return `${window.location.origin}/a/${arenaCode}`;
  }, [arenaCode, isPublic]);

  // Enable arcade palette / background across the arena view.
  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);

  // Every arena runs on a market. If it's a real Panta base58 id, add it to
  // the tracked-markets store so PantaGraduationBanner can watch for the
  // primary→graduated flip. Synthetic dir-<asset>-<horizon> ids are ignored.
  useEffect(() => {
    const mid = view?.round?.config.marketId;
    if (!mid) return;
    (async () => {
      try {
        const [{ trackMarket, looksLikePantaMarketId }] = await Promise.all([
          import("@/lib/tracked-markets")
        ]);
        if (looksLikePantaMarketId(mid)) {
          trackMarket({ marketId: mid, question: view?.round?.config.marketQuestion, role: "player" });
        }
      } catch { /* ignore */ }
    })();
  }, [view?.round?.config.marketId, view?.round?.config.marketQuestion]);

  // ── round polling (drives the keeper) ─────────────────────────────
  const refresh = useCallback(async () => {
    try { setView(await getRound(arenaCode, wallet)); } catch { /* transient */ }
  }, [arenaCode, wallet]);

  useEffect(() => {
    refresh();
    pollRef.current = window.setInterval(refresh, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const round: Round | null = view?.round ?? null;
  const standings: Entrant[] = view?.standings ?? [];
  const yesPrice = view?.yesPrice ?? 50;
  const cut = view?.cutLine ?? 0;
  const asset = round?.config.asset ?? "";
  const spot = view?.spot ?? round?.oracle?.last?.[asset] ?? null;
  const openPrice = round?.oracle?.open?.[asset] ?? null;
  const closePrice = round?.oracle?.close?.[asset] ?? null;
  // A pit on a Panta market trades YES/NO on the room's own book; a crypto
  // pit trades UP/DOWN on the spot price.
  const pantaPit = round?.config.marketSource === "panta";
  const sideName = useCallback((s: "YES" | "NO") => (pantaPit ? s : s === "YES" ? "UP" : "DOWN"), [pantaPit]);
  const yesNow = Math.round(yesPrice);
  const pantaLine = view?.line ?? null;

  const me = useMemo(() => (wallet ? standings.find((e) => e.wallet === wallet) ?? null : null), [standings, wallet]);
  const enrolled = !!me;
  const picksMode = round?.config.format === "predictions";
  const streakMode = round?.config.format === "streak";
  // Formats with no vault: the seat is just the entry.
  const entryOnly = picksMode || streakMode;
  const leg = round?.streak ? currentLeg(round.streak) : null;
  const questions = useMemo(() => round?.predictions?.questions ?? [], [round?.predictions?.questions]);
  const myPicks: Picks = useMemo(() => ({ ...(me?.picks ?? {}), ...pickEdits }), [me?.picks, pickEdits]);
  const myLocks: string[] = lockEdit ?? me?.locks ?? [];
  const myPickCount = pickCount(questions, myPicks);
  const tradeOpen = !!round && tradingOpen(round, now);
  const aliveCount = standings.filter((e) => e.eliminatedRound === null).length;

  const deadline = round?.status === "enrolling" ? round.enrollDeadline : round?.status === "live" ? round.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;

  // ── wallet ────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    const r = await signIn();
    if (r.message) setToast(r.message);
  }, [signIn]);

  // ── actions (all arena-scoped) ────────────────────────────────────
  const doEnroll = useCallback(async () => {
    if (!wallet) { setShowEnroll(false); await connect(); return; }
    // The server names the seat after the X handle.
    const nick = username;
    const predictions = round?.config.format === "predictions";
    if (predictions && pickCount(round?.predictions?.questions, seatPicks) < (round?.predictions?.questions.length ?? 0)) {
      setToast("Answer all five questions to take your seat.");
      return;
    }
    const noCall = predictions || round?.config.format === "streak";
    if (!noCall && !callPick) { setToast(`Pick ${sideName("YES")}, ${sideName("NO")} or decide later.`); return; }
    const call: OpeningCall = noCall || callPick === "LATER" || !callPick ? null : callPick;

    setBusy(true);
    try {
      // enrollWithEscrow: if arena is on-chain, wallet signs a Deposit tx
      // (real USDC on devnet) before the ledger enrolls. Ledger-only arenas
      // fall through immediately. Signing UI is provided by the wallet.
      const seatUsd = round ? seatCostUsdc(round.config) : 0;
      const r = await enrollWithEscrow(wallet, nick, arenaCode, call, (step, name) => {
        setSeatStep(step);
        setToast(seatStepText(step, seatUsd, call, name, pantaPit).toast);
      }, callPct, predictions ? seatPicks : undefined, predictions ? seatLocks : undefined);
      const seated = !!(r.entrantId || r.already);
      if (seated) {
        const callText = predictions ? " · your picks stay hidden until the start" : round?.config.format === "streak" ? " · pick leg 1 below" : call ? ` · opening call ${sideName(call)}` : "";
        setToast(`You're in pit ${arenaCode}${nick ? ` as @${nick}` : ""}${callText}.`);
        setShowEnroll(false);
      } else if (r.deposited) {
        // Paid on chain but not confirmed as seated yet — the keeper seats
        // it from the on-chain entry, so never ask to pay again.
        setToast(r.error ?? "Deposit sent — your seat will appear in a moment.");
        setShowEnroll(false);
      } else {
        setToast(r.error ?? "Couldn't take a seat — try again.");
      }
      await refresh();
    } finally { setBusy(false); setSeatStep(null); }
  }, [wallet, connect, arenaCode, refresh, round, callPick, callPct, seatPicks, seatLocks, username, sideName, pantaPit]);

  /** Add or remove a question from a lock (2–3 picks). */
  const nextLocks = useCallback((current: string[], questionId: string): string[] | null => {
    if (current.includes(questionId)) return current.filter((q) => q !== questionId);
    if (current.length >= LOCK_MAX) { setToast(`A lock holds at most ${LOCK_MAX} picks — remove one first.`); return null; }
    return [...current, questionId];
  }, []);
  const toggleSeatLock = useCallback((questionId: string) => {
    setSeatLocks((cur) => nextLocks(cur, questionId) ?? cur);
  }, [nextLocks]);

  // Pick and lock saves go out one at a time, so the last click always wins.
  const pickQueue = useRef<Promise<void>>(Promise.resolve());

  // Change my saved lock while enrolling (queued behind pick saves).
  const doToggleLock = useCallback((questionId: string) => {
    if (!wallet) return;
    const next = nextLocks(myLocks, questionId);
    if (!next) return;
    setLockEdit(next);
    pickQueue.current = pickQueue.current.then(async () => {
      const r = await setPicks(wallet, arenaCode, undefined, next);
      if (r.error) setToast(r.error);
      await refresh();
      setLockEdit((cur) => (cur && cur.join() === next.join() ? null : cur));
    });
  }, [wallet, arenaCode, refresh, myLocks, nextLocks]);

  // Change one of my picks while enrolling. Shown at once; saved in the
  // background, one request at a time so the last click always wins.
  const doPick = useCallback((questionId: string, optionId: string) => {
    if (!wallet) return;
    setPickEdits((p) => ({ ...p, [questionId]: optionId }));
    pickQueue.current = pickQueue.current.then(async () => {
      const r = await setPicks(wallet, arenaCode, { [questionId]: optionId });
      if (r.error) setToast(r.error);
      await refresh();
      // Drop the local edit once the server copy has it (or refused it).
      setPickEdits((p) => {
        if (p[questionId] !== optionId) return p;
        const { [questionId]: _done, ...rest } = p;
        void _done;
        return rest;
      });
    });
  }, [wallet, arenaCode, refresh]);

  const doChangeCall = useCallback(async (call: OpeningCall, pct?: number) => {
    if (!wallet) return;
    setBusy(true);
    try {
      const r = await setOpeningCall(wallet, arenaCode, call, pct);
      if (r.error) setToast(r.error);
      else setToast(call
        ? `Opening call: ${sideName(call)} with ${r.pct === 100 ? "your whole vault" : `${r.pct ?? pct ?? 100}% of your vault`}.`
        : `You'll pick ${sideName("YES")} or ${sideName("NO")} once trading opens.`);
      await refresh();
    } finally { setBusy(false); }
  }, [wallet, arenaCode, refresh, sideName]);

  // Streak: pick this leg's answer (one request at a time; the last click wins).
  const streakQueue = useRef<Promise<void>>(Promise.resolve());
  const doStreakPick = useCallback((optionId: string) => {
    if (!wallet || !leg) return;
    const n = leg.n;
    setStreakDraft({ n, pick: optionId });
    streakQueue.current = streakQueue.current.then(async () => {
      const r = await setStreakPick(wallet, arenaCode, optionId);
      if (r.error) { setToast(r.error); setStreakDraft((d) => (d?.n === n && d.pick === optionId ? null : d)); }
      await refresh();
    });
  }, [wallet, arenaCode, refresh, leg]);

  // Streak: flag an open pick window in the tab title, so a player on another
  // tab notices before the window closes (no pick and they're out).
  const needsStreakPick = streakMode && round?.status === "live" && round.streak?.phase === "picking"
    && !!me && me.eliminatedRound === null && !!leg && !leg.picks[me.id] && streakDraft?.n !== leg.n
    && now < (round.streak?.phaseEndsAt ?? 0);
  useEffect(() => {
    if (!needsStreakPick) return;
    const original = document.title;
    document.title = `⏱ Pick now — leg ${leg?.n} · The Pit`;
    return () => { document.title = original; };
  }, [needsStreakPick, leg?.n]);

  // ── settlement, refunds + claim ───────────────────────────────────
  // Complete arena → record payouts on-chain. Cancelled arena → record a
  // full refund for every depositor. Any client can nudge; the server is
  // idempotent. A cancelled arena waits ~2 min (in-flight deposits) first,
  // so keep retrying while the server reports `pending`.
  const roundId = round?.id;
  const roundStatus = round?.status;
  const hasVault = !!round?.escrow;
  const vaultSettled = !!round?.escrow?.settleSignatures?.length;
  const [escrowNudge, setEscrowNudge] = useState(0);
  // The chain is the authority: if its vault is settled, stop waiting even
  // when the game record hasn't caught up yet.
  const [chainSettled, setChainSettled] = useState(false);
  useEffect(() => {
    if (!hasVault || vaultSettled || chainSettled) return;
    if (roundStatus !== "complete" && roundStatus !== "cancelled") return;
    let timer: number | undefined;
    let stopped = false;
    let failures = 0;
    const run = async () => {
      const res = await serverSettleArena(arenaCode);
      if (stopped) return;
      if (res.pending) {
        timer = window.setTimeout(run, Math.min(30_000, Math.max(3_000, res.retryInMs ?? 5_000)));
        return;
      }
      if (res.error) {
        // Devnet RPC hiccups and expired blockhashes are common and the
        // settle call is idempotent: keep trying with a growing delay, and
        // only tell the player if it keeps failing.
        failures += 1;
        if (failures === 3) setToast(`${roundStatus === "cancelled" ? "Refund" : "Settlement"} is taking longer than usual (${res.error}). Still retrying — your funds are safe in escrow.`);
        if (failures < 12) timer = window.setTimeout(run, Math.min(60_000, 5_000 * failures));
      }
      await refresh();
      setEscrowNudge((n) => n + 1);
    };
    run();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [roundId, roundStatus, hasVault, vaultSettled, chainSettled, arenaCode, refresh]);

  // This wallet's on-chain position in the arena — drives the refund card,
  // including deposits that landed after the round closed.
  type MyEscrow = { deposited: boolean; seatUsdc?: number; settled?: boolean; claimed?: boolean; entitlementUsdc?: number; claimsOpen?: boolean; recoverAt?: number | null; claimFeeBps?: number };
  const [myEscrow, setMyEscrow] = useState<MyEscrow | null>(null);
  const loadMyEscrow = useCallback(async () => {
    if (!wallet || !hasVault) { setMyEscrow(null); return; }
    try {
      const r = await fetch(`/api/escrow/entry?arena=${encodeURIComponent(arenaCode)}&wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" }).then((x) => x.json());
      setMyEscrow(r);
      if (r?.claimsOpen) setChainSettled(true);
    } catch { /* transient */ }
  }, [wallet, hasVault, arenaCode]);
  useEffect(() => {
    if (roundStatus !== "cancelled" && roundStatus !== "complete") return;
    loadMyEscrow();
  }, [roundStatus, loadMyEscrow, escrowNudge, vaultSettled]);

  const doClaim = useCallback(async (recover = false) => {
    if (!wallet) return setToast("Sign in with X first.");
    setBusy(true);
    try {
      const r = await claimFromEscrow(wallet, arenaCode, recover, (name) => setToast(seatStepText("waiting", 0, null, name).toast), undefined,
        () => setToast("That took over a minute, so Solana needs a fresh signature — approve the withdrawal once more in your X wallet."));
      if (r.error) setToast(`Claim: ${r.error}`);
      else if (r.signature) setToast(`${recover ? "Recovered" : "Claimed"} · ${r.signature.slice(0, 8)}…`);
      else setToast("Withdrawal submitted.");
      await loadMyEscrow();
    } finally { setBusy(false); }
  }, [wallet, arenaCode, loadMyEscrow]);

  const marketId = round?.config.marketId;
  const pantaFillAvailable = !!wallet && !!marketId && looksLikePantaMarketId(marketId);

  const doBuy = useCallback(async () => {
    if (!wallet) return setToast("Sign in with X first.");
    if (!enrolled) return setToast("Enroll in the round first.");
    const v = Number(amount);
    if (!v || v <= 0) return setToast("Enter an amount.");
    const avail = me ? (round?.book ? bookAvailableFor(round.book, me, side) : availableFor(me, side, yesPrice, TRADE_SPREAD)) : 0;
    if (me && v > avail + 1e-9) return setToast(`You have ${usd2.format(avail)} available for ${sideName(side)}.`);
    setBusy(true);
    try {
      // Kick the Panta order lifecycle in parallel when opted in and the
      // market is a real Panta id. This walks the full quote → build →
      // sign → submit → verify → report chain against the same size the
      // player bought at inside the round. Attribution becomes live-honest.
      let pantaLifecycle: Promise<unknown> | null = null;
      if (pantaFillOn && pantaFillAvailable && marketId) {
        setPantaOrder({ step: "quoting", note: "Starting…" });
        pantaLifecycle = executePantaOrder({
          marketId, side, usdcAmount: v, wallet,
          onUpdate: (u) => setPantaOrder(u)
        }).catch((err) => {
          setPantaOrder({ step: "error", error: err instanceof Error ? err.message : String(err) });
        });
      }
      const r = await tradeRound({ wallet, action: "buy", side, usdc: v, arena: arenaCode, quotedYes: yesPrice });
      if (r.error) {
        setToast(r.error);
        if (r.repriced || r.retry || r.closed) await refresh();
      } else {
        setToast(`${r.fill ?? `Bought ${sideName(side)}.`} Stake ${usd2.format(v)}.`);
        setAmount("");
        await refresh();
      }
      // Don't block the UI on the Panta lifecycle — it streams via
      // setPantaOrder. We do await it so `busy` clears only after both
      // paths settle when the toggle was on.
      if (pantaLifecycle) await pantaLifecycle;
    } finally { setBusy(false); }
  }, [wallet, enrolled, amount, side, arenaCode, refresh, pantaFillOn, pantaFillAvailable, marketId, me, yesPrice, round?.book, sideName]);

  const doSell = useCallback(async () => {
    if (!wallet || !enrolled) return;
    setBusy(true);
    try {
      const r = await tradeRound({ wallet, action: "sell", arena: arenaCode, quotedYes: yesPrice });
      if (r.error) {
        setToast(r.error);
        if (r.repriced || r.retry || r.closed) await refresh();
      } else { setToast(`${r.fill ?? "Sold."} Your position is back in cash.`); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, arenaCode, refresh, yesPrice]);

  /** Hosting lives on the lobby's Host panel; preselect what makes sense from here. */
  const hostHref = useCallback((format?: "single" | "royale" | "predictions" | "streak") => {
    const q = new URLSearchParams({ tab: "host" });
    if (format) q.set("format", format);
    // From a Panta pit, offer the same market.
    if (round && round.config.marketSource === "panta" && round.config.marketId) {
      q.set("source", "panta");
      q.set("market", round.config.marketId);
    }
    return `/?${q.toString()}`;
  }, [round]);

  const doCopyInvite = useCallback(async (url?: string) => {
    const link = url ?? currentInviteUrl;
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setToast("Invite link copied."); }
    catch { setToast("Copy failed — long-press the link to select and copy."); }
  }, [currentInviteUrl]);

  const goToArena = useCallback((code: string) => {
    window.location.href = `/a/${code}`;
  }, []);

  const closeEnroll = useCallback(() => setShowEnroll(false), []);
  // Escape closes a dialog — but never while a wallet request is in flight.
  useEscapeKey(showEnroll && !busy, closeEnroll);


  const myPnl = me ? me.bankroll - (round?.config.startingBankroll ?? 0) : 0;

  return (
    <main className="game-main arena-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="arenas"
        escrow={escrow}
        onToast={setToast}
        extra={!isPublic ? (
          <button className="arena-chip private" onClick={() => doCopyInvite()} title="Copy invite link">
            {arenaCode}
            <span className="copy-hint" aria-hidden="true">⧉</span>
            <span className="sr-only">Copy invite link</span>
          </button>
        ) : undefined}
      />

      {/* ── ROUND BAR ───────────────────────────────────────── */}
      <div className="roundbar" id="top">
        {round ? (
          <>
            {!entryOnly && (
              <div className="rb-cell">
                <span className="rb-k">Round</span>
                <span className="rb-v">{round.roundNumber} <em>/ {round.config.roundLimit}</em></span>
              </div>
            )}
            <div className="rb-cell">
              <span className="rb-k">Status</span>
              <span className={`rb-v status ${round.status}`}>{STATUS_LABEL[round.status]}</span>
            </div>
            {deadline > 0 && (
              <div className="rb-cell">
                <span className="rb-k">{round.status === "enrolling" ? "Locks in" : streakMode ? (round.streak?.phase === "picking" ? "Picks lock" : "Leg ends") : "Settles in"}</span>
                <span className="rb-v mono">
                  {round.status === "enrolling" && standings.every((e) => e.isBot) ? "Waiting" : fmtClock(timeLeft)}
                </span>
              </div>
            )}
            <div className="rb-cell">
              <span className="rb-k">Prize pool</span>
              <span className="rb-v accent">{usd.format(round.prizePoolUsdc)}</span>
            </div>
            {streakMode && round.status !== "enrolling" ? (
              <div className="rb-cell">
                <span className="rb-k">Still in</span>
                <span className="rb-v">{aliveCount} <em>/ {standings.length}</em></span>
              </div>
            ) : entryOnly ? (
              <div className="rb-cell">
                <span className="rb-k">Players</span>
                <span className="rb-v">{standings.length} <em>/ {round.config.capacity}</em></span>
              </div>
            ) : (
              <div className="rb-cell">
                <span className="rb-k">Alive</span>
                <span className="rb-v">{aliveCount} <em>/ {standings.length}</em></span>
              </div>
            )}
            {round.status === "live" && round.config.format !== "royale" ? (
              <div className="rb-cell">
                <span className="rb-k">Paid</span>
                <span className="rb-v">{paidPlaces(round) === 1 ? "Winner" : `Top ${paidPlaces(round)}`}</span>
              </div>
            ) : round.status === "live" && aliveCount > cut ? (
              <div className="rb-cell">
                <span className="rb-k">Survive</span>
                <span className="rb-v danger">Top {cut}</span>
              </div>
            ) : null}
            <div className="rb-cell grow">
              <span className="rb-k">{entryOnly ? "Game" : `Market · ${round.config.asset}`}</span>
              <span className="rb-v market">
                {picksMode ? `Five picks on BTC, ETH and SOL · ${Math.round(round.config.liveSec / 60)} min`
                  : streakMode ? `Streak · ${leg && round.status !== "enrolling" ? `leg ${leg.n} of up to ${round.streak!.maxLegs}` : `up to ${MAX_LEGS} legs`} · ${Math.round(round.config.liveSec / 60)}-min legs`
                  : round.config.marketQuestion}
              </span>
            </div>
            {picksMode && round.oracle?.open && (["BTC", "ETH", "SOL"] as const).map((a) => {
              const c = changeOf(round.oracle?.open?.[a], judgedPrices(round)[a]);
              return (
                <div className="rb-cell" key={a}>
                  <span className="rb-k">{a} {round.oracle?.close ? "close" : "vs open"}</span>
                  <span className={`rb-v mono rb-move ${c === null ? "" : c > 0 ? "up" : c < 0 ? "down" : ""}`}>{c === null ? "—" : `${c > 0 ? "▲" : c < 0 ? "▼" : "•"}${pctText(c).slice(1)}`}</span>
                </div>
              );
            })}
            {!entryOnly && (spot || closePrice) && (
              <div className="rb-cell">
                <span className="rb-k">{asset} {closePrice ? "close" : "price"}</span>
                <span className="rb-v mono">
                  {usdPx(closePrice ?? spot!)}
                  {openPrice && (
                    <em className={`rb-move ${(closePrice ?? spot!) >= openPrice ? "up" : "down"}`}>
                      {" "}{(closePrice ?? spot!) >= openPrice ? "▲" : "▼"}{Math.abs(((closePrice ?? spot!) - openPrice) / openPrice * 100).toFixed(2)}%
                    </em>
                  )}
                </span>
              </div>
            )}
            {!entryOnly && (
              <div className="rb-cell">
                <span className="rb-k">{pantaPit ? "Room YES / NO" : "UP / DOWN"}</span>
                <span className="rb-v"><span className="yes">{yesNow}¢</span> <em>/</em> <span className="no">{100 - yesNow}¢</span></span>
              </div>
            )}
            {pantaPit && pantaLine !== null && (
              <div className="rb-cell">
                <span className="rb-k">Panta line</span>
                <span className="rb-v mono">{Math.round(pantaLine)}¢ <em className={`rb-move ${yesNow > pantaLine ? "up" : yesNow < pantaLine ? "down" : ""}`}>room {yesNow - Math.round(pantaLine) >= 0 ? "+" : "−"}{Math.abs(yesNow - Math.round(pantaLine))}¢</em></span>
              </div>
            )}
            {round.escrow && (
              <div className="rb-cell">
                <span className="rb-k">Escrow vault</span>
                <a
                  className="rb-v mono vault-link"
                  href={`https://explorer.solana.com/address/${round.escrow.roundVault}${CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`}`}
                  target="_blank" rel="noopener noreferrer"
                  title={`View the on-chain vault ${round.escrow.roundVault} on Solana Explorer`}
                >
                  {round.escrow.roundVault.slice(0, 4)}…{round.escrow.roundVault.slice(-4)} ↗
                </a>
              </div>
            )}
          </>
        ) : (
          <div className="rb-cell grow">
            <span className="rb-v market">
              {!view ? `Loading pit ${arenaCode}…` : isPublic ? "Opening the pit…" : `Pit ${arenaCode} has no active round. `}
              {view && !isPublic && <a className="link" href="/">Browse open pits →</a>}
            </span>
          </div>
        )}
      </div>

      {/* Predictions: a seated player still missing picks is told before the stage. */}
      {picksMode && round?.status === "enrolling" && enrolled && myPickCount < questions.length && !(picksMade(me) > 0 && myPickCount === 0) && (
        <div className="pk-nudge" role="status">
          <span>
            <b>{myPickCount === 0 ? "Make your picks" : `${questions.length - myPickCount} pick${questions.length - myPickCount === 1 ? "" : "s"} left`}</b>
            {" "}— {myPickCount} of {questions.length} done. They lock in <span className="mono">{fmtClock(timeLeft)}</span>.
          </span>
          <a className="btn primary sm" href="#picks">Pick now ↓</a>
        </div>
      )}

      {/* Streak: a player still in with no pick for the open leg. */}
      {streakMode && round?.status === "live" && round.streak?.phase === "picking" && me && me.eliminatedRound === null
        && leg && !(streakDraft?.n === leg.n) && !leg.picks[me.id] && canPick(round, me, now) && (
        <div className="pk-nudge urgent" role="status">
          <span><b>Leg {leg.n} is open — pick now.</b> {leg.question.text} Picks lock in <span className="mono">{fmtClock(Math.max(0, round.streak.phaseEndsAt - now))}</span>; no pick and you&apos;re out.</span>
          <a className="btn primary sm" href="#streak">Pick ↓</a>
        </div>
      )}

      {/* ── ARENA STAGE (every round state) ─────────────────── */}
      {round && (
        <ArenaStage round={round} standings={standings} survivors={cut} yesPrice={yesPrice} spot={spot} line={pantaLine} wallet={wallet} />
      )}

      {/* ── TERMINAL: price tape, room positioning, Oracle read ── */}
      {round && !entryOnly && (
        <PitTerminal arenaCode={arenaCode} round={round} standings={standings} yesPrice={yesPrice} line={pantaLine} now={now} />
      )}

      {/* ── CREATOR KIT: the host's stream tools while the pit is open ── */}
      {round && !isPublic && !!wallet && round.config.host === wallet && (round.status === "enrolling" || round.status === "live") && (
        <CreatorKit code={arenaCode} onToast={setToast} />
      )}

      {/* ── ARENA ───────────────────────────────────────────── */}
      <section className="arena-shell" id="arena">
        {round?.status === "complete" ? (
          <div className="champion">
            {(() => {
              const champ = standings.find((e) => e.id === round.championId) ?? standings[0] ?? null;
              const paid = [...standings].filter((e) => e.prizeUsdc > 0).sort((a, b) => b.prizeUsdc - a.prizeUsdc);
              // Projected payout under the escrow's rule (same function the
              // server settles with); the on-chain figure replaces it once recorded.
              const humansNow = standings.filter((e) => !e.isBot);
              const hostFee = round.hostFeeUsdc ?? 0;
              const projected = payoutShares(
                humansNow.map((e) => ({ key: e.wallet, cash: e.cash, prize: e.prizeUsdc + (e.wallet === round.config.host ? hostFee : 0) })),
                humansNow.length * (round.config.entryUsdc + round.config.startingBankroll)
              );
              const myEntitlement = me ? projected[me.wallet] ?? 0 : 0;
              const hostEntrant = hostFee > 0 ? standings.find((e) => e.wallet === round.config.host) : undefined;
              // What actually reaches the wallet after the platform's claim fee.
              const claimBps = myEscrow?.claimFeeBps ?? 0;
              const gross = myEscrow?.entitlementUsdc ?? myEntitlement;
              const escrowSettled = !!round.escrow?.settleSignatures?.length || chainSettled || !!myEscrow?.claimsOpen;
              const canClaim = !!wallet && !!round.escrow && escrowSettled && (myEscrow?.entitlementUsdc ?? myEntitlement) > 0.0001 && !myEscrow?.claimed;
              const explorerBase = `https://explorer.solana.com/tx`;
              const explorerCluster = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
              return (
                <>
                  <p className="eyebrow">{picksMode ? "Predictions" : streakMode ? "Streak" : round.config.format === "single" ? "Single round" : `Round ${round.roundNumber}`} · final</p>
                  <h1>{picksMode ? predictionsHeadline(standings) : streakMode ? streakHeadline(standings) : champ ? `${displayName(champ)} wins ${usd2.format(champ.prizeUsdc)}` : "Pit closed"}</h1>
                  {streakMode && (
                    <div className="pk-results">
                      <StreakHistory round={round} me={me} />
                      {me && (
                        <p className="pk-results-me">
                          {me.eliminatedRound === null ? <>You lasted to the end — <b>{me.score ?? 0} leg{(me.score ?? 0) === 1 ? "" : "s"}</b></> : <>You were knocked out on <b>leg {me.eliminatedRound}</b></>}
                          {standings.filter((e) => !e.isBot).length === 1 ? <>. No one else paid in, so your entry comes back.</>
                            : me.prizeUsdc > 0 ? <> and won <b>{usd2.format(me.prizeUsdc)}</b>.</> : <>.</>}
                        </p>
                      )}
                    </div>
                  )}
                  {picksMode && (
                    <div className="pk-results">
                      <PicksBoard round={round} me={me} entrants={standings} />
                      {me && (
                        <p className="pk-results-me">
                          {(() => {
                            const card = scoreCard(me.picks, me.locks, round.predictions?.answers);
                            return <>You scored <b>{ptsText(card.total)}</b> — {card.right} of {questions.length} right{card.lock === "landed" ? `, lock +${card.lockDelta}` : card.lock === "missed" ? (card.lockDelta < 0 ? `, lock missed (−${Math.abs(card.lockDelta)})` : ", lock missed") : ""}</>;
                          })()}
                          {standings.filter((e) => !e.isBot).length === 1 ? <>. No one else paid in, so your entry comes back.</>
                            : me.prizeUsdc > 0 ? <> and won <b>{usd2.format(me.prizeUsdc)}</b>.</> : <>.</>}
                        </p>
                      )}
                    </div>
                  )}
                  {pantaPit && round.book?.close !== undefined && (
                    <p className={`resolution ${round.book.close > 50 ? "up" : round.book.close < 50 ? "down" : ""}`}>
                      {round.book.settledBy === "outcome"
                        ? <>Panta resolved the market <b>{round.book.close >= 50 ? "YES" : "NO"}</b> — YES shares paid <b>{Math.round(round.book.close)}¢</b>.</>
                        : <>Settled at <b>{round.book.close}¢ YES</b> — the room&apos;s average price over the closing {Math.round(closingWindowMs(round.config.liveSec) / 1000) >= 60 ? `${Math.round(closingWindowMs(round.config.liveSec) / 60000)} min` : `${Math.round(closingWindowMs(round.config.liveSec) / 1000)}s`}. Panta hadn&apos;t ruled by the bell.</>}
                    </p>
                  )}
                  {!picksMode && openPrice && closePrice && (
                    <p className={`resolution ${closePrice > openPrice ? "up" : closePrice < openPrice ? "down" : ""}`}>
                      {asset} closed at <b>{usdPx(closePrice)}</b> vs <b>{usdPx(openPrice)}</b> open —{" "}
                      <b>{closePrice > openPrice ? "UP wins" : closePrice < openPrice ? "DOWN wins" : "flat, both sides paid 50¢"}</b>
                    </p>
                  )}
                  <p className="lead">
                    {paid.length > 1
                      ? `${usd.format(round.prizePoolUsdc)} pool split across the top ${paid.length}.`
                      : `${usd.format(round.prizePoolUsdc)} pool to the winner.`}
                    {hostEntrant ? <>{" "}{displayName(hostEntrant)} took a {usd2.format(hostFee)} host fee ({round.config.hostFeePct}% of the pool).</> : null}
                    {entryOnly ? <>{" "}Players who tie split the places they share.</>
                      : round.escrow ? <>{" "}Players also share the vault money by how their vaults finished — one player&apos;s trading losses fund another&apos;s gains.</> : null}
                  </p>

                  {/* Withdrawal — amounts come from the on-chain entry once settled. */}
                  {round.escrow && me && !me.isBot && (
                    <div className="claim-box">
                      {!escrowSettled ? (
                        <p>
                          <b>Your payout: {usd2.format(myEntitlement)}</b> — recording the results on-chain. This is
                          automatic; the Withdraw button appears here in a few seconds.
                        </p>
                      ) : myEscrow?.claimed ? (
                        <p className="claimed"><b>Withdrawn ✓</b> {usd2.format(myEscrow.entitlementUsdc ?? myEntitlement)} is back in your X wallet.</p>
                      ) : (myEscrow?.entitlementUsdc ?? myEntitlement) > 0.0001 ? (
                        <>
                          <p>
                            <b>Your withdrawal:</b> {usd2.format(gross)}
                            {me.wallet === round.config.host && hostFee > 0 ? ` — includes your ${usd2.format(hostFee)} host fee` : entryOnly ? " — your prize" : me.prizeUsdc > 0 ? ` — includes your ${usd2.format(me.prizeUsdc)} prize` : " — your share of the vault money"}
                            {claimBps > 0 && <span className="fee-note"> · {(claimBps / 100).toFixed(1)}% platform fee ({usd2.format(claimFeeOf(gross, claimBps))}) — you receive {usd2.format(netOfClaimFee(gross, claimBps))}</span>}
                          </p>
                          <button
                            className="btn primary full"
                            onClick={() => doClaim(false)}
                            disabled={busy || !canClaim}
                            title={!wallet ? "Sign in with the X account you played with" : ""}
                          >
                            {busy ? "Approve in your X wallet…" : `Withdraw ${usd2.format(netOfClaimFee(gross, claimBps))} to my X wallet`}
                          </button>
                          <div className="claim-links">
                            {(round.escrow.settleSignatures ?? []).filter((s) => s.length > 60).slice(-2).map((s) => (
                              <a key={s} className="link" target="_blank" rel="noopener noreferrer" href={`${explorerBase}/${s}${explorerCluster}`}>
                                settle {s.slice(0, 6)}… ↗
                              </a>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p>{entryOnly ? "No prize this time — nothing to withdraw." : "Your vault finished at $0 — nothing to withdraw this time."}</p>
                      )}
                    </div>
                  )}
                  {/* Paid but never seated (deposit landed after the lock): full refund. */}
                  {round.escrow && !me && myEscrow?.deposited && (
                    <RefundCard
                      wallet={wallet}
                      state={myEscrow}
                      refundReady={escrowSettled}
                      busy={busy}
                      onConnect={connect}
                      onClaim={() => doClaim(false)}
                      onRecover={() => doClaim(true)}
                    />
                  )}
                  {round.escrow && !me && !myEscrow?.deposited && escrowSettled && (
                    <p className="disclaimer">Settlement complete on-chain — players withdraw from the wallet they played with.</p>
                  )}

                  {!round.escrow && <p className="disclaimer">Practice round — no USDC moved.</p>}
                  <a className="btn primary" href={hostHref(entryOnly ? (streakMode ? "streak" : "predictions") : undefined)}>Host the next pit →</a>
                  <div className="final-board">
                    <div className="fb-row fb-head" aria-hidden="true">
                      <span className="fb-rank">#</span>
                      <span className="fb-name">Player</span>
                      <span className="fb-bank">{picksMode ? "Points" : streakMode ? "Lasted" : "Final vault"}</span>
                      <span className="fb-prize">{round.escrow ? "Payout" : "Prize"}</span>
                    </div>
                    {standings.map((e, i) => (
                      <div key={e.id} className={`fb-row ${e.wallet === wallet ? "me" : ""}`}>
                        <span className="fb-rank">{entryOnly ? scorePlace(round, e) : i + 1}</span>
                        <span className="fb-name">{displayName(e)}{e.isBot ? " ·bot" : ""}</span>
                        <span className="fb-bank">{picksMode ? ptsText(e.score) : streakMode ? `${e.score ?? 0} leg${(e.score ?? 0) === 1 ? "" : "s"}` : usd2.format(e.bankroll)}</span>
                        <span className="fb-prize">
                          {e.isBot ? "" : round.escrow ? usd2.format(projected[e.wallet] ?? 0) : e.prizeUsdc > 0 ? `+${usd2.format(e.prizeUsdc)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        ) : round?.status === "cancelled" ? (
          <div className="champion closed">
            <p className="eyebrow">Arena {arenaCode} · closed</p>
            <h1>This pit didn&apos;t start</h1>
            <p className="lead">{cancelReason(round.history)}</p>
            {round.escrow && (
              <RefundCard
                wallet={wallet}
                state={myEscrow}
                refundReady={vaultSettled || chainSettled || !!myEscrow?.claimsOpen}
                busy={busy}
                onConnect={connect}
                onClaim={() => doClaim(false)}
                onRecover={() => doClaim(true)}
              />
            )}
            <div className="cta-row" style={{ marginTop: 18 }}>
              <a className="btn primary" href="/?tab=host">Host a new pit</a>
              <a className="btn secondary" href="/">Browse pits</a>
            </div>
          </div>
        ) : !round ? (
          <div className="enroll-cta" style={{ margin: "20px 0" }}>
            {!view ? (
              <p role="status">Loading the pit…</p>
            ) : isPublic ? (
              <p>Opening the walk-in pit…</p>
            ) : (
              <>
                <p>This pit has no live game right now. Host a new pit (you get a fresh code to share), or head back to the public pit.</p>
                <div className="cta-row">
                  <a className="btn primary" href={hostHref()}>Host a pit</a>
                  <button className="btn secondary" onClick={() => goToArena(PUBLIC_ARENA)}>Public pit →</button>
                </div>
              </>
            )}
          </div>
        ) : streakMode && round.streak ? (
          <div className="cockpit">
            <div className="trade-col pk-col" id="streak">
              <div className="tc-head">
                <div>
                  <span className="cat">Streak · {Math.round(round.config.liveSec / 60)}-min legs</span>
                  <h2>
                    {round.status === "enrolling" ? "Last caller standing. One wrong pick and you're out."
                      : round.status === "live" && leg ? `Leg ${leg.n}: ${leg.question.text}`
                      : "Working out the results…"}
                  </h2>
                </div>
                {deadline > 0 && (
                  <div className="pk-clock">
                    <b className="mono">{round.status === "enrolling" && standings.every((e) => e.isBot) ? "—" : fmtClock(timeLeft)}</b>
                    <span>{round.status === "enrolling" ? "until it starts" : round.streak.phase === "picking" ? "to pick" : "left in the leg"}</span>
                  </div>
                )}
              </div>

              {round.status === "enrolling" && !enrolled ? (
                <div className="enroll-cta">
                  <p>
                    A chain of quick calls on BTC, ETH and SOL. Each leg you get {PICK_MS / 1000} seconds to pick, then it runs
                    for {Math.round(round.config.liveSec / 60)} minute{round.config.liveSec === 60 ? "" : "s"} on live prices. Right, and you&apos;re through; wrong — or no pick — and you&apos;re out.
                    The last player standing takes the pool. Your seat is <b>{usd2.format(round.config.entryUsdc)}</b>{round.escrow ? "" : " (free here — practice)"}.
                  </p>
                  <ul className="sk-rules">
                    <li>Picks are hidden until each leg starts — going against the crowd is how you end up alone.</li>
                    <li>If everyone still in misses a leg, or it ends dead level, nobody goes out.</li>
                    <li>Up to {MAX_LEGS} legs; players still in after that split the pool.</li>
                  </ul>
                  <div className="cta-row">
                    <button className="btn primary" onClick={() => { if (!wallet) { connect(); return; } setShowEnroll(true); }} disabled={busy}>
                      {wallet ? "Take a seat" : "Sign in with X to play"}
                    </button>
                    <a className="btn secondary" href={hostHref("streak")}>Host your own</a>
                    {!isPublic && <button className="btn secondary" onClick={() => doCopyInvite()}>Copy invite link</button>}
                  </div>
                </div>
              ) : (
                <>
                  {round.status === "enrolling" && (
                    <p className="last-call">
                      <b>You&apos;re in.</b> Leg 1 is below — pick now or in the {PICK_MS / 1000}-second window once the game starts.
                    </p>
                  )}
                  {round.status === "live" && (
                    <p className="last-call">{phaseText(round, now)} · {aliveCount} of {standings.length} still in</p>
                  )}
                  <StreakLegCard
                    round={round}
                    me={me}
                    now={now}
                    busy={busy}
                    myDraft={leg && streakDraft?.n === leg.n ? streakDraft.pick : undefined}
                    onPick={doStreakPick}
                  />
                  <StreakHistory round={round} me={me} />
                  {round.status === "enrolling" && !isPublic && currentInviteUrl && (
                    <div className="invite-inline">
                      <span className="call-k">Invite players · {standings.filter((e) => !e.isBot).length}/{round.config.capacity} seats taken</span>
                      <div className="invite-inline-row">
                        <input readOnly value={currentInviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                        <button className="btn secondary sm" onClick={() => doCopyInvite()}>Copy link</button>
                      </div>
                      <p className="call-note">Elimination needs a crowd — the more players, the better the game. If nobody else joins you play a bot, and your entry comes back.</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <StreakRoster round={round} standings={standings} wallet={wallet} />
          </div>
        ) : picksMode ? (
          <div className="cockpit">
            <div className="trade-col pk-col" id="picks">
              <div className="tc-head">
                <div>
                  <span className="cat">Predictions · {Math.round(round.config.liveSec / 60)} min</span>
                  <h2>
                    {round.status === "enrolling" ? "Five picks on BTC, ETH and SOL. Most points wins."
                      : round.status === "live" ? "Picks are locked — now the coins decide."
                      : "Working out the results…"}
                  </h2>
                </div>
                {deadline > 0 && (
                  <div className="pk-clock">
                    <b className="mono">{round.status === "enrolling" && standings.every((e) => e.isBot) ? "—" : fmtClock(timeLeft)}</b>
                    <span>{round.status === "enrolling" ? "until picks lock" : "until the close"}</span>
                  </div>
                )}
              </div>

              {round.status === "enrolling" && !enrolled ? (
                <div className="enroll-cta">
                  <p>
                    Answer five questions about the next <b>{Math.round(round.config.liveSec / 60)} minutes</b>: is each coin up or down, which does best, and one head-to-head.
                    Nothing to trade — your seat is <b>{usd2.format(round.config.entryUsdc)}</b> into the prize pool{round.escrow ? "" : " (free here — practice)"}.
                    Picks stay hidden until the round starts, and the most points take the pool. Lock 2 or 3 picks together for bonus points — if they all land.
                  </p>
                  <ol className="pk-preview" aria-label="This round's questions">
                    {questions.map((q) => <li key={q.id}>{q.text}</li>)}
                  </ol>
                  <div className="cta-row">
                    <button className="btn primary" onClick={() => { if (!wallet) { connect(); return; } setSeatPicks({}); setSeatLocks([]); setShowEnroll(true); }} disabled={busy}>
                      {wallet ? "Make your picks" : "Sign in with X to play"}
                    </button>
                    <a className="btn secondary" href={hostHref("predictions")}>Host your own</a>
                    {!isPublic && <button className="btn secondary" onClick={() => doCopyInvite()}>Copy invite link</button>}
                  </div>
                </div>
              ) : round.status === "enrolling" ? (
                <div className="enroll-cta my-call">
                  {picksMade(me) > 0 && myPickCount === 0 ? (
                    <p>
                      <b>You&apos;re in.</b> Your picks are saved but hidden on this device until you sign in.{" "}
                      <button type="button" className="link-btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await prepareWallet(wallet!); if (!r.ok) setToast(r.error); await refresh(); } finally { setBusy(false); } }}>
                        Sign in to see them
                      </button>
                    </p>
                  ) : (
                    <p>
                      <b>You&apos;re in.</b>{" "}
                      {myPickCount < questions.length
                        ? <><b className="down">{myPickCount} of {questions.length} picked</b> — an empty pick scores nothing. </>
                        : <>All {questions.length} picks made. </>}
                      Change any of them until the round locks{deadline > 0 ? <> in <b className="mono">{fmtClock(timeLeft)}</b></> : null}; each click saves.
                    </p>
                  )}
                  <PicksEditor questions={questions} picks={myPicks} onPick={doPick} locks={myLocks} onToggleLock={doToggleLock} />
                  {!isPublic && currentInviteUrl && (
                    <div className="invite-inline">
                      <span className="call-k">Invite players · {standings.filter((e) => !e.isBot).length}/{round.config.capacity} seats taken</span>
                      <div className="invite-inline-row">
                        <input readOnly value={currentInviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                        <button className="btn secondary sm" onClick={() => doCopyInvite()}>Copy link</button>
                      </div>
                      <p className="call-note">If nobody else joins, you play a practice bot — with no one to win from, your entry simply comes back to you.</p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <p className="last-call">
                    {round.oracle?.open
                      ? <>Every coin is judged against its price when picks locked. </>
                      : <>Waiting for the opening prices… </>}
                    {me ? <>Right now you have <b>{ptsText(me.score)}</b>{scorePlace(round, me, true) <= paidPlaces(round) ? " — in the money" : ""}.</> : <>You&apos;re watching — enrollment has closed.</>}
                  </p>
                  <PicksBoard round={round} me={me} entrants={standings} />
                  <p className="pk-key">
                    <span className="pk-chip win">Winning</span> answer right now · number = players who picked it · ✓ / ✗ = your pick so far · = = level, nobody scores
                  </p>
                </>
              )}
            </div>
            <PicksRoster round={round} standings={standings} wallet={wallet} />
          </div>
        ) : (
          <>
          <div className="cockpit">
            {/* trading */}
            <div className="trade-col">
              <div className="tc-head">
                <div>
                  <span className="cat">{round?.config.category ?? "—"}</span>
                  <h2>{round?.config.marketQuestion ?? "Loading market…"}</h2>
                </div>
                <div className="tc-price">
                  <div><b className="up">{yesNow}¢</b><span>▲ {sideName("YES")}</span></div>
                  <div><b className="down">{100 - yesNow}¢</b><span>▼ {sideName("NO")}</span></div>
                </div>
              </div>

              {!enrolled ? (
                <div className="enroll-cta">
                  {round?.status === "enrolling" ? (
                    <>
                      <p>
                        {pantaPit
                          ? <>Call it: <b className="up">YES</b> if you think it happens, <b className="down">NO</b> if not. The room trades its own odds — every trade moves the price for everyone.</>
                          : <>Call where <b>{asset}</b> goes: <b className="up">UP</b> if you think it finishes the round higher than it opens, <b className="down">DOWN</b> if lower.</>}
                        Your seat is <b>{usd.format(round.config.entryUsdc + round.config.startingBankroll)}</b> — <b>{usd.format(round.config.entryUsdc)}</b> into the shared prize pool plus a <b>{usd.format(round.config.startingBankroll)}</b> vault you trade with. At the end the players&apos; vault money is shared out by how each vault finished.
                      </p>
                      <div className="cta-row">
                        <button className="btn primary" onClick={() => { if (!wallet) { connect(); return; } setCallPick(""); setShowEnroll(true); }} disabled={busy}>
                          {wallet ? "Enter the pit" : "Sign in with X to enter"}
                        </button>
                        <a className="btn secondary" href={hostHref()}>Host your own</a>
                        {!isPublic && <button className="btn secondary" onClick={() => doCopyInvite()}>Copy invite link</button>}
                      </div>
                    </>
                  ) : (
                    <p>This round is <b>{STATUS_LABEL[round?.status ?? ""]?.toLowerCase()}</b>. Enrollment is closed — the next pit opens when this one settles.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="vault">
                    <div><span>Vault</span><b>{usd2.format(me!.bankroll)}</b></div>
                    <div><span>Cash</span><b>{usd2.format(me!.cash)}</b></div>
                    <div><span>Position</span><b>{me!.side ? `${me!.shares.toFixed(1)} ${sideName(me!.side)} @ ${me!.avgPrice.toFixed(0)}¢` : "—"}</b></div>
                    <div className={myPnl >= 0 ? "up" : "down"}><span>Vault P&amp;L</span><b>{myPnl >= 0 ? "+" : ""}{usd2.format(myPnl)}</b></div>
                  </div>

                  {round?.status === "live" && !tradeOpen ? (
                    <div className="enroll-cta locked-note" role="status">
                      <p><b>Last call has passed.</b> Positions are locked for the final {TRADE_CUTOFF_MS / 1000} seconds — the round settles in <b className="mono">{fmtClock(Math.max(0, round.liveDeadline - now))}</b>.</p>
                    </div>
                  ) : round?.status === "live" ? (
                    <>
                      <p className="last-call">
                        Trading closes in <b className="mono">{fmtClock(Math.max(0, round.liveDeadline - TRADE_CUTOFF_MS - now))}</b> — last call is {TRADE_CUTOFF_MS / 1000}s before the end.
                        {pantaPit
                          ? <> Every trade moves the room&apos;s odds — the bigger the trade, the further the price moves while it fills.</>
                          : <> Each trade buys {TRADE_SPREAD}¢ above and sells {TRADE_SPREAD}¢ below the market price.</>}
                      </p>
                      {pantaPit ? (
                        <p className="trade-rule">
                          At the bell <b className="up">YES</b> shares are worth $1 if Panta has resolved the market YES — otherwise the room&apos;s average YES price over the closing {Math.round(closingWindowMs(round.config.liveSec) / 1000) >= 60 ? `${Math.round(closingWindowMs(round.config.liveSec) / 60000)} min` : `${Math.round(closingWindowMs(round.config.liveSec) / 1000)}s`}. <b className="down">NO</b> is the other side.
                        </p>
                      ) : openPrice ? (
                        <p className="trade-rule">
                          <b className="up">UP</b> pays $1 a share if {asset} closes above <b>{usdPx(openPrice)}</b>; <b className="down">DOWN</b> pays $1 if it closes below. Prices move with {asset}.
                        </p>
                      ) : null}
                      <div className="sides">
                        <button className={side === "YES" ? "side yes on" : "side yes"} onClick={() => setSide("YES")} aria-pressed={side === "YES"}>▲ {sideName("YES")} <b>{yesNow}¢</b></button>
                        <button className={side === "NO" ? "side no on" : "side no"} onClick={() => setSide("NO")} aria-pressed={side === "NO"}>▼ {sideName("NO")} <b>{100 - yesNow}¢</b></button>
                      </div>
                      {round?.book ? (() => {
                        // Room book: quote the exact fill — your own trade moves the price.
                        const book = round.book;
                        const avail = bookAvailableFor(book, me!, side);
                        const stake = Number(amount || 0);
                        const over = stake > avail + 1e-9;
                        const switching = !!me!.side && me!.side !== side && me!.shares > 0;
                        const sellValue = me!.side ? proceedsForSell(book, me!.side, me!.shares) : 0;
                        // Quote against the book as it will be after any switch-sell.
                        const after = switching && me!.side ? (me!.side === "YES" ? { ...book, qYes: book.qYes - me!.shares } : { ...book, qNo: book.qNo - me!.shares }) : book;
                        const spend = Math.min(stake, avail);
                        const shares = spend > 0 ? sharesForSpend(after, side, spend) : 0;
                        const avg = shares > 0 ? (spend * 100) / shares : 0;
                        const moved = shares > 0 ? (() => {
                          const q = side === "YES" ? { ...after, qYes: after.qYes + shares } : { ...after, qNo: after.qNo + shares };
                          return 100 / (1 + Math.exp((q.qNo - q.qYes) / q.b));
                        })() : yesPrice;
                        return (
                          <>
                            <label className="field">
                              <span className="field-head">
                                Stake from your vault (USDC)
                                <em>{usd2.format(avail)} available{switching ? ` — sells your ${sideName(me!.side!)} first` : ""}</em>
                              </span>
                              <div className={`field-input ${over ? "bad" : ""}`}>
                                <span className="curr">$</span>
                                <input value={amount} placeholder={avail > 0 ? avail.toFixed(2) : "0.00"} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-invalid={over} />
                                <button type="button" className="max" onClick={() => setAmount(String(Math.floor(avail * 100) / 100))}>MAX</button>
                              </div>
                            </label>
                            <div className="summary">
                              <span>Average fill</span><b>{shares > 0 ? `${avg.toFixed(1)}¢` : "—"} <em className="muted">room {yesNow}¢ YES now</em></b>
                              <span>Shares</span><b>{shares.toFixed(2)}</b>
                              <span>Room after your trade</span><b>{Math.round(moved)}¢ YES</b>
                              <span>Pays if {side} wins</span><b className="accent">{usd2.format(shares)}</b>
                            </div>
                            {over && <p className="jc-error" role="alert">That&apos;s more than the {usd2.format(avail)} you have available.</p>}
                            <div className="trade-actions">
                              <button className="btn primary full" onClick={doBuy} disabled={busy || !stake || over}>
                                {switching ? `Switch to ${side}` : `Buy ${side}`}
                              </button>
                              <button className="btn secondary" onClick={doSell} disabled={busy || !me!.side} title={me!.side ? `Sells your whole position back to the room for about ${usd2.format(sellValue)}` : "No position to sell"}>
                                {me!.side ? `Sell all · ${usd2.format(sellValue)}` : "Sell all"}
                              </button>
                            </div>
                          </>
                        );
                      })() : (() => {
                        const avail = availableFor(me!, side, yesPrice, TRADE_SPREAD);
                        const stake = Number(amount || 0);
                        const market = side === "YES" ? yesPrice : 100 - yesPrice;
                        const price = buyPriceOf(market);
                        const over = stake > avail + 1e-9;
                        const switching = !!me!.side && me!.side !== side && me!.shares > 0;
                        const mySide = me!.side ? (me!.side === "YES" ? yesPrice : 100 - yesPrice) : 0;
                        const sellValue = me!.side ? me!.shares * (sellPriceOf(mySide) / 100) : 0;
                        return (
                          <>
                            <label className="field">
                              <span className="field-head">
                                Stake from your vault (USDC)
                                <em>{usd2.format(avail)} available{switching ? ` — sells your ${sideName(me!.side!)} first` : ""}</em>
                              </span>
                              <div className={`field-input ${over ? "bad" : ""}`}>
                                <span className="curr">$</span>
                                <input value={amount} placeholder={avail > 0 ? avail.toFixed(2) : "0.00"} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-invalid={over} />
                                <button type="button" className="max" onClick={() => setAmount(String(Math.floor(avail * 100) / 100))}>MAX</button>
                              </div>
                            </label>
                            <div className="summary">
                              <span>Buy price</span><b>{price}¢ <em className="muted">market {market}¢ + {TRADE_SPREAD}¢</em></b>
                              <span>Shares</span><b>{(stake / (price / 100)).toFixed(2)}</b>
                              <span>Pays if {asset} closes {side === "YES" ? "higher" : "lower"}</span><b className="accent">{usd2.format(stake / (price / 100))}</b>
                            </div>
                            {over && <p className="jc-error" role="alert">That&apos;s more than the {usd2.format(avail)} you have available.</p>}
                            <div className="trade-actions">
                              <button className="btn primary full" onClick={doBuy} disabled={busy || !stake || over}>
                                {switching ? `Switch to ${sideName(side)}` : `Buy ${sideName(side)}`}
                              </button>
                              <button className="btn secondary" onClick={doSell} disabled={busy || !me!.side} title={me!.side ? `Sells at ${sellPriceOf(mySide)}¢ (market less ${TRADE_SPREAD}¢)` : "No position to sell"}>
                                {me!.side ? `Sell all · ${usd2.format(sellValue)}` : "Sell all"}
                              </button>
                            </div>
                          </>
                        );
                      })()}
                      {pantaFillAvailable && (
                      <div className="panta-fill-toggle">
                        <label className={pantaFillAvailable ? "" : "disabled"}>
                          <input
                            type="checkbox"
                            checked={pantaFillOn && pantaFillAvailable}
                            onChange={(e) => setPantaFillOn(e.target.checked)}
                            disabled={!pantaFillAvailable}
                          />
                          <span className="lab">Also fill on Panta</span>
                          <span className="hint">
                            {!wallet ? "sign in with X"
                              : !marketId ? "no market"
                              : !looksLikePantaMarketId(marketId) ? "synthetic market — Panta orders need a real book"
                              : "real /orders/quote → build → sign → submit → verify → report"}
                          </span>
                        </label>
                      </div>
                      )}
                      {pantaFillOn && pantaFillAvailable && pantaOrder && (
                        <PantaOrderStatus update={pantaOrder} />
                      )}
                    </>
                  ) : (
                    <div className="enroll-cta my-call">
                      <p><b>You&apos;re in.</b> Trading opens when enrollment locks{deadline > 0 ? <> in <b className="mono">{fmtClock(timeLeft)}</b></> : null}.</p>
                      <div className="call-row" role="group" aria-label="Your opening call">
                        <span className="call-k">Opening call</span>
                        <div className="seg">
                          <button className={me!.openingCall === "YES" ? "seg-opt on up" : "seg-opt"} onClick={() => doChangeCall("YES")} disabled={busy} aria-pressed={me!.openingCall === "YES"}>▲ {sideName("YES")}</button>
                          <button className={me!.openingCall === "NO" ? "seg-opt on down" : "seg-opt"} onClick={() => doChangeCall("NO")} disabled={busy} aria-pressed={me!.openingCall === "NO"}>▼ {sideName("NO")}</button>
                          <button className={!me!.openingCall ? "seg-opt on" : "seg-opt"} onClick={() => doChangeCall(null)} disabled={busy} aria-pressed={!me!.openingCall}>Decide later</button>
                        </div>
                      </div>
                      {me!.openingCall && (
                        <CallSizePicker value={me!.openingCallPct ?? 100} onChange={(p) => doChangeCall(me!.openingCall ?? null, p)} vault={me!.cash} disabled={busy} />
                      )}
                      <p className="call-note">
                        {me!.openingCall
                          ? <>{callSizeText(me!.openingCallPct ?? 100, me!.cash).stake.replace(/^./, (c) => c.toUpperCase())} goes on <b className={me!.openingCall === "YES" ? "up" : "down"}>{sideName(me!.openingCall)}</b> at the opening price ({pantaPit ? "Panta's line" : "50¢ a share"}) the moment trading opens. {callSizeText(me!.openingCallPct ?? 100, me!.cash).rest} You can switch or sell any time while the round is live.</>
                          : <>No call yet — your vault stays in cash until you trade. You&apos;ll get {sideName("YES")} and {sideName("NO")} buttons the moment the round goes live.</>}
                      </p>
                      {!isPublic && currentInviteUrl && (
                        <div className="invite-inline">
                          <span className="call-k">Invite players · {standings.filter((e) => !e.isBot).length}/{round!.config.capacity} seats taken</span>
                          <div className="invite-inline-row">
                            <input readOnly value={currentInviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                            <button className="btn secondary sm" onClick={() => doCopyInvite()}>Copy link</button>
                          </div>
                          <p className="call-note">
                            If nobody else joins, you play a practice bot — with no one to win from, your vault money simply comes back to you.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* roster */}
            <aside className="roster">
              <div className="roster-head">
                <span>Standings</span>
                {round?.status === "live" && round.config.format === "single" ? (
                  <span className="cut">{paidPlaces(round) === 1 ? "Winner takes the pool" : `Top ${paidPlaces(round)} paid`}</span>
                ) : round?.status === "live" && aliveCount > cut ? (
                  <span className="cut">Top {cut} survive · {aliveCount - cut} cut</span>
                ) : null}
              </div>
              <ul>
                {standings.map((e, i) => {
                  const isCutLine = round?.status === "live" && round.config.format !== "single" && i === cut && e.eliminatedRound === null;
                  const pnl = e.bankroll - (round?.config.startingBankroll ?? 0);
                  return (
                    <li key={e.id}>
                      {isCutLine && <div className="cutline"><span>elimination line</span></div>}
                      <div className={`r-row ${e.wallet === wallet ? "me" : ""} ${e.eliminatedRound !== null ? "dead" : ""}`}>
                        <span className="r-rank">{e.eliminatedRound !== null ? "✕" : i + 1}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="r-avatar" src={avatarDataUrl(e.wallet, 24)} width={24} height={24} alt="" />
                        <span className="r-name">{displayName(e)}{e.isBot ? <em>bot</em> : ""}{e.wallet === wallet ? <em>you</em> : ""}</span>
                        <span className="r-bank">{usd2.format(e.bankroll)}</span>
                        <span className={`r-pnl ${pnl >= 0 ? "up" : "down"}`}>{pnl >= 0 ? "+" : "−"}{usd2.format(Math.abs(pnl))}</span>
                      </div>
                    </li>
                  );
                })}
                {standings.length === 0 && <li className="empty">Waiting for entrants…</li>}
              </ul>
            </aside>
          </div>
          </>
        )}

      </section>

      {/* Live Panta fills + resolution — only for rounds on a real Panta market
          (the BTC/ETH/SOL direction markets are oracle-resolved, never on Panta). */}
      {round && looksLikePantaMarketId(round.config.marketId) && (
        <PantaTradeTape marketId={round.config.marketId} marketQuestion={round.config.marketQuestion} />
      )}
      {round && looksLikePantaMarketId(round.config.marketId) && (
        <PantaResolution marketId={round.config.marketId} />
      )}

      {/* Fires once per tracked market when it graduates on Panta's secondary book */}
      <PantaGraduationBanner />

      {/* ── HOW IT WORKS ────────────────────────────────────── */}
      <section className="how-shell" id="how">
        <h2>How the pit works</h2>
        {streakMode ? (
        <div className="how-grid">
          <div><b>1 · One seat, one entry</b><p>Everyone pays the same entry into the prize pool. There&apos;s no vault and nothing to trade.</p></div>
          <div><b>2 · One call per leg</b><p>Each leg asks one question: a coin up or down, a head-to-head, or which of BTC, ETH and SOL does best. You get {PICK_MS / 1000} seconds to pick.</p></div>
          <div><b>3 · Hidden, then revealed</b><p>Nobody sees your pick while the window is open. When it closes, the leg starts at the live price and everyone&apos;s picks are shown.</p></div>
          <div><b>4 · Wrong and you&apos;re out</b><p>A wrong pick — or no pick — knocks you out. If everyone still in misses, or the leg ends dead level, nobody goes out.</p></div>
          <div><b>5 · Last caller standing</b><p>The game ends when one player is left, or after {MAX_LEGS} legs. The pool goes to whoever lasted longest — ties split their places.</p></div>
          <div><b>6 · Read the room</b><p>Short moves are close to a coin flip, so the edge is the crowd: if everyone calls UP, DOWN is how you end up alone.</p></div>
        </div>
        ) : picksMode ? (
        <div className="how-grid">
          <div><b>1 · One seat, one entry</b><p>Everyone pays the same entry into the prize pool. There&apos;s no vault and nothing to trade.</p></div>
          <div><b>2 · Five picks</b><p>BTC, ETH and SOL: each up or down, which does best (biggest % gain or smallest drop), and one head-to-head.</p></div>
          <div><b>3 · Hidden until the start</b><p>Nobody sees your picks while enrollment is open. You can change them until the round locks — then everyone&apos;s picks are revealed.</p></div>
          <div><b>4 · The prices decide</b><p>Each coin is judged against its live price at the lock. At the close every right answer is a point; a dead-level result scores for nobody.</p></div>
          <div><b>5 · Most points wins</b><p>Each right answer is a point; a lock of 2–3 picks that all land adds a point each, but one miss zeroes the lock. The top scores take the pool — 62.5% / 23.4% / 14.1%, or all of it in a duel. Players who tie split the places they share.</p></div>
          <div><b>6 · Withdraw</b><p>Winners withdraw their prize from the pit or the Positions page once the results are recorded on chain.</p></div>
        </div>
        ) : (
        <div className="how-grid">
          <div><b>1 · Host chooses the game</b><p>Any user opens their own pit — pick BTC, ETH or SOL, the player limit, the entry, the starting vault, and one to four rounds. You get a shareable link.</p></div>
          <div><b>2 · Invite friends</b><p>Send the pit link. Anyone with the link takes a seat in your room — everyone else plays a different pit on the same site.</p></div>
          <div><b>3 · Entry and vault separate</b><p>Your entry joins the shared prize pool. Your vault is your trading bankroll for the round.</p></div>
          <div><b>4 · Call UP or DOWN</b><p>Pick a direction when you sit down, or trade once the round opens. The round opens at the asset&apos;s live price: UP pays $1 a share if it closes higher, DOWN if lower.</p></div>
          <div><b>5 · The price decides</b><p>At the deadline the live price settles every position and players are ranked by vault value. In a royale the bottom half is cut and survivors carry their bankroll on.</p></div>
          <div><b>6 · Everyone withdraws</b><p>Top finishers share the pool — 62.5% / 23.4% / 14.1%, or all of it in a duel. The players&apos; vault money is shared by how each vault finished, so losses fund gains. Withdraw from the pit or your Positions page.</p></div>
        </div>
        )}
        <p className="disclaimer">
          Rounds, vaults, elimination and the prize pool are server-side game state on Postgres, priced by the
          live BTC, ETH and SOL spot price (Coinbase, with Kraken as backup). Player funds are held in a non-custodial
          escrow program on Solana {CLUSTER} — testnet USDC has no monetary value. If a game is never settled,
          recovery lets each player take their full seat back after the deadline.
        </p>
      </section>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}


      {showEnroll && round && (() => {
        // X-only: the seat is named after the X handle (local dev without X: the wallet).
        const ok = !!wallet && (!!username || !xEnabled);
        const seat = seatCostUsdc(round.config);
        const vault = round.config.startingBankroll;
        const liveMin = Math.round(round.config.liveSec / 60);
        const rounds = round.config.format === "royale" ? round.config.roundLimit : 1;
        const cta = callPick === "YES" ? `call ${sideName("YES")}` : callPick === "NO" ? `call ${sideName("NO")}` : "join";
        const seatPicked = pickCount(questions, seatPicks);
        const ready = streakMode ? true : picksMode ? seatPicked >= questions.length : !!callPick;
        return (
          <div className="modal-backdrop" onClick={() => { if (!busy) setShowEnroll(false); }}>
            <div className="modal seat-modal" role="dialog" aria-modal="true" aria-labelledby="seat-title" onClick={(e) => e.stopPropagation()}>
              <button className="close" onClick={() => setShowEnroll(false)} aria-label="Close">×</button>
              <h2 id="seat-title">Take your seat</h2>
              <p className="sub">Pit <b>{arenaCode}</b> · {round.config.marketQuestion}</p>

              <form onSubmit={(e) => { e.preventDefault(); if (ok && ready && !busy && wallet) doEnroll(); }}>
                {streakMode ? (
                  <div className="call-pick sk-seat">
                    <p className="call-explain">
                      Each leg asks one question about BTC, ETH or SOL. You get {PICK_MS / 1000} seconds to pick, then the leg runs for {Math.round(round.config.liveSec / 60)} minute{round.config.liveSec === 60 ? "" : "s"}.
                      A wrong pick — or no pick — knocks you out. Stay on this page while you play: legs come quickly.
                    </p>
                  </div>
                ) : picksMode ? (
                  <fieldset className="call-pick">
                    <legend>Your picks · hidden from everyone until the round starts</legend>
                    <PicksEditor questions={questions} picks={seatPicks} onPick={(q, o) => setSeatPicks((p) => ({ ...p, [q]: o }))} disabled={busy} compact locks={seatLocks} onToggleLock={toggleSeatLock} />
                    <p className="call-explain" role="status">
                      Each coin is judged against its price when picks lock. &ldquo;Best&rdquo; means the biggest % gain (or smallest drop). You can change picks until the round starts.
                    </p>
                  </fieldset>
                ) : (
                <fieldset className="call-pick">
                  <legend>{pantaPit ? <>Your call{pantaLine !== null ? <> · Panta has YES at <b>{Math.round(pantaLine)}¢</b></> : null}</> : <>Your call on {asset}{spot ? <> · now <b>{usdPx(spot)}</b></> : null}</>}</legend>
                  <div className="call-options">
                    <button type="button" className={`call-opt up ${callPick === "YES" ? "on" : ""}`} onClick={() => setCallPick("YES")} aria-pressed={callPick === "YES"}>
                      <span className="co-arrow" aria-hidden="true">▲</span>
                      <span className="co-t">{sideName("YES")}</span>
                      <span className="co-d">{pantaPit ? "It happens — the market resolves YES" : `${asset} finishes the round higher than it opens`}</span>
                    </button>
                    <button type="button" className={`call-opt down ${callPick === "NO" ? "on" : ""}`} onClick={() => setCallPick("NO")} aria-pressed={callPick === "NO"}>
                      <span className="co-arrow" aria-hidden="true">▼</span>
                      <span className="co-t">{sideName("NO")}</span>
                      <span className="co-d">{pantaPit ? "It doesn't — the market resolves NO" : `${asset} finishes the round lower than it opens`}</span>
                    </button>
                  </div>
                  <button type="button" className={`call-later ${callPick === "LATER" ? "on" : ""}`} onClick={() => setCallPick("LATER")} aria-pressed={callPick === "LATER"}>
                    {callPick === "LATER" ? "✓ " : ""}Decide when trading opens
                  </button>
                  {(callPick === "YES" || callPick === "NO") && (
                    <CallSizePicker value={callPct} onChange={setCallPct} vault={vault} disabled={busy} />
                  )}
                  <p className="call-explain" role="status">
                    {callPick === "YES" || callPick === "NO"
                      ? <>When enrollment locks, {callSizeText(callPct, vault).stake} buys <b className={callPick === "YES" ? "up" : "down"}>{sideName(callPick)}</b> at the opening price — {pantaPit ? "Panta's line" : "50¢ a share"}, each paying $1 if you&apos;re right. {callSizeText(callPct, vault).rest} You can switch sides or sell any time during the round, and change this call until it starts.</>
                      : callPick === "LATER"
                        ? <>Your {usd2.format(vault)} vault stays in cash. Once the round is live you pick {sideName("YES")} or {sideName("NO")}, and how much, yourself.</>
                        : pantaPit ? <>Pick the side you think wins. Nothing is placed until trading opens.</> : <>Pick the direction you think {asset} moves. Nothing is placed until trading opens.</>}
                  </p>
                </fieldset>
                )}

                <ol className="seat-steps" aria-label="How this round plays">
                  <li><b>Enrollment</b> {round.status === "enrolling" && deadline > 0 && standings.some((e) => !e.isBot) ? <>closes in <span className="mono">{fmtClock(timeLeft)}</span></> : isPublic ? `runs ${round.config.enrollmentSec}s from the first seat` : "open"}</li>
                  {streakMode
                    ? <li><b>Up to {MAX_LEGS} legs</b> of {liveMin} min, {PICK_MS / 1000}s to pick each — no trading</li>
                    : picksMode
                    ? <li><b>{liveMin} min</b> on the live BTC, ETH and SOL prices — no trading</li>
                    : pantaPit ? <li><b>{liveMin} min</b> trading the room&apos;s odds on this Panta market{rounds > 1 ? `, ${rounds} rounds` : ""}</li>
                    : <li><b>{liveMin} min</b> of trading on the live {asset} price{rounds > 1 ? `, ${rounds} rounds` : ""}</li>}
                  {streakMode
                    ? <li><b>Last caller standing</b> takes the pool · ties split their places</li>
                    : picksMode
                    ? <li><b>Most points</b> take the pool · ties split their places</li>
                    : <li><b>Top finishers</b> split the pool · everyone is paid out after the round</li>}
                </ol>

                <dl className="seat-breakdown">
                  <div><dt>Entry → shared prize pool</dt><dd>{usd2.format(round.config.entryUsdc)}</dd></div>
                  {(round.config.hostFeePct ?? 0) > 0 && <div><dt>Host fee</dt><dd>{round.config.hostFeePct}% of the pool</dd></div>}
                  {round.escrow && <div><dt>Platform fee</dt><dd>{(PLATFORM_CLAIM_FEE_BPS / 100).toFixed(1)}% when you withdraw</dd></div>}
                  {!entryOnly && <div><dt>Vault → your trading bankroll</dt><dd>{usd2.format(vault)}</dd></div>}
                  <div className="total">
                    <dt>{round.escrow ? "Total deposit" : "Practice seat"}</dt>
                    <dd>{round.escrow ? `${usd2.format(seat)} USDC` : "free — no USDC moves"}</dd>
                  </div>
                </dl>

                {username && <p className="x-playing-as">Playing as <b>@{username}</b> <em>· your X handle</em></p>}
                <button type="submit" className="btn primary full" disabled={busy || !ok || !wallet || !ready} style={{ marginTop: 10 }}>
                  {busy ? (seatStep ? seatStepText(seatStep, seat, callPick === "YES" || callPick === "NO" ? callPick : null, undefined, pantaPit).button : "Checking your X wallet…")
                    : !ok ? "Sign in with X first"
                    : streakMode ? (round.escrow ? `Deposit ${usd2.format(seat)} & take a seat` : "Take a practice seat")
                    : picksMode && !ready ? `Answer all ${questions.length} questions · ${seatPicked}/${questions.length}`
                    : picksMode ? (round.escrow ? `Deposit ${usd2.format(seat)} & lock in my picks` : "Take a practice seat")
                    : !callPick ? `Pick ${sideName("YES")}, ${sideName("NO")} or decide later`
                    : round.escrow ? `Deposit ${usd2.format(seat)} & ${cta}` : `Take a practice seat & ${cta}`}
                </button>
              </form>
              <p className="disclaimer" style={{ marginTop: 12 }}>
                {round.escrow && entryOnly
                  ? <>Held in a non-custodial escrow program on Solana {CLUSTER}. After settlement, winners withdraw their prize to this wallet.</>
                  : round.escrow
                  ? <>Held in a non-custodial escrow program on Solana {CLUSTER}. After settlement you withdraw your payout: any prize plus your share of the vault money.</>
                  : <>Practice pit — no USDC moves and nothing is deposited.</>}
              </p>
            </div>
          </div>
        );
      })()}

    </main>
  );
}

/** "nova wins $3.75 with 6 pts" or "nova and kai tie on 4 pts". */
function predictionsHeadline(standings: Entrant[]): string {
  const humans = standings.filter((e) => !e.isBot);
  const best = humans[0];
  if (!best) return "Predictions complete";
  const pts = (n: number | undefined) => `${n ?? 0} pt${(n ?? 0) === 1 ? "" : "s"}`;
  if (humans.length === 1) return `${displayName(best)} scored ${pts(best.score)} — entry returned`;
  const top = humans.filter((e) => (e.score ?? 0) === (best.score ?? 0));
  if (top.length === 1) return `${displayName(best)} wins ${usd2.format(best.prizeUsdc)} with ${pts(best.score)}`;
  if (top.length === 2) return `${displayName(top[0])} and ${displayName(top[1])} tie on ${pts(best.score)}`;
  return `${top.length} players tie on ${pts(best.score)}`;
}

/** "nova is the last caller standing" or "nova and kai survive 6 legs". */
function streakHeadline(standings: Entrant[]): string {
  const humans = standings.filter((e) => !e.isBot);
  const best = humans[0];
  if (!best) return "Streak complete";
  const legs = (n: number | undefined) => `${n ?? 0} leg${(n ?? 0) === 1 ? "" : "s"}`;
  if (humans.length === 1) return `${displayName(best)} lasted ${legs(best.score)} — entry returned`;
  const top = humans.filter((e) => (e.score ?? 0) === (best.score ?? 0));
  if (top.length === 1) return best.eliminatedRound === null ? `${displayName(best)} is the last caller standing` : `${displayName(best)} lasted ${legs(best.score)} and wins ${usd2.format(best.prizeUsdc)}`;
  if (top.length === 2) return `${displayName(top[0])} and ${displayName(top[1])} survive ${legs(best.score)}`;
  return `${top.length} players survive ${legs(best.score)}`;
}

/** Plain-language reason from the round's last cancellation event. */
function cancelReason(history: string[]): string {
  const line = [...history].reverse().find((h) => /cancelled/i.test(h)) ?? "";
  if (/no players/i.test(line)) return "No seat was confirmed before enrollment closed, so the round never started.";
  if (/host deposit/i.test(line)) return "The host's seat deposit wasn't approved, so the pit was closed before anyone could join.";
  if (/only \d+ entrants/i.test(line)) return "Not enough players joined before enrollment closed.";
  return "The round was cancelled before it started.";
}

type RefundState = {
  deposited: boolean;
  seatUsdc?: number;
  settled?: boolean;
  claimed?: boolean;
  entitlementUsdc?: number;
  claimsOpen?: boolean;
  recoverAt?: number | null;
} | null;

/** What a (possible) depositor needs after a cancelled arena: their refund. */
function RefundCard({
  wallet, state, refundReady, busy, onConnect, onClaim, onRecover
}: {
  wallet: string | null;
  state: RefundState;
  refundReady: boolean;
  busy: boolean;
  onConnect: () => void;
  onClaim: () => void;
  onRecover: () => void;
}) {
  const money = (n?: number) => `${(n ?? 0).toFixed(2)} USDC`;

  if (!wallet) {
    return (
      <div className="refund-card">
        <p><b>Deposited into this pit?</b> Sign in with the X account you played with to get your refund.</p>
        <button className="btn primary full" onClick={onConnect}>Sign in with X</button>
      </div>
    );
  }
  if (!state) return <div className="refund-card"><p>Checking your deposit…</p></div>;
  if (!state.deposited) {
    return <div className="refund-card muted"><p>This wallet has no deposit in this pit — nothing to refund.</p></div>;
  }
  if (state.claimed) {
    return (
      <div className="refund-card done">
        <p><b>Refund complete.</b> {money(state.entitlementUsdc || state.seatUsdc)} was returned to your X wallet.</p>
      </div>
    );
  }
  if (state.settled && state.claimsOpen) {
    return (
      <div className="refund-card ready">
        <p><b>Your {money(state.seatUsdc)} deposit is ready to refund.</b> Nothing was lost — claim it back to your X wallet.</p>
        <button className="btn primary full" onClick={onClaim} disabled={busy}>
          {busy ? "Confirm in your X wallet…" : `Claim ${money(state.entitlementUsdc || state.seatUsdc)} refund`}
        </button>
      </div>
    );
  }
  const canRecover = !!state.recoverAt && Date.now() >= state.recoverAt;
  return (
    <div className="refund-card">
      <p>
        <b>Your {money(state.seatUsdc)} deposit is safe in escrow.</b>{" "}
        {refundReady
          ? "Your refund is being recorded — this page updates automatically."
          : "A full refund is being prepared and opens within about two minutes of the pit closing. This page updates automatically."}
      </p>
      {canRecover && (
        <button className="btn secondary full" onClick={onRecover} disabled={busy}>Recover deposit directly</button>
      )}
    </div>
  );
}
