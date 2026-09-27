"use client";

/**
 * Arenas directory / lobby.
 *
 * Sections top-to-bottom:
 *   1. Compact product-first hero
 *   2. Featured LIVE arena (visual centerpiece) + supporting arenas
 *   3. Full grid of active arenas
 *   4. How the rumble works (connected steps)
 *   5. Host a rumble (dedicated card)
 *   6. Live markets table
 *   7. Footer
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectSolanaWallet } from "@/lib/panta-client";
import { enrollWithEscrow, newRound } from "@/lib/round-client";

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
  horizon: "MIN5" | "MIN15" | "HOUR" | "DAY";
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
  enrolling: "Enrolling", live: "Live", settling: "Settling",
  advancing: "Advancing", complete: "Complete", cancelled: "Cancelled"
};

export default function ArenasDirectory() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [arenas, setArenas] = useState<ArenaItem[]>([]);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [escrow, setEscrow] = useState<{ active: boolean; reason?: string | null } | null>(null);

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

  useEffect(() => {
    try { const w = localStorage.getItem(WALLET_KEY); if (w) setWallet(w); } catch { /* ignore */ }
    fetch("/api/escrow/status", { cache: "no-store" }).then((r) => r.json()).then(setEscrow).catch(() => setEscrow({ active: false, reason: "unreachable" }));
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
    } else setToast("No Solana wallet found. Install Phantom, Backpack or Solflare.");
  }, [wallet]);

  const hostSeat = (Number(hEntry) || 0) + (Number(hVault) || 0);

  const doHostAndJoin = useCallback(async () => {
    setBusy(true);
    try {
      const enrollmentSec = hMode === "scheduled" ? hStartInMin * 60 : undefined;
      const v = await newRound({
        asset: hAsset, horizon: hHorizon, format: hFormat,
        entryUsdc: Number(hEntry) || 1, startingBankroll: Number(hVault) || 5,
        capacity: hCapacity, roundLimit: hFormat === "royale" ? hRounds : 1,
        enrollmentSec, host: wallet ?? ""
      });
      if (v.error || !v.arena) { setToast(v.error ?? "Host failed."); return; }
      const url = `${window.location.origin}/a/${v.arena}`;
      if (wallet) {
        try {
          const nick = shortPk(wallet).replace("…", "");
          if (escrow?.active) setToast("Signing seat deposit…");
          const r = await enrollWithEscrow(wallet, nick, v.arena);
          if (r.error) setToast(`Hosted, seat #1 failed: ${r.error}`);
        } catch { /* enroll fails are OK */ }
      }
      setInviteInfo({ code: v.arena, url });
      refresh();
    } finally { setBusy(false); }
  }, [hMode, hStartInMin, hAsset, hHorizon, hFormat, hEntry, hVault, hCapacity, hRounds, wallet, escrow, refresh]);

  const doCopy = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); setToast("Invite link copied."); }
    catch { setToast("Copy failed."); }
  }, []);

  const goTo = useCallback((slug: string) => { window.location.href = slug; }, []);

  // Only real hosted rooms are shown — the PUBLIC walk-in practice arena is
  // retired, so filter it out defensively in case a stale one lingers in the DB.
  const active = arenas.filter((a) => !a.isPublic && ["enrolling", "live", "settling", "advancing"].includes(a.status));
  const liveOnly = active.filter((a) => a.status === "live" || a.status === "enrolling");
  const featured = liveOnly.find((a) => a.status === "live")
    ?? liveOnly.find((a) => a.status === "enrolling")
    ?? liveOnly[0]
    ?? null;
  const supporting = active.filter((a) => a.arenaCode !== featured?.arenaCode).slice(0, 4);

  return (
    <main>
      {/* HEADER */}
      <nav className="hud-bar">
        <a href="/" className="brand" aria-label="Oracle Rumble">
          <svg className="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="4" fill="none" stroke="var(--up)" strokeWidth="2"/>
            <path d="M7 14 L10 11 L13 14 L17 8" stroke="var(--text)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          ORACLE RUMBLE
        </a>
        <div className="hud-nav">
          <a href="#arenas">Arenas</a>
          <a href="#host">Host</a>
          <a href="#markets">Markets</a>
        </div>
        <div className="hud-right">
          <span className="src live">{CLUSTER}</span>
          {escrow && (
            <span
              className={`escrow-badge ${escrow.active ? "on" : "off"}`}
              title={escrow.active ? "Real on-chain USDC" : `Practice mode: ${escrow.reason ?? "escrow off"}`}
            >
              <span className="dot" />
              {escrow.active ? "On-chain" : "Practice"}
            </span>
          )}
          <button className={wallet ? "wallet connected" : "wallet"} onClick={connect}>
            <span className="avatar">{wallet ? wallet.slice(0, 2).toUpperCase() : "?"}</span>
            {wallet ? shortPk(wallet) : "Connect"}
          </button>
        </div>
      </nav>

      {/* ═════════ HERO ═════════ */}
      <section className="hero-shell">
        <div className="hero-eyebrow">
          <span className="live-dot" />
          <span>Live prediction arenas</span>
          <span className="sep">·</span>
          <span>Solana {CLUSTER}</span>
        </div>
        <h1>
          Trade the market. <span className="accent">Outplay</span> the room.
        </h1>
        <p className="sublead">
          A battle-royale prediction market on live BTC, ETH and SOL. Every entrant pays the same seat, trades the same market, and only the survivors keep the pool.
        </p>
      </section>

      {/* ═════════ FEATURED LIVE ARENA ═════════ */}
      {featured && (
        <section className="featured-shell" id="arenas">
          <div className="section-head">
            <h2>Featured Rumble</h2>
            <a href="#all" className="section-cta">All arenas →</a>
          </div>
          <FeaturedArena
            arena={featured}
            supporting={supporting}
            now={now}
            onJoin={() => goTo(featured.inviteSlug)}
            onOpenSupporting={(a) => goTo(a.inviteSlug)}
          />
        </section>
      )}

      {/* ═════════ FULL ARENA GRID ═════════ */}
      <section className="dir-shell" id="all">
        <div className="dir-head">
          <span className="dir-title">All arenas <span className="count">({active.length})</span></span>
          <a className="dir-copy" href="#host">+ Host an arena</a>
        </div>

        {active.length === 0 ? (
          <div className="dir-empty">
            <div>
              <b>No live rumbles right now.</b>
              <p>Open the first one and send the invite link.</p>
            </div>
            <a className="btn primary" href="#host">Host an arena →</a>
          </div>
        ) : (
          <div className="dir-grid">
            {active.map((a) => (
              <ArenaCard key={a.arenaCode} arena={a} now={now}
                onJoin={() => goTo(a.inviteSlug)}
                onCopy={() => doCopy(`${window.location.origin}/a/${a.arenaCode}`)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ═════════ HOW IT WORKS ═════════ */}
      <section className="how-shell">
        <div className="how-inner">
          <div className="how-lead">
            <h2>How the rumble works</h2>
            <p>Same seat, same market, same rules. Every player is on equal footing when the round opens.</p>
          </div>
          <div className="how-steps">
            <div className="how-step">
              <div className="num">01</div>
              <h3>Enter</h3>
              <p>Pay the seat: entry into the shared pool + a starting vault you trade with. On-chain and non-custodial.</p>
            </div>
            <div className="how-step active">
              <div className="num">02</div>
              <h3>Trade</h3>
              <p>Buy UP, buy DOWN, or stack a parlay across BTC / ETH / SOL. Your vault balance is your leaderboard score.</p>
            </div>
            <div className="how-step">
              <div className="num">03</div>
              <h3>Survive</h3>
              <p>The oracle settles the market, the bottom half is cut, and survivors split the pool. Claim goes straight to your wallet.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════ HOST ═════════ */}
      <section className="host-shell" id="host">
        <div className="host-card">
          <div className="host-left">
            <span className="tag">Host</span>
            <h2>Host a rumble</h2>
            <p className="host-blurb">
              Pick a market, set the seat, choose the format. You get a shareable code — your game starts the moment enrollment locks, however many joined.
            </p>
            <ul className="host-features">
              <li>Non-custodial escrow on Solana {CLUSTER}</li>
              <li>Same seat for every player, enforced on-chain</li>
              <li>Automatic settlement + one-click claim to wallet</li>
              <li>Recovery if the round is ever cancelled</li>
            </ul>
          </div>

          <div className="host-right">
            {inviteInfo ? (
              <div className="invite-box">
                <p className="invite-lead">Arena is live — send the link.</p>
                <div className="invite-code">{inviteInfo.code}</div>
                <div className="invite-url">
                  <input readOnly value={inviteInfo.url} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn secondary sm" onClick={() => doCopy(inviteInfo.url)}>Copy</button>
                </div>
                <div className="invite-share">
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                     href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>X</a>
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                     href={`https://t.me/share/url?url=${encodeURIComponent(inviteInfo.url)}&text=${encodeURIComponent("Join my Oracle Rumble arena")}`}>Telegram</a>
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                     href={`https://wa.me/?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>WhatsApp</a>
                </div>
                <button className="btn primary full" onClick={() => goTo(`/a/${inviteInfo.code}`)} style={{ marginTop: 12 }}>
                  Open arena {inviteInfo.code} →
                </button>
                <button className="link-btn" onClick={() => setInviteInfo(null)} style={{ marginTop: 8 }}>
                  Host another
                </button>
              </div>
            ) : (
              <>
                <div className="seg" style={{ width: "100%", marginBottom: 14 }}>
                  <button className={`seg-opt ${hMode === "quick" ? "on" : ""}`} onClick={() => setHMode("quick")}>Quick match</button>
                  <button className={`seg-opt ${hMode === "scheduled" ? "on" : ""}`} onClick={() => setHMode("scheduled")}>Scheduled</button>
                </div>

                {hMode === "scheduled" && (
                  <div className="host-cell" style={{ marginBottom: 14 }}>
                    <span className="host-label">Enrollment window</span>
                    <div className="seg">
                      {[5, 15, 30, 60, 180].map((m) => (
                        <button key={m} className={`seg-opt ${hStartInMin === m ? "on" : ""}`} onClick={() => setHStartInMin(m)}>
                          {m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="host-grid">
                  <div className="host-cell">
                    <span className="host-label">Market</span>
                    <div className="seg">
                      {(["BTC", "ETH", "SOL"] as const).map((a) => (
                        <button key={a} className={`seg-opt ${hAsset === a ? "on" : ""}`} onClick={() => setHAsset(a)}>{a}</button>
                      ))}
                    </div>
                  </div>
                  <div className="host-cell">
                    <span className="host-label">Timeframe</span>
                    <div className="seg">
                      {(["MIN5", "MIN15", "HOUR", "DAY"] as const).map((h) => (
                        <button key={h} className={`seg-opt ${hHorizon === h ? "on" : ""}`} onClick={() => setHHorizon(h)}>
                          {h === "MIN5" ? "5m" : h === "MIN15" ? "15m" : h === "HOUR" ? "1h" : "1d"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="host-cell">
                    <span className="host-label">Format</span>
                    <div className="seg">
                      <button className={`seg-opt ${hFormat === "single" ? "on" : ""}`} onClick={() => setHFormat("single")}>Single</button>
                      <button className={`seg-opt ${hFormat === "royale" ? "on" : ""}`} onClick={() => setHFormat("royale")}>Royale</button>
                    </div>
                  </div>

                  {hFormat === "royale" && (
                    <div className="host-cell">
                      <span className="host-label">Rounds</span>
                      <div className="seg">
                        {[2, 3, 4].map((n) => (
                          <button key={n} className={`seg-opt ${hRounds === n ? "on" : ""}`} onClick={() => setHRounds(n)}>{n}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="host-cell">
                    <span className="host-label">Capacity</span>
                    <div className="seg">
                      {[2, 4, 8, 12, 16].map((n) => (
                        <button key={n} className={`seg-opt ${hCapacity === n ? "on" : ""}`} onClick={() => setHCapacity(n)}>{n}</button>
                      ))}
                    </div>
                  </div>

                  <label className="host-num">
                    Entry (USDC)
                    <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>Goes to prize pool</em>
                  </label>
                  <label className="host-num">
                    Vault (USDC)
                    <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>Yours to trade</em>
                  </label>
                </div>

                <div className="host-summary">
                  <div>
                    <span>Seat</span>
                    <b>{usd2.format(hostSeat)}</b>
                  </div>
                  <div>
                    <span>Pool full</span>
                    <b className="accent">{usd2.format((Number(hEntry) || 0) * hCapacity)}</b>
                  </div>
                  <div>
                    <span>Format</span>
                    <b>{hFormat === "single" ? "1 round" : `${hRounds} rds`}</b>
                  </div>
                </div>

                {escrow && !escrow.active && (
                  <div className="host-seat warn">
                    <b>Practice mode is on</b> — {escrow.reason ?? "escrow not configured"}. Hosting works, wallet will not be asked to sign. Set <code>ESCROW_HOST_SECRET_KEY</code> to go live.
                  </div>
                )}

                <button className="btn primary big full" onClick={doHostAndJoin} disabled={busy}>
                  {busy ? "Opening arena…" : escrow?.active
                    ? (wallet ? "Host & Join · sign deposit" : "Host arena")
                    : (wallet ? "Host & Join · practice" : "Host practice arena")}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ═════════ LIVE MARKETS ═════════ */}
      <section className="dir-shell" id="markets" style={{ marginTop: 40 }}>
        <div className="dir-head">
          <span className="dir-title">Live markets <span className="count">({markets.length})</span></span>
          <span className="dir-copy" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--text-3)" }}>
            {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
          {markets.map((m, i) => (
            <div key={m.id} style={{
              display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto", gap: 14,
              padding: "12px 18px", alignItems: "center",
              borderTop: i === 0 ? 0 : "1px solid var(--border)",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12
            }}>
              <span style={{ padding: "3px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>{m.asset}</span>
              <span style={{ fontFamily: "'Inter', sans-serif", color: "var(--text)", fontWeight: 500 }}>{m.question}</span>
              <span style={{ color: "var(--text-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{m.horizon === "MIN5" ? "5m" : m.horizon === "MIN15" ? "15m" : m.horizon === "HOUR" ? "1h" : "1d"}</span>
              <span style={{ color: "var(--up)", fontWeight: 700 }}>{m.up}¢</span>
              <span style={{ color: "var(--down)", fontWeight: 700 }}>{m.down}¢</span>
              <span style={{ color: m.change >= 0 ? "var(--up)" : "var(--down)", fontWeight: 600, fontSize: 11 }}>{m.change >= 0 ? "+" : ""}{m.change}¢</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <span>Oracle Rumble · Solana {CLUSTER} · Non-custodial escrow</span>
        <span>Built on Panta prediction markets</span>
      </footer>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}
    </main>
  );
}

/* ── Featured live arena — the visual centerpiece ─────────────── */
function FeaturedArena({
  arena, supporting, now, onJoin, onOpenSupporting
}: {
  arena: ArenaItem;
  supporting: ArenaItem[];
  now: number;
  onJoin: () => void;
  onOpenSupporting: (a: ArenaItem) => void;
}) {
  const deadline = arena.status === "enrolling" ? arena.enrollDeadline : arena.status === "live" ? arena.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;

  return (
    <div className="featured">
      <div className="featured-main">
        <div className="featured-top">
          <span className={`tag ${arena.status === "live" ? "up live" : "amber"}`}>
            <span className="dot" />
            {arena.status === "live" ? "Live" : STATUS_LABEL[arena.status]}
          </span>
          <span className="code">
            {arena.isPublic ? "PUBLIC" : arena.arenaCode} · Round {arena.roundNumber}/{arena.roundLimit}
          </span>
        </div>

        <div className="featured-asset">
          <span className="sym">{arena.asset}/USD</span>
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" }}>
            {arena.format === "single" ? "Single round" : `Royale · ${arena.roundLimit} rounds`}
          </span>
        </div>

        <h3 className="featured-q">{arena.marketQuestion}</h3>

        <div className="featured-mkt">
          <div className="col">
            <span className="k">Pool</span>
            <span className="v up">{usd.format(arena.prizePoolUsdc)}</span>
          </div>
          <div className="col">
            <span className="k">Seat</span>
            <span className="v">{usd2.format(arena.entryUsdc + arena.startingBankroll)}</span>
          </div>
        </div>

        <div className="updown-bar">
          <div className="side up"><span className="label">UP</span><span className="pct">50%</span></div>
          <div className="side down"><span className="label">DOWN</span><span className="pct">50%</span></div>
        </div>

        <div className="featured-meta">
          <div className="item">
            <span className="k">Players</span>
            <span className="v">{arena.humans}<span style={{ color: "var(--text-3)" }}>/{arena.capacity}</span></span>
          </div>
          <div className="item">
            <span className="k">Alive</span>
            <span className="v up">{arena.alive}</span>
          </div>
          <div className="item">
            <span className="k">{arena.status === "enrolling" ? "Locks in" : "Settles in"}</span>
            <span className="v">{deadline ? fmtClock(timeLeft) : "—"}</span>
          </div>
        </div>

        <div className="featured-cta">
          <button className="btn primary big full" onClick={onJoin}>
            Enter arena →
          </button>
        </div>
      </div>

      <div className="featured-side">
        <div className="side-head">Also Live</div>
        {supporting.length === 0
          ? <div className="empty-mini">No other arenas right now — host one and it lands here.</div>
          : supporting.map((a) => (
              <button key={a.arenaCode} className="mini-arena" onClick={() => onOpenSupporting(a)}>
                <span className="code">{a.isPublic ? "PUB" : a.arenaCode}</span>
                <span className="mid">
                  <span className="q">{a.asset} · {a.marketQuestion}</span>
                  <span className="meta">{a.humans}/{a.capacity} · {STATUS_LABEL[a.status]}</span>
                </span>
                <span className="right">{usd.format(a.prizePoolUsdc)}</span>
              </button>
            ))
        }
        <a href="#all" className="see-all">See all arenas →</a>
      </div>
    </div>
  );
}

/* ── Dense arena card for the grid ─────────────────────────────── */
function ArenaCard({
  arena, now, onJoin, onCopy
}: { arena: ArenaItem; now: number; onJoin: () => void; onCopy: () => void }) {
  const deadline = arena.status === "enrolling" ? arena.enrollDeadline : arena.status === "live" ? arena.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;

  return (
    <div className={`arena-card ${arena.status}`}>
      <div className="ac-row1">
        <span className={`ac-code ${arena.isPublic ? "public" : "private"}`}>{arena.isPublic ? "PUBLIC" : arena.arenaCode}</span>
        <span className={`ac-status ${arena.status}`}>
          <span className="dot" />
          {STATUS_LABEL[arena.status]}
        </span>
      </div>

      <div className="ac-market">
        <span className="ac-asset">{arena.asset} · {arena.format === "single" ? "Single" : `Royale ${arena.roundLimit}`}</span>
        <span className="ac-q">{arena.marketQuestion}</span>
      </div>

      <div className="ac-updown">
        <div className="cell up"><span className="label">UP</span><span className="val">50¢</span></div>
        <div className="cell down"><span className="label">DOWN</span><span className="val">50¢</span></div>
      </div>

      <div className="ac-meta-row">
        <div className="cell">
          <span className="k">Pool</span>
          <span className="v accent">{usd.format(arena.prizePoolUsdc)}</span>
        </div>
        <div className="cell">
          <span className="k">Players</span>
          <span className="v">{arena.humans}/{arena.capacity}</span>
        </div>
        <div className="cell">
          <span className="k">{arena.status === "enrolling" ? "Locks" : "Ends"}</span>
          <span className="v">{deadline ? fmtClock(timeLeft) : "—"}</span>
        </div>
      </div>

      <div className="ac-actions">
        <button className="btn primary sm" onClick={onJoin} style={{ flex: 1 }}>Join →</button>
        {!arena.isPublic && (
          <button className="btn ghost sm" onClick={onCopy}>Copy link</button>
        )}
      </div>
    </div>
  );
}
