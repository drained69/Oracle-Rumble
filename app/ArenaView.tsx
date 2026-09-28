"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRound, enrollWithEscrow, tradeRound, newRound, placeParlayApi, claimFromEscrow, serverSettleArena, cancelArena, checkSeatFunds, type RoundView } from "@/lib/round-client";
import { useEscrowStatus, useWalletIdentity } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import UsernameModal from "@/app/UsernameModal";
import type { Entrant, Round, ParlayTicket } from "@/lib/royale";
import { PUBLIC_ARENA } from "@/lib/royale";
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
import PantaCreateMarketModal from "@/app/PantaCreateMarketModal";
import PantaCashOutModal from "@/app/PantaCashOutModal";
import { executePantaOrder, type LifecycleUpdate } from "@/lib/panta-order";
import { looksLikePantaMarketId } from "@/lib/tracked-markets";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

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
  const isPublic = arenaCode === PUBLIC_ARENA;
  const { wallet, username, toggleConnect, saveUsername } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [showUsername, setShowUsername] = useState(false);
  const [nickname, setNickname] = useState("");
  const [view, setView] = useState<RoundView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [amount, setAmount] = useState("100");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [betMode, setBetMode] = useState<"single" | "parlay">("single");
  const [parlayLegs, setParlayLegs] = useState<{ marketId: string; side: "YES" | "NO" }[]>([]);
  const [parlayStake, setParlayStake] = useState("5");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showEnroll, setShowEnroll] = useState(false);
  const [showHost, setShowHost] = useState(false);
  const [hAsset, setHAsset] = useState<"BTC" | "ETH" | "SOL">("SOL");
  const [hHorizon, setHHorizon] = useState<"MIN5" | "MIN15" | "HOUR" | "DAY">("MIN5");
  const [hFormat, setHFormat] = useState<"single" | "royale">("royale");
  const [hRounds, setHRounds] = useState(3);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  // When a host call succeeds we mint a fresh arena code; this state drives
  // the "share your invite link" screen inside the host modal.
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);
  // Real Panta order lifecycle — opt-in, disabled when market is a
  // synthetic direction-board id or no wallet is connected. When on,
  // `doBuy` also drives quote → build → sign → submit → verify → report
  // through Panta's own APIs and streams progress here.
  const [pantaFillOn, setPantaFillOn] = useState(false);
  const [pantaOrder, setPantaOrder] = useState<LifecycleUpdate | null>(null);
  const [showCreateMarket, setShowCreateMarket] = useState(false);
  const [cashoutTicket, setCashoutTicket] = useState<ParlayTicket | null>(null);
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
    try { setView(await getRound(arenaCode)); } catch { /* transient */ }
  }, [arenaCode]);

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

  const me = useMemo(() => (wallet ? standings.find((e) => e.wallet === wallet) ?? null : null), [standings, wallet]);
  const enrolled = !!me;
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

    setBusy(true);
    try {
      // Persist the username first so it survives a cancelled wallet prompt.
      saveUsername(nick);

      // enrollWithEscrow: if arena is on-chain, wallet signs a Deposit tx
      // (real USDC on devnet) before the ledger enrolls. Ledger-only arenas
      // fall through immediately. Signing UI is provided by the wallet.
      setToast("Signing seat deposit…");
      const r = await enrollWithEscrow(wallet, nick, arenaCode);
      if (r.error) setToast(r.error);
      else {
        setToast(r.escrowSignature
          ? `Sat down at ${arenaCode} as ${nick} · deposit ${r.escrowSignature.slice(0, 8)}…`
          : `Entered arena ${arenaCode} as ${nick}.`);
        setShowEnroll(false);
        await refresh();
      }
    } finally { setBusy(false); }
  }, [wallet, nickname, arenaCode, refresh, round, saveUsername]);

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
  useEffect(() => {
    if (!hasVault || vaultSettled) return;
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
  }, [roundId, roundStatus, hasVault, vaultSettled, arenaCode, refresh]);

  // This wallet's on-chain position in the arena — drives the refund card,
  // including deposits that landed after the round closed.
  type MyEscrow = { deposited: boolean; seatUsdc?: number; settled?: boolean; claimed?: boolean; entitlementUsdc?: number; claimsOpen?: boolean; recoverAt?: number | null };
  const [myEscrow, setMyEscrow] = useState<MyEscrow | null>(null);
  const loadMyEscrow = useCallback(async () => {
    if (!wallet || !hasVault) { setMyEscrow(null); return; }
    try {
      const r = await fetch(`/api/escrow/entry?arena=${encodeURIComponent(arenaCode)}&wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" }).then((x) => x.json());
      setMyEscrow(r);
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
      const r = await claimFromEscrow(wallet, arenaCode, recover);
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
      const r = await tradeRound({ wallet, action: "buy", side, usdc: v, arena: arenaCode });
      if (r.error) setToast(r.error);
      else {
        setToast(`Bought ${side} $${v.toFixed(0)}.`);
        await refresh();
      }
      // Don't block the UI on the Panta lifecycle — it streams via
      // setPantaOrder. We do await it so `busy` clears only after both
      // paths settle when the toggle was on.
      if (pantaLifecycle) await pantaLifecycle;
    } finally { setBusy(false); }
  }, [wallet, enrolled, amount, side, arenaCode, refresh, pantaFillOn, pantaFillAvailable, marketId]);

  const doSell = useCallback(async () => {
    if (!wallet || !enrolled) return;
    setBusy(true);
    try {
      const r = await tradeRound({ wallet, action: "sell", arena: arenaCode });
      if (r.error) setToast(r.error);
      else { setToast("Position liquidated."); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, arenaCode, refresh]);

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
      return { marketId: l.marketId, side: l.side, question: m.question, price: l.side === "YES" ? m.yesPrice : 100 - m.yesPrice, correlationGroup: m.correlationGroup };
    });
    return quoteParlay(legs, Number(parlayStake) || 0);
  }, [parlayLegs, parlayStake]);

  const doPlaceParlay = useCallback(async () => {
    if (!wallet || !enrolled) return setToast("Enroll in the round first.");
    if (parlayLegs.length < 2) return setToast("Add at least 2 legs.");
    const v = Number(parlayStake);
    if (!v || v <= 0) return setToast("Enter a stake.");
    setBusy(true);
    try {
      const r = await placeParlayApi(wallet, parlayLegs, v, arenaCode);
      if (r.error) setToast(r.error);
      else {
        setToast(`Parlay placed · ${parlayLegs.length} legs.`);
        // Parlays are a client-space bundle over N Panta single-market
        // orders. Firing the full lifecycle per leg is scoped for a
        // follow-up; today the parlay stakes are drawn from the round
        // vault (game state), not from real on-chain USDC, so we don't
        // synthesize attribution here — a mock signature would be
        // rejected by Panta in live mode and would only inflate the
        // demo-mode counter dishonestly.
        setParlayLegs([]);
        await refresh();
      }
    } finally { setBusy(false); }
  }, [wallet, enrolled, parlayLegs, parlayStake, arenaCode, refresh]);

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

    setBusy(true);
    try {
      // Check funds before the operator pays for an on-chain InitRound.
      if (wallet && escrow?.active) {
        const short = await checkSeatFunds(wallet, (Number(hEntry) || 1) + (Number(hVault) || 5));
        if (short) { setToast(short); return; }
      }
      const v = await newRound({
        asset: hAsset,
        horizon: hHorizon,
        format: hFormat,
        entryUsdc: Number(hEntry) || 1,
        startingBankroll: Number(hVault) || 5,
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
      if (escrow?.active) setToast("Approve the seat deposit in your wallet…");
      let enrollError = "";
      let refundable = false;
      try {
        const r = await enrollWithEscrow(wallet, nick, v.arena);
        if (r.error) { enrollError = r.error; refundable = !!r.refundable; }
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
    } finally { setBusy(false); }
  }, [hAsset, hHorizon, hFormat, hEntry, hVault, hCapacity, hRounds, wallet, escrow, username]);

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

  const hostSeat = (Number(hEntry) || 0) + (Number(hVault) || 0);

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
            <div className="rb-cell">
              <span className="rb-k">Round</span>
              <span className="rb-v">{round.roundNumber} <em>/ {round.config.roundLimit}</em></span>
            </div>
            <div className="rb-cell">
              <span className="rb-k">Status</span>
              <span className={`rb-v status ${round.status}`}>{STATUS_LABEL[round.status]}</span>
            </div>
            {deadline > 0 && (
              <div className="rb-cell">
                <span className="rb-k">{round.status === "enrolling" ? "Locks in" : "Settles in"}</span>
                <span className="rb-v mono">{fmtClock(timeLeft)}</span>
              </div>
            )}
            <div className="rb-cell">
              <span className="rb-k">Prize pool</span>
              <span className="rb-v accent">{usd.format(round.prizePoolUsdc)}</span>
            </div>
            <div className="rb-cell">
              <span className="rb-k">Alive</span>
              <span className="rb-v">{aliveCount} <em>/ {standings.length}</em></span>
            </div>
            {round.status === "live" && aliveCount > cut && (
              <div className="rb-cell">
                <span className="rb-k">Survive</span>
                <span className="rb-v danger">Top {cut}</span>
              </div>
            )}
            <div className="rb-cell grow">
              <span className="rb-k">Market · {round.config.asset}</span>
              <span className="rb-v market">{round.config.marketQuestion}</span>
            </div>
            <div className="rb-cell">
              <span className="rb-k">YES / NO</span>
              <span className="rb-v"><span className="yes">{yesPrice}¢</span> <em>/</em> <span className="no">{100 - yesPrice}¢</span></span>
            </div>
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
              {isPublic ? "Opening the arena…" : `Arena ${arenaCode} has no active round. `}
              {!isPublic && <a className="link" href="/">Browse open arenas →</a>}
            </span>
          </div>
        )}
      </div>

      {/* ── ARENA STAGE (every round state) ─────────────────── */}
      {round && (
        <ArenaStage round={round} standings={standings} survivors={cut} yesPrice={yesPrice} wallet={wallet} />
      )}

      {/* ── ARENA ───────────────────────────────────────────── */}
      <section className="arena-shell" id="arena">
        {round?.status === "complete" ? (
          <div className="champion">
            {(() => {
              const champ = standings.find((e) => e.id === round.championId) ?? standings[0] ?? null;
              const paid = [...standings].filter((e) => e.prizeUsdc > 0).sort((a, b) => b.prizeUsdc - a.prizeUsdc);
              const myEntitlement = me ? me.cash + me.prizeUsdc : 0;
              const escrowSettled = !!round.escrow?.settleSignatures?.length;
              const canClaim = !!wallet && !!round.escrow && escrowSettled && myEntitlement > 0.0001;
              const explorerBase = `https://explorer.solana.com/tx`;
              const explorerCluster = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
              return (
                <>
                  <p className="eyebrow">{round.config.format === "single" ? "Single round" : `Round ${round.roundNumber}`} · final</p>
                  <h1>{champ ? `${displayName(champ)} wins ${usd2.format(champ.prizeUsdc)}` : "Rumble complete"}</h1>
                  <p className="lead">
                    {paid.length > 1
                      ? `${usd.format(round.prizePoolUsdc)} pool split across the top ${paid.length}.`
                      : `${usd.format(round.prizePoolUsdc)} pool to the winner.`}
                    {" "}Everyone withdraws their remaining vault; winners also take the pool share.
                  </p>

                  {/* Claim box — only show to actual participants with a real entitlement. */}
                  {round.escrow && me && !me.isBot && myEntitlement > 0.001 && (
                    <div className="claim-box">
                      {!escrowSettled ? (
                        <p>Locking in on-chain settlement — hold tight, it&apos;s automatic…</p>
                      ) : (
                        <>
                          <p><b>Your withdrawal:</b> {usd2.format(myEntitlement)}</p>
                          <button
                            className="btn primary full"
                            onClick={() => doClaim(false)}
                            disabled={busy || !canClaim}
                            title={!wallet ? "Connect the wallet you played with" : ""}
                          >
                            {busy ? "Claiming…" : `Claim ${usd2.format(myEntitlement)} to my wallet`}
                          </button>
                          <div className="claim-links">
                            {(round.escrow.settleSignatures ?? []).slice(-2).map((s) => (
                              <a key={s} className="link" target="_blank" rel="noopener noreferrer" href={`${explorerBase}/${s}${explorerCluster}`}>
                                settle {s.slice(0, 6)}… ↗
                              </a>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {/* Non-participant / bot-viewing note — no confusing empty claim box. */}
                  {round.escrow && (!me || me.isBot || myEntitlement <= 0) && escrowSettled && (
                    <p className="disclaimer">Settlement complete on-chain — participants can claim from the wallet they played with.</p>
                  )}

                  <button className="btn primary" onClick={() => { setInviteInfo(null); setShowHost(true); }} disabled={busy}>Host the next rumble →</button>
                  <div className="final-board">
                    {standings.map((e, i) => (
                      <div key={e.id} className={`fb-row ${e.wallet === wallet ? "me" : ""}`}>
                        <span className="fb-rank">{i + 1}</span>
                        <span className="fb-name">{displayName(e)}{e.isBot ? " ·bot" : ""}</span>
                        <span className="fb-bank">{usd2.format(e.bankroll)}</span>
                        <span className="fb-prize">{e.prizeUsdc > 0 ? `+${usd2.format(e.prizeUsdc)}` : ""}</span>
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
                refundReady={vaultSettled}
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
            {isPublic ? (
              <p>Opening the walk-in arena…</p>
            ) : (
              <>
                <p>This arena has no live rumble right now. Host the next one on the same code, or head back to the public arena.</p>
                <div className="cta-row">
                  <button className="btn primary" onClick={() => { setInviteInfo(null); setShowHost(true); }}>Host a rumble</button>
                  <button className="btn secondary" onClick={() => goToArena(PUBLIC_ARENA)}>Public arena →</button>
                </div>
              </>
            )}
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
                  <div><b className="up">{yesPrice}¢</b><span>YES</span></div>
                  <div><b className="down">{100 - yesPrice}¢</b><span>NO</span></div>
                </div>
              </div>

              {!enrolled ? (
                <div className="enroll-cta">
                  {round?.status === "enrolling" ? (
                    <>
                      <p>
                        Your seat is <b>{usd.format(round.config.entryUsdc + round.config.startingBankroll)}</b>: <b>{usd.format(round.config.entryUsdc)}</b> entry into the shared pool plus a <b>{usd.format(round.config.startingBankroll)}</b> trading vault that&apos;s yours to cash out. Everyone starts equal — trade the market, outlast the cut, win the pool.
                      </p>
                      <div className="cta-row">
                        <button className="btn primary" onClick={() => (wallet ? setShowEnroll(true) : connect())} disabled={busy}>
                          {wallet ? "Enter the arena" : "Connect to enter"}
                        </button>
                        <button className="btn secondary" onClick={() => { setInviteInfo(null); setShowHost(true); }} disabled={busy}>Host your own</button>
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
                    <div><span>Position</span><b>{me!.side ? `${me!.shares.toFixed(1)} ${me!.side} @ ${me!.avgPrice.toFixed(0)}¢` : "—"}</b></div>
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
                              disabled={round?.status !== "live"}
                              onClick={() => setCashoutTicket(t)}
                            >
                              Cash out →
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {round?.status === "live" ? (
                    <>
                      <div className="bet-mode">
                        <button className={betMode === "single" ? "bm on" : "bm"} onClick={() => setBetMode("single")}>Single trade</button>
                        <button className={betMode === "parlay" ? "bm on" : "bm"} onClick={() => setBetMode("parlay")}>Parlay</button>
                      </div>

                      {betMode === "single" ? (
                        <>
                          <div className="sides">
                            <button className={side === "YES" ? "side yes on" : "side yes"} onClick={() => setSide("YES")}>YES <b>{yesPrice}¢</b></button>
                            <button className={side === "NO" ? "side no on" : "side no"} onClick={() => setSide("NO")}>NO <b>{100 - yesPrice}¢</b></button>
                          </div>
                          <label className="field">
                            Stake from your vault (USDC)
                            <div className="field-input">
                              <span className="curr">$</span>
                              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                              <button type="button" className="max" onClick={() => setAmount(String(Math.floor(me!.cash)))}>MAX</button>
                            </div>
                          </label>
                          <div className="summary">
                            <span>Entry price</span><b>{side === "YES" ? yesPrice : 100 - yesPrice}¢</b>
                            <span>Shares</span><b>{(Number(amount || 0) / ((side === "YES" ? yesPrice : 100 - yesPrice) / 100)).toFixed(1)}</b>
                            <span>Payout if side wins</span><b className="accent">{usd.format(Number(amount || 0) / ((side === "YES" ? yesPrice : 100 - yesPrice) / 100))}</b>
                          </div>
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
                          <div className="trade-actions">
                            <button className="btn primary full" onClick={doBuy} disabled={busy}>Buy {side}</button>
                            <button className="btn secondary" onClick={doSell} disabled={busy || !me!.side}>Liquidate</button>
                          </div>
                          {pantaFillOn && pantaFillAvailable && pantaOrder && (
                            <PantaOrderStatus update={pantaOrder} />
                          )}
                        </>
                      ) : (
                        <div className="parlay-build">
                          <p className="pb-hint">Stack BTC/ETH/SOL up-or-down calls into one bet. Every leg must land — longer odds, bigger payout. One horizon per asset.</p>
                          <div className="pb-board">
                            {boardMarkets.map((m) => {
                              const sel = parlayLegs.find((l) => l.marketId === m.id);
                              return (
                                <div className="pb-mkt" key={m.id}>
                                  <div className="pb-mkt-q"><b>{m.asset}</b> up in {m.horizon === "MIN5" ? "5m" : m.horizon === "MIN15" ? "15m" : m.horizon === "HOUR" ? "1h" : "1d"}?</div>
                                  <div className="pb-mkt-sides">
                                    <button className={sel?.side === "YES" ? "pb-side up on" : "pb-side up"} onClick={() => toggleLeg(m.id, "YES")}>UP {m.yesPrice}¢</button>
                                    <button className={sel?.side === "NO" ? "pb-side down on" : "pb-side down"} onClick={() => toggleLeg(m.id, "NO")}>DN {100 - m.yesPrice}¢</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <label className="field">
                            Stake from your vault (USDC)
                            <div className="field-input">
                              <span className="curr">$</span>
                              <input value={parlayStake} onChange={(e) => setParlayStake(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                              <button type="button" className="max" onClick={() => setParlayStake(String(Math.floor(me!.cash)))}>MAX</button>
                            </div>
                          </label>
                          <div className="summary">
                            <span>Legs</span><b>{parlayLegs.length}</b>
                            <span>Combined odds</span><b>{parlayLegs.length >= 2 ? `${parlayQuote.impliedOdds.toFixed(2)}×` : "—"}</b>
                            <span>Variance fee</span><b>{parlayLegs.length >= 2 ? usd2.format(parlayQuote.feeUsdc) : "—"}</b>
                            <span>Pays if all land</span><b className="accent">{parlayLegs.length >= 2 ? usd.format(parlayQuote.potentialPayoutUsdc) : "—"}</b>
                            <span>If one leg voids</span><b>{parlayLegs.length >= 2 ? usd.format(parlayQuote.halfPayoutIfOneVoidUsdc) : "—"}</b>
                          </div>
                          <button className="btn primary full" onClick={doPlaceParlay} disabled={busy || parlayLegs.length < 2}>
                            {parlayLegs.length < 2 ? "Pick at least 2 legs" : `Place ${parlayLegs.length}-leg parlay`}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="enroll-cta"><p>You&apos;re in. Waiting for the round to go live — the room is locking in.</p></div>
                  )}
                </>
              )}
            </div>

            {/* roster */}
            <aside className="roster">
              <div className="roster-head">
                <span>Standings</span>
                {round?.status === "live" && aliveCount > cut && (
                  <span className="cut">Top {cut} survive · {aliveCount - cut} cut</span>
                )}
              </div>
              <ul>
                {standings.map((e, i) => {
                  const isCutLine = round?.status === "live" && i === cut && e.eliminatedRound === null;
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
                        <span className={`r-pnl ${pnl >= 0 ? "up" : "down"}`}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}</span>
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

        {/* event log */}
        {round && round.history.length > 0 && (
          <div className="log">
            {[...round.history].slice(-4).reverse().map((h, i) => <span key={i}>{h}</span>)}
          </div>
        )}
      </section>

      {/* Live Panta fills for THIS market — the trade tape */}
      {round && round.config.marketId && (
        <PantaTradeTape marketId={round.config.marketId} marketQuestion={round.config.marketQuestion} />
      )}

      {/* Resolution + dispute window: appears only when Panta says the market is resolved */}
      {round && round.config.marketId && (
        <PantaResolution marketId={round.config.marketId} />
      )}

      {/* Fires once per tracked market when it graduates on Panta's secondary book */}
      <PantaGraduationBanner />

      {/* ── HOW IT WORKS ────────────────────────────────────── */}
      <section className="how-shell" id="how">
        <h2>How the arena works</h2>
        <div className="how-grid">
          <div><b>1 · Host chooses the game</b><p>Any user opens their own arena — pick BTC, ETH or SOL, the player limit, the entry, the starting vault, and one to four rounds. You get a shareable link.</p></div>
          <div><b>2 · Invite friends</b><p>Send the arena link. Anyone with the link takes a seat in your room — everyone else plays a different arena on the same site.</p></div>
          <div><b>3 · Entry and vault separate</b><p>Your entry joins the shared prize pool. Your starting vault stays in your own game account to trade.</p></div>
          <div><b>4 · Trade the same market</b><p>Everyone in your arena trades UP and DOWN on the same live market. Buy, sell, or hold cash until it closes.</p></div>
          <div><b>5 · The oracle ranks every vault</b><p>Winning shares become USDC and players are ranked by vault value. In a royale the bottom half is cut and survivors keep the bankroll they earned.</p></div>
          <div><b>6 · Winners claim &amp; progress</b><p>Everyone withdraws their remaining vault. Top finishers share the pool — 62.5% / 23.4% / 14.1%, or the whole pool in a duel.</p></div>
        </div>
        <p className="disclaimer">
          Rounds, vaults, elimination and the prize pool are real server-side game state on Postgres, priced by
          live Panta markets on Solana {CLUSTER}. Player funds are held in a non-custodial
          escrow program on Solana {CLUSTER} — testnet USDC has no monetary value. If a game can&apos;t finish,
          recovery lets players reclaim their entry and remaining vault.
        </p>
      </section>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}

      {showCreateMarket && <PantaCreateMarketModal initialWallet={wallet} onClose={() => setShowCreateMarket(false)} />}
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
        const seat = round.config.entryUsdc + round.config.startingBankroll;
        return (
          <div className="modal-backdrop" onClick={() => setShowEnroll(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="seat-title" onClick={(e) => e.stopPropagation()}>
              <button className="close" onClick={() => setShowEnroll(false)} aria-label="Close">×</button>
              <h2 id="seat-title">Take your seat</h2>
              <p className="sub">Arena <b>{arenaCode}</b> · {round.config.marketQuestion}</p>
              <dl className="seat-breakdown">
                <div><dt>Entry → shared prize pool</dt><dd>{usd2.format(round.config.entryUsdc)}</dd></div>
                <div><dt>Vault → your trading bankroll</dt><dd>{usd2.format(round.config.startingBankroll)}</dd></div>
                <div className="total"><dt>Total deposit</dt><dd>{usd2.format(seat)} USDC</dd></div>
              </dl>
              <form onSubmit={(e) => { e.preventDefault(); if (ok && !busy && wallet) doEnroll(); }}>
                <label>
                  Username
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="e.g. nova_9"
                    maxLength={USERNAME_MAX}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={nickname.length > 0 && !ok}
                    aria-describedby="seat-hint"
                  />
                </label>
                <p id="seat-hint" className={`username-hint ${nickname.length === 0 ? "" : ok ? "ok" : "bad"}`} role="status">{hint}</p>
                <button type="submit" className="btn primary full" disabled={busy || !ok || !wallet} style={{ marginTop: 10 }}>
                  {busy ? "Confirm in your wallet…" : wallet ? `Deposit ${usd2.format(seat)} & join` : "Connect a wallet first"}
                </button>
              </form>
              <p className="disclaimer" style={{ marginTop: 12 }}>
                {escrow?.active
                  ? <>Held in a non-custodial escrow program on Solana {CLUSTER}. You withdraw your remaining vault plus any prize after settlement.</>
                  : <>Practice mode — no USDC moves.</>}
              </p>
            </div>
          </div>
        );
      })()}

      {showHost && (
        <div className="modal-backdrop" onClick={closeHostModal}>
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
                  Go to arena {inviteInfo.code} →
                </button>
                <p className="disclaimer" style={{ marginTop: 10 }}>
                  Enrollment is open now. Your game starts the moment the timer locks, with whoever joined.
                </p>
              </>
            ) : (
              // ── CONFIGURE ROOM SCREEN ────────────────────────────────
              <>
                <h2>Host a rumble</h2>
                <p className="sub">You set the terms and get a shareable link. Every player funds the same seat — you can&apos;t hand anyone a bigger vault.</p>

                <div className="host-field">
                  <span className="host-label">Asset</span>
                  <div className="seg">
                    {(["BTC", "ETH", "SOL"] as const).map((a) => (
                      <button key={a} className={hAsset === a ? "seg-opt on" : "seg-opt"} onClick={() => setHAsset(a)}>{a}</button>
                    ))}
                  </div>
                </div>

                <div className="host-field">
                  <span className="host-label">Timeframe</span>
                  <div className="seg">
                    {(["MIN5", "MIN15", "HOUR", "DAY"] as const).map((h) => (
                      <button key={h} className={hHorizon === h ? "seg-opt on" : "seg-opt"} onClick={() => setHHorizon(h)}>
                        {h === "MIN5" ? "5m" : h === "MIN15" ? "15m" : h === "HOUR" ? "1h" : "1d"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="host-field">
                  <span className="host-label">Format</span>
                  <div className="seg">
                    <button className={hFormat === "single" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("single")}>Single round</button>
                    <button className={hFormat === "royale" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("royale")}>Royale</button>
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
                    <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>→ shared pool</em>
                  </label>
                  <label className="host-num">
                    Starting vault (USDC)
                    <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>→ each player trades</em>
                  </label>
                </div>

                <div className="host-summary">
                  <div><span>Seat per player</span><b>{usd2.format(hostSeat)}</b></div>
                  <div><span>Pool if full</span><b className="accent">{usd2.format((Number(hEntry) || 0) * hCapacity)}</b></div>
                  <div><span>Format</span><b>{hFormat === "single" ? "1 round" : `${hRounds} rounds · cut`}</b></div>
                </div>

                <button className="btn primary full" onClick={doHost} disabled={busy} style={{ marginTop: 12 }}>
                  {busy ? "Opening…" : `Open ${hAsset} rumble & get invite link`}
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
