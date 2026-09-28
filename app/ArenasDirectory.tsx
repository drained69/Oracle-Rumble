"use client";

/**
 * Arenas directory — Jumper-style single-viewport widget.
 * No scrolling on the main entry: a centered card with two clickable tabs
 * (Play, Host). Long-form content lives on /docs. Deep views like
 * /positions live on their own routes reached from the header.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectSolanaWallet } from "@/lib/panta-client";
import { cancelArena, enrollWithEscrow, newRound } from "@/lib/round-client";
import {
  getStoredUsername,
  saveStoredUsername,
  validateUsername,
  USERNAME_MAX
} from "@/lib/username";
import PantaGraduationBanner from "@/app/PantaGraduationBanner";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const WALLET_KEY = "oracle-rumble/wallet/v1";
const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

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

function shortPk(pk: string) {
  if (!pk) return "";
  if (pk.length <= 10) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}
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

export default function ArenasDirectory() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [arenas, setArenas] = useState<ArenaItem[]>([]);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [escrow, setEscrow] = useState<{ active: boolean; reason?: string | null } | null>(null);
  const [tab, setTab] = useState<Tab>("play");

  const [hMode, setHMode] = useState<"quick" | "scheduled">("quick");
  const [hAsset, setHAsset] = useState<"BTC" | "ETH" | "SOL">("SOL");
  const [hHorizon, setHHorizon] = useState<"MIN5" | "MIN15" | "HOUR" | "DAY">("MIN5");
  const [hFormat, setHFormat] = useState<"single" | "royale">("single");
  const [hRounds, setHRounds] = useState(2);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  const [hStartInMin, setHStartInMin] = useState(15);
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);
  const [callsign, setCallsign] = useState<string>("");
  const [showCallsign, setShowCallsign] = useState(false);
  const [csDraft, setCsDraft] = useState("");

  useEffect(() => {
    document.body.classList.add("game-mode");
    document.body.classList.add("no-scroll");
    return () => {
      document.body.classList.remove("game-mode");
      document.body.classList.remove("no-scroll");
    };
  }, []);

  useEffect(() => {
    try {
      const w = localStorage.getItem(WALLET_KEY);
      if (w) {
        setWallet(w);
        const u = getStoredUsername(w);
        setCallsign(u);
      }
    } catch { /* ignore */ }
    fetch("/api/escrow/status", { cache: "no-store" }).then((r) => r.json()).then(setEscrow).catch(() => setEscrow({ active: false, reason: "unreachable" }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const aRes = await fetch("/api/arenas", { cache: "no-store" }).then((r) => r.json());
      setArenas(aRes.items ?? []);
    } catch { /* transient */ }
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
    const id = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const connect = useCallback(async () => {
    if (wallet) {
      setWallet(null);
      setCallsign("");
      try { localStorage.removeItem(WALLET_KEY); } catch { /* ignore */ }
      setToast("Wallet disconnected.");
      return;
    }
    const real = await connectSolanaWallet();
    if (real) {
      setWallet(real);
      try { localStorage.setItem(WALLET_KEY, real); } catch { /* ignore */ }
      const stored = getStoredUsername(real);
      setCallsign(stored);
      if (stored) {
        setToast(`Connected as ${stored}.`);
      } else {
        // First time this wallet appears — prompt for a callsign right away.
        setCsDraft("");
        setShowCallsign(true);
        setToast(`Connected · ${shortPk(real)} · pick a callsign.`);
      }
    } else setToast("No Solana wallet found. Install Phantom, Backpack or Solflare.");
  }, [wallet]);

  const saveCallsign = useCallback(() => {
    if (!wallet) { setToast("Connect a wallet first."); return; }
    const v = validateUsername(csDraft);
    if (!v.ok) { setToast(v.reason); return; }
    saveStoredUsername(wallet, v.value);
    setCallsign(v.value);
    setShowCallsign(false);
    setToast(`Callsign set to ${v.value}.`);
  }, [wallet, csDraft]);

  const hostSeat = (Number(hEntry) || 0) + (Number(hVault) || 0);
  const poolIfFull = (Number(hEntry) || 0) * hCapacity;

  const doHostAndJoin = useCallback(async () => {
    // Real-mode guard: on-chain hosting requires a wallet signature for the
    // host's own seat deposit. Refuse before we spend an on-chain InitRound
    // tx on an arena the caller can't actually fund.
    if (escrow?.active && !wallet) {
      setToast("Connect a wallet first — hosting on-chain needs your seat deposit signature.");
      return;
    }
    // Callsign is required for the host — it shows on every arena screen.
    if (wallet && !callsign) {
      setCsDraft("");
      setShowCallsign(true);
      setToast("Pick a callsign before hosting your arena.");
      return;
    }

    setBusy(true);
    let openedArena: string | null = null;
    try {
      const enrollmentSec = hMode === "scheduled" ? hStartInMin * 60 : undefined;
      const v = await newRound({
        asset: hAsset, horizon: hHorizon, format: hFormat,
        entryUsdc: Number(hEntry) || 1, startingBankroll: Number(hVault) || 5,
        capacity: hCapacity, roundLimit: hFormat === "royale" ? hRounds : 1,
        enrollmentSec, host: wallet ?? ""
      });
      if (v.error || !v.arena) { setToast(v.error ?? "Host failed."); return; }
      openedArena = v.arena;
      const url = `${window.location.origin}/a/${v.arena}`;

      // Practice-mode fast path: no wallet, no deposit — arena is a walk-in.
      if (!wallet) {
        setInviteInfo({ code: v.arena, url });
        refresh();
        return;
      }

      // Real-mode / practice-with-wallet: the host must sign the seat
      // deposit BEFORE we show the invite screen. If signing fails or the
      // wallet is dismissed, cancel the arena we just opened so the room
      // doesn't linger as an unfunded orphan.
      const nick = callsign || getStoredUsername(wallet) || shortPk(wallet).replace("…", "");
      if (escrow?.active) setToast("Sign the seat deposit in your wallet…");
      let enrollError = "";
      try {
        const r = await enrollWithEscrow(wallet, nick, v.arena);
        if (r.error) enrollError = r.error;
      } catch (err) {
        enrollError = err instanceof Error ? err.message : "wallet signing failed";
      }

      if (enrollError) {
        // Roll the arena back — we never funded seat #1.
        await cancelArena(v.arena, wallet).catch(() => { /* best effort */ });
        openedArena = null;
        setToast(`Host cancelled: ${enrollError}`);
        return;
      }

      setInviteInfo({ code: v.arena, url });
      refresh();
    } finally { setBusy(false); }
  }, [hMode, hStartInMin, hAsset, hHorizon, hFormat, hEntry, hVault, hCapacity, hRounds, wallet, escrow, refresh, callsign]);

  const doCopy = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); setToast("Invite link copied."); }
    catch { setToast("Copy failed."); }
  }, []);

  const goTo = useCallback((slug: string) => { window.location.href = slug; }, []);

  const active = arenas.filter((a) => !a.isPublic && ["enrolling", "live", "settling", "advancing"].includes(a.status));
  const liveOnly = active.filter((a) => a.status === "live" || a.status === "enrolling");
  const featured = liveOnly.find((a) => a.status === "live")
    ?? liveOnly.find((a) => a.status === "enrolling")
    ?? liveOnly[0]
    ?? null;
  const others = active.filter((a) => a.arenaCode !== featured?.arenaCode);

  const totals = useMemo(() => ({
    pool: active.reduce((s, a) => s + a.prizePoolUsdc, 0),
    alive: active.reduce((s, a) => s + a.alive, 0),
    live: active.filter((a) => a.status === "live").length
  }), [active]);

  return (
    <main className="game-main jumper">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      {/* Floating pixel tabbar (unchanged) */}
      <nav className="hud-bar game-hud">
        <div className="tabbar-inner">
          <a href="/" className="brand" aria-label="Oracle Rumble">
            <BrandMark />
            ORACLE RUMBLE
          </a>
          <div className="hud-nav">
            <button className={`nav-link ${tab === "play" ? "active" : ""}`} onClick={() => setTab("play")}>Play</button>
            <button className={`nav-link ${tab === "host" ? "active" : ""}`} onClick={() => setTab("host")}>Host</button>
            <a href="/positions">Positions</a>
            <a href="/docs">Docs</a>
          </div>
          <div className="hud-right">
            <span
              className={`system-chip ${escrow?.active ? "on" : "off"}`}
              title={`Solana ${CLUSTER} · ${escrow?.active ? "on-chain escrow" : `practice mode (${escrow?.reason ?? "escrow off"})`}`}
            >
              <span className="dot" />
              {CLUSTER}
            </span>
            {wallet && (
              <button
                className="callsign-chip"
                onClick={() => { setCsDraft(callsign); setShowCallsign(true); }}
                title="Edit your callsign"
              >
                {callsign || "set callsign"}
              </button>
            )}
            <button className={wallet ? "wallet game connected" : "wallet game"} onClick={connect}>
              <span className="avatar">{wallet ? (callsign || wallet).slice(0, 2).toUpperCase() : "?"}</span>
              {wallet ? (callsign || shortPk(wallet)) : "Connect"}
            </button>
          </div>
        </div>
      </nav>

      <section className="jumper-stage">
        <aside className="jumper-tagline">
          <h1 className="game-title">
            <span className="lash">Call it.</span><br />
            <span className="kill">Outplay</span>{" "}the room.
          </h1>
          <p>
            A battle-royale prediction market on live BTC, ETH and SOL. Same seat, same market,
            same rules — only the survivors keep the pool.
          </p>
          <div className="jumper-stats">
            <div>
              <span>Prize pool</span>
              <b className="plasma">{usd.format(totals.pool)}</b>
            </div>
            <div>
              <span>Alive</span>
              <b className="neon">{totals.alive}</b>
            </div>
            <div>
              <span>Live now</span>
              <b className="gold">{totals.live}</b>
            </div>
          </div>
        </aside>

        <div className="jumper-card">
          <header className="jc-tabs">
            <button className={`jc-tab ${tab === "play" ? "on" : ""}`} onClick={() => setTab("play")}>
              <span className="dot" /> Play
            </button>
            <button className={`jc-tab ${tab === "host" ? "on" : ""}`} onClick={() => setTab("host")}>
              <span className="dot" /> Host
            </button>
          </header>

          <div className="jc-body">
            {tab === "play" ? (
              <PlayPanel
                featured={featured}
                others={others}
                now={now}
                onJoin={(slug) => goTo(slug)}
                onCopy={(url) => doCopy(url)}
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
                hostSeat={hostSeat} poolIfFull={poolIfFull}
                wallet={wallet} escrow={escrow}
                busy={busy} onSubmit={doHostAndJoin}
              />
            )}
          </div>
        </div>
      </section>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}

      {showCallsign && (
        <div className="modal-backdrop" onClick={() => setShowCallsign(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShowCallsign(false)} aria-label="Close">×</button>
            <h2>Set your callsign</h2>
            <p className="sub">
              Shown in the arena stage, standings, activity feed, and champion screen.
              Stored locally on this device per wallet.
            </p>
            <label>
              Callsign
              <input
                value={csDraft}
                onChange={(e) => setCsDraft(e.target.value)}
                placeholder="e.g. nova_9"
                maxLength={USERNAME_MAX}
                autoFocus
                aria-invalid={csDraft.length > 0 && !validateUsername(csDraft).ok}
              />
            </label>
            {(() => {
              const v = validateUsername(csDraft);
              const hint = csDraft.length === 0
                ? "3–16 characters: letters, numbers, underscore."
                : !v.ok
                ? v.reason
                : "Looks good — this callsign will show on every screen.";
              const ok = csDraft.length > 0 && v.ok;
              return (
                <p
                  className={`disclaimer callsign-hint ${csDraft.length === 0 ? "" : ok ? "ok" : "bad"}`}
                  style={{ marginTop: 6, textAlign: "left" }}
                >
                  {hint}
                </p>
              );
            })()}
            <button
              className="btn primary full"
              onClick={saveCallsign}
              disabled={!validateUsername(csDraft).ok || !wallet}
              style={{ marginTop: 8 }}
            >
              Save callsign
            </button>
          </div>
        </div>
      )}

      <PantaGraduationBanner />
    </main>
  );
}

