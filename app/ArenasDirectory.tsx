"use client";

/**
 * Home — a single-viewport lobby. Left: what Oracle Rumble is. Right: a
 * card with two tabs, Join (live arenas) and Host (open a new arena).
 * Positions and Docs are their own routes, reached from the header.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelArena, checkSeatFunds, enrollWithEscrow, newRound, prepareWallet, seatStepText, type SeatStep } from "@/lib/round-client";
import { shortPk, USERNAME_MAX, validateUsername } from "@/lib/username";
import { DEFAULT_OPENING_CALL_PCT, hostAmountError } from "@/lib/royale";
import CallSizePicker, { callSizeText } from "@/app/CallSizePicker";
import { avatarDataUrl } from "@/lib/avatars";
import { useEscrowStatus, useWalletIdentity } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import UsernameModal from "@/app/UsernameModal";
import PantaGraduationBanner from "@/app/PantaGraduationBanner";
import AmbientLife from "@/app/AmbientLife";
import ActivityFeed from "@/app/ActivityFeed";
import SeatRing from "@/app/SeatRing";
import CountUp from "@/app/CountUp";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

type ArenaItem = {
  arenaCode: string;
  isPublic: boolean;
  inviteSlug: string;
  status: string;
  roundNumber: number;
  roundLimit: number;
  format: "single" | "royale";
  asset: string;
  marketQuestion: string;
  capacity: number;
  entryUsdc: number;
  startingBankroll: number;
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
type HostStep = "" | "checking" | "opening" | SeatStep;

export default function ArenasDirectory() {
  const { wallet, username, toggleConnect, saveUsername } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [arenas, setArenas] = useState<ArenaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);
  const [hostStep, setHostStep] = useState<HostStep>("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<Tab>("play");
  const [showUsername, setShowUsername] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const [hMode, setHMode] = useState<"quick" | "scheduled">("quick");
  const [hAsset, setHAsset] = useState<"BTC" | "ETH" | "SOL">("SOL");
  const [hHorizon, setHHorizon] = useState<"MIN5" | "MIN15" | "HOUR" | "DAY">("MIN5");
  const [hFormat, setHFormat] = useState<"single" | "royale">("single");
  const [hRounds, setHRounds] = useState(2);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  const [hStartInMin, setHStartInMin] = useState(15);
  // The host's own opening call (they take seat 1 like everyone else).
  const [hCall, setHCall] = useState<"YES" | "NO" | "LATER" | "">("");
  const [hCallPct, setHCallPct] = useState<number>(DEFAULT_OPENING_CALL_PCT);
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);

  useEffect(() => {
    document.body.classList.add("game-mode", "no-scroll");
    // Deep link from other pages' "Host" nav item.
    if (new URLSearchParams(window.location.search).get("tab") === "host") setTab("host");
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
    const r = await toggleConnect();
    setToast(r.message);
    if (r.needsUsername) setShowUsername(true);
  }, [toggleConnect]);

  const entryNum = Number(hEntry) || 0;
  const vaultNum = Number(hVault) || 0;
  const hostSeat = entryNum + vaultNum;
  const poolIfFull = entryNum * hCapacity;
  const hostInputError = hostAmountError(entryNum, vaultNum);

  const doHostAndJoin = useCallback(async () => {
    if (hostInputError) { setToast(hostInputError); return; }
    if (!hCall) { setToast(`Pick UP or DOWN on ${hAsset} (or decide later) before taking seat 1.`); return; }
    // On-chain hosting needs the host's own seat deposit signature.
    if (escrow?.active && !wallet) {
      setToast("Connect a wallet first — hosting on-chain needs your seat deposit.");
      return;
    }
    let hostName = username;
    if (wallet && !hostName) {
      // Username typed inline in the host card — save it on the way through.
      const r = saveUsername(nameDraft);
      if (!r.ok) { setToast(nameDraft ? r.message : "Set a username so players know who is hosting."); return; }
      hostName = nameDraft.trim();
    }

    const call = hCall === "LATER" ? null : hCall;
    const onStep = (step: SeatStep, name?: string) => { setHostStep(step); setToast(seatStepText(step, hostSeat, call, name).toast); };
    try {
      // Check funds and the wallet BEFORE the operator pays for an on-chain
      // InitRound, so a declined sign-in doesn't leave a cancelled arena.
      if (wallet && escrow?.active) {
        setHostStep("checking");
        const short = await checkSeatFunds(wallet, hostSeat);
        if (short) { setToast(short); return; }
      }
      if (wallet) {
        const ready = await prepareWallet(wallet, onStep);
        if (!ready.ok) { setToast(ready.error); return; }
      }

      setHostStep("opening");
      const enrollmentSec = hMode === "scheduled" ? hStartInMin * 60 : QUICK_ENROLL_SEC;
      const v = await newRound({
        asset: hAsset, horizon: hHorizon, format: hFormat,
        entryUsdc: entryNum, startingBankroll: vaultNum,
        capacity: hCapacity, roundLimit: hFormat === "royale" ? hRounds : 1,
        enrollmentSec, host: wallet ?? ""
      });
      if (v.error || !v.arena) { setToast(v.error ?? "Could not open the arena."); return; }
      const url = `${window.location.origin}/a/${v.arena}`;

      if (!wallet) {
        setInviteInfo({ code: v.arena, url });
        refresh();
        return;
      }

      // The host takes seat #1. If that deposit isn't signed, roll the
      // arena back so no unfunded room is left behind.
      let enrollError = "";
      let refundable = false;
      try {
        const r = await enrollWithEscrow(wallet, hostName || shortPk(wallet).replace("…", ""), v.arena, call, onStep, hCallPct);
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
        setToast(`Arena not opened — ${enrollError}`);
        return;
      }

      setInviteInfo({ code: v.arena, url });
      setToast(`Arena ${v.arena} is open — you're in seat 1. Share the link.`);
      refresh();
    } finally { setHostStep(""); }
  }, [hostInputError, escrow, wallet, username, nameDraft, saveUsername, hostSeat, hMode, hStartInMin, hAsset, hHorizon, hFormat, entryNum, vaultNum, hCapacity, hRounds, hCall, hCallPct, refresh]);

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
        wallet={wallet}
        username={username}
        escrow={escrow}
        onConnect={connect}
        onEditUsername={() => setShowUsername(true)}
        onNav={(k) => setTab(k === "arenas" ? "play" : "host")}
      />

      <section className="jumper-stage">
        <div className="jumper-tagline">
          <p className="jt-eyebrow">Prediction-market battle royale · Solana</p>
          <h1 className="jt-title" data-text="Call it. Outplay the room.">
            <span className="hl-a">Call it.</span><br />
            <span className="hl-b">Outplay</span> the room.
          </h1>
          <p className="jt-lead">
            Everyone pays the same seat, calls UP or DOWN on the same live market, and is ranked by
            vault value. The top finishers take the pool — in a royale, the bottom half is cut each round.
          </p>

          <ol className="jt-steps">
            <li><b>01</b><span>Take a seat — entry funds the pool, the vault is your bankroll.</span></li>
            <li><b>02</b><span>Call UP or DOWN on BTC, ETH or SOL. The round opens at the live price and pays out on the real move.</span></li>
            <li><b>03</b><span>Survive the cut. Top finishers claim the pool to their wallet.</span></li>
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
            <li>Live price oracle</li>
            <li>No house cut</li>
          </ul>

          <ActivityFeed />
        </div>

        <div className="jumper-card">
          <div className="jc-tabs" role="tablist" aria-label="Arena actions">
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
                hRounds={hRounds} setHRounds={setHRounds}
                hCapacity={hCapacity} setHCapacity={setHCapacity}
                hEntry={hEntry} setHEntry={setHEntry}
                hVault={hVault} setHVault={setHVault}
                hCall={hCall} setHCall={setHCall} hCallPct={hCallPct} setHCallPct={setHCallPct}
                hostSeat={hostSeat} poolIfFull={poolIfFull}
                inputError={hostInputError}
                wallet={wallet} escrowActive={!!escrow?.active} escrowKnown={escrow != null}
                username={username} nameDraft={nameDraft} setNameDraft={setNameDraft}
                onEditUsername={() => setShowUsername(true)} onConnect={connect}
                step={hostStep} onSubmit={doHostAndJoin}
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

      {showUsername && (
        <UsernameModal
          initial={username}
          onSave={(v) => { const r = saveUsername(v); if (r.ok) setToast(r.message); return r; }}
          onClose={() => setShowUsername(false)}
        />
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
    return <div className="jc-empty" role="status"><p>Loading arenas…</p></div>;
  }
  if (!featured) {
    return (
      <div className="jc-empty">
        <div className="jc-empty-icon" aria-hidden="true">◆</div>
        <h3>No arenas open</h3>
        <p>Open one in under a minute, then share the invite link with the players you want in the room.</p>
        <button className="btn-cta" onClick={onSwitchToHost}>Host an arena</button>
        <a className="jc-practice" href="/a/PUBLIC">New here? Play a free practice round against bots →</a>
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
                  <span className="q">{a.asset} · {a.marketQuestion}</span>
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
  hFormat, setHFormat, hRounds, setHRounds,
  hCapacity, setHCapacity, hEntry, setHEntry, hVault, setHVault, hCall, setHCall, hCallPct, setHCallPct,
  hostSeat, poolIfFull, inputError, wallet, escrowActive, escrowKnown,
  username, nameDraft, setNameDraft, onEditUsername, onConnect, step, onSubmit
}: {
  hMode: "quick" | "scheduled"; setHMode: (v: "quick" | "scheduled") => void;
  hStartInMin: number; setHStartInMin: (v: number) => void;
  hAsset: "BTC" | "ETH" | "SOL"; setHAsset: (v: "BTC" | "ETH" | "SOL") => void;
  hHorizon: "MIN5" | "MIN15" | "HOUR" | "DAY"; setHHorizon: (v: "MIN5" | "MIN15" | "HOUR" | "DAY") => void;
  hFormat: "single" | "royale"; setHFormat: (v: "single" | "royale") => void;
  hRounds: number; setHRounds: (v: number) => void;
  hCapacity: number; setHCapacity: (v: number) => void;
  hEntry: string; setHEntry: (v: string) => void;
  hVault: string; setHVault: (v: string) => void;
  hCall: "YES" | "NO" | "LATER" | ""; setHCall: (v: "YES" | "NO" | "LATER") => void;
  hCallPct: number; setHCallPct: (v: number) => void;
  hostSeat: number; poolIfFull: number; inputError: string;
  wallet: string | null; escrowActive: boolean; escrowKnown: boolean;
  username: string; nameDraft: string; setNameDraft: (v: string) => void;
  onEditUsername: () => void; onConnect: () => void;
  step: HostStep; onSubmit: () => void;
}) {
  const busy = step !== "";
  const draftCheck = validateUsername(nameDraft);
  const needsWallet = escrowActive && !wallet;
  const label =
    step === "checking" ? "Checking balance…" :
    step === "opening" ? "Opening arena…" :
    step ? seatStepText(step, hostSeat).button :
    !wallet && !escrowActive ? "Host practice arena" :
    !hCall ? `Pick UP or DOWN on ${hAsset}` :
    `${hCall === "YES" ? "Deposit & call UP" : hCall === "NO" ? "Deposit & call DOWN" : "Deposit & take seat 1"} · ${usd2.format(hostSeat)}${escrowActive ? "" : " · practice"}`;

  return (
    <div className="jc-host">
      {/* Who is hosting — set the username right here if it's missing. */}
      {needsWallet ? (
        <div className="host-id">
          <span>Connect a wallet to host — you take seat 1 with a real deposit.</span>
          <button className="host-id-btn" onClick={onConnect}>Connect wallet</button>
        </div>
      ) : wallet && username ? (
        <div className="host-id">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarDataUrl(wallet, 26)} width={26} height={26} alt="" className="host-id-avatar" />
          <span>Hosting as <b>{username}</b></span>
          <button className="link-btn" onClick={onEditUsername}>Change</button>
        </div>
      ) : wallet ? (
        <label className="host-name">
          <span className="jc-field-label">Your username</span>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="e.g. nova_9"
            maxLength={USERNAME_MAX}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={nameDraft.length > 0 && !draftCheck.ok}
            aria-describedby="host-name-hint"
          />
          <span id="host-name-hint" className={`username-hint ${nameDraft.length === 0 ? "" : draftCheck.ok ? "ok" : "bad"}`}>
            {nameDraft.length === 0 ? "How players will see you — 3–16 letters, numbers or _" : draftCheck.ok ? "Saved when you host." : draftCheck.reason}
          </span>
        </label>
      ) : null}

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

      <div className="jc-host-grid">
        <FieldRow label="Market">
          <div className="gm-seg">
            {(["BTC", "ETH", "SOL"] as const).map((a) => (
              <button key={a} className={`opt ${hAsset === a ? "on" : ""}`} onClick={() => setHAsset(a)}>{a}</button>
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Timeframe">
          <div className="gm-seg">
            {(["MIN5", "MIN15", "HOUR"] as const).map((h) => (
              <button key={h} className={`opt ${hHorizon === h ? "on" : ""}`} onClick={() => setHHorizon(h)}>{HORIZON_LABEL[h]}</button>
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Format">
          <div className="gm-seg">
            <button className={`opt ${hFormat === "single" ? "on" : ""}`} onClick={() => setHFormat("single")}>Single</button>
            <button className={`opt ${hFormat === "royale" ? "on" : ""}`} onClick={() => setHFormat("royale")}>Royale</button>
          </div>
        </FieldRow>
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
        <label className="gm-num">
          <span>Vault (USDC)</span>
          <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" aria-describedby="vault-help" />
          <em id="vault-help">Your trading bankroll · $5–500</em>
        </label>
      </div>

      <div className="jc-host-preview">
        <div><span>Seat cost</span><b>{usd2.format(hostSeat)}</b></div>
        <div><span>Pool if full</span><b className="plasma">{usd2.format(poolIfFull)}</b></div>
        <div><span>Prize</span><b>{hCapacity <= 2 ? "Winner takes all" : "Top 3 split"}</b></div>
      </div>


      {/* Seat 1 is a real position — say which way it goes before any deposit. */}
      <div className="jc-field host-call">
        <span className="jc-field-label">Your call on {hAsset}</span>
        <div className="gm-seg call-seg" role="radiogroup" aria-label="Your opening call">
          <button role="radio" aria-checked={hCall === "YES"} className={`opt up ${hCall === "YES" ? "on" : ""}`} onClick={() => setHCall("YES")}>▲ Up</button>
          <button role="radio" aria-checked={hCall === "NO"} className={`opt down ${hCall === "NO" ? "on" : ""}`} onClick={() => setHCall("NO")}>▼ Down</button>
          <button role="radio" aria-checked={hCall === "LATER"} className={`opt ${hCall === "LATER" ? "on" : ""}`} onClick={() => setHCall("LATER")}>Decide later</button>
        </div>
        {(hCall === "YES" || hCall === "NO") && (
          <CallSizePicker value={hCallPct} onChange={setHCallPct} vault={Number(hVault) || 0} disabled={busy} />
        )}
        <p className={`jc-help call-help ${hCall ? "" : "need"}`} role="status">
          {!hCall
            ? `You take seat 1: pick UP if you think ${hAsset} finishes the round above its opening price, DOWN if below — or decide once trading opens.`
            : hCall === "LATER"
              ? `Your vault stays in cash. The round opens at ${hAsset}'s live price; you pick UP or DOWN once trading starts.`
              : `${callSizeText(hCallPct, Number(hVault) || 0).stake.replace(/^./, (c) => c.toUpperCase())} goes on ${hCall === "YES" ? "UP" : "DOWN"} at ${hAsset}'s opening price when trading starts — each share pays $1 if ${hAsset} closes ${hCall === "YES" ? "higher" : "lower"}. ${callSizeText(hCallPct, Number(hVault) || 0).rest ?? ""} You can switch any time during the round.`}
        </p>
      </div>

      {inputError && <p className="jc-error" role="alert">{inputError}</p>}
      {escrowKnown && !escrowActive && (
        <p className="jc-note"><b>Practice mode.</b> Hosting works, but no USDC moves and your wallet won&apos;t be asked to sign.</p>
      )}

      <button className="gm-host-cta" onClick={onSubmit} disabled={busy || !!inputError || needsWallet || (!!wallet && !hCall)} aria-busy={busy}>
        {label}
      </button>
    </div>
  );
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
  info, onCopy, onOpen, onReset
}: { info: { code: string; url: string }; onCopy: (url: string) => void; onOpen: () => void; onReset: () => void }) {
  const text = `Join my Oracle Rumble arena · ${info.url}`;
  return (
    <div className="jc-invite">
      <p className="jc-invite-lead">Your arena is open. Share the code or link.</p>
      <div className="gm-invite-code" aria-label={`Arena code ${info.code}`}>{info.code}</div>
      <div className="gm-invite-url">
        <input readOnly value={info.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
        <button className="btn-host" style={{ height: 42, padding: "0 16px", fontSize: 11 }} onClick={() => onCopy(info.url)}>Copy</button>
      </div>
      <div className="jc-share">
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`}>Share on X</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(info.url)}&text=${encodeURIComponent("Join my Oracle Rumble arena")}`}>Telegram</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>WhatsApp</a>
      </div>
      <button className="gm-host-cta" onClick={onOpen}>Enter arena {info.code}</button>
      <button className="link-btn" onClick={onReset} style={{ marginTop: 10 }}>Host another arena</button>
    </div>
  );
}
