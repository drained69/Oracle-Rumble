"use client";

/**
 * Home — a single-viewport lobby. Left: what The Pit is. Right: a
 * card with two tabs, Join (live arenas) and Host (open a new arena).
 * Positions and Docs are their own routes, reached from the header.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelArena, checkSeatFunds, enrollWithEscrow, newRound, prepareWallet, seatStepText, type SeatStep } from "@/lib/round-client";
import { finishMarket, quoteMarket, type MarketQuote } from "@/lib/panta-client";
import { DEFAULT_OPENING_CALL_PCT, PICKS_CHAIN_VAULT_USDC, hostAmountError, isPicksFormat, type RoundFormat } from "@/lib/royale";
import { DEFAULT_LEG_SEC, LEG_LENGTHS, MAX_LEGS } from "@/lib/streak";
import { HOST_FEE_OPTIONS } from "@/lib/fees";
import CallSizePicker, { callSizeText } from "@/app/CallSizePicker";
import { avatarDataUrl } from "@/lib/avatars";
import { useEscrowStatus, useWalletIdentity, useXNotices } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import PantaGraduationBanner from "@/app/PantaGraduationBanner";
import AmbientLife from "@/app/AmbientLife";
import ActivityFeed from "@/app/ActivityFeed";
import SeatRing from "@/app/SeatRing";
import CountUp from "@/app/CountUp";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Where a hosted pit's market comes from. */
type MarketSource = "crypto" | "panta" | "create";
type CatalogItem = { id: string; question: string; category: string; yesCents: number; endMs: number | null; volumeUsdc: number };
const CREATE_CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
/** A starting source of truth per category — the host can change it. */
const DEFAULT_SOURCE: Record<string, string> = {
  sports: "https://www.espn.com", crypto: "https://www.coinbase.com", politics: "https://apnews.com",
  entertainment: "https://variety.com", finance: "https://www.reuters.com/markets", science: "https://www.nature.com",
  world: "https://www.reuters.com/world", other: "https://www.reuters.com"
};
/** How long trading on a created market runs: label → seconds. */
const MARKET_ENDS: { label: string; sec: number }[] = [
  { label: "1h", sec: 3_600 }, { label: "3h", sec: 3 * 3_600 }, { label: "12h", sec: 12 * 3_600 },
  { label: "1d", sec: 86_400 }, { label: "7d", sec: 7 * 86_400 }
];
/** Trading window of a pit on a Panta market (minutes). */
const PIT_WINDOWS = [5, 15, 60];

type ArenaItem = {
  arenaCode: string;
  marketSource?: "crypto" | "panta";
  isPublic: boolean;
  inviteSlug: string;
  status: string;
  roundNumber: number;
  roundLimit: number;
  format: RoundFormat;
  asset: string;
  marketQuestion: string;
  capacity: number;
  entryUsdc: number;
  startingBankroll: number;
  hostFeePct?: number;
  prizePoolUsdc: number;
  humans: number;
  bots: number;
  alive: number;
  entrants: number;
  enrollDeadline: number;
  liveDeadline: number;
};

function fmtClock(ms: number) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
function tierFor(pool: number): "S" | "A" | "B" | "C" {
  if (pool >= 100) return "S";
  if (pool >= 40) return "A";
  if (pool >= 15) return "B";
  return "C";
}
const HORIZON_LABEL: Record<string, string> = { MIN5: "5m", MIN15: "15m", HOUR: "1h", DAY: "1d" };
const STATUS_LABEL: Record<string, string> = {
  enrolling: "Enrolling", live: "Live", settling: "Settling",
  advancing: "Advancing", complete: "Complete", cancelled: "Cancelled"
};

type Tab = "play" | "host";

/** Quick arenas stay open this long after the host's seat is confirmed. */
const QUICK_ENROLL_SEC = 120;
type HostStep = "" | "checking" | "opening" | "quoting" | "building" | "signing" | "registering" | SeatStep;

