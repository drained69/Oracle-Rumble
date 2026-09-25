"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectSolanaWallet, fetchCategories } from "@/lib/panta-client";
import { getRound, enrollRound, tradeRound, newRound, placeParlayApi, type RoundView } from "@/lib/round-client";
import type { Entrant, Round } from "@/lib/royale";
import { markets as boardMarkets } from "@/lib/arena-data";
import { quoteParlay, PARLAY_MAX_LEGS, type ParlayLeg } from "@/lib/parlay";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const WALLET_KEY = "oracle-rumble/wallet/v1";
const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

function shortPk(pk: string) {
  if (!pk) return "";
  if (pk.startsWith("bot:")) return pk.slice(4).toUpperCase();
  if (pk.length <= 10) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
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

export default function Home() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [view, setView] = useState<RoundView | null>(null);
  const [dataSource, setDataSource] = useState<"panta" | "mock" | "unknown">("unknown");
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
  const [hFormat, setHFormat] = useState<"single" | "royale">("royale");
  const [hRounds, setHRounds] = useState(3);
  const [hCapacity, setHCapacity] = useState(8);
  const [hEntry, setHEntry] = useState("2");
  const [hVault, setHVault] = useState("10");
  const pollRef = useRef<number | null>(null);

  // ── boot ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const w = localStorage.getItem(WALLET_KEY);
      if (w) setWallet(w);
    } catch { /* ignore */ }
    fetchCategories().then((c) => setDataSource(c.source === "panta" ? "panta" : "mock")).catch(() => setDataSource("mock"));
  }, []);

  // ── round polling (drives the keeper) ─────────────────────────────
  const refresh = useCallback(async () => {
    try { setView(await getRound()); } catch { /* transient */ }
  }, []);

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

  // ── actions ───────────────────────────────────────────────────────
  const doEnroll = useCallback(async () => {
    if (!wallet) { setShowEnroll(false); setToast("Connect a wallet first."); return; }
    setBusy(true);
    try {
      const nick = (nickname || shortPk(wallet)).slice(0, 16);
      const r = await enrollRound(wallet, nick);
      if (r.error) setToast(r.error);
      else { setToast(`Entered the arena as ${nick}.`); setShowEnroll(false); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, nickname, refresh]);

  const doBuy = useCallback(async () => {
    if (!wallet) return setToast("Connect a wallet first.");
    if (!enrolled) return setToast("Enroll in the round first.");
    const v = Number(amount);
    if (!v || v <= 0) return setToast("Enter an amount.");
    setBusy(true);
    try {
      const r = await tradeRound({ wallet, action: "buy", side, usdc: v });
      if (r.error) setToast(r.error);
      else { setToast(`Bought ${side} $${v.toFixed(0)}.`); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, amount, side, refresh]);

  const doSell = useCallback(async () => {
    if (!wallet || !enrolled) return;
    setBusy(true);
    try {
      const r = await tradeRound({ wallet, action: "sell" });
      if (r.error) setToast(r.error);
      else { setToast("Position liquidated."); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, refresh]);

  const startNew = useCallback(async () => {
    setBusy(true);
    try {
      const v = await newRound();
      if (v.error) { await refresh(); }   // a round is already active — jump to it
      else { setView(v); setToast("New round opened."); }
    } finally { setBusy(false); }
  }, [refresh]);

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
      const r = await placeParlayApi(wallet, parlayLegs, v);
      if (r.error) setToast(r.error);
      else { setToast(`Parlay placed · ${parlayLegs.length} legs.`); setParlayLegs([]); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, parlayLegs, parlayStake, refresh]);

  const doHost = useCallback(async () => {
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
      if (v.error) { setToast(v.error); await refresh(); }
      else {
        setView(v);
        setShowHost(false);
        setToast(`Rumble hosted · ${hAsset} · ${hFormat === "single" ? "single round" : `${hRounds} rounds`}`);
      }
    } finally { setBusy(false); }
  }, [hAsset, hFormat, hEntry, hVault, hCapacity, hRounds, wallet, refresh]);

  const hostSeat = (Number(hEntry) || 0) + (Number(hVault) || 0);

  const sourceBadge = dataSource === "panta"
    ? { text: `LIVE · ${CLUSTER}`, cls: "src live" }
    : dataSource === "mock" ? { text: "DEMO", cls: "src demo" } : { text: "…", cls: "src pending" };

  const myMark = me ? (me.side === "YES" ? yesPrice : me.side === "NO" ? 100 - yesPrice : 0) : 0;
  const myPnl = me ? me.bankroll - (round?.config.startingBankroll ?? 0) : 0;
  const openParlays = (me?.parlays ?? []).filter((p) => p.status === "open");
  const openParlayPotential = openParlays.reduce((s, t) => s + t.potentialPayout, 0);

  return (
    <main>
      {/* ── HUD ─────────────────────────────────────────────── */}
      <nav className="hud-bar">
        <a href="#top" className="brand" aria-label="Oracle Rumble">
          <svg className="mark" viewBox="0 0 64 64" width="24" height="24" aria-hidden="true">
            <path d="M26 16 C27 7 37 7 38 16 Z" fill="#4ade80" />
            <path d="M17 51 C13 22 22 15 32 15 C42 15 51 22 47 51 C47 55 43 56 39 54 L39 37 L25 37 L25 54 C21 56 17 55 17 51 Z" fill="#7aa2ff" />
            <rect x="21" y="32" width="22" height="5" rx="1.5" fill="#0e1017" />
            <rect x="29.5" y="32" width="5" height="16" rx="1.5" fill="#0e1017" />
          </svg>
          Oracle Rumble
        </a>
        <div className="hud-nav">
          <a href="#arena">Arena</a>
          <a href="#how">How it works</a>
        </div>
        <div className="hud-right">
          <span className={sourceBadge.cls}>{sourceBadge.text}</span>
          <button className="btn host-btn" onClick={() => setShowHost(true)}>+ Host a rumble</button>
          <button className={wallet ? "wallet connected" : "wallet"} onClick={connect}>
            <span className="avatar">{wallet ? wallet.slice(0, 2).toUpperCase() : "?"}</span>
            {wallet ? shortPk(wallet) : "Connect"}
          </button>
        </div>
      </nav>

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
            <div className="rb-cell">
              <span className="rb-k">{round.status === "enrolling" ? "Locks in" : round.status === "live" ? "Settles in" : "Window"}</span>
              <span className="rb-v mono">{deadline ? fmtClock(timeLeft) : "—"}</span>
            </div>
            <div className="rb-cell">
              <span className="rb-k">Prize pool</span>
              <span className="rb-v accent">{usd.format(round.prizePoolUsdc)}</span>
            </div>
            <div className="rb-cell">
              <span className="rb-k">Alive</span>
              <span className="rb-v">{aliveCount} <em>/ {standings.length}</em></span>
            </div>
            <div className="rb-cell grow">
              <span className="rb-k">Market · {round.config.asset}</span>
              <span className="rb-v market">{round.config.marketQuestion}</span>
            </div>
            <div className="rb-cell">
              <span className="rb-k">YES</span>
              <span className="rb-v accent">{yesPrice}¢</span>
            </div>
          </>
        ) : (
          <div className="rb-cell grow"><span className="rb-v">Opening the arena…</span></div>
        )}
      </div>

      {/* ── ARENA ───────────────────────────────────────────── */}
      <section className="arena-shell" id="arena">
        {round?.status === "complete" ? (
          <div className="champion">
            {(() => {
              const champ = standings.find((e) => e.id === round.championId) ?? standings[0] ?? null;
              const paid = [...standings].filter((e) => e.prizeUsdc > 0).sort((a, b) => b.prizeUsdc - a.prizeUsdc);
              return (
                <>
                  <p className="eyebrow">{round.config.format === "single" ? "Single round" : `Round ${round.roundNumber}`} · final</p>
                  <h1>{champ ? `${champ.nickname} wins ${usd2.format(champ.prizeUsdc)}` : "Rumble complete"}</h1>
                  <p className="lead">
                    {paid.length > 1
                      ? `${usd.format(round.prizePoolUsdc)} pool split across the top ${paid.length}.`
                      : `${usd.format(round.prizePoolUsdc)} pool to the winner.`}
                    {" "}Everyone withdraws their remaining vault; winners also take the pool share.
                  </p>
                  <button className="btn primary" onClick={() => setShowHost(true)} disabled={busy}>Host the next rumble →</button>
                  <div className="final-board">
                    {standings.map((e, i) => (
                      <div key={e.id} className={`fb-row ${e.wallet === wallet ? "me" : ""}`}>
                        <span className="fb-rank">{i + 1}</span>
                        <span className="fb-name">{e.nickname}{e.isBot ? " ·bot" : ""}</span>
                        <span className="fb-bank">{usd2.format(e.bankroll)}</span>
                        <span className="fb-prize">{e.prizeUsdc > 0 ? `+${usd2.format(e.prizeUsdc)}` : ""}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
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
                        <button className="btn secondary" onClick={() => setShowHost(true)} disabled={busy}>Host your own</button>
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
                          <div className="trade-actions">
                            <button className="btn primary full" onClick={doBuy} disabled={busy}>Buy {side}</button>
                            <button className="btn secondary" onClick={doSell} disabled={busy || !me!.side}>Liquidate</button>
                          </div>
                        </>
                      ) : (
                        <div className="parlay-build">
                          <p className="pb-hint">Stack BTC/ETH/SOL up-or-down calls into one bet. Every leg must land — longer odds, bigger payout. One horizon per asset.</p>
                          <div className="pb-board">
                            {boardMarkets.map((m) => {
                              const sel = parlayLegs.find((l) => l.marketId === m.id);
                              return (
                                <div className="pb-mkt" key={m.id}>
                                  <div className="pb-mkt-q"><b>{m.asset}</b> up in {m.horizon === "HOUR" ? "1h" : "1d"}?</div>
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
                    <div className="enroll-cta"><p>You&apos;re in. Waiting for the round to go live — bots and rivals are locking in.</p></div>
                  )}
                </>
              )}
            </div>

            {/* roster */}
            <aside className="roster">
              <div className="roster-head">
                <span>Standings</span>
                <span className="cut">cut ↓ bottom {standings.filter(e => e.eliminatedRound === null).length - cut}</span>
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
                        <span className="r-name">{e.nickname}{e.isBot ? <em> bot</em> : ""}{e.wallet === wallet ? <em> you</em> : ""}</span>
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
        )}

        {/* event log */}
        {round && round.history.length > 0 && (
          <div className="log">
            {[...round.history].slice(-4).reverse().map((h, i) => <span key={i}>{h}</span>)}
          </div>
        )}
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────── */}
      <section className="how-shell" id="how">
        <h2>How the arena works</h2>
        <div className="how-grid">
          <div><b>1 · Host chooses the game</b><p>The host picks BTC, ETH or SOL, the player limit, the entry, the starting vault, and one to four rounds.</p></div>
          <div><b>2 · Everyone funds the same seat</b><p>Same entry, same starting vault. Nobody can begin with more trading money than you.</p></div>
          <div><b>3 · Entry and vault separate</b><p>Your entry joins the shared prize pool. Your starting vault stays in your own game account to trade.</p></div>
          <div><b>4 · Trade the same market</b><p>Everyone trades UP and DOWN on the same live market. Buy, sell, or hold cash until it closes.</p></div>
          <div><b>5 · The oracle ranks every vault</b><p>Winning shares become USDC and players are ranked by vault value. In a royale the bottom half is cut and survivors keep the bankroll they earned.</p></div>
          <div><b>6 · Winners claim &amp; progress</b><p>Everyone withdraws their remaining vault. Top finishers share the pool — 62.5% / 23.4% / 14.1%, or the whole pool in a duel.</p></div>
        </div>
        <p className="disclaimer">
          Rounds, vaults, elimination and the prize pool are real server-side game state on Postgres, priced by
          live Panta markets on Solana {CLUSTER}. Bots fill empty seats. Player funds are held in a non-custodial
          escrow program on Solana {CLUSTER} — testnet USDC has no monetary value. If a game can&apos;t finish,
          recovery lets players reclaim their entry and remaining vault.
        </p>
      </section>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}

      {showEnroll && round && (
        <div className="modal-backdrop" onClick={() => setShowEnroll(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShowEnroll(false)} aria-label="Close">×</button>
            <h2>Take your seat</h2>
            <p className="sub">
              {usd.format(round.config.entryUsdc)} entry → pool &nbsp;+&nbsp; {usd.format(round.config.startingBankroll)} vault → yours to trade &nbsp;=&nbsp; <b>{usd.format(round.config.entryUsdc + round.config.startingBankroll)} total</b>
            </p>
            <label>
              Callsign
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={shortPk(wallet ?? "")} maxLength={16} />
            </label>
            <button className="btn primary full" onClick={doEnroll} disabled={busy} style={{ marginTop: 8 }}>
              {busy ? "Entering…" : `Lock in ${usd.format(round.config.entryUsdc + round.config.startingBankroll)}`}
            </button>
            <p className="disclaimer" style={{ marginTop: 12 }}>Entry funds the pool; the vault stays yours to trade and withdraw. Funds are held in a non-custodial escrow program on {CLUSTER}.</p>
          </div>
        </div>
      )}

      {showHost && (
        <div className="modal-backdrop" onClick={() => setShowHost(false)}>
          <div className="modal host-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShowHost(false)} aria-label="Close">×</button>
            <h2>Host a rumble</h2>
            <p className="sub">You set the terms. Every player funds the same seat — you can&apos;t hand anyone a bigger vault.</p>

            <div className="host-field">
              <span className="host-label">Asset</span>
              <div className="seg">
                {(["BTC", "ETH", "SOL"] as const).map((a) => (
                  <button key={a} className={hAsset === a ? "seg-opt on" : "seg-opt"} onClick={() => setHAsset(a)}>{a}</button>
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
              {busy ? "Opening…" : `Host ${hAsset} rumble`}
            </button>
            <p className="disclaimer" style={{ marginTop: 10 }}>
              Opens enrollment for a new rumble. If a rumble is already live or players have joined, yours starts when it settles.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