/* ── The eye/compass brand mark ─────────────────────────────────── */
function BrandMark() {
  return (
    <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="#edf0f6" strokeWidth="3.2" strokeLinecap="round">
        <path d="M 12 24 A 22 22 0 0 1 24 12" />
        <path d="M 40 12 A 22 22 0 0 1 52 24" />
        <path d="M 52 40 A 22 22 0 0 1 40 52" />
        <path d="M 24 52 A 22 22 0 0 1 12 40" />
      </g>
      <path d="M 4 32 L 11 32 M 53 32 L 60 32" stroke="#edf0f6" strokeWidth="3" strokeLinecap="round" />
      <path d="M 32 2 L 36 18 L 32 23 L 28 18 Z" fill="#edf0f6" />
      <path d="M 32 62 L 36 46 L 32 41 L 28 46 Z" fill="#edf0f6" />
      <path d="M 10 32 C 18 20, 26 18, 32 18 C 38 18, 46 20, 54 32 C 46 44, 38 46, 32 46 C 26 46, 18 44, 10 32 Z" fill="#edf0f6" />
      <circle cx="32" cy="32" r="7" fill="#0a0d13" />
      <circle cx="32" cy="32" r="3.3" fill="#edf0f6" />
    </svg>
  );
}

/* ── Play panel — featured + short list of others ───────────────── */
function PlayPanel({
  featured, others, now, onJoin, onCopy, onSwitchToHost
}: {
  featured: ArenaItem | null;
  others: ArenaItem[];
  now: number;
  onJoin: (slug: string) => void;
  onCopy: (url: string) => void;
  onSwitchToHost: () => void;
}) {
  if (!featured) {
    return (
      <div className="jc-empty">
        <div className="jc-empty-icon">◆</div>
        <h3>No live rumbles</h3>
        <p>The cabinet is quiet. Open the first arena — invite goes out in one click.</p>
        <button className="btn-fight" onClick={onSwitchToHost}>Host the first fight ▶</button>
      </div>
    );
  }

  const deadline = featured.status === "enrolling" ? featured.enrollDeadline : featured.status === "live" ? featured.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;
  const tier = tierFor(featured.prizePoolUsdc);

  return (
    <div className="jc-play">
      <div className="jc-featured">
        <div className="jc-featured-top">
          <span className={`gm-boss-tag ${featured.status === "live" ? "live" : "enrolling"}`}>
            <span className="pulse" />
            {featured.status === "live" ? "Live fight" : STATUS_LABEL[featured.status]}
          </span>
          <span className="jc-code">
            {featured.isPublic ? "PUBLIC" : featured.arenaCode} · R{featured.roundNumber}/{featured.roundLimit}
          </span>
        </div>
        <div className="jc-featured-q">{featured.marketQuestion}</div>
        <div className="jc-featured-meta">
          <div><span>Pool</span><b className="plasma">{usd.format(featured.prizePoolUsdc)}</b></div>
          <div><span>Seat</span><b>{usd2.format(featured.entryUsdc + featured.startingBankroll)}</b></div>
          <div><span>Alive</span><b>{featured.alive}<em>/{featured.capacity}</em></b></div>
          <div><span>{featured.status === "enrolling" ? "Locks" : "Ends"}</span><b className="neon">{deadline ? fmtClock(timeLeft) : "—"}</b></div>
          <div><span>Tier</span><b className={tier === "S" ? "gold" : tier === "A" ? "neon" : ""}>{tier}</b></div>
        </div>
        <button className="btn-fight full" onClick={() => onJoin(featured.inviteSlug)}>
          {featured.status === "live" ? "Jump in mid-fight" : "Enter arena"} ▶
        </button>
      </div>

      {others.length > 0 && (
        <div className="jc-others">
          <div className="jc-others-head">Also live · {others.length}</div>
          {others.slice(0, 4).map((a) => {
            const t = tierFor(a.prizePoolUsdc);
            const d = a.status === "enrolling" ? a.enrollDeadline : a.status === "live" ? a.liveDeadline : 0;
            const tl = d ? Math.max(0, d - now) : 0;
            return (
              <button key={a.arenaCode} className="gm-mini-arena" onClick={() => onJoin(a.inviteSlug)}
                onContextMenu={(e) => { e.preventDefault(); onCopy(`${window.location.origin}/a/${a.arenaCode}`); }}
              >
                <span className={`rank-badge ${t.toLowerCase()}`}>{t}</span>
                <span className="mid">
                  <span className="q">{a.asset} · {a.marketQuestion}</span>
                  <span className="meta">{a.humans}/{a.capacity} · {STATUS_LABEL[a.status]}{d ? ` · ${fmtClock(tl)}` : ""}</span>
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

/* ── Host panel — compact form ──────────────────────────────────── */
function HostPanel({
  hMode, setHMode, hStartInMin, setHStartInMin,
  hAsset, setHAsset, hHorizon, setHHorizon,
  hFormat, setHFormat, hRounds, setHRounds,
  hCapacity, setHCapacity, hEntry, setHEntry, hVault, setHVault,
  hostSeat, poolIfFull, wallet, escrow, busy, onSubmit
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
  hostSeat: number; poolIfFull: number;
  wallet: string | null; escrow: { active: boolean; reason?: string | null } | null;
  busy: boolean; onSubmit: () => void;
}) {
  return (
    <div className="jc-host">
      <div className="gm-seg" style={{ marginBottom: 12 }}>
        <button className={`opt ${hMode === "quick" ? "on" : ""}`} onClick={() => setHMode("quick")}>Quick</button>
        <button className={`opt ${hMode === "scheduled" ? "on" : ""}`} onClick={() => setHMode("scheduled")}>Scheduled</button>
      </div>

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
            {(["MIN5", "MIN15", "HOUR", "DAY"] as const).map((h) => (
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
        <FieldRow label="Capacity">
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
          <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
        </label>
        <label className="gm-num">
          <span>Vault (USDC)</span>
          <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
        </label>
      </div>

      <div className="jc-host-preview">
        <div><span>Seat</span><b>{usd2.format(hostSeat)}</b></div>
        <div><span>Pool full</span><b className="plasma">{usd2.format(poolIfFull)}</b></div>
        <div><span>Format</span><b>{hFormat === "single" ? "1 rnd" : `${hRounds} rds`}</b></div>
      </div>

      {escrow && !escrow.active && (
        <div className="gm-host-warn" style={{ margin: "8px 0" }}>
          <b>Practice mode.</b> Hosting works; wallet won&apos;t be asked to sign.
        </div>
      )}

      <button className="gm-host-cta" onClick={onSubmit} disabled={busy}>
        {busy ? "Opening…" : escrow?.active ? (wallet ? "Host & Join · sign deposit" : "Host arena") : (wallet ? "Host & Join · practice" : "Host practice arena")}
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

/* ── Invite result — appears after Host & Join ──────────────────── */
function InviteResult({
  info, onCopy, onOpen, onReset
}: { info: { code: string; url: string }; onCopy: (url: string) => void; onOpen: () => void; onReset: () => void }) {
  return (
    <div className="jc-invite">
      <p className="jc-invite-lead">Arena is live — send the code.</p>
      <div className="gm-invite-code">{info.code}</div>
      <div className="gm-invite-url">
        <input readOnly value={info.url} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn-host" style={{ height: 42, padding: "0 16px", fontSize: 11 }} onClick={() => onCopy(info.url)}>Copy</button>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
           href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${info.url}`)}`}>Share on X</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
           href={`https://t.me/share/url?url=${encodeURIComponent(info.url)}&text=${encodeURIComponent("Join my Oracle Rumble arena")}`}>Telegram</a>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
           href={`https://wa.me/?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${info.url}`)}`}>WhatsApp</a>
      </div>
      <button className="gm-host-cta" onClick={onOpen}>Enter {info.code} ▶</button>
      <button className="link-btn" onClick={onReset} style={{ marginTop: 10 }}>Host another</button>
    </div>
  );
}