export default function ArenasDirectory() {
  const { wallet, username, status: authStatus, signIn } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [arenas, setArenas] = useState<ArenaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);
  const [hostStep, setHostStep] = useState<HostStep>("");
  const [toast, setToast] = useState("");
  useXNotices(setToast);
  const [tab, setTab] = useState<Tab>("play");

  const [hMode, setHMode] = useState<"quick" | "scheduled">("quick");
  const [hAsset, setHAsset] = useState<"BTC" | "ETH" | "SOL">("SOL");
  const [hHorizon, setHHorizon] = useState<"MIN5" | "MIN15" | "HOUR" | "DAY">("MIN5");
  const [hFormat, setHFormat] = useState<RoundFormat>("single");
  const [hLegSec, setHLegSec] = useState<number>(DEFAULT_LEG_SEC);
  const [hHostFee, setHHostFee] = useState<number>(0);
  const [hRounds, setHRounds] = useState(2);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  const [hStartInMin, setHStartInMin] = useState(15);
  // The host's own opening call (they take seat 1 like everyone else).
  const [hCall, setHCall] = useState<"YES" | "NO" | "LATER" | "">("");
  const [hCallPct, setHCallPct] = useState<number>(DEFAULT_OPENING_CALL_PCT);
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);

  // Market source: crypto direction, an existing Panta market, or a new one.
  const [hSource, setHSource] = useState<MarketSource>("crypto");
  const [catalog, setCatalog] = useState<{ loaded: boolean; available: boolean; sandbox: boolean; items: CatalogItem[] }>({ loaded: false, available: false, sandbox: false, items: [] });
  const [hPantaId, setHPantaId] = useState("");
  const [hWindowMin, setHWindowMin] = useState(15);
  const [mQuestion, setMQuestion] = useState("");
  const [mCategory, setMCategory] = useState<string>("sports");
  const [mRule, setMRule] = useState("");
  const [mRuleTouched, setMRuleTouched] = useState(false);
  const [mSource, setMSource] = useState(DEFAULT_SOURCE.sports);
  const [mSourceTouched, setMSourceTouched] = useState(false);
  const [mEndsSec, setMEndsSec] = useState(3 * 3_600);
  const [mBreaking, setMBreaking] = useState(true);
  // The fee quote for a market being created; `created` once Panta lists it.
  const [mQuote, setMQuote] = useState<(MarketQuote & { created?: boolean }) | null>(null);
  const [mFieldError, setMFieldError] = useState<{ field?: string; message: string } | null>(null);

  const pantaHost = hSource !== "crypto";
  // Predictions and Streak run on the BTC/ETH/SOL spot oracle — Panta pits trade.
  useEffect(() => { if (pantaHost && (hFormat === "predictions" || hFormat === "streak")) setHFormat("single"); }, [pantaHost, hFormat]);
  // Any edit to the market invalidates its quote — until it's created on
  // Panta (paid): then the form is locked so a retry reuses that market.
  useEffect(() => {
    setMQuote((q) => (q?.created ? q : null));
    setMFieldError(null);
  }, [mQuestion, mCategory, mRule, mSource, mEndsSec, mBreaking]);
  // A sensible default rule and source until the host writes their own.
  useEffect(() => {
    if (!mRuleTouched) {
      const q = mQuestion.trim();
      setMRule(q ? `Resolves YES if the answer to "${q}" is yes, as reported by the source of truth below. Resolves NO otherwise.` : "");
    }
  }, [mQuestion, mRuleTouched]);
  useEffect(() => { if (!mSourceTouched) setMSource(DEFAULT_SOURCE[mCategory] ?? DEFAULT_SOURCE.other); }, [mCategory, mSourceTouched]);
  // A scheduled (non-live) market must open ~1h out, so it can't end within the hour.
  useEffect(() => { if (!mBreaking && mEndsSec < 3 * 3_600) setMEndsSec(3 * 3_600); }, [mBreaking, mEndsSec]);

  useEffect(() => {
    if (hSource !== "panta" || catalog.loaded) return;
    fetch("/api/markets/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCatalog({ loaded: true, available: !!j.available, sandbox: !!j.sandbox, items: j.items ?? [] }))
      .catch(() => setCatalog({ loaded: true, available: false, sandbox: false, items: [] }));
  }, [hSource, catalog.loaded]);

  useEffect(() => {
    document.body.classList.add("game-mode", "no-scroll");
    // Deep link from other pages' "Host" links: ?tab=host[&format=…][&source=panta&market=ID]
    const q = new URLSearchParams(window.location.search);
    if (q.get("tab") === "host") setTab("host");
    const f = q.get("format");
    if (f === "single" || f === "royale" || f === "predictions" || f === "streak") setHFormat(f);
    if (q.get("source") === "panta") {
      setHSource("panta");
      const id = q.get("market");
      if (id && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) setHPantaId(id);
    }
    return () => { document.body.classList.remove("game-mode", "no-scroll"); };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const aRes = await fetch("/api/arenas", { cache: "no-store" }).then((r) => r.json());
      setArenas(aRes.items ?? []);
    } catch { /* transient */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const connect = useCallback(async () => {
    const r = await signIn();
    if (r.message) setToast(r.message);
  }, [signIn]);

  // Entry-only games (Predictions, Streak): seat 1 has no call.
  const picks = isPicksFormat(hFormat);
  const entryNum = Number(hEntry) || 0;
  const vaultNum = Number(hVault) || 0;
  // A predictions seat is the entry (the escrow keeps a 1-unit vault, returned at the end).
  const hostSeat = entryNum + (picks ? PICKS_CHAIN_VAULT_USDC : vaultNum);
  const poolIfFull = entryNum * hCapacity;
  const hostInputError = hostAmountError(entryNum, vaultNum, hFormat);

  const doHostAndJoin = useCallback(async () => {
    // Every pit has a signed-in host who takes seat 1.
    if (!wallet) { await connect(); return; }
    if (hostInputError) { setToast(hostInputError); return; }
    if (hSource === "panta" && !hPantaId) { setToast("Pick a Panta market for the pit."); return; }
    // Checking a new market with Panta comes before the call; seat 1 needs one.
    const quoting = hSource === "create" && !mQuote;
    if (!quoting && !hCall && !picks) {
      setToast(pantaHost ? "Pick YES or NO (or decide later) before taking seat 1." : `Pick UP or DOWN on ${hAsset} (or decide later) before taking seat 1.`);
      return;
    }

    const call = picks || hCall === "LATER" || !hCall ? null : hCall;
    const onStep = (step: SeatStep, name?: string) => { setHostStep(step); setToast(seatStepText(step, hostSeat, call, name, pantaHost).toast); };
    try {
      // New market, first press: get Panta's fee quote and stop, so the host
      // sees exactly what creating it costs before anything is signed.
      if (hSource === "create" && !mQuote) {
        setHostStep("quoting");
        const q = await quoteMarket({
          question: mQuestion.trim(), category: mCategory, resolutionRule: mRule.trim(),
          sourcesOfTruth: [mSource.trim()], endsAt: Math.floor(Date.now() / 1000) + mEndsSec, breaking: mBreaking
        });
        if (!q.ok) { setMFieldError({ field: q.field, message: q.error }); setToast(q.error); return; }
        setMQuote(q.data);
        setToast(q.data.sandbox
          ? "Market checks out. Panta sandbox: no creation fee is charged. Press again to create it and open the pit."
          : `Market checks out. Panta charges ${usd2.format(q.data.feeUsdc)} to create it. Press again to sign and open the pit.`);
        return;
      }
      // Check funds and the wallet BEFORE paying Panta or the operator paying
      // for an on-chain InitRound — the seat, plus the market fee if one is due.
      const marketFee = hSource === "create" && mQuote && !mQuote.created && !mQuote.sandbox ? mQuote.feeUsdc : 0;
      if (escrow?.active) {
        setHostStep("checking");
        const short = await checkSeatFunds(wallet, hostSeat + marketFee, marketFee > 0 ? `the ${usd2.format(marketFee)} market fee plus your seat` : undefined);
        if (short) { setToast(short); return; }
      }
      // Something to sign: an on-chain seat deposit, or a real market-creation transaction.
      const willSign = !!escrow?.active || (hSource === "create" && !!mQuote && !mQuote.created && !mQuote.sandbox);
      const ready = await prepareWallet(wallet, onStep, willSign);
      if (!ready.ok) { setToast(ready.error); return; }

      // New market, second press: build → sign (pays the fee) → register.
      if (hSource === "create" && mQuote && !mQuote.created) {
        const made = await finishMarket(mQuote.draftId, wallet, (st) => {
          setHostStep(st);
          setToast(st === "building" ? "Building the market on Panta…" : st === "signing" ? "Approve the market creation in your X wallet…" : "Registering the market with Panta…");
        }, mQuestion.trim());
        if (!made.ok) { setToast(`Market not created — ${made.error}`); return; }
        setMQuote({ ...mQuote, created: true });
      }

      setHostStep("opening");
      const enrollmentSec = hMode === "scheduled" ? hStartInMin * 60 : QUICK_ENROLL_SEC;
      const v = await newRound({
        format: hFormat,
        ...(pantaHost
          ? { marketSource: "panta" as const, liveSec: hWindowMin * 60, ...(hSource === "create" ? { draftId: mQuote?.draftId } : { pantaMarketId: hPantaId }) }
          : { asset: hAsset, horizon: hHorizon }),
        entryUsdc: entryNum, startingBankroll: vaultNum,
        capacity: hCapacity, roundLimit: hFormat === "royale" ? hRounds : 1,
        ...(hFormat === "streak" ? { liveSec: hLegSec } : {}),
        enrollmentSec, hostFeePct: hHostFee
      }, wallet);
      if (v.error || !v.arena) { setToast(v.error ?? "Could not open the pit."); return; }
      const url = `${window.location.origin}/a/${v.arena}`;

      // The host takes seat #1. If that deposit isn't signed, roll the
      // arena back so no unfunded room is left behind.
      let enrollError = "";
      let refundable = false;
      try {
        const r = await enrollWithEscrow(wallet, username, v.arena, call, onStep, hCallPct);
        // A signed deposit means the room is funded — never tear it down;
        // the seat is registered from the on-chain entry if this call lags.
        if (r.error && !(r.entrantId || r.already)) { enrollError = r.error; refundable = !!r.refundable || !!r.deposited; }
      } catch (err) {
        enrollError = err instanceof Error ? err.message : "wallet signing failed";
      }
      if (enrollError) {
        if (refundable) {
          // Deposit landed after the arena closed — take them to the refund.
          setToast(enrollError);
          window.setTimeout(() => { window.location.href = `/a/${v.arena}`; }, 1500);
          return;
        }
        await cancelArena(v.arena, wallet).catch(() => { /* best effort */ });
        setToast(`Pit not opened — ${enrollError}`);
        return;
      }

      setInviteInfo({ code: v.arena, url });
      if (hSource === "create") { setMQuote(null); setMQuestion(""); setMRuleTouched(false); setMSourceTouched(false); }
      setToast(hFormat === "streak"
        ? `Pit ${v.arena} is open — you're in seat 1. Pick leg 1 in the pit, then share the link.`
        : picks
        ? `Pit ${v.arena} is open — you're in seat 1. Make your picks in the pit, then share the link.`
        : `Pit ${v.arena} is open — you're in seat 1. Share the link.`);
      refresh();
    } finally { setHostStep(""); }
  }, [connect, hostInputError, escrow, wallet, username, hostSeat, hMode, hStartInMin, hAsset, hHorizon, hFormat, entryNum, vaultNum, hCapacity, hRounds, hCall, hCallPct, refresh, picks, hLegSec, hHostFee,
      hSource, hPantaId, pantaHost, hWindowMin, mQuote, mQuestion, mCategory, mRule, mSource, mEndsSec, mBreaking]);

  const doCopy = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); setToast("Invite link copied."); }
    catch { setToast("Copy failed — select the link and copy it manually."); }
  }, []);

  const goTo = useCallback((slug: string) => { window.location.href = slug; }, []);

  const active = useMemo(
    // An on-chain arena whose host hasn't paid seat 1 yet isn't open to join.
    () => arenas.filter((a) => !a.isPublic && ["enrolling", "live", "settling", "advancing"].includes(a.status)
      && !(escrow?.active && a.status === "enrolling" && a.humans === 0)),
    [arenas, escrow?.active]
  );
  const featured = active.find((a) => a.status === "live")
    ?? active.find((a) => a.status === "enrolling")
    ?? active[0]
    ?? null;
  const others = active.filter((a) => a.arenaCode !== featured?.arenaCode);

  const totals = useMemo(() => ({
    pool: active.reduce((s, a) => s + a.prizePoolUsdc, 0),
    alive: active.reduce((s, a) => s + a.alive, 0),
    live: active.filter((a) => a.status === "live").length
  }), [active]);

  return (
    <main className="game-main jumper">
      <AmbientLife />
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active={tab === "play" ? "arenas" : "host"}
        escrow={escrow}
        onToast={setToast}
        onNav={(k) => setTab(k === "arenas" ? "play" : "host")}
      />

      <section className="jumper-stage">
        <div className="jumper-tagline">
          <p className="jt-eyebrow">Trading pits on any prediction market · Solana</p>
          <h1 className="jt-title" data-text="Any market. Outtrade the room.">
            <span className="hl-a">Any market.</span><br />
            <span className="hl-b">Outtrade</span> the room.
          </h1>
          <p className="jt-lead">
            Host a pit on tonight&apos;s game, a question you write, or live BTC, ETH and SOL. Everyone takes the
            same seat and the same vault, the room trades its own odds, and the best vaults split the pool when the
            bell rings. On the crypto board you can also play Predictions — five hidden picks — or Streak, where one
            wrong call knocks you out.
          </p>

          <ol className="jt-steps">
            <li><b>01</b><span>Pick any market — an open Panta market, one you create in a minute, or BTC, ETH and SOL.</span></li>
            <li><b>02</b><span>Trade the room — every YES/NO trade moves the pit&apos;s odds. The Oracle reads the tape and Panta&apos;s line as you go.</span></li>
            <li><b>03</b><span>Finish on top — Panta&apos;s resolver or the closing price settles it, and payouts go straight to the top vaults&apos; wallets.</span></li>
          </ol>

          <div className="jumper-stats" aria-live="polite">
            <div>
              <span>In prize pools</span>
              <b className="plasma">
                <CountUp value={totals.pool} format={(n) => usd.format(n)} />
              </b>
            </div>
            <div>
              <span>Players alive</span>
              <b className="neon">
                <CountUp value={totals.alive} format={(n) => Math.round(n).toString()} />
              </b>
            </div>
            <div>
              <span>Live rounds</span>
              <b className="gold">
                <CountUp value={totals.live} format={(n) => Math.round(n).toString()} />
              </b>
            </div>
          </div>

          <ul className="jt-trust">
            <li>Non-custodial USDC escrow</li>
            <li>Markets by Panta</li>
            <li>0.1% platform fee</li>
          </ul>

          <ActivityFeed />
        </div>

        <div className="jumper-card">
          <div className="jc-tabs" role="tablist" aria-label="Pit actions">
            <button role="tab" aria-selected={tab === "play"} className={`jc-tab ${tab === "play" ? "on" : ""}`} onClick={() => setTab("play")}>
              <span className="dot" aria-hidden="true" /> Join
            </button>
            <button role="tab" aria-selected={tab === "host"} className={`jc-tab ${tab === "host" ? "on" : ""}`} onClick={() => setTab("host")}>
              <span className="dot" aria-hidden="true" /> Host
            </button>
          </div>

          <div className="jc-body" role="tabpanel">
            {tab === "play" ? (
              <PlayPanel
                loaded={loaded}
                featured={featured}
                others={others}
                now={now}
                onJoin={goTo}
                onSwitchToHost={() => setTab("host")}
              />
            ) : inviteInfo ? (
              <InviteResult
                info={inviteInfo}
                picks={picks}
                streak={hFormat === "streak"}
                onCopy={doCopy}
                onOpen={() => goTo(`/a/${inviteInfo.code}`)}
                onReset={() => setInviteInfo(null)}
              />
            ) : (
              <HostPanel
                hMode={hMode} setHMode={setHMode}
                hStartInMin={hStartInMin} setHStartInMin={setHStartInMin}
                hAsset={hAsset} setHAsset={setHAsset}
                hHorizon={hHorizon} setHHorizon={setHHorizon}
                hFormat={hFormat} setHFormat={setHFormat}
                hLegSec={hLegSec} setHLegSec={setHLegSec}
                hHostFee={hHostFee} setHHostFee={setHHostFee}
                hRounds={hRounds} setHRounds={setHRounds}
                hCapacity={hCapacity} setHCapacity={setHCapacity}
                hEntry={hEntry} setHEntry={setHEntry}
                hVault={hVault} setHVault={setHVault}
                hCall={hCall} setHCall={setHCall} hCallPct={hCallPct} setHCallPct={setHCallPct}
                hostSeat={hostSeat} poolIfFull={poolIfFull}
                inputError={hostInputError}
                wallet={wallet} escrowActive={!!escrow?.active} escrowKnown={escrow != null}
                username={username} authStatus={authStatus}
                step={hostStep} onSubmit={doHostAndJoin}
                market={{
                  source: hSource, setSource: setHSource, catalog, pantaId: hPantaId, setPantaId: setHPantaId,
                  windowMin: hWindowMin, setWindowMin: setHWindowMin,
                  question: mQuestion, setQuestion: setMQuestion, category: mCategory, setCategory: setMCategory,
                  rule: mRule, setRule: (v: string) => { setMRuleTouched(true); setMRule(v); },
                  source2: mSource, setSource2: (v: string) => { setMSourceTouched(true); setMSource(v); },
                  endsSec: mEndsSec, setEndsSec: setMEndsSec, breaking: mBreaking, setBreaking: setMBreaking,
                  quote: mQuote, fieldError: mFieldError,
                  startOver: () => { setMQuote(null); setMQuestion(""); setMRuleTouched(false); setMSourceTouched(false); }
                }}
              />
            )}
          </div>
        </div>
      </section>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss">×</button>
        </div>
      )}


      <PantaGraduationBanner />
    </main>
  );
}

