"use client";

/**
 * Arenas directory — GAME MODE.
 * Arcade-cabinet + battle-royale rebuild: neon boss card, fighter grid,
 * level-based how-it-works, arcade host cabinet, ticker markets strip.
 * Data flow unchanged from prior directory — every feature is preserved.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectSolanaWallet } from "@/lib/panta-client";
import { enrollWithEscrow, newRound } from "@/lib/round-client";
import PantaHUD from "@/app/PantaHUD";
import PantaGraduationBanner from "@/app/PantaGraduationBanner";
import PantaCreateMarketModal from "@/app/PantaCreateMarketModal";
import PantaPositions from "@/app/PantaPositions";

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
  const [showCreateMarket, setShowCreateMarket] = useState(false);
  const [showPositions, setShowPositions] = useState(false);

  // Toggle body.game-mode so the background layers render correctly.
  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);

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
  const poolIfFull = (Number(hEntry) || 0) * hCapacity;

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

  const active = arenas.filter((a) => !a.isPublic && ["enrolling", "live", "settling", "advancing"].includes(a.status));
  const liveOnly = active.filter((a) => a.status === "live" || a.status === "enrolling");
  const featured = liveOnly.find((a) => a.status === "live")
    ?? liveOnly.find((a) => a.status === "enrolling")
    ?? liveOnly[0]
    ?? null;
  const supporting = active.filter((a) => a.arenaCode !== featured?.arenaCode).slice(0, 4);

  // Aggregate stats for the hero HUD strip.
  const stats = useMemo(() => {
    const totalPool = active.reduce((s, a) => s + a.prizePoolUsdc, 0);
    const totalAlive = active.reduce((s, a) => s + a.alive, 0);
    const liveCount = active.filter((a) => a.status === "live").length;
    return { totalPool, totalAlive, liveCount };
  }, [active]);

  const topChampion = useMemo(() => {
    return [...active].sort((a, b) => b.prizePoolUsdc - a.prizePoolUsdc)[0] ?? null;
  }, [active]);

  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      {/* ═════════ HEADER ═════════ */}
      <nav className="hud-bar game-hud">
        <a href="/" className="brand" aria-label="Oracle Rumble">
          <svg className="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="4" fill="none" stroke="var(--neon)" strokeWidth="2" />
            <path d="M7 14 L10 11 L13 14 L17 8" stroke="var(--plasma)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          ORACLE RUMBLE
        </a>
        <div className="hud-nav">
          <a href="#arenas" onClick={(e) => { e.preventDefault(); scrollToId("arenas"); }}>Arenas</a>
          <a href="#host" onClick={(e) => { e.preventDefault(); scrollToId("host"); }}>Host</a>
          <a href="#markets" onClick={(e) => { e.preventDefault(); scrollToId("markets"); }}>Markets</a>
          <button className="nav-link" onClick={() => setShowCreateMarket(true)}>+ Panta market</button>
          <button className="nav-link" onClick={() => setShowPositions(true)}>Positions</button>
        </div>
        <div className="hud-right">
          <PantaHUD />
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
          <button className={wallet ? "wallet game connected" : "wallet game"} onClick={connect}>
            <span className="avatar">{wallet ? wallet.slice(0, 2).toUpperCase() : "?"}</span>
            {wallet ? shortPk(wallet) : "Connect"}
          </button>
        </div>
      </nav>

      {/* ═════════ HERO ═════════ */}
      <section className="gm-hero">
        <div className="gm-hero-inner">
          <div>
            <div className="gm-eyebrow">
              <span className="live-dot" />
              <span>Live prediction arenas</span>
              <span className="sep">·</span>
              <span>Solana {CLUSTER}</span>
            </div>
            <h1 className="game-title">
              <span className="lash">Call it.</span><br />
              <span className="kill">Outplay</span> the room.
            </h1>
            <p className="sublead">
              A battle-royale prediction market on live BTC, ETH and SOL. Every entrant pays the same
              seat, trades the same market, and <b>only the survivors keep the pool</b>.
            </p>
            <div className="gm-cta-row">
              <button className="btn-play" onClick={() => scrollToId("arenas")}>
                Enter arena <span className="arrow">▶</span>
              </button>
              <button className="btn-host" onClick={() => scrollToId("host")}>
                Host battle
              </button>
            </div>
          </div>

          <div className="gm-hero-side">
            <div className="gm-stat-tiles">
              <div className="gm-stat">
                <div className="k">Prize Pool</div>
                <div className="v plasma">{usd.format(stats.totalPool)}</div>
                <div className="sub">across {active.length} arenas</div>
              </div>
              <div className="gm-stat">
                <div className="k">Alive</div>
                <div className="v neon">{stats.totalAlive}</div>
                <div className="sub">fighters live</div>
              </div>
              <div className="gm-stat">
                <div className="k">Live now</div>
                <div className="v gold">{stats.liveCount}</div>
                <div className="sub">rounds in play</div>
              </div>
            </div>
            {topChampion ? (
              <div className="gm-champion">
                <div className="crown">S</div>
                <div className="mid">
                  <span className="k">Biggest prize live</span>
                  <span className="who">{topChampion.asset} · {topChampion.marketQuestion}</span>
                </div>
                <span className="prize">{usd.format(topChampion.prizePoolUsdc)}</span>
              </div>
            ) : (
              <div className="gm-champion">
                <div className="crown" style={{ background: "linear-gradient(180deg, #64748b, #334155)", color: "#f1f5f9", boxShadow: "none" }}>?</div>
                <div className="mid">
                  <span className="k">Champion Slot Open</span>
                  <span className="who">No live arenas — host the first fight</span>
                </div>
                <span className="prize" style={{ color: "var(--text-3)" }}>—</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═════════ BOSS BATTLE ═════════ */}
      {featured && (
        <section className="gm-boss-shell" id="arenas">
          <div className="gm-section-head">
            <span className="title">Boss Battle</span>
            <button className="cta" onClick={() => scrollToId("all")}>All arenas ▸</button>
          </div>
          <BossCard
            arena={featured}
            supporting={supporting}
            now={now}
            onJoin={() => goTo(featured.inviteSlug)}
            onOpenSupporting={(a) => goTo(a.inviteSlug)}
          />
        </section>
      )}

      {/* ═════════ FIGHTER GRID ═════════ */}
      <section className="gm-grid-shell" id="all">
        <div className="gm-section-head">
          <span className="title">Fighter Grid <span style={{ color: "var(--text-3)", fontWeight: 500 }}>· {active.length} live</span></span>
          <button className="cta" onClick={() => scrollToId("host")}>+ Host arena</button>
        </div>

        {active.length === 0 ? (
          <div className="gm-empty">
            <h4>No live rumbles</h4>
            <p>The cabinet is quiet. Slam the coin slot and open the first arena — invite goes out in one click.</p>
            <button className="btn-play" onClick={() => scrollToId("host")}>Host the first fight ▶</button>
          </div>
        ) : (
          <div className="gm-grid">
            {active.map((a) => (
              <FighterCard
                key={a.arenaCode}
                arena={a}
                now={now}
                onJoin={() => goTo(a.inviteSlug)}
                onCopy={() => doCopy(`${window.location.origin}/a/${a.arenaCode}`)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ═════════ LEVEL FLOW ═════════ */}
      <section className="gm-flow-shell">
        <div className="gm-flow">
          <div className="gm-flow-head">
            <h2>How to <span className="accent">win</span></h2>
            <p>Four levels. Same seat, same market, same rules. Only the survivors split the pool.</p>
          </div>
          <div className="gm-levels">
            <div className="gm-level">
              <span className="lvl">Level 01</span>
              <div className="icon">🎟️</div>
              <h3>Enter</h3>
              <p>Pay the seat: entry into the shared pool + a starting vault you trade with. Non-custodial escrow.</p>
            </div>
            <div className="gm-level">
              <span className="lvl">Level 02</span>
              <div className="icon">⚡</div>
              <h3>Trade</h3>
              <p>Buy UP, DOWN, or stack a parlay across BTC / ETH / SOL. Your vault is your leaderboard score.</p>
            </div>
            <div className="gm-level">
              <span className="lvl">Level 03</span>
              <div className="icon">🗡️</div>
              <h3>Survive</h3>
              <p>The oracle settles. The bottom half is cut. Survivors advance — winners double down on the next round.</p>
            </div>
            <div className="gm-level">
              <span className="lvl">Final</span>
              <div className="icon">👑</div>
              <h3>Claim</h3>
              <p>Prize splits go straight to your wallet on-chain. Recovery clause if the round is ever cancelled.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════ HOST CABINET ═════════ */}
      <section className="gm-host-shell" id="host">
        <div className="gm-host">
          <div className="gm-host-left">
            <h2>Host a <span className="accent">rumble</span></h2>
            <p>
              Pick a market, set the seat, choose the format. You get a shareable code — the game starts the
              moment enrollment locks, however many joined.
            </p>
            <ul className="gm-host-features">
              <li>Non-custodial escrow on Solana {CLUSTER}</li>
              <li>Same seat for every player, enforced on-chain</li>
              <li>Automatic settlement + one-click claim to wallet</li>
              <li>Recovery clause if a round is ever cancelled</li>
            </ul>
          </div>

          <div>
            {inviteInfo ? (
              <div className="gm-invite">
                <p className="gm-invite-lead">Arena is live — send the code.</p>
                <div className="gm-invite-code">{inviteInfo.code}</div>
                <div className="gm-invite-url">
                  <input readOnly value={inviteInfo.url} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn-host" style={{ height: 42, padding: "0 16px", fontSize: 11 }} onClick={() => doCopy(inviteInfo.url)}>Copy</button>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                     href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>Share on X</a>
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                     href={`https://t.me/share/url?url=${encodeURIComponent(inviteInfo.url)}&text=${encodeURIComponent("Join my Oracle Rumble arena")}`}>Telegram</a>
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                     href={`https://wa.me/?text=${encodeURIComponent(`Join my Oracle Rumble arena · ${inviteInfo.url}`)}`}>WhatsApp</a>
                </div>
                <button className="gm-host-cta" onClick={() => goTo(`/a/${inviteInfo.code}`)}>
                  Enter {inviteInfo.code} ▶
                </button>
                <button className="link-btn" onClick={() => setInviteInfo(null)} style={{ marginTop: 10 }}>
                  Host another
                </button>
              </div>
            ) : (
              <>
                <div className="gm-seg" style={{ marginBottom: 14 }}>
                  <button className={`opt ${hMode === "quick" ? "on" : ""}`} onClick={() => setHMode("quick")}>Quick match</button>
                  <button className={`opt ${hMode === "scheduled" ? "on" : ""}`} onClick={() => setHMode("scheduled")}>Scheduled</button>
                </div>

                {hMode === "scheduled" && (
                  <div className="gm-host-cell" style={{ marginBottom: 14 }}>
                    <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "var(--text-3)", textTransform: "uppercase" }}>Enrollment window</label>
                    <div className="gm-seg">
                      {[5, 15, 30, 60, 180].map((m) => (
                        <button key={m} className={`opt ${hStartInMin === m ? "on" : ""}`} onClick={() => setHStartInMin(m)}>
                          {m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="gm-host-grid">
                  <div className="gm-host-cell">
                    <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "var(--text-3)", textTransform: "uppercase" }}>Market</label>
                    <div className="gm-seg">
                      {(["BTC", "ETH", "SOL"] as const).map((a) => (
                        <button key={a} className={`opt ${hAsset === a ? "on" : ""}`} onClick={() => setHAsset(a)}>{a}</button>
                      ))}
                    </div>
                  </div>
                  <div className="gm-host-cell">
                    <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "var(--text-3)", textTransform: "uppercase" }}>Timeframe</label>
                    <div className="gm-seg">
                      {(["MIN5", "MIN15", "HOUR", "DAY"] as const).map((h) => (
                        <button key={h} className={`opt ${hHorizon === h ? "on" : ""}`} onClick={() => setHHorizon(h)}>{HORIZON_LABEL[h]}</button>
                      ))}
                    </div>
                  </div>
                  <div className="gm-host-cell">
                    <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "var(--text-3)", textTransform: "uppercase" }}>Format</label>
                    <div className="gm-seg">
                      <button className={`opt ${hFormat === "single" ? "on" : ""}`} onClick={() => setHFormat("single")}>Single</button>
                      <button className={`opt ${hFormat === "royale" ? "on" : ""}`} onClick={() => setHFormat("royale")}>Royale</button>
                    </div>
                  </div>
                  {hFormat === "royale" && (
                    <div className="gm-host-cell">
                      <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "var(--text-3)", textTransform: "uppercase" }}>Rounds</label>
                      <div className="gm-seg">
                        {[2, 3, 4].map((n) => (
                          <button key={n} className={`opt ${hRounds === n ? "on" : ""}`} onClick={() => setHRounds(n)}>{n}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="gm-host-cell">
                    <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "var(--text-3)", textTransform: "uppercase" }}>Capacity</label>
                    <div className="gm-seg">
                      {[2, 4, 8, 12, 16].map((n) => (
                        <button key={n} className={`opt ${hCapacity === n ? "on" : ""}`} onClick={() => setHCapacity(n)}>{n}</button>
                      ))}
                    </div>
                  </div>

                  <div className="gm-num">
                    <label>Entry (USDC)</label>
                    <input value={hEntry} onChange={(e) => setHEntry(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>Goes to prize pool</em>
                  </div>
                  <div className="gm-num">
                    <label>Vault (USDC)</label>
                    <input value={hVault} onChange={(e) => setHVault(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                    <em>Yours to trade</em>
                  </div>
                </div>

                <div className="gm-prize-preview">
                  <div>
                    <span>Seat</span>
                    <b>{usd2.format(hostSeat)}</b>
                  </div>
                  <div>
                    <span>Pool full</span>
                    <b className="plasma">{usd2.format(poolIfFull)}</b>
                  </div>
                  <div>
                    <span>Format</span>
                    <b>{hFormat === "single" ? "1 rnd" : `${hRounds} rds`}</b>
                  </div>
                </div>

                {escrow && !escrow.active && (
                  <div className="gm-host-warn">
                    <b>Practice mode is on</b> — {escrow.reason ?? "escrow not configured"}. Hosting works,
                    wallet will not be asked to sign. Set <code>ESCROW_HOST_SECRET_KEY</code> to go live.
                  </div>
                )}

                <button className="gm-host-cta" onClick={doHostAndJoin} disabled={busy}>
                  {busy ? "Opening arena…" : escrow?.active
                    ? (wallet ? "Host & Join · sign deposit" : "Host arena")
                    : (wallet ? "Host & Join · practice" : "Host practice arena")}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ═════════ MARKETS TICKER ═════════ */}
      <section className="gm-ticker-shell" id="markets">
        <div className="gm-section-head">
          <span className="title">Live Markets <span style={{ color: "var(--text-3)", fontWeight: 500 }}>· {markets.length} open</span></span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--text-3)", letterSpacing: 1.2 }}>
            {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
        <div className="gm-ticker">
          {markets.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
              Markets loading…
            </div>
          ) : markets.map((m) => (
            <div key={m.id} className="gm-ticker-row">
              <span className="asym">{m.asset}</span>
              <span className="q">{m.question}</span>
              <span className="horizon">{HORIZON_LABEL[m.horizon] ?? m.horizon}</span>
              <span className="up">{m.up}¢</span>
              <span className="down">{m.down}¢</span>
              <span className={`chg ${m.change >= 0 ? "up" : "down"}`}>{m.change >= 0 ? "+" : ""}{m.change}¢</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="footer" style={{ position: "relative", zIndex: 2 }}>
        <span>Oracle Rumble · Solana {CLUSTER} · Non-custodial escrow</span>
        <span>Built on Panta prediction markets</span>
      </footer>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}

      {showCreateMarket && <PantaCreateMarketModal initialWallet={wallet} onClose={() => setShowCreateMarket(false)} />}
      {showPositions && <PantaPositions wallet={wallet} onClose={() => setShowPositions(false)} />}

      <PantaGraduationBanner />
    </main>
  );
}

/* ── Boss card — featured live arena ─────────────────────────────── */
function BossCard({
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
  const isLive = arena.status === "live";
  const isEnroll = arena.status === "enrolling";
  const seatUsd = arena.entryUsdc + arena.startingBankroll;
  const upPct = 50;
  const downPct = 50;
  const tier = tierFor(arena.prizePoolUsdc);

  return (
    <div className="gm-boss">
      <div className="gm-boss-inner">
        <div className="gm-boss-left">
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
            <span className={`gm-boss-tag ${isLive ? "live" : "enrolling"}`}>
              <span className="pulse" />
              {isLive ? "LIVE FIGHT" : isEnroll ? "ENROLLING" : STATUS_LABEL[arena.status]}
            </span>
            <span className="gm-boss-code">
              {arena.isPublic ? "PUBLIC" : arena.arenaCode} · Round {arena.roundNumber}/{arena.roundLimit}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 8px" }}>
            <span className="gm-boss-sym">{arena.asset}/USD</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "var(--text-3)", letterSpacing: 1.2, textTransform: "uppercase" }}>
              {arena.format === "single" ? "Single round" : `Royale · ${arena.roundLimit} rounds`}
            </span>
          </div>

          <h3 className="gm-boss-title">{arena.marketQuestion}</h3>

          <div className="gm-hbars">
            <div className="gm-hbar up">
              <div className="row1">
                <span className="side">▲ UP</span>
                <span className="pct">{upPct}%</span>
              </div>
              <div className="bar"><div className="fill" style={{ width: `${upPct}%` }} /></div>
            </div>
            <div className="gm-hbar down">
              <div className="row1">
                <span className="side">▼ DOWN</span>
                <span className="pct">{downPct}%</span>
              </div>
              <div className="bar"><div className="fill" style={{ width: `${downPct}%` }} /></div>
            </div>
          </div>

          <div className="gm-boss-meta">
            <div className="cell">
              <span className="k">Prize Pool</span>
              <span className="v plasma">{usd.format(arena.prizePoolUsdc)}</span>
            </div>
            <div className="cell">
              <span className="k">Seat</span>
              <span className="v">{usd2.format(seatUsd)}</span>
            </div>
            <div className="cell">
              <span className="k">Alive</span>
              <span className="v gold">{arena.alive}<span style={{ color: "var(--text-3)", fontSize: 14 }}>/{arena.capacity}</span></span>
            </div>
            <div className="cell">
              <span className="k">Tier</span>
              <span className={`v ${tier === "S" ? "gold" : tier === "A" ? "neon" : ""}`}>{tier}</span>
            </div>
          </div>

          <button className="gm-boss-cta" onClick={onJoin}>
            {isLive ? "Jump in mid-fight" : "Enter the arena"}
          </button>
        </div>

        <div className="gm-boss-right">
          <div className="gm-boss-clock">
            <div className="k">{isEnroll ? "Locks in" : isLive ? "Settles in" : "—"}</div>
            <div className="clock">{deadline ? fmtClock(timeLeft) : "—:—"}</div>
            <div className="sub">{isEnroll ? "Get your seat before the door closes" : isLive ? "Every second counts" : "Between rounds"}</div>
          </div>

          <div className="also">Also Live</div>
          {supporting.length === 0
            ? <div className="empty-mini">No other arenas — host one and it lands here.</div>
            : supporting.map((a) => {
                const t = tierFor(a.prizePoolUsdc);
                return (
                  <button key={a.arenaCode} className="gm-mini-arena" onClick={() => onOpenSupporting(a)}>
                    <span className={`rank-badge ${t.toLowerCase()}`}>{t}</span>
                    <span className="mid">
                      <span className="q">{a.asset} · {a.marketQuestion}</span>
                      <span className="meta">{a.humans}/{a.capacity} · {STATUS_LABEL[a.status]}</span>
                    </span>
                    <span className="prize">{usd.format(a.prizePoolUsdc)}</span>
                  </button>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}

/* ── Fighter card — grid entry ───────────────────────────────────── */
function FighterCard({
  arena, now, onJoin, onCopy
}: { arena: ArenaItem; now: number; onJoin: () => void; onCopy: () => void }) {
  const deadline = arena.status === "enrolling" ? arena.enrollDeadline : arena.status === "live" ? arena.liveDeadline : 0;
  const timeLeft = deadline ? Math.max(0, deadline - now) : 0;
  const isLive = arena.status === "live";
  const tier = tierFor(arena.prizePoolUsdc);

  return (
    <div className={`gm-fcard ${isLive ? "live" : ""}`}>
      <div className="gm-fcard-row1">
        <span className="gm-tier">
          <span className={`badge ${tier.toLowerCase()}`}>{tier}</span>
          <span className="lab">{arena.isPublic ? "PUBLIC" : arena.arenaCode}</span>
        </span>
        <span className={`gm-status ${arena.status}`}>
          <span className="dot" />
          {STATUS_LABEL[arena.status]}
        </span>
      </div>

      <div className="gm-fcard-mkt">
        <span className="gm-fcard-asset">{arena.asset} · {arena.format === "single" ? "Single" : `Royale ${arena.roundLimit}`}</span>
        <span className="gm-fcard-q">{arena.marketQuestion}</span>
      </div>

      <div className="gm-fcard-hbars">
        <div className="gm-fcard-hbar up"><span className="lab">▲ UP</span><span className="val">50¢</span></div>
        <div className="gm-fcard-hbar down"><span className="lab">▼ DOWN</span><span className="val">50¢</span></div>
      </div>

      <div className="gm-fcard-meta">
        <div className="cell">
          <span className="k">Pool</span>
          <span className="v plasma">{usd.format(arena.prizePoolUsdc)}</span>
        </div>
        <div className="cell">
          <span className="k">Fighters</span>
          <span className="v">{arena.humans}/{arena.capacity}</span>
        </div>
        <div className="cell">
          <span className="k">{arena.status === "enrolling" ? "Locks" : "Ends"}</span>
          <span className="v neon">{deadline ? fmtClock(timeLeft) : "—"}</span>
        </div>
      </div>

      <div className="gm-fcard-actions">
        <button className="btn-fight" onClick={onJoin}>Fight ▶</button>
        {!arena.isPublic && (
          <button className="btn-share" onClick={onCopy}>Copy</button>
        )}
      </div>
    </div>
  );
}
