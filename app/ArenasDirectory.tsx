"use client";

/**
 * Arenas directory — the lobby. All currently active hosted rumbles, an inline
 * host card (Quick match / Scheduled), and a live BTC/ETH/SOL up/down markets
 * strip. Modelled on Market Royale's `/#arena` — the discovery surface for the
 * whole product.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectSolanaWallet } from "@/lib/panta-client";
import { enrollRound, newRound } from "@/lib/round-client";
import { PUBLIC_ARENA } from "@/lib/royale";

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

type MarketRow = {
  id: string;
  asset: string;
  horizon: "HOUR" | "DAY";
  question: string;
  up: number;
  down: number;
  change: number;
  volume: string;
  closes: string;
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

const STATUS_LABEL: Record<string, string> = {
  enrolling: "Enrolling",
  live: "Live",
  settling: "Settling",
  advancing: "Advancing",
  complete: "Complete",
  cancelled: "Cancelled"
};

export default function ArenasDirectory() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [arenas, setArenas] = useState<ArenaItem[]>([]);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  // Inline host form (mirrors MR "CHOOSE YOUR BATTLEGROUND").
  const [hMode, setHMode] = useState<"quick" | "scheduled">("quick");
  const [hAsset, setHAsset] = useState<"BTC" | "ETH" | "SOL">("SOL");
  const [hHorizon, setHHorizon] = useState<"HOUR" | "DAY">("HOUR");
  const [hFormat, setHFormat] = useState<"single" | "royale">("single");
  const [hRounds, setHRounds] = useState(2);
  const [hMinPlayers, setHMinPlayers] = useState(2);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);

  // ── boot ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const w = localStorage.getItem(WALLET_KEY);
      if (w) setWallet(w);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [aRes, mRes] = await Promise.all([
        fetch("/api/arenas", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/markets/live", { cache: "no-store" }).then((r) => r.json())
      ]);
      setArenas(aRes.items ?? []);
      setMarkets(mRes.items ?? []);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
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

  const connect = useCallback(async () => {
    if (wallet) {
      setWallet(null);
      try { localStorage.removeItem(WALLET_KEY); } catch { /* ignore */ }
      setToast("Wallet disconnected.");
      return;
    }
    const real = await connectSolanaWallet();
    if (real) {
      setWallet(real);
      try { localStorage.setItem(WALLET_KEY, real); } catch { /* ignore */ }
      setToast(`Connected · ${shortPk(real)}`);
    } else {
      setToast("No Solana wallet found. Install Phantom, Backpack, or Solflare and reload.");
    }
  }, [wallet]);

  const hostSeat = (Number(hEntry) || 0) + (Number(hVault) || 0);

  /**
   * Host AND join in one action (MR's "HOST & JOIN EVENT"): mint the arena,
   * enroll the host wallet as player 1, then navigate to /a/{code} with the
   * invite screen open. If no wallet, still hosts + shows the invite; the
   * host can connect and join from the room.
   */
  const doHostAndJoin = useCallback(async () => {
    setBusy(true);
    try {
      const v = await newRound({
        asset: hAsset,
        format: hFormat,
        entryUsdc: Number(hEntry) || 1,
        startingBankroll: Number(hVault) || 5,
        capacity: hCapacity,
        roundLimit: hFormat === "royale" ? hRounds : 1,
        host: wallet ?? ""
      });
      if (v.error || !v.arena) { setToast(v.error ?? "Host failed."); return; }
      const url = `${window.location.origin}/a/${v.arena}`;

      // Host & Join: enroll the host wallet right now so the host is seat 1.
      if (wallet) {
        try {
          const nick = shortPk(wallet).replace("…", "");
          await enrollRound(wallet, nick, v.arena);
        } catch { /* enroll fails are OK — user can enter from the room */ }
      }
      setInviteInfo({ code: v.arena, url });
      refresh();
    } finally { setBusy(false); }
  }, [hAsset, hFormat, hEntry, hVault, hCapacity, hRounds, wallet, refresh]);

  const doCopy = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); setToast("Invite link copied."); }
    catch { setToast("Copy failed — long-press the link to copy."); }
  }, []);

  const goTo = useCallback((slug: string) => { window.location.href = slug; }, []);

  const active = arenas.filter((a) => ["enrolling", "live", "settling", "advancing"].includes(a.status));
  const hasActive = active.length > 0;

  return (
    <main>
      {/* ── HUD ─────────────────────────────────────────────── */}
      <nav className="hud-bar">
        <a href="/" className="brand" aria-label="Oracle Rumble">
          <svg className="mark" viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
            <circle cx="32" cy="32" r="19" stroke="#1a1410" strokeWidth="7" />
            <path d="M22 36L30 28L35 33L44 22" stroke="#c9752f" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
          oracle rumble
        </a>
        <div className="hud-nav">
          <a href="#arenas">Arenas</a>
          <a href="#host">Host</a>
          <a href="#markets">Markets</a>
          <a href="/play">Practice</a>
        </div>
        <div className="hud-right">
          <span className="src live">LIVE · {CLUSTER}</span>
          <button className={wallet ? "wallet connected" : "wallet"} onClick={connect}>
            <span className="avatar">{wallet ? wallet.slice(0, 2).toUpperCase() : "?"}</span>
            {wallet ? shortPk(wallet) : "Connect"}
          </button>
        </div>
      </nav>

      {/* ── DIRECTORY HEADER ────────────────────────────────── */}
      <section className="dir-shell" id="arenas">
        <div className="dir-head">
          <div>
            <p className="eyebrow">On-chain events</p>
            <h1 className="dir-title">all active rumbles</h1>
          </div>
          <a className="dir-copy" href="#host">+ Host an event →</a>
        </div>

        {!hasActive ? (
          <div className="dir-empty">
            <div>
              <b>No active rumbles right now.</b>
              <p>Host the next event and send the invite link to another funded testnet wallet.</p>
            </div>
            <a className="btn primary" href="#host">Host an event →</a>
          </div>
        ) : (
          <div className="dir-grid">
            {active.map((a) => {
              const deadline = a.status === "enrolling" ? a.enrollDeadline : a.status === "live" ? a.liveDeadline : 0;
              const timeLeft = deadline ? Math.max(0, deadline - now) : 0;
              return (
                <div key={a.arenaCode} className={`arena-card ${a.status}`}>
                  <div className="ac-head">
                    <span className={`ac-code ${a.isPublic ? "public" : "private"}`}>
                      {a.isPublic ? "PRACTICE" : a.arenaCode}
                    </span>
                    <span className={`ac-status ${a.status}`}>{STATUS_LABEL[a.status]}</span>
                  </div>
                  <div className="ac-market">
                    <span className="ac-asset">{a.asset}</span>
                    <span className="ac-q">{a.marketQuestion}</span>
                  </div>
                  <div className="ac-meta">
                    <div><span>Format</span><b>{a.format === "single" ? "Single round" : `Royale · ${a.roundLimit} rounds`}</b></div>
                    <div><span>Seats</span><b>{a.humans}/{a.capacity} <em>({a.bots} bots)</em></b></div>
                    <div><span>Pool</span><b className="accent">{usd.format(a.prizePoolUsdc)}</b></div>
                    <div><span>Seat cost</span><b>{usd.format(a.entryUsdc + a.startingBankroll)}</b></div>
                    <div><span>Timer</span><b>{deadline ? fmtClock(timeLeft) : "—"}</b></div>
                    <div><span>Round</span><b>{a.roundNumber} / {a.roundLimit}</b></div>
                  </div>
                  <div className="ac-actions">
                    <button className="btn primary sm" onClick={() => goTo(a.inviteSlug)}>Join arena →</button>
                    {!a.isPublic && (
                      <button className="btn secondary sm" onClick={() => doCopy(`${window.location.origin}/a/${a.arenaCode}`)}>Copy invite</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── HOST INLINE CARD ────────────────────────────────── */}
      <section className="host-shell" id="host">
        <div className="host-card">
          <div className="host-left">
            <p className="eyebrow">Host a rumble</p>
            <h2>choose your battleground</h2>
            <p className="host-blurb">
              Hosting also enters you as player one. Choose equal entry and starting-vault
              terms for every player before the lobby opens. You&apos;ll get a shareable link.
            </p>
            <p className="host-fine">
              A new arena code is minted for your room. Bots backfill any empty seats when the
              timer locks. If minimum players is missed, the pool is refunded.
            </p>
          </div>

          <div className="host-right">
            {inviteInfo ? (
              <div className="invite-box">
                <p className="invite-lead">Your arena is live — send the link to friends.</p>
                <div className="invite-code">{inviteInfo.code}</div>
                <div className="invite-url">
                  <input readOnly value={inviteInfo.url} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn secondary sm" onClick={() => doCopy(inviteInfo.url)}>Copy</button>
                </div>
                <div className="invite-share">
                  <a className="btn secondary sm" target="_blank" rel="noopener noreferrer"
                     href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>
                    X
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
                <button className="btn primary full" onClick={() => goTo(`/a/${inviteInfo.code}`)} style={{ marginTop: 10 }}>
                  Go to arena {inviteInfo.code} →
                </button>
                <button className="link-btn" onClick={() => setInviteInfo(null)} style={{ marginTop: 8 }}>
                  Host another
                </button>
              </div>
            ) : (
              <>
                <div className="bet-mode" style={{ marginBottom: 18 }}>
                  <button className={hMode === "quick" ? "bm on" : "bm"} onClick={() => setHMode("quick")}>Quick match</button>
                  <button className={hMode === "scheduled" ? "bm on" : "bm"} onClick={() => setHMode("scheduled")}>Scheduled event</button>
                </div>

                <div className="host-grid">
                  <div className="host-cell">
                    <span className="host-label">Market asset</span>
                    <div className="seg">
                      {(["BTC", "ETH", "SOL"] as const).map((a) => (
                        <button key={a} className={hAsset === a ? "seg-opt on" : "seg-opt"} onClick={() => setHAsset(a)}>{a}</button>
                      ))}
                    </div>
                  </div>
                  <div className="host-cell">
                    <span className="host-label">Market window</span>
                    <div className="seg">
                      <button className={hHorizon === "HOUR" ? "seg-opt on" : "seg-opt"} onClick={() => setHHorizon("HOUR")}>1 hour</button>
                      <button className={hHorizon === "DAY" ? "seg-opt on" : "seg-opt"} onClick={() => setHHorizon("DAY")}>1 day</button>
                    </div>
                  </div>
                  <div className="host-cell">
                    <span className="host-label">Format</span>
                    <div className="seg">
                      <button className={hFormat === "single" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("single")}>Single</button>
                      <button className={hFormat === "royale" ? "seg-opt on" : "seg-opt"} onClick={() => setHFormat("royale")}>Royale</button>
                    </div>
                  </div>
                  <div className="host-cell">
                    <span className="host-label">Max rounds</span>
                    <div className="seg">
                      {hFormat === "single" ? (
                        <span className="seg-opt on" style={{ cursor: "default" }}>1</span>
                      ) : (
                        [2, 3, 4].map((n) => (
                          <button key={n} className={hRounds === n ? "seg-opt on" : "seg-opt"} onClick={() => setHRounds(n)}>{n}</button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="host-cell">
                    <span className="host-label">Capacity</span>
                    <div className="seg">
                      {[2, 4, 8, 12, 16].map((n) => (
                        <button key={n} className={hCapacity === n ? "seg-opt on" : "seg-opt"} onClick={() => { setHCapacity(n); if (hMinPlayers > n) setHMinPlayers(n); }}>{n}</button>
                      ))}
                    </div>
                  </div>
                  <div className="host-cell">
                    <span className="host-label">Min players</span>
                    <div className="seg">
                      {[2, 3, 4].filter((n) => n <= hCapacity).map((n) => (
                        <button key={n} className={hMinPlayers === n ? "seg-opt on" : "seg-opt"} onClick={() => setHMinPlayers(n)}>{n}</button>
                      ))}
                    </div>
                  </div>

                  <label className="host-num">
                    Entry contribution (USDC)
                    <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>→ shared pool</em>
                  </label>
                  <label className="host-num">
                    Starting vault (USDC)
                    <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>→ your isolated bankroll</em>
                  </label>
                </div>

                <p className="host-seat">
                  Your seat locks <b>{usd2.format(Number(hEntry) || 0)}</b> into the prize pool and{" "}
                  <b>{usd2.format(Number(hVault) || 0)}</b> into your isolated vault. Total per player: <b>{usd2.format(hostSeat)}</b>.
                </p>

                <button className="btn primary full big" onClick={doHostAndJoin} disabled={busy}>
                  {busy ? "Opening arena…" : wallet ? "Host & Join event ⚡" : "Host event ⚡"}
                </button>
                {!wallet && (
                  <p className="host-fine" style={{ marginTop: 8, textAlign: "center" }}>
                    Connect a wallet to be seat #1 automatically. You can also host without a wallet and enroll from the room.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── LIVE MARKETS STRIP ──────────────────────────────── */}
      <section className="markets-shell" id="markets">
        <div className="markets-head">
          <h2>live btc · eth · sol markets</h2>
          <span className="markets-sub">Updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
        <div className="markets-table">
          <div className="mkt-row mkt-header">
            <span>Market</span>
            <span>Window</span>
            <span>UP ask</span>
            <span>DOWN ask</span>
            <span>24h</span>
            <span>Volume</span>
          </div>
          {markets.map((m) => (
            <div className="mkt-row" key={m.id}>
              <span className="mkt-q"><b>{m.asset}</b> up?</span>
              <span className="mkt-w">{m.horizon === "HOUR" ? "1 hour" : "1 day"}</span>
              <span className="mkt-up up">{m.up}¢</span>
              <span className="mkt-down down">{m.down}¢</span>
              <span className={`mkt-chg ${m.change >= 0 ? "up" : "down"}`}>{m.change >= 0 ? "+" : ""}{m.change}¢</span>
              <span className="mkt-vol">{m.volume}</span>
            </div>
          ))}
        </div>
      </section>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}
    </main>
  );
}