/* ── Join panel ──────────────────────────────────────────────────── */
function PlayPanel({
  loaded, featured, others, now, onJoin, onSwitchToHost
}: {
  loaded: boolean;
  featured: ArenaItem | null;
  others: ArenaItem[];
  now: number;
  onJoin: (slug: string) => void;
  onSwitchToHost: () => void;
}) {
  if (!loaded) {
    return <div className="jc-empty" role="status"><p>Loading pits…</p></div>;
  }
  if (!featured) {
    return (
      <div className="jc-empty">
        <div className="jc-empty-icon" aria-hidden="true">◆</div>
        <h3>No pits open</h3>
        <p>Open one in under a minute, then share the invite link with the players you want in the room.</p>
        <button className="btn-cta" onClick={onSwitchToHost}>Host a pit</button>
        <a className="jc-practice" href="/a/PUBLIC">New here? Play a free practice round against bots →</a>
        <a className="jc-practice" href="/a/PICKS">Or try Predictions free — five picks, no trading →</a>
        <a className="jc-practice" href="/a/STREAK">Or play a free Streak — last caller standing →</a>
      </div>
    );
  }

  const deadline = featured.status === "enrolling" ? featured.enrollDeadline : featured.status === "live" ? featured.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;
  const tier = tierFor(featured.prizePoolUsdc);
  const seats = `${featured.humans}/${featured.capacity}`;

  return (
    <div className="jc-play">
      <div className="jc-featured">
        <div className="jc-featured-top">
          <span className={`gm-boss-tag ${featured.status === "live" ? "live" : "enrolling"}`}>
            <span className="pulse" aria-hidden="true" />
            {featured.status === "live" ? "Live" : STATUS_LABEL[featured.status]}
          </span>
          <span className="jc-code">
            {featured.arenaCode} · Round {featured.roundNumber}/{featured.roundLimit}
          </span>
        </div>
        <div className="jc-featured-row">
          <div className="jc-featured-q">{featured.marketQuestion}</div>
          <SeatRing taken={featured.humans} capacity={featured.capacity} compact />
        </div>
        <div className="jc-featured-meta">
          <div><span>Pool</span><b className="plasma">{usd2.format(featured.prizePoolUsdc)}</b></div>
          <div><span>Seat</span><b>{usd2.format(featured.entryUsdc + featured.startingBankroll)}</b></div>
          {featured.format === "predictions" && <div><span>Game</span><b>5 picks</b></div>}
          {featured.format === "streak" && <div><span>Game</span><b>Streak</b></div>}
          {(featured.hostFeePct ?? 0) > 0 && <div><span>Host fee</span><b>{featured.hostFeePct}%</b></div>}
          <div><span>Players</span><b>{seats}</b></div>
          <div><span>{featured.status === "enrolling" ? "Locks in" : "Ends in"}</span><b className="neon">{deadline ? fmtClock(timeLeft) : "—"}</b></div>
          <div><span>Tier</span><b className={tier === "S" ? "gold" : tier === "A" ? "neon" : ""}>{tier}</b></div>
        </div>
        <button className="btn-cta full" onClick={() => onJoin(featured.inviteSlug)}>
          {featured.status === "live" ? "Watch live" : "Take a seat"}
        </button>
      </div>

      {others.length > 0 && (
        <div className="jc-others">
          <div className="jc-others-head">More arenas · {others.length}</div>
          {others.slice(0, 8).map((a) => {
            const t = tierFor(a.prizePoolUsdc);
            const d = a.status === "enrolling" ? a.enrollDeadline : a.status === "live" ? a.liveDeadline : 0;
            const tl = d ? Math.max(0, d - now) : 0;
            return (
              <button key={a.arenaCode} className="gm-mini-arena" onClick={() => onJoin(a.inviteSlug)}>
                <span className={`rank-badge ${t.toLowerCase()}`} aria-label={`Tier ${t}`}>{t}</span>
                <span className="mid">
                  <span className="q">{isPicksFormat(a.format) ? a.marketQuestion : `${a.asset} · ${a.marketQuestion}`}</span>
                  <span className="meta">{a.humans}/{a.capacity} players · {STATUS_LABEL[a.status]}{d ? ` · ${fmtClock(tl)}` : ""}</span>
                </span>
                <span className="prize">{usd.format(a.prizePoolUsdc)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Host panel ──────────────────────────────────────────────────── */
function HostPanel({
  hMode, setHMode, hStartInMin, setHStartInMin,
  hAsset, setHAsset, hHorizon, setHHorizon,
  hFormat, setHFormat, hLegSec, setHLegSec, hHostFee, setHHostFee, hRounds, setHRounds,
  hCapacity, setHCapacity, hEntry, setHEntry, hVault, setHVault, hCall, setHCall, hCallPct, setHCallPct,
  hostSeat, poolIfFull, inputError, wallet, escrowActive, escrowKnown,
  username, authStatus, step, onSubmit, market
}: {
  hMode: "quick" | "scheduled"; setHMode: (v: "quick" | "scheduled") => void;
  hStartInMin: number; setHStartInMin: (v: number) => void;
  hAsset: "BTC" | "ETH" | "SOL"; setHAsset: (v: "BTC" | "ETH" | "SOL") => void;
  hHorizon: "MIN5" | "MIN15" | "HOUR" | "DAY"; setHHorizon: (v: "MIN5" | "MIN15" | "HOUR" | "DAY") => void;
  hFormat: RoundFormat; setHFormat: (v: RoundFormat) => void;
  hLegSec: number; setHLegSec: (v: number) => void;
  hHostFee: number; setHHostFee: (v: number) => void;
  hRounds: number; setHRounds: (v: number) => void;
  hCapacity: number; setHCapacity: (v: number) => void;
  hEntry: string; setHEntry: (v: string) => void;
  hVault: string; setHVault: (v: string) => void;
  hCall: "YES" | "NO" | "LATER" | ""; setHCall: (v: "YES" | "NO" | "LATER") => void;
  hCallPct: number; setHCallPct: (v: number) => void;
  hostSeat: number; poolIfFull: number; inputError: string;
  wallet: string | null; escrowActive: boolean; escrowKnown: boolean;
  username: string; authStatus: "loading" | "out" | "busy" | "in";
  step: HostStep; onSubmit: () => void;
  market: MarketProps;
}) {
  const busy = step !== "";
  const src = market.source;
  const pantaHost = src !== "crypto";
  const Yw = pantaHost ? "YES" : "UP";
  const Nw = pantaHost ? "NO" : "DOWN";
  const pickedMarket = market.catalog.items.find((m) => m.id === market.pantaId) ?? null;
  const subject = pantaHost ? (src === "create" ? "your market" : "this market") : hAsset;
  const picks = isPicksFormat(hFormat);
  const streak = hFormat === "streak";
  const created = !!market.quote?.created;
  const quoting = src === "create" && !market.quote;
  const label =
    !wallet ? (authStatus === "busy" ? "Signing in with X…" : authStatus === "loading" ? "Checking your sign-in…" : "Sign in with X to host") :
    step === "checking" ? "Checking balance…" :
    step === "opening" ? "Opening pit…" :
    step === "quoting" ? "Checking the market with Panta…" :
    step === "building" ? "Building the market…" :
    step === "signing" ? "Approve the market in your X wallet…" :
    step === "registering" ? "Registering with Panta…" :
    step ? seatStepText(step, hostSeat, undefined, undefined, pantaHost).button :
    src === "create" && !market.quote ? "Check market & see the creation fee" :
    src === "panta" && !market.pantaId ? "Pick a Panta market above" :
    src === "create" && market.quote && !created && !hCall ? `Pick YES or NO` :
    picks ? (escrowActive ? `Deposit ${usd2.format(hostSeat)} & take seat 1` : "Take seat 1 · practice") :
    !hCall ? `Pick ${Yw} or ${Nw} on ${subject}` :
    `${src === "create" && market.quote && !created ? (market.quote.sandbox ? "create market, " : `pay ${usd2.format(market.quote.feeUsdc)} fee, `) : ""}${escrowActive ? `deposit ${usd2.format(hostSeat)} & ` : ""}${hCall === "YES" ? `call ${Yw}` : hCall === "NO" ? `call ${Nw}` : "take seat 1"}${escrowActive ? "" : " · practice"}`.replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="jc-host">
      {/* Who is hosting: the signed-in X account, which takes seat 1. */}
      {wallet ? (
        <div className="host-id">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarDataUrl(wallet, 26)} width={26} height={26} alt="" className="host-id-avatar" />
          <span>Hosting as <b>{username ? `@${username}` : "you"}</b> · you take seat 1</span>
        </div>
      ) : (
        <div className="host-id">
          <span>Sign in with X to host — you take seat 1, and your X handle is shown as the host.</span>
        </div>
      )}

      <FieldRow label="Market">
        <div className="gm-seg" role="radiogroup" aria-label="Market source">
          <button role="radio" aria-checked={src === "crypto"} className={`opt ${src === "crypto" ? "on" : ""}`} onClick={() => market.setSource("crypto")}>Crypto</button>
          <button role="radio" aria-checked={src === "panta"} className={`opt ${src === "panta" ? "on" : ""}`} onClick={() => market.setSource("panta")}>Panta market</button>
          <button role="radio" aria-checked={src === "create"} className={`opt ${src === "create" ? "on" : ""}`} onClick={() => market.setSource("create")}>New market</button>
        </div>
      </FieldRow>
      <p className="jc-help">
        {src === "crypto" ? "BTC, ETH or SOL up or down — priced live from the spot market."
          : src === "panta" ? "Run a pit on any open Panta market — sports, politics, culture. The room trades its own odds; Panta resolves it."
          : "Write your own question — tonight's game, a stream bet, anything with a clear yes or no. It's listed on Panta and your pit runs on it."}
      </p>

      {src === "panta" && (
        <div className="mkt-pick" role="listbox" aria-label="Panta markets">
          {!market.catalog.loaded ? <p className="jc-help">Loading Panta&apos;s markets…</p>
            : !market.catalog.available ? <p className="jc-help">Panta markets aren&apos;t available on this server. Use Crypto, or create a market once a Panta key is set.</p>
            : market.catalog.items.length === 0 ? <p className="jc-help">No open Panta markets right now — create one with <b>New market</b>.</p>
            : market.catalog.items.map((m) => (
              <button key={m.id} role="option" aria-selected={market.pantaId === m.id} className={`mkt-opt ${market.pantaId === m.id ? "on" : ""}`} onClick={() => market.setPantaId(m.id)}>
                <span className="mkt-cat">{m.category}</span>
                <span className="mkt-q">{m.question}</span>
                <span className="mkt-px">{m.yesCents}¢ YES{m.endMs ? ` · ${closesIn(m.endMs)}` : ""}</span>
              </button>
            ))}
          {pickedMarket?.endMs != null && pickedMarket.endMs - Date.now() < ((hMode === "scheduled" ? hStartInMin : 2) + market.windowMin) * 60_000 && (
        <p className="jc-note" role="status">
          Trading on this market ends {closesIn(pickedMarket.endMs) === "closed" ? "now" : `in ${closesIn(pickedMarket.endMs).replace(" left", "")}`} — before your pit would finish.
          The pit still settles on the room&apos;s average, but pick a shorter window or another market to trade alongside Panta.
        </p>
      )}
      {market.catalog.sandbox && market.catalog.loaded && (
            <p className="jc-note mkt-sandbox">Panta sandbox key: Panta lists one test market. A live key lists every open market.</p>
          )}
        </div>
      )}

      {src === "create" && (
        <div className="mkt-create">
          <label className="mkt-field">
            <span className="jc-field-label">Question</span>
            <input disabled={created || busy} value={market.question} onChange={(e) => market.setQuestion(e.target.value.slice(0, 200))} placeholder="Will the Lakers beat the Celtics tonight?" aria-invalid={market.fieldError?.field === "question"} />
          </label>
          <div className="gm-seg mkt-cats" role="radiogroup" aria-label="Category">
            {CREATE_CATEGORIES.map((c) => (
              <button key={c} role="radio" aria-checked={market.category === c} disabled={created || busy} className={`opt ${market.category === c ? "on" : ""}`} onClick={() => market.setCategory(c)}>{c}</button>
            ))}
          </div>
          <label className="mkt-field">
            <span className="jc-field-label">Resolves YES if…</span>
            <textarea rows={2} disabled={created || busy} value={market.rule} onChange={(e) => market.setRule(e.target.value.slice(0, 600))} aria-invalid={market.fieldError?.field === "resolutionRule"} />
          </label>
          <label className="mkt-field">
            <span className="jc-field-label">Source of truth</span>
            <input disabled={created || busy} value={market.source2} onChange={(e) => market.setSource2(e.target.value.slice(0, 300))} placeholder="https://…" inputMode="url" aria-invalid={market.fieldError?.field === "sourcesOfTruth"} />
          </label>
          <div className="mkt-row2">
            <button className={`mkt-toggle ${market.breaking ? "on" : ""}`} role="switch" aria-checked={market.breaking} disabled={created || busy} onClick={() => market.setBreaking(!market.breaking)}>
              <span className="knob" aria-hidden="true" /> Live event — trades on Panta now
            </button>
            <div className="gm-seg" role="radiogroup" aria-label="Trading on the market ends in">
              {MARKET_ENDS.filter((o) => market.breaking || o.sec >= 3 * 3_600).map((o) => (
                <button key={o.label} role="radio" aria-checked={market.endsSec === o.sec} disabled={created || busy} className={`opt ${market.endsSec === o.sec ? "on" : ""}`} onClick={() => market.setEndsSec(o.sec)}>{o.label}</button>
              ))}
            </div>
          </div>
          <p className="jc-help">
            Panta&apos;s AI resolver settles it after trading ends, using your rule and source.
            {market.breaking ? " A live event trades on Panta immediately." : " A scheduled market opens on Panta about an hour from now — your pit still runs right away."}
          </p>
          {market.fieldError && <p className="jc-error" role="alert">{market.fieldError.message}</p>}
          {market.quote && (
            <div className={`mkt-fee ${market.quote.sandbox ? "free" : ""}`} role="status">
              {market.quote.created ? <><b>Market created on Panta.</b> Your pit opens on it — press below to try again if it didn&apos;t. <button type="button" className="link-btn" onClick={market.startOver} disabled={busy}>Write a different market</button></>
                : market.quote.sandbox ? <><b>No creation fee — Panta sandbox.</b> On mainnet Panta charges a creation fee (it seeds the market&apos;s liquidity); you&apos;d see it here before signing.</>
                : <><b>Creation fee {usd2.format(market.quote.feeUsdc)}</b> — paid to Panta when you sign{market.quote.liquidityUsdc > 0 ? <>, {usd2.format(market.quote.liquidityUsdc)} of it seeds the market&apos;s liquidity</> : null}. As creator you earn a share of trading fees once it graduates.</>}
            </div>
          )}
        </div>
      )}

      <div className="gm-seg" role="radiogroup" aria-label="Start mode">
        <button role="radio" aria-checked={hMode === "quick"} className={`opt ${hMode === "quick" ? "on" : ""}`} onClick={() => setHMode("quick")}>Quick</button>
        <button role="radio" aria-checked={hMode === "scheduled"} className={`opt ${hMode === "scheduled" ? "on" : ""}`} onClick={() => setHMode("scheduled")}>Scheduled</button>
      </div>
      <p className="jc-help">
        {hMode === "quick"
          ? "Stays open 2 minutes after your seat is confirmed, or until every seat fills."
          : "Stays open for the window you pick (counted from your seat), or until every seat fills."}
      </p>

      {hMode === "scheduled" && (
        <FieldRow label="Enrollment window">
          <div className="gm-seg">
            {[5, 15, 30, 60, 180].map((m) => (
              <button key={m} className={`opt ${hStartInMin === m ? "on" : ""}`} onClick={() => setHStartInMin(m)}>
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>
        </FieldRow>
      )}

      <FieldRow label="Game">
        <div className="gm-seg">
          <button className={`opt ${hFormat === "single" ? "on" : ""}`} onClick={() => setHFormat("single")}>Single</button>
          <button className={`opt ${hFormat === "royale" ? "on" : ""}`} onClick={() => setHFormat("royale")}>Royale</button>
          {!pantaHost && <button className={`opt ${hFormat === "predictions" ? "on" : ""}`} onClick={() => setHFormat("predictions")}>Predictions</button>}
          {!pantaHost && <button className={`opt ${hFormat === "streak" ? "on" : ""}`} onClick={() => setHFormat("streak")}>Streak</button>}
        </div>
      </FieldRow>
      <p className="jc-help">
        {streak ? `No trading. Quick calls on BTC, ETH and SOL, one per leg — a wrong pick and you're out. Last caller standing takes the pool.`
          : picks ? "No trading. Everyone answers five questions on BTC, ETH and SOL; most points take the pool, and a lock can double your best calls."
          : hFormat === "royale" ? `Trade ${Yw}/${Nw} over several rounds; the bottom half is cut each round.`
          : `Trade ${Yw}/${Nw} for one round; the top finishers split the pool.`}
      </p>

      <div className="jc-host-grid">
        {!picks && !pantaHost && (
          <FieldRow label="Coin">
            <div className="gm-seg">
              {(["BTC", "ETH", "SOL"] as const).map((a) => (
                <button key={a} className={`opt ${hAsset === a ? "on" : ""}`} onClick={() => setHAsset(a)}>{a}</button>
              ))}
            </div>
          </FieldRow>
        )}
        {streak ? (
          <FieldRow label="Leg length">
            <div className="gm-seg">
              {LEG_LENGTHS.map((sec) => (
                <button key={sec} className={`opt ${hLegSec === sec ? "on" : ""}`} onClick={() => setHLegSec(sec)}>{sec / 60}m</button>
              ))}
            </div>
          </FieldRow>
        ) : pantaHost ? (
          <FieldRow label="Trading window">
            <div className="gm-seg">
              {PIT_WINDOWS.map((m) => (
                <button key={m} className={`opt ${market.windowMin === m ? "on" : ""}`} onClick={() => market.setWindowMin(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>
              ))}
            </div>
          </FieldRow>
        ) : (
          <FieldRow label="Timeframe">
            <div className="gm-seg">
              {(["MIN5", "MIN15", "HOUR"] as const).map((h) => (
                <button key={h} className={`opt ${hHorizon === h ? "on" : ""}`} onClick={() => setHHorizon(h)}>{HORIZON_LABEL[h]}</button>
              ))}
            </div>
          </FieldRow>
        )}
        <FieldRow label="Players">
          <div className="gm-seg">
            {[2, 4, 8, 12, 16].map((n) => (
              <button key={n} className={`opt ${hCapacity === n ? "on" : ""}`} onClick={() => setHCapacity(n)}>{n}</button>
            ))}
          </div>
        </FieldRow>
        {hFormat === "royale" && (
          <FieldRow label="Rounds">
            <div className="gm-seg">
              {[2, 3, 4].map((n) => (
                <button key={n} className={`opt ${hRounds === n ? "on" : ""}`} onClick={() => setHRounds(n)}>{n}</button>
              ))}
            </div>
          </FieldRow>
        )}
      </div>

      <div className="jc-host-inputs">
        <label className="gm-num">
          <span>Entry (USDC)</span>
          <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" aria-describedby="entry-help" />
          <em id="entry-help">Into the shared prize pool · $1–100</em>
        </label>
        {!picks && (
          <label className="gm-num">
            <span>Vault (USDC)</span>
            <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" aria-describedby="vault-help" />
            <em id="vault-help">Your trading bankroll · $5–500</em>
          </label>
        )}
      </div>

      <FieldRow label="Host fee">
        <div className="gm-seg">
          {HOST_FEE_OPTIONS.map((p) => (
            <button key={p} className={`opt ${hHostFee === p ? "on" : ""}`} onClick={() => setHHostFee(p)}>{p}%</button>
          ))}
        </div>
      </FieldRow>
      <p className="jc-help">
        {hHostFee > 0
          ? `You keep ${hHostFee}% of the prize pool (${usd2.format((poolIfFull * hHostFee) / 100)} if full), paid with your own payout. Players see it before they join.`
          : "Optional: keep up to 5% of the prize pool for hosting. Players see it before they join."}
      </p>

      <div className="jc-host-preview">
        <div><span>Seat cost</span><b>{usd2.format(hostSeat)}</b></div>
        <div><span>Pool if full</span><b className="plasma">{usd2.format(poolIfFull)}</b></div>
        <div><span>Prize</span><b>{hCapacity <= 2 ? "Winner takes all" : "Top 3 split"}</b></div>
      </div>


      {/* Seat 1 is a real position — say which way it goes before any deposit. */}
      {picks ? (
        <p className="jc-help call-help">
          {streak
            ? `You take seat 1. The game starts when enrollment closes: up to ${MAX_LEGS} legs, 20 seconds to pick each — stay on the pit page while you play.`
            : "You take seat 1. Right after the pit opens you make your five picks on its page — they stay hidden and lock when enrollment closes."}
        </p>
      ) : (
      <div className="jc-field host-call">
        <span className="jc-field-label">Your call on {subject}</span>
        <div className="gm-seg call-seg" role="radiogroup" aria-label="Your opening call">
          <button role="radio" aria-checked={hCall === "YES"} className={`opt up ${hCall === "YES" ? "on" : ""}`} onClick={() => setHCall("YES")}>▲ {pantaHost ? "Yes" : "Up"}</button>
          <button role="radio" aria-checked={hCall === "NO"} className={`opt down ${hCall === "NO" ? "on" : ""}`} onClick={() => setHCall("NO")}>▼ {pantaHost ? "No" : "Down"}</button>
          <button role="radio" aria-checked={hCall === "LATER"} className={`opt ${hCall === "LATER" ? "on" : ""}`} onClick={() => setHCall("LATER")}>Decide later</button>
        </div>
        {(hCall === "YES" || hCall === "NO") && (
          <CallSizePicker value={hCallPct} onChange={setHCallPct} vault={Number(hVault) || 0} disabled={busy} />
        )}
        <p className={`jc-help call-help ${hCall ? "" : "need"}`} role="status">
          {pantaHost
            ? (!hCall
              ? "You take seat 1: pick YES if you think it happens, NO if not — or decide once trading opens. Seat calls fill at Panta's line, then the room trades its own odds."
              : hCall === "LATER"
                ? "Your vault stays in cash. You pick YES or NO, and how much, once trading starts."
                : `${callSizeText(hCallPct, Number(hVault) || 0).stake.replace(/^./, (c) => c.toUpperCase())} goes on ${hCall} at Panta's opening line when trading starts. ${callSizeText(hCallPct, Number(hVault) || 0).rest ?? ""} You can switch any time during the round.`)
          : !hCall
            ? `You take seat 1: pick UP if you think ${hAsset} finishes the round above its opening price, DOWN if below — or decide once trading opens.`
            : hCall === "LATER"
              ? `Your vault stays in cash. The round opens at ${hAsset}'s live price; you pick UP or DOWN once trading starts.`
              : `${callSizeText(hCallPct, Number(hVault) || 0).stake.replace(/^./, (c) => c.toUpperCase())} goes on ${hCall === "YES" ? "UP" : "DOWN"} at ${hAsset}'s opening price when trading starts — each share pays $1 if ${hAsset} closes ${hCall === "YES" ? "higher" : "lower"}. ${callSizeText(hCallPct, Number(hVault) || 0).rest ?? ""} You can switch any time during the round.`}
        </p>
      </div>
      )}

      {inputError && <p className="jc-error" role="alert">{inputError}</p>}
      {escrowKnown && !escrowActive && (
        <p className="jc-note"><b>Practice mode.</b> Hosting works, but no USDC moves and nothing is signed.</p>
      )}

      <button
        className="gm-host-cta"
        onClick={onSubmit}
        disabled={!wallet
          ? authStatus === "busy" || authStatus === "loading"
          : busy || !!inputError || (!hCall && !picks && !quoting) || (src === "panta" && !market.pantaId) || (src === "create" && market.question.trim().length < 10)}
        aria-busy={busy || authStatus === "busy"}
      >
        {label}
      </button>
    </div>
  );
}

type MarketProps = {
  source: MarketSource; setSource: (v: MarketSource) => void;
  catalog: { loaded: boolean; available: boolean; sandbox: boolean; items: CatalogItem[] };
  pantaId: string; setPantaId: (v: string) => void;
  windowMin: number; setWindowMin: (v: number) => void;
  question: string; setQuestion: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  rule: string; setRule: (v: string) => void;
  source2: string; setSource2: (v: string) => void;
  endsSec: number; setEndsSec: (v: number) => void;
  breaking: boolean; setBreaking: (v: boolean) => void;
  quote: (MarketQuote & { created?: boolean }) | null;
  fieldError: { field?: string; message: string } | null;
  startOver: () => void;
};

function closesIn(endMs: number): string {
  const ms = endMs - Date.now();
  if (ms <= 0) return "closed";
  const h = ms / 3_600_000;
  return h >= 48 ? `${Math.round(h / 24)}d left` : h >= 1 ? `${Math.round(h)}h left` : `${Math.max(1, Math.round(ms / 60_000))}m left`;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="jc-field">
      <span className="jc-field-label">{label}</span>
      {children}
    </div>
  );
}

/* ── Invite result ───────────────────────────────────────────────── */
function InviteResult({
  info, picks, streak, onCopy, onOpen, onReset
}: { info: { code: string; url: string }; picks: boolean; streak: boolean; onCopy: (url: string) => void; onOpen: () => void; onReset: () => void }) {
  const text = `Take a seat in my pit on The Pit · ${info.url}`;
  return (
    <div className="jc-invite">
      <p className="jc-invite-lead">{streak ? "Your pit is open. Share the code or link — Streak is best with a crowd." : picks ? "Your pit is open. Make your five picks there, then share the code or link." : "Your pit is open. Share the code or link."}</p>
      <div className="gm-invite-code" aria-label={`Pit code ${info.code}`}>{info.code}</div>
      <div className="gm-invite-url">
        <input readOnly value={info.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
        <button className="btn-host" style={{ height: 42, padding: "0 16px", fontSize: 11 }} onClick={() => onCopy(info.url)}>Copy</button>
      </div>
      <div className="jc-share">
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`}>Share on X</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(info.url)}&text=${encodeURIComponent("Take a seat in my pit on The Pit")}`}>Telegram</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>WhatsApp</a>
      </div>
      <button className="gm-host-cta" onClick={onOpen}>{streak ? `Enter ${info.code} and pick leg 1` : picks ? `Make my picks in ${info.code}` : `Enter pit ${info.code}`}</button>
      <button className="link-btn" onClick={onReset} style={{ marginTop: 10 }}>Host another pit</button>
    </div>
  );
}
