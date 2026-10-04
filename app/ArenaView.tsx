"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { availableFor, buyPriceOf, DEFAULT_OPENING_CALL_PCT, hostAmountError, paidPlaces, payoutShares, scorePlace, seatCostUsdc, sellPriceOf, tradingOpen, TRADE_CUTOFF_MS, TRADE_SPREAD } from "@/lib/royale";
import { changeOf, pickCount, type Picks } from "@/lib/predictions";
import { PicksBoard, PicksEditor, PicksRoster, judgedPrices, pctText, picksMade } from "@/app/Predictions";
import { useEscapeKey } from "@/lib/use-escape";
import CallSizePicker, { callSizeText } from "@/app/CallSizePicker";
import { getRound, enrollWithEscrow, tradeRound, newRound, placeParlayApi, claimFromEscrow, serverSettleArena, cancelArena, checkSeatFunds, setOpeningCall, setPicks, prepareWallet, seatStepText, type OpeningCall, type RoundView, type SeatStep } from "@/lib/round-client";
import { useEscrowStatus, useWalletIdentity } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import UsernameModal from "@/app/UsernameModal";
import type { Entrant, Round, ParlayTicket } from "@/lib/royale";
import { PICKS_CHAIN_VAULT_USDC, PUBLIC_ARENA, isPracticeArena } from "@/lib/royale";
import { markets as boardMarkets } from "@/lib/arena-data";
import { quoteParlay, PARLAY_MAX_LEGS, type ParlayLeg } from "@/lib/parlay";
import { avatarDataUrl } from "@/lib/avatars";
import {
  displayName,
  isUsernameFreeInArena,
  shortPk,
  validateUsername,
  USERNAME_MAX
} from "@/lib/username";
import ArenaStage from "@/app/ArenaStage";
import PantaTradeTape from "@/app/PantaTradeTape";
import PantaResolution from "@/app/PantaResolution";
import PantaGraduationBanner from "@/app/PantaGraduationBanner";
import PantaOrderStatus from "@/app/PantaOrderStatus";
import PantaCashOutModal from "@/app/PantaCashOutModal";
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
  const { wallet, username, toggleConnect, saveUsername } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [showUsername, setShowUsername] = useState(false);
  const [nickname, setNickname] = useState("");
  const [view, setView] = useState<RoundView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [betMode, setBetMode] = useState<"single" | "parlay">("single");
  const [parlayLegs, setParlayLegs] = useState<{ marketId: string; side: "YES" | "NO" }[]>([]);
  const [parlayStake, setParlayStake] = useState("");
  const [busy, setBusy] = useState(false);
  // Which wallet step a seat/host request is waiting on (null = idle).
  const [seatStep, setSeatStep] = useState<SeatStep | null>(null);
  const [toast, setToast] = useState("");
  const [showEnroll, setShowEnroll] = useState(false);
  // UP / DOWN / decide-later pick in the seat modal ("" = not chosen yet).
  const [callPick, setCallPick] = useState<"YES" | "NO" | "LATER" | "">("");
  const [callPct, setCallPct] = useState<number>(DEFAULT_OPENING_CALL_PCT);
  const [hCallPct, setHCallPct] = useState<number>(DEFAULT_OPENING_CALL_PCT);
  const [showHost, setShowHost] = useState(false);
  const [hAsset, setHAsset] = useState<"BTC" | "ETH" | "SOL">("SOL");
  const [hHorizon, setHHorizon] = useState<"MIN5" | "MIN15" | "HOUR" | "DAY">("MIN5");
  const [hFormat, setHFormat] = useState<"single" | "royale" | "predictions">("royale");
  const [hRounds, setHRounds] = useState(3);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  const [hCall, setHCall] = useState<"YES" | "NO" | "LATER" | "">("");
  // When a host call succeeds we mint a fresh arena code; this state drives
  // the "share your invite link" screen inside the host modal.
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);
  // Real Panta order lifecycle — opt-in, disabled when market is a
  // synthetic direction-board id or no wallet is connected. When on,
  // `doBuy` also drives quote → build → sign → submit → verify → report
  // through Panta's own APIs and streams progress here.
  const [pantaFillOn, setPantaFillOn] = useState(false);
  const [pantaOrder, setPantaOrder] = useState<LifecycleUpdate | null>(null);
  const [cashoutTicket, setCashoutTicket] = useState<ParlayTicket | null>(null);
  // Predictions: answers chosen in the seat modal, and edits to my saved
  // picks that are on their way to the server.
  const [seatPicks, setSeatPicks] = useState<Picks>({});
  const [pickEdits, setPickEdits] = useState<Picks>({});
  const pollRef = useRef<number | null>(null);

  // Live invite URL for THIS arena (visible in the HUD when non-public).
  const currentInviteUrl = useMemo(() => {
    if (typeof window === "undefined" || isPublic) return "";
    return `${window.location.origin}/a/${arenaCode}`;
  }, [arenaCode, isPublic]);

  // Prefill the seat form with the wallet's saved username.
  useEffect(() => { if (username) setNickname(username); }, [username]);

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
  const livePrices = view?.prices ?? {};

  const me = useMemo(() => (wallet ? standings.find((e) => e.wallet === wallet) ?? null : null), [standings, wallet]);
  const enrolled = !!me;
  const picksMode = round?.config.format === "predictions";
  const questions = useMemo(() => round?.predictions?.questions ?? [], [round?.predictions?.questions]);
  const myPicks: Picks = useMemo(() => ({ ...(me?.picks ?? {}), ...pickEdits }), [me?.picks, pickEdits]);
  const myPickCount = pickCount(questions, myPicks);
  const tradeOpen = !!round && tradingOpen(round, now);
  const aliveCount = standings.filter((e) => e.eliminatedRound === null).length;

  const deadline = round?.status === "enrolling" ? round.enrollDeadline : round?.status === "live" ? round.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;

  // ── wallet ────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    const r = await toggleConnect();
    setToast(r.message);
    if (r.needsUsername) setShowUsername(true);
  }, [toggleConnect]);

  // ── actions (all arena-scoped) ────────────────────────────────────
  const doEnroll = useCallback(async () => {
    if (!wallet) { setShowEnroll(false); setToast("Connect a wallet first."); return; }
    const v = validateUsername(nickname);
    if (!v.ok) { setToast(v.reason); return; }
    const nick = v.value;
    if (round && !isUsernameFreeInArena(nick, round.entrants, wallet)) {
      setToast(`Username "${nick}" is taken in this arena — pick another.`);
      return;
    }
    const predictions = round?.config.format === "predictions";
    if (predictions && pickCount(round?.predictions?.questions, seatPicks) < (round?.predictions?.questions.length ?? 0)) {
      setToast("Answer all five questions to take your seat.");
      return;
    }
    if (!predictions && !callPick) { setToast("Pick UP, DOWN or decide later."); return; }
    const call: OpeningCall = predictions || callPick === "LATER" || !callPick ? null : callPick;

    setBusy(true);
    try {
      // Persist the username first so it survives a cancelled wallet prompt.
      saveUsername(nick);

      // enrollWithEscrow: if arena is on-chain, wallet signs a Deposit tx
      // (real USDC on devnet) before the ledger enrolls. Ledger-only arenas
      // fall through immediately. Signing UI is provided by the wallet.
      const seatUsd = round ? seatCostUsdc(round.config) : 0;
      const r = await enrollWithEscrow(wallet, nick, arenaCode, call, (step, name) => {
        setSeatStep(step);
        setToast(seatStepText(step, seatUsd, call, name).toast);
      }, callPct, predictions ? seatPicks : undefined);
      const seated = !!(r.entrantId || r.already);
      if (seated) {
        const callText = predictions ? " · your picks stay hidden until the start" : call ? ` · opening call ${call === "YES" ? "UP" : "DOWN"}` : "";
        setToast(`You're in arena ${arenaCode} as ${nick}${callText}.`);
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
  }, [wallet, nickname, arenaCode, refresh, round, saveUsername, callPick, callPct, seatPicks]);

  // Change one of my picks while enrolling. Shown at once; saved in the
  // background, one request at a time so the last click always wins.
  const pickQueue = useRef<Promise<void>>(Promise.resolve());
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
        ? `Opening call: ${call === "YES" ? "UP" : "DOWN"} with ${r.pct === 100 ? "your whole vault" : `${r.pct ?? pct ?? 100}% of your vault`}.`
        : "You'll pick UP or DOWN once trading opens.");
      await refresh();
    } finally { setBusy(false); }
  }, [wallet, arenaCode, refresh]);

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
    const run = async () => {
      const res = await serverSettleArena(arenaCode);
      if (stopped) return;
      if (res.pending) {
        timer = window.setTimeout(run, Math.min(30_000, Math.max(3_000, res.retryInMs ?? 5_000)));
        return;
      }
      if (res.error) setToast(`${roundStatus === "cancelled" ? "Refund" : "Settlement"}: ${res.error}`);
      await refresh();
      setEscrowNudge((n) => n + 1);
    };
    run();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [roundId, roundStatus, hasVault, vaultSettled, chainSettled, arenaCode, refresh]);

  // This wallet's on-chain position in the arena — drives the refund card,
  // including deposits that landed after the round closed.
  type MyEscrow = { deposited: boolean; seatUsdc?: number; settled?: boolean; claimed?: boolean; entitlementUsdc?: number; claimsOpen?: boolean; recoverAt?: number | null };
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
    if (!wallet) return setToast("Connect a wallet first.");
    setBusy(true);
    try {
      const r = await claimFromEscrow(wallet, arenaCode, recover, (name) => setToast(seatStepText("waiting", 0, null, name).toast), undefined,
        () => setToast("That took over a minute, so Solana needs a fresh signature — approve the withdrawal once more in your wallet."));
      if (r.error) setToast(`Claim: ${r.error}`);
      else if (r.signature) setToast(`${recover ? "Recovered" : "Claimed"} · ${r.signature.slice(0, 8)}…`);
      else setToast("Withdrawal submitted.");
      await loadMyEscrow();
    } finally { setBusy(false); }
  }, [wallet, arenaCode, loadMyEscrow]);

  const marketId = round?.config.marketId;
  const pantaFillAvailable = !!wallet && !!marketId && looksLikePantaMarketId(marketId);

  const doBuy = useCallback(async () => {
    if (!wallet) return setToast("Connect a wallet first.");
    if (!enrolled) return setToast("Enroll in the round first.");
    const v = Number(amount);
    if (!v || v <= 0) return setToast("Enter an amount.");
    if (me && v > availableFor(me, side, yesPrice, TRADE_SPREAD) + 1e-9) return setToast(`You have ${usd2.format(availableFor(me, side, yesPrice, TRADE_SPREAD))} available for ${side === "YES" ? "UP" : "DOWN"}.`);
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
        setToast(`${r.fill ?? `Bought ${side === "YES" ? "UP" : "DOWN"}.`} Stake ${usd2.format(v)}.`);
        setAmount("");
        await refresh();
      }
      // Don't block the UI on the Panta lifecycle — it streams via
      // setPantaOrder. We do await it so `busy` clears only after both
      // paths settle when the toggle was on.
      if (pantaLifecycle) await pantaLifecycle;
    } finally { setBusy(false); }
  }, [wallet, enrolled, amount, side, arenaCode, refresh, pantaFillOn, pantaFillAvailable, marketId, me, yesPrice]);

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

  // ── parlay builder ────────────────────────────────────────────────
  const toggleLeg = useCallback((marketId: string, legSide: "YES" | "NO") => {
    setParlayLegs((prev) => {
      const existing = prev.find((l) => l.marketId === marketId);
      if (existing && existing.side === legSide) return prev.filter((l) => l.marketId !== marketId); // deselect
      // Correlation block: at most one horizon per asset (shared correlationGroup).
      const target = boardMarkets.find((m) => m.id === marketId);
      const group = target?.correlationGroup;
      const kept = prev.filter((l) => {
        if (l.marketId === marketId) return false;
        if (!group) return true;
        const m = boardMarkets.find((b) => b.id === l.marketId);
        return m?.correlationGroup !== group;
      });
      if (kept.length >= PARLAY_MAX_LEGS) { setToast(`Parlays cap at ${PARLAY_MAX_LEGS} legs.`); return prev; }
      return [...kept, { marketId, side: legSide }];
    });
  }, []);

  const parlayQuote = useMemo(() => {
    const legs: ParlayLeg[] = parlayLegs.map((l) => {
      const m = boardMarkets.find((b) => b.id === l.marketId)!;
      const up = livePrices[l.marketId] ?? 50;
      return { marketId: l.marketId, side: l.side, question: m.question, price: l.side === "YES" ? up : 100 - up, correlationGroup: m.correlationGroup };
    });
    return quoteParlay(legs, Number(parlayStake) || 0);
  }, [parlayLegs, parlayStake, livePrices]);

  // One leg per asset, on this round's horizon — every leg resolves over
  // the round's own window.
  const parlayBoard = useMemo(() => {
    const horizon = boardMarkets.find((m) => m.id === round?.config.marketId)?.horizon ?? "MIN5";
    return boardMarkets.filter((m) => m.horizon === horizon);
  }, [round?.config.marketId]);

  const doPlaceParlay = useCallback(async () => {
    if (!wallet || !enrolled) return setToast("Enroll in the round first.");
    if (parlayLegs.length < 2) return setToast("Add at least 2 legs.");
    const v = Number(parlayStake);
    if (!v || v <= 0) return setToast("Enter a stake.");
    if (me && v > me.cash + 1e-9) return setToast(`You have ${usd2.format(me.cash)} in cash for a parlay.`);
    setBusy(true);
    try {
      const r = await placeParlayApi(wallet, parlayLegs, v, arenaCode);
      if (r.error) setToast(r.error);
      else {
        setToast(`Parlay placed · ${parlayLegs.length} legs, ${usd2.format(v)} staked.`);
        setParlayLegs([]);
        setParlayStake("");
        await refresh();
      }
    } finally { setBusy(false); }
  }, [wallet, enrolled, parlayLegs, parlayStake, arenaCode, refresh, me]);

  const hostPicks = hFormat === "predictions";
  const hostSeat = (Number(hEntry) || 0) + (hostPicks ? PICKS_CHAIN_VAULT_USDC : Number(hVault) || 0);
  const hostError = hostAmountError(Number(hEntry) || 0, Number(hVault) || 0, hFormat);

  const doHost = useCallback(async () => {
    // Real-mode guard: on-chain hosting requires the host to sign a seat
    // deposit before the room is real.
    if (escrow?.active && !wallet) {
      setToast("Connect a wallet first — hosting on-chain needs your seat deposit signature.");
      return;
    }
    if (wallet && !username) {
      setShowUsername(true);
      setToast("Set a username before hosting.");
      return;
    }
    if (hostError) { setToast(hostError); return; }
    if (wallet && !hCall && !hostPicks) { setToast(`Pick UP or DOWN on ${hAsset} (or decide later) before taking seat 1.`); return; }

    setBusy(true);
    try {
      // Check funds before the operator pays for an on-chain InitRound.
      if (wallet && escrow?.active) {
        const short = await checkSeatFunds(wallet, hostSeat);
        if (short) { setToast(short); return; }
      }
      // Wallet reachable and signed in before an arena is created for us.
      const call: OpeningCall = !hostPicks && (hCall === "YES" || hCall === "NO") ? hCall : null;
      const onStep = (step: SeatStep, name?: string) => { setSeatStep(step); setToast(seatStepText(step, hostSeat, call, name).toast); };
      if (wallet) {
        const ready = await prepareWallet(wallet, onStep);
        if (!ready.ok) { setToast(ready.error); return; }
        setSeatStep(null);
      }
      const v = await newRound({
        asset: hAsset,
        horizon: hHorizon,
        format: hFormat,
        entryUsdc: Number(hEntry),
        startingBankroll: Number(hVault),
        capacity: hCapacity,
        roundLimit: hFormat === "royale" ? hRounds : 1,
        enrollmentSec: 120, // counted from the host's confirmed seat
        host: wallet ?? ""
      });
      if (v.error || !v.arena) { setToast(v.error ?? "Host failed."); return; }
      const url = `${window.location.origin}/a/${v.arena}`;

      // No wallet → practice-mode arena, no seat deposit required.
      if (!wallet) {
        setInviteInfo({ code: v.arena, url });
        setToast(`Arena ${v.arena} is open. Share the link.`);
        return;
      }

      // With wallet: the host must sign seat #1 deposit before the arena
      // is announced. If signing is dismissed or fails, roll back so the
      // room doesn't linger as an unfunded orphan.
      const nick = username || shortPk(wallet).replace("…", "");
      let enrollError = "";
      let refundable = false;
      try {
        const r = await enrollWithEscrow(wallet, nick, v.arena, call, onStep, hCallPct);
        // A signed deposit means the room is funded — never tear it down.
        if (r.error && !(r.entrantId || r.already)) { enrollError = r.error; refundable = !!r.refundable || !!r.deposited; }
      } catch (err) {
        enrollError = err instanceof Error ? err.message : "wallet signing failed";
      }

      if (enrollError) {
        if (refundable) {
          // Deposit landed after the arena closed — its page offers the refund.
          setToast(enrollError);
          window.setTimeout(() => { window.location.href = `/a/${v.arena}`; }, 1500);
          return;
        }
        await cancelArena(v.arena, wallet).catch(() => { /* best effort */ });
        setToast(`Arena not opened — ${enrollError}`);
        return;
      }

      setInviteInfo({ code: v.arena, url });
      setToast(`Arena ${v.arena} is open. Share the link.`);
    } finally { setBusy(false); setSeatStep(null); }
  }, [hAsset, hHorizon, hFormat, hEntry, hVault, hCapacity, hRounds, wallet, escrow, username, hCall, hCallPct, hostSeat, hostError, hostPicks]);

  const doCopyInvite = useCallback(async (url?: string) => {
    const link = url ?? currentInviteUrl;
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setToast("Invite link copied."); }
    catch { setToast("Copy failed — long-press the link to select and copy."); }
  }, [currentInviteUrl]);

  const goToArena = useCallback((code: string) => {
    window.location.href = `/a/${code}`;
  }, []);

  const closeHostModal = useCallback(() => {
    // Preserve inviteInfo when closing — the arena is live and shareable via HUD.
    setShowHost(false);
  }, []);
  const closeEnroll = useCallback(() => setShowEnroll(false), []);
  // Escape closes a dialog — but never while a wallet request is in flight.
  useEscapeKey(showHost && !busy, closeHostModal);
  useEscapeKey(showEnroll && !busy, closeEnroll);


  const myPnl = me ? me.bankroll - (round?.config.startingBankroll ?? 0) : 0;
  const openParlays = (me?.parlays ?? []).filter((p) => p.status === "open");
  const openParlayPotential = openParlays.reduce((s, t) => s + t.potentialPayout, 0);

  return (
    <main className="game-main arena-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="arenas"
        wallet={wallet}
        username={username}
        escrow={escrow}
        onConnect={connect}
        onEditUsername={() => setShowUsername(true)}
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
            {!picksMode && (
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
                <span className="rb-k">{round.status === "enrolling" ? "Locks in" : "Settles in"}</span>
                <span className="rb-v mono">
                  {round.status === "enrolling" && standings.every((e) => e.isBot) ? "Waiting" : fmtClock(timeLeft)}
                </span>
              </div>
            )}
            <div className="rb-cell">
              <span className="rb-k">Prize pool</span>
              <span className="rb-v accent">{usd.format(round.prizePoolUsdc)}</span>
            </div>
            {picksMode ? (
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
              <span className="rb-k">{picksMode ? "Game" : `Market · ${round.config.asset}`}</span>
              <span className="rb-v market">{picksMode ? `Five picks on BTC, ETH and SOL · ${Math.round(round.config.liveSec / 60)} min` : round.config.marketQuestion}</span>
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
            {!picksMode && (spot || closePrice) && (
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
            {!picksMode && (
              <div className="rb-cell">
                <span className="rb-k">UP / DOWN</span>
                <span className="rb-v"><span className="yes">{yesPrice}¢</span> <em>/</em> <span className="no">{100 - yesPrice}¢</span></span>
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
              {!view ? `Loading arena ${arenaCode}…` : isPublic ? "Opening the arena…" : `Arena ${arenaCode} has no active round. `}
              {view && !isPublic && <a className="link" href="/">Browse open arenas →</a>}
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

      {/* ── ARENA STAGE (every round state) ─────────────────── */}
      {round && (
        <ArenaStage round={round} standings={standings} survivors={cut} yesPrice={yesPrice} spot={spot} wallet={wallet} />
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
              const projected = payoutShares(
                humansNow.map((e) => ({ key: e.wallet, cash: e.cash, prize: e.prizeUsdc })),
                humansNow.length * (round.config.entryUsdc + round.config.startingBankroll)
              );
              const myEntitlement = me ? projected[me.wallet] ?? 0 : 0;
              const escrowSettled = !!round.escrow?.settleSignatures?.length || chainSettled || !!myEscrow?.claimsOpen;
              const canClaim = !!wallet && !!round.escrow && escrowSettled && (myEscrow?.entitlementUsdc ?? myEntitlement) > 0.0001 && !myEscrow?.claimed;
              const explorerBase = `https://explorer.solana.com/tx`;
              const explorerCluster = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
              return (
                <>
                  <p className="eyebrow">{picksMode ? "Predictions" : round.config.format === "single" ? "Single round" : `Round ${round.roundNumber}`} · final</p>
                  <h1>{picksMode ? predictionsHeadline(standings, questions.length) : champ ? `${displayName(champ)} wins ${usd2.format(champ.prizeUsdc)}` : "Rumble complete"}</h1>
                  {picksMode && (
                    <div className="pk-results">
                      <PicksBoard round={round} me={me} entrants={standings} />
                      {me && (
                        <p className="pk-results-me">
                          You got <b>{me.score ?? 0} of {questions.length}</b> right
                          {standings.filter((e) => !e.isBot).length === 1 ? <>. No one else paid in, so your entry comes back.</>
                            : me.prizeUsdc > 0 ? <> and won <b>{usd2.format(me.prizeUsdc)}</b>.</> : <>.</>}
                        </p>
                      )}
                    </div>
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
                    {picksMode ? <>{" "}Players who tie split the places they share.</>
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
                        <p className="claimed"><b>Withdrawn ✓</b> {usd2.format(myEscrow.entitlementUsdc ?? myEntitlement)} is back in your wallet.</p>
                      ) : (myEscrow?.entitlementUsdc ?? myEntitlement) > 0.0001 ? (
                        <>
                          <p><b>Your withdrawal:</b> {usd2.format(myEscrow?.entitlementUsdc ?? myEntitlement)}{picksMode ? " — your prize" : me.prizeUsdc > 0 ? ` — includes your ${usd2.format(me.prizeUsdc)} prize` : " — your share of the vault money"}</p>
                          <button
                            className="btn primary full"
                            onClick={() => doClaim(false)}
                            disabled={busy || !canClaim}
                            title={!wallet ? "Connect the wallet you played with" : ""}
                          >
                            {busy ? "Confirm in your wallet…" : `Withdraw ${usd2.format(myEscrow?.entitlementUsdc ?? myEntitlement)} to my wallet`}
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
                        <p>{picksMode ? "No prize this time — nothing to withdraw." : "Your vault finished at $0 — nothing to withdraw this time."}</p>
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
                  <button className="btn primary" onClick={() => { setInviteInfo(null); setHCall(""); if (picksMode) setHFormat("predictions"); setShowHost(true); }} disabled={busy}>Host the next rumble →</button>
                  <div className="final-board">
                    <div className="fb-row fb-head" aria-hidden="true">
                      <span className="fb-rank">#</span>
                      <span className="fb-name">Player</span>
                      <span className="fb-bank">{picksMode ? "Right" : "Final vault"}</span>
                      <span className="fb-prize">{round.escrow ? "Payout" : "Prize"}</span>
                    </div>
                    {standings.map((e, i) => (
                      <div key={e.id} className={`fb-row ${e.wallet === wallet ? "me" : ""}`}>
                        <span className="fb-rank">{picksMode ? scorePlace(round, e) : i + 1}</span>
                        <span className="fb-name">{displayName(e)}{e.isBot ? " ·bot" : ""}</span>
                        <span className="fb-bank">{picksMode ? `${e.score ?? 0}/${questions.length}` : usd2.format(e.bankroll)}</span>
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
            <h1>This arena didn&apos;t start</h1>
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
              <a className="btn primary" href="/?tab=host">Host a new arena</a>
              <a className="btn secondary" href="/">Browse arenas</a>
            </div>
          </div>
        ) : !round ? (
          <div className="enroll-cta" style={{ margin: "20px 0" }}>
            {!view ? (
              <p role="status">Loading the arena…</p>
            ) : isPublic ? (
              <p>Opening the walk-in arena…</p>
            ) : (
              <>
                <p>This arena has no live rumble right now. Host the next one on the same code, or head back to the public arena.</p>
                <div className="cta-row">
                  <button className="btn primary" onClick={() => { setInviteInfo(null); setHCall(""); setShowHost(true); }}>Host a rumble</button>
                  <button className="btn secondary" onClick={() => goToArena(PUBLIC_ARENA)}>Public arena →</button>
                </div>
              </>
            )}
          </div>
        ) : picksMode ? (
          <div className="cockpit">
            <div className="trade-col pk-col" id="picks">
              <div className="tc-head">
                <div>
                  <span className="cat">Predictions · {Math.round(round.config.liveSec / 60)} min</span>
                  <h2>
                    {round.status === "enrolling" ? "Five picks on BTC, ETH and SOL. Most right answers wins."
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
                    Picks stay hidden until the round starts, and the most right answers take the pool.
                  </p>
                  <ol className="pk-preview" aria-label="This round's questions">
                    {questions.map((q) => <li key={q.id}>{q.text}</li>)}
                  </ol>
                  <div className="cta-row">
                    <button className="btn primary" onClick={() => { if (!wallet) { connect(); return; } setSeatPicks({}); setShowEnroll(true); }} disabled={busy}>
                      {wallet ? "Make your picks" : "Connect to play"}
                    </button>
                    <button className="btn secondary" onClick={() => { setInviteInfo(null); setHCall(""); setHFormat("predictions"); setShowHost(true); }} disabled={busy}>Host your own</button>
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
                  <PicksEditor questions={questions} picks={myPicks} onPick={doPick} />
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
                    {me ? <>Right now you have <b>{me.score ?? 0} of {questions.length}</b>{scorePlace(round, me, true) <= paidPlaces(round) ? " — in the money" : ""}.</> : <>You&apos;re watching — enrollment has closed.</>}
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
                  <div><b className="up">{yesPrice}¢</b><span>▲ UP</span></div>
                  <div><b className="down">{100 - yesPrice}¢</b><span>▼ DOWN</span></div>
                </div>
              </div>

              {!enrolled ? (
                <div className="enroll-cta">
                  {round?.status === "enrolling" ? (
                    <>
                      <p>
                        Call where <b>{asset}</b> goes: <b className="up">UP</b> if you think it finishes the round higher than it opens, <b className="down">DOWN</b> if lower.
                        Your seat is <b>{usd.format(round.config.entryUsdc + round.config.startingBankroll)}</b> — <b>{usd.format(round.config.entryUsdc)}</b> into the shared prize pool plus a <b>{usd.format(round.config.startingBankroll)}</b> vault you trade with. At the end the players&apos; vault money is shared out by how each vault finished.
                      </p>
                      <div className="cta-row">
                        <button className="btn primary" onClick={() => { if (!wallet) { connect(); return; } setCallPick(""); setShowEnroll(true); }} disabled={busy}>
                          {wallet ? "Enter the arena" : "Connect to enter"}
                        </button>
                        <button className="btn secondary" onClick={() => { setInviteInfo(null); setHCall(""); setShowHost(true); }} disabled={busy}>Host your own</button>
                        {!isPublic && <button className="btn secondary" onClick={() => doCopyInvite()}>Copy invite link</button>}
                      </div>
                    </>
                  ) : (
                    <p>This round is <b>{STATUS_LABEL[round?.status ?? ""]?.toLowerCase()}</b>. Enrollment is closed — the next arena opens when this one settles.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="vault">
                    <div><span>Vault</span><b>{usd2.format(me!.bankroll)}</b></div>
                    <div><span>Cash</span><b>{usd2.format(me!.cash)}</b></div>
                    <div><span>Position</span><b>{me!.side ? `${me!.shares.toFixed(1)} ${me!.side === "YES" ? "UP" : "DOWN"} @ ${me!.avgPrice.toFixed(0)}¢` : "—"}</b></div>
                    <div><span>Parlays</span><b>{openParlays.length ? `${openParlays.length} · pays ${usd.format(openParlayPotential)}` : "—"}</b></div>
                    <div className={myPnl >= 0 ? "up" : "down"}><span>Vault P&amp;L</span><b>{myPnl >= 0 ? "+" : ""}{usd2.format(myPnl)}</b></div>
                  </div>

                  {openParlays.length > 0 && (
                    <div className="parlay-list">
                      <div className="parlay-list-head">Open parlays · early cashout</div>
                      {openParlays.map((t) => (
                        <div className="parlay-row" key={t.id}>
                          <div className="pr-lead">
                            <span className="pr-legs">{t.legs.length}-leg</span>
                            <span className="pr-mid">
                              {t.legs.map((l) => `${l.asset} ${l.side}`).join(" · ")}
                            </span>
                            <span className="pr-payout">pays {usd.format(t.potentialPayout)}</span>
                          </div>
                          <div className="pr-tail">
                            <span className="pr-stake">stake {usd2.format(t.stake)}</span>
                            <button
                              className="btn secondary sm"
                              disabled={!tradeOpen}
                              onClick={() => setCashoutTicket(t)}
                            >
                              Cash out →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {round?.status === "live" && !tradeOpen ? (
                    <div className="enroll-cta locked-note" role="status">
                      <p><b>Last call has passed.</b> Positions are locked for the final {TRADE_CUTOFF_MS / 1000} seconds — the round settles in <b className="mono">{fmtClock(Math.max(0, round.liveDeadline - now))}</b>.</p>
                    </div>
                  ) : round?.status === "live" ? (
                    <>
                      <p className="last-call">
                        Trading closes in <b className="mono">{fmtClock(Math.max(0, round.liveDeadline - TRADE_CUTOFF_MS - now))}</b> — last call is {TRADE_CUTOFF_MS / 1000}s before the end.
                        Each trade buys {TRADE_SPREAD}¢ above and sells {TRADE_SPREAD}¢ below the market price.
                      </p>
                      <div className="bet-mode">
                        <button className={betMode === "single" ? "bm on" : "bm"} onClick={() => setBetMode("single")}>Single trade</button>
                        <button className={betMode === "parlay" ? "bm on" : "bm"} onClick={() => setBetMode("parlay")}>Parlay</button>
                      </div>

                      {betMode === "single" ? (
                        <>
                          {openPrice ? (
                            <p className="trade-rule">
                              <b className="up">UP</b> pays $1 a share if {asset} closes above <b>{usdPx(openPrice)}</b>; <b className="down">DOWN</b> pays $1 if it closes below. Prices move with {asset}.
                            </p>
                          ) : null}
                          <div className="sides">
                            <button className={side === "YES" ? "side yes on" : "side yes"} onClick={() => setSide("YES")} aria-pressed={side === "YES"}>▲ UP <b>{yesPrice}¢</b></button>
                            <button className={side === "NO" ? "side no on" : "side no"} onClick={() => setSide("NO")} aria-pressed={side === "NO"}>▼ DOWN <b>{100 - yesPrice}¢</b></button>
                          </div>
                          {(() => {
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
                                    <em>{usd2.format(avail)} available{switching ? ` — sells your ${me!.side === "YES" ? "UP" : "DOWN"} first` : ""}</em>
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
                                    {switching ? `Switch to ${side === "YES" ? "UP" : "DOWN"}` : `Buy ${side === "YES" ? "UP" : "DOWN"}`}
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
                                {!wallet ? "connect a wallet"
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
                        <div className="parlay-build">
                          <p className="pb-hint">Stack BTC, ETH and SOL up-or-down calls into one bet — every leg must land, over this round. The three usually move together, so legs in the same direction pay modestly, and legs that split (say BTC UP + ETH DOWN) pay far more.</p>
                          <div className="pb-board">
                            {parlayBoard.map((m) => {
                              const sel = parlayLegs.find((l) => l.marketId === m.id);
                              const up = livePrices[m.id] ?? 50;
                              return (
                                <div className="pb-mkt" key={m.id}>
                                  <div className="pb-mkt-q"><b>{m.asset}</b> up by the end of the round?</div>
                                  <div className="pb-mkt-sides">
                                    <button className={sel?.side === "YES" ? "pb-side up on" : "pb-side up"} onClick={() => toggleLeg(m.id, "YES")}>UP {up}¢</button>
                                    <button className={sel?.side === "NO" ? "pb-side down on" : "pb-side down"} onClick={() => toggleLeg(m.id, "NO")}>DOWN {100 - up}¢</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {(() => {
                            const cash = me!.cash;
                            const stake = Number(parlayStake || 0);
                            const over = stake > cash + 1e-9;
                            const ready = parlayLegs.length >= 2;
                            const mySide = me!.side ? (me!.side === "YES" ? yesPrice : 100 - yesPrice) : 0;
                            return (
                              <>
                                <label className="field">
                                  <span className="field-head">
                                    Stake from your vault cash (USDC)
                                    <em>{usd2.format(cash)} available</em>
                                  </span>
                                  <div className={`field-input ${over ? "bad" : ""}`}>
                                    <span className="curr">$</span>
                                    <input value={parlayStake} placeholder={cash > 0 ? cash.toFixed(2) : "0.00"} onChange={(e) => setParlayStake(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-invalid={over} />
                                    <button type="button" className="max" onClick={() => setParlayStake(String(Math.floor(cash * 100) / 100))}>MAX</button>
                                  </div>
                                </label>
                                {cash < 0.01 && me!.side && me!.shares > 0 && (
                                  <p className="pb-cash-note">
                                    Your vault is all in your {me!.side === "YES" ? "UP" : "DOWN"} position.{" "}
                                    <button type="button" className="link-btn" onClick={doSell} disabled={busy}>
                                      Sell it for {usd2.format(me!.shares * (sellPriceOf(mySide) / 100))} to free cash
                                    </button>
                                  </p>
                                )}
                                <div className="summary">
                                  <span>Legs</span><b>{parlayLegs.length}</b>
                                  <span>Chance all land</span><b>{ready ? `${parlayQuote.combinedPrice.toFixed(1)}%` : "—"}</b>
                                  <span>Pays</span><b>{ready ? `${parlayQuote.impliedOdds.toFixed(2)}× your stake` : "—"}</b>
                                  <span>Variance fee</span><b>{ready ? usd2.format(parlayQuote.feeUsdc) : "—"}</b>
                                  <span>Pays if all land</span><b className="accent">{ready ? usd2.format(parlayQuote.potentialPayoutUsdc) : "—"}</b>
                                  <span>If one leg voids</span><b>{ready ? usd2.format(parlayQuote.halfPayoutIfOneVoidUsdc) : "—"}</b>
                                </div>
                                {over && <p className="jc-error" role="alert">That&apos;s more than the {usd2.format(cash)} cash in your vault.</p>}
                                <button className="btn primary full" onClick={doPlaceParlay} disabled={busy || !ready || !stake || over}>
                                  {!ready ? "Pick at least 2 legs" : !stake ? "Enter a stake" : `Place ${parlayLegs.length}-leg parlay`}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="enroll-cta my-call">
                      <p><b>You&apos;re in.</b> Trading opens when enrollment locks{deadline > 0 ? <> in <b className="mono">{fmtClock(timeLeft)}</b></> : null}.</p>
                      <div className="call-row" role="group" aria-label="Your opening call">
                        <span className="call-k">Opening call</span>
                        <div className="seg">
                          <button className={me!.openingCall === "YES" ? "seg-opt on up" : "seg-opt"} onClick={() => doChangeCall("YES")} disabled={busy} aria-pressed={me!.openingCall === "YES"}>▲ UP</button>
                          <button className={me!.openingCall === "NO" ? "seg-opt on down" : "seg-opt"} onClick={() => doChangeCall("NO")} disabled={busy} aria-pressed={me!.openingCall === "NO"}>▼ DOWN</button>
                          <button className={!me!.openingCall ? "seg-opt on" : "seg-opt"} onClick={() => doChangeCall(null)} disabled={busy} aria-pressed={!me!.openingCall}>Decide later</button>
                        </div>
                      </div>
                      {me!.openingCall && (
                        <CallSizePicker value={me!.openingCallPct ?? 100} onChange={(p) => doChangeCall(me!.openingCall ?? null, p)} vault={me!.cash} disabled={busy} />
                      )}
                      <p className="call-note">
                        {me!.openingCall
                          ? <>{callSizeText(me!.openingCallPct ?? 100, me!.cash).stake.replace(/^./, (c) => c.toUpperCase())} goes on <b className={me!.openingCall === "YES" ? "up" : "down"}>{me!.openingCall === "YES" ? "UP" : "DOWN"}</b> at the opening price (50¢ a share) the moment trading opens. {callSizeText(me!.openingCallPct ?? 100, me!.cash).rest} You can switch or sell any time while the round is live.</>
                          : <>No call yet — your vault stays in cash until you trade. You&apos;ll get UP and DOWN buttons the moment the round goes live.</>}
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
        <h2>How the arena works</h2>
        {picksMode ? (
        <div className="how-grid">
          <div><b>1 · One seat, one entry</b><p>Everyone pays the same entry into the prize pool. There&apos;s no vault and nothing to trade.</p></div>
          <div><b>2 · Five picks</b><p>BTC, ETH and SOL: each up or down, which does best (biggest % gain or smallest drop), and one head-to-head.</p></div>
          <div><b>3 · Hidden until the start</b><p>Nobody sees your picks while enrollment is open. You can change them until the round locks — then everyone&apos;s picks are revealed.</p></div>
          <div><b>4 · The prices decide</b><p>Each coin is judged against its live price at the lock. At the close every right answer is a point; a dead-level result scores for nobody.</p></div>
          <div><b>5 · Most right answers wins</b><p>The top scores take the pool — 62.5% / 23.4% / 14.1%, or all of it in a duel. Players who tie split the places they share.</p></div>
          <div><b>6 · Withdraw</b><p>Winners withdraw their prize from the arena or the Positions page once the results are recorded on chain.</p></div>
        </div>
        ) : (
        <div className="how-grid">
          <div><b>1 · Host chooses the game</b><p>Any user opens their own arena — pick BTC, ETH or SOL, the player limit, the entry, the starting vault, and one to four rounds. You get a shareable link.</p></div>
          <div><b>2 · Invite friends</b><p>Send the arena link. Anyone with the link takes a seat in your room — everyone else plays a different arena on the same site.</p></div>
          <div><b>3 · Entry and vault separate</b><p>Your entry joins the shared prize pool. Your vault is your trading bankroll for the round.</p></div>
          <div><b>4 · Call UP or DOWN</b><p>Pick a direction when you sit down, or trade once the round opens. The round opens at the asset&apos;s live price: UP pays $1 a share if it closes higher, DOWN if lower.</p></div>
          <div><b>5 · The price decides</b><p>At the deadline the live price settles every position and players are ranked by vault value. In a royale the bottom half is cut and survivors carry their bankroll on.</p></div>
          <div><b>6 · Everyone withdraws</b><p>Top finishers share the pool — 62.5% / 23.4% / 14.1%, or all of it in a duel. The players&apos; vault money is shared by how each vault finished, so losses fund gains. Withdraw from the arena or your Positions page.</p></div>
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

      {cashoutTicket && wallet && (
        <PantaCashOutModal
          ticket={cashoutTicket}
          wallet={wallet}
          arena={arenaCode}
          onClose={() => setCashoutTicket(null)}
          onSuccess={async (net) => {
            setToast(`Cashed out for ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(net)}.`);
            await refresh();
          }}
        />
      )}

      {showUsername && (
        <UsernameModal
          initial={username}
          onSave={(v) => { const r = saveUsername(v); if (r.ok) setToast(r.message); return r; }}
          onClose={() => setShowUsername(false)}
        />
      )}

      {showEnroll && round && (() => {
        const v = validateUsername(nickname);
        const clash = v.ok && !isUsernameFreeInArena(v.value, round.entrants, wallet ?? undefined);
        const ok = v.ok && !clash;
        const hint = nickname.length === 0
          ? "3–16 characters: letters, numbers and underscores."
          : !v.ok ? v.reason
          : clash ? `"${v.value}" is already taken in this arena.`
          : "Available — shown on the arena stage, standings and results.";
        const seat = seatCostUsdc(round.config);
        const vault = round.config.startingBankroll;
        const liveMin = Math.round(round.config.liveSec / 60);
        const rounds = round.config.format === "royale" ? round.config.roundLimit : 1;
        const cta = callPick === "YES" ? "call UP" : callPick === "NO" ? "call DOWN" : "join";
        const seatPicked = pickCount(questions, seatPicks);
        const ready = picksMode ? seatPicked >= questions.length : !!callPick;
        return (
          <div className="modal-backdrop" onClick={() => { if (!busy) setShowEnroll(false); }}>
            <div className="modal seat-modal" role="dialog" aria-modal="true" aria-labelledby="seat-title" onClick={(e) => e.stopPropagation()}>
              <button className="close" onClick={() => setShowEnroll(false)} aria-label="Close">×</button>
              <h2 id="seat-title">Take your seat</h2>
              <p className="sub">Arena <b>{arenaCode}</b> · {round.config.marketQuestion}</p>

              <form onSubmit={(e) => { e.preventDefault(); if (ok && ready && !busy && wallet) doEnroll(); }}>
                {picksMode ? (
                  <fieldset className="call-pick">
                    <legend>Your picks · hidden from everyone until the round starts</legend>
                    <PicksEditor questions={questions} picks={seatPicks} onPick={(q, o) => setSeatPicks((p) => ({ ...p, [q]: o }))} disabled={busy} compact />
                    <p className="call-explain" role="status">
                      Each coin is judged against its price when picks lock. &ldquo;Best&rdquo; means the biggest % gain (or smallest drop). You can change picks until the round starts.
                    </p>
                  </fieldset>
                ) : (
                <fieldset className="call-pick">
                  <legend>Your call on {asset}{spot ? <> · now <b>{usdPx(spot)}</b></> : null}</legend>
                  <div className="call-options">
                    <button type="button" className={`call-opt up ${callPick === "YES" ? "on" : ""}`} onClick={() => setCallPick("YES")} aria-pressed={callPick === "YES"}>
                      <span className="co-arrow" aria-hidden="true">▲</span>
                      <span className="co-t">UP</span>
                      <span className="co-d">{asset} finishes the round higher than it opens</span>
                    </button>
                    <button type="button" className={`call-opt down ${callPick === "NO" ? "on" : ""}`} onClick={() => setCallPick("NO")} aria-pressed={callPick === "NO"}>
                      <span className="co-arrow" aria-hidden="true">▼</span>
                      <span className="co-t">DOWN</span>
                      <span className="co-d">{asset} finishes the round lower than it opens</span>
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
                      ? <>When enrollment locks, {callSizeText(callPct, vault).stake} buys <b className={callPick === "YES" ? "up" : "down"}>{callPick === "YES" ? "UP" : "DOWN"}</b> at the opening price — 50¢ a share, each paying $1 if you&apos;re right. {callSizeText(callPct, vault).rest} You can switch sides or sell any time during the round, and change this call until it starts.</>
                      : callPick === "LATER"
                        ? <>Your {usd2.format(vault)} vault stays in cash. Once the round is live you pick UP or DOWN, and how much, yourself.</>
                        : <>Pick the direction you think {asset} moves. Nothing is placed until trading opens.</>}
                  </p>
                </fieldset>
                )}

                <ol className="seat-steps" aria-label="How this round plays">
                  <li><b>Enrollment</b> {round.status === "enrolling" && deadline > 0 && standings.some((e) => !e.isBot) ? <>closes in <span className="mono">{fmtClock(timeLeft)}</span></> : isPublic ? `runs ${round.config.enrollmentSec}s from the first seat` : "open"}</li>
                  {picksMode
                    ? <li><b>{liveMin} min</b> on the live BTC, ETH and SOL prices — no trading</li>
                    : <li><b>{liveMin} min</b> of trading on the live {asset} price{rounds > 1 ? `, ${rounds} rounds` : ""}</li>}
                  {picksMode
                    ? <li><b>Most right answers</b> take the pool · ties split their places</li>
                    : <li><b>Top finishers</b> split the pool · everyone is paid out after the round</li>}
                </ol>

                <dl className="seat-breakdown">
                  <div><dt>Entry → shared prize pool</dt><dd>{usd2.format(round.config.entryUsdc)}</dd></div>
                  {!picksMode && <div><dt>Vault → your trading bankroll</dt><dd>{usd2.format(vault)}</dd></div>}
                  <div className="total">
                    <dt>{round.escrow ? "Total deposit" : "Practice seat"}</dt>
                    <dd>{round.escrow ? `${usd2.format(seat)} USDC` : "free — no USDC moves"}</dd>
                  </div>
                </dl>

                <label>
                  Username
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="e.g. nova_9"
                    maxLength={USERNAME_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={nickname.length > 0 && !ok}
                    aria-describedby="seat-hint"
                  />
                </label>
                <p id="seat-hint" className={`username-hint ${nickname.length === 0 ? "" : ok ? "ok" : "bad"}`} role="status">{hint}</p>
                <button type="submit" className="btn primary full" disabled={busy || !ok || !wallet || !ready} style={{ marginTop: 10 }}>
                  {busy ? (seatStep ? seatStepText(seatStep, seat, callPick === "YES" || callPick === "NO" ? callPick : null).button : "Checking your wallet…")
                    : !wallet ? "Connect a wallet first"
                    : picksMode && !ready ? `Answer all ${questions.length} questions · ${seatPicked}/${questions.length}`
                    : picksMode ? (round.escrow ? `Deposit ${usd2.format(seat)} & lock in my picks` : "Take a practice seat")
                    : !callPick ? "Pick UP, DOWN or decide later"
                    : round.escrow ? `Deposit ${usd2.format(seat)} & ${cta}` : `Take a practice seat & ${cta}`}
                </button>
              </form>
              <p className="disclaimer" style={{ marginTop: 12 }}>
                {round.escrow && picksMode
                  ? <>Held in a non-custodial escrow program on Solana {CLUSTER}. After settlement, winners withdraw their prize to this wallet.</>
                  : round.escrow
                  ? <>Held in a non-custodial escrow program on Solana {CLUSTER}. After settlement you withdraw your payout: any prize plus your share of the vault money.</>
                  : <>Practice arena — no USDC moves and nothing is deposited.</>}
              </p>
            </div>
          </div>
        );
      })()}

      {showHost && (
        <div className="modal-backdrop" onClick={() => { if (!busy) closeHostModal(); }}>
          <div className="modal host-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={closeHostModal} aria-label="Close">×</button>

            {inviteInfo ? (
              // ── SHARE INVITE SCREEN (after successful host) ──────────
              <>
                <h2>Your arena is live</h2>
                <p className="sub">Send this link to your friends. Anyone with it takes a seat in your rumble.</p>

                <div className="invite-box">
                  <div className="invite-code">{inviteInfo.code}</div>
                  <div className="invite-url">
                    <input readOnly value={inviteInfo.url} onFocus={(e) => e.currentTarget.select()} />
                    <button className="btn secondary sm" onClick={() => doCopyInvite(inviteInfo.url)}>Copy</button>
                  </div>
                  <div className="invite-share">
                    <a className="btn secondary sm" target="_blank" rel="noopener noreferrer"
                       href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>
                      Share on X
                    </a>
                    <a className="btn secondary sm" target="_blank" rel="noopener noreferrer"
                       href={`https://t.me/share/url?url=${encodeURIComponent(inviteInfo.url)}&text=${encodeURIComponent("Join my Oracle Rumble arena")}`}>
                      Telegram
                    </a>
                    <a className="btn secondary sm" target="_blank" rel="noopener noreferrer"
                       href={`https://wa.me/?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>
                      WhatsApp
                    </a>
                  </div>
                </div>

                <button className="btn primary full" onClick={() => goToArena(inviteInfo.code)} style={{ marginTop: 12 }}>
                  {hostPicks ? `Make my picks in ${inviteInfo.code} →` : `Go to arena ${inviteInfo.code} →`}
                </button>
                <p className="disclaimer" style={{ marginTop: 10 }}>
                  {hostPicks
                    ? "Next: open the arena and make your five picks — they lock when enrollment closes."
                    : "Enrollment is open now. Your game starts the moment the timer locks, with whoever joined."}
                </p>
              </>
            ) : (
              // ── CONFIGURE ROOM SCREEN ────────────────────────────────
              <>
                <h2>Host a rumble</h2>
                <p className="sub">You set the terms and get a shareable link. Every player funds the same seat — you can&apos;t hand anyone a bigger vault.</p>

                <div className="host-field">
                  <span className="host-label">Game</span>
                  <div className="seg">
                    <button className={hFormat === "single" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("single")}>Single round</button>
                    <button className={hFormat === "royale" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("royale")}>Royale</button>
                    <button className={hFormat === "predictions" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("predictions")}>Predictions</button>
                  </div>
                </div>
                {hostPicks && (
                  <p className="host-call-help" role="status">
                    No trading: everyone answers five questions on BTC, ETH and SOL (up or down, which does best, a head-to-head). Most right answers take the pool. You make your picks in the arena after it opens.
                  </p>
                )}

                {!hostPicks && (<>
                <div className="host-field">
                  <span className="host-label">Your call</span>
                  <div className="seg call-seg" role="radiogroup" aria-label="Your opening call">
                    <button role="radio" aria-checked={hCall === "YES"} className={hCall === "YES" ? "seg-opt on up" : "seg-opt"} onClick={() => setHCall("YES")}>▲ UP</button>
                    <button role="radio" aria-checked={hCall === "NO"} className={hCall === "NO" ? "seg-opt on down" : "seg-opt"} onClick={() => setHCall("NO")}>▼ DOWN</button>
                    <button role="radio" aria-checked={hCall === "LATER"} className={hCall === "LATER" ? "seg-opt on" : "seg-opt"} onClick={() => setHCall("LATER")}>Decide later</button>
                  </div>
                </div>
                {(hCall === "YES" || hCall === "NO") && (
                  <CallSizePicker value={hCallPct} onChange={setHCallPct} vault={Number(hVault) || 0} disabled={busy} />
                )}
                <p className={`host-call-help ${hCall ? "" : "need"}`} role="status">
                  {!hCall
                    ? `You take seat 1. UP = ${hAsset} finishes the round above its opening price, DOWN = below.`
                    : hCall === "LATER"
                      ? "Your vault stays in cash until you trade once the round is live."
                      : `${callSizeText(hCallPct, Number(hVault) || 0).stake.replace(/^./, (c) => c.toUpperCase())} goes on ${hCall === "YES" ? "UP" : "DOWN"} at the opening price when trading starts. ${callSizeText(hCallPct, Number(hVault) || 0).rest ?? ""}`}
                </p>

                <div className="host-field">
                  <span className="host-label">Asset</span>
                  <div className="seg">
                    {(["BTC", "ETH", "SOL"] as const).map((a) => (
                      <button key={a} className={hAsset === a ? "seg-opt on" : "seg-opt"} onClick={() => setHAsset(a)}>{a}</button>
                    ))}
                  </div>
                </div>
                </>)}

                <div className="host-field">
                  <span className="host-label">Timeframe</span>
                  <div className="seg">
                    {(["MIN5", "MIN15", "HOUR"] as const).map((h) => (
                      <button key={h} className={hHorizon === h ? "seg-opt on" : "seg-opt"} onClick={() => setHHorizon(h)}>
                        {h === "MIN5" ? "5m" : h === "MIN15" ? "15m" : h === "HOUR" ? "1h" : "1d"}
                      </button>
                    ))}
                  </div>
                </div>

                {hFormat === "royale" && (
                  <div className="host-field">
                    <span className="host-label">Rounds</span>
                    <div className="seg">
                      {[2, 3, 4].map((n) => (
                        <button key={n} className={hRounds === n ? "seg-opt on" : "seg-opt"} onClick={() => setHRounds(n)}>{n}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="host-field">
                  <span className="host-label">Player limit</span>
                  <div className="seg">
                    {[2, 4, 8, 12, 16].map((n) => (
                      <button key={n} className={hCapacity === n ? "seg-opt on" : "seg-opt"} onClick={() => setHCapacity(n)}>{n}</button>
                    ))}
                  </div>
                </div>

                <div className="host-2col">
                  <label className="host-num">
                    Entry (USDC)
                    <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" />
                    <em>→ shared pool · $1–100</em>
                  </label>
                  {!hostPicks && (
                    <label className="host-num">
                      Starting vault (USDC)
                      <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" />
                      <em>→ each player trades · $5–500</em>
                    </label>
                  )}
                </div>

                <div className="host-summary">
                  <div><span>Seat per player</span><b>{usd2.format(hostSeat)}</b></div>
                  <div><span>Pool if full</span><b className="accent">{usd2.format((Number(hEntry) || 0) * hCapacity)}</b></div>
                  <div><span>Format</span><b>{hostPicks ? "5 picks · 1 round" : hFormat === "single" ? "1 round" : `${hRounds} rounds · cut`}</b></div>
                </div>

                {hostError && <p className="jc-error" role="alert">{hostError}</p>}
                <button className="btn primary full" onClick={doHost} disabled={busy || !!hostError || (!!wallet && !hCall && !hostPicks)} style={{ marginTop: 12 }}>
                  {busy ? (seatStep ? seatStepText(seatStep, hostSeat).button : "Opening…")
                    : !wallet ? (hostPicks ? "Open practice predictions" : `Open ${hAsset} practice rumble`)
                    : hostPicks ? `Deposit ${usd2.format(hostSeat)} & take seat 1 · get invite link`
                    : !hCall ? `Pick UP or DOWN on ${hAsset}`
                    : `Deposit ${usd2.format(hostSeat)} & ${hCall === "YES" ? "call UP" : hCall === "NO" ? "call DOWN" : "open"} · get invite link`}
                </button>
                <p className="disclaimer" style={{ marginTop: 10 }}>
                  A new arena code is minted for your room. You&apos;ll get a shareable link on the next screen.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/** "nova wins $3.75 with 4/5" or "nova and kai tie on 4/5". */
function predictionsHeadline(standings: Entrant[], total: number): string {
  const humans = standings.filter((e) => !e.isBot);
  const best = humans[0];
  if (!best) return "Predictions complete";
  if (humans.length === 1) return `${displayName(best)} scored ${best.score ?? 0}/${total} — entry returned`;
  const top = humans.filter((e) => (e.score ?? 0) === (best.score ?? 0));
  if (top.length === 1) return `${displayName(best)} wins ${usd2.format(best.prizeUsdc)} with ${best.score ?? 0}/${total}`;
  if (top.length === 2) return `${displayName(top[0])} and ${displayName(top[1])} tie on ${best.score ?? 0}/${total}`;
  return `${top.length} players tie on ${best.score ?? 0}/${total}`;
}

/** Plain-language reason from the round's last cancellation event. */
function cancelReason(history: string[]): string {
  const line = [...history].reverse().find((h) => /cancelled/i.test(h)) ?? "";
  if (/no players/i.test(line)) return "No seat was confirmed before enrollment closed, so the round never started.";
  if (/host deposit/i.test(line)) return "The host's seat deposit wasn't approved, so the arena was closed before anyone could join.";
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
        <p><b>Deposited into this arena?</b> Connect that wallet to get your refund.</p>
        <button className="btn primary full" onClick={onConnect}>Connect wallet</button>
      </div>
    );
  }
  if (!state) return <div className="refund-card"><p>Checking your deposit…</p></div>;
  if (!state.deposited) {
    return <div className="refund-card muted"><p>This wallet has no deposit in this arena — nothing to refund.</p></div>;
  }
  if (state.claimed) {
    return (
      <div className="refund-card done">
        <p><b>Refund complete.</b> {money(state.entitlementUsdc || state.seatUsdc)} was returned to your wallet.</p>
      </div>
    );
  }
  if (state.settled && state.claimsOpen) {
    return (
      <div className="refund-card ready">
        <p><b>Your {money(state.seatUsdc)} deposit is ready to refund.</b> Nothing was lost — claim it back to your wallet.</p>
        <button className="btn primary full" onClick={onClaim} disabled={busy}>
          {busy ? "Confirm in your wallet…" : `Claim ${money(state.entitlementUsdc || state.seatUsdc)} refund`}
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
          : "A full refund is being prepared and opens within about two minutes of the arena closing. This page updates automatically."}
      </p>
      {canRecover && (
        <button className="btn secondary full" onClick={onRecover} disabled={busy}>Recover deposit directly</button>
      )}
    </div>
  );
}
