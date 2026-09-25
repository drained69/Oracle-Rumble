"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectSolanaWallet, fetchCategories } from "@/lib/panta-client";
import { getRound, enrollRound, tradeRound, newRound, type RoundView } from "@/lib/round-client";
import type { Entrant, Round } from "@/lib/royale";

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
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showEnroll, setShowEnroll] = useState(false);
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

  const sourceBadge = dataSource === "panta"
    ? { text: `LIVE · ${CLUSTER}`, cls: "src live" }
    : dataSource === "mock" ? { text: "DEMO", cls: "src demo" } : { text: "…", cls: "src pending" };

  const myMark = me ? (me.side === "YES" ? yesPrice : me.side === "NO" ? 100 - yesPrice : 0) : 0;
  const myPnl = me ? me.bankroll - (round?.config.startingBankroll ?? 0) : 0;

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
            <p className="eyebrow">Round {round.roundNumber} · final</p>
            <h1>{standings[0] ? `${standings[0].nickname} takes the pool` : "Round complete"}</h1>
            <p className="lead">
              {standings[0] ? `${usd.format(round.prizePoolUsdc)} paid to the last survivor.` : "No survivors."}
              {" "}Ties broke to earliest entry.
            </p>
            <button className="btn primary" onClick={startNew} disabled={busy}>Open a new arena →</button>
            <div className="final-board">
              {standings.map((e) => (
                <div key={e.id} className={`fb-row ${e.wallet === wallet ? "me" : ""}`}>
                  <span className="fb-rank">{e.rank ?? "—"}</span>
                  <span className="fb-name">{e.nickname}{e.isBot ? " ·bot" : ""}</span>
                  <span className="fb-bank">{usd2.format(e.bankroll)}</span>
                </div>
              ))}
            </div>
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
                      <p>Enter the arena for <b>{usd.format(round.config.entryUsdc)}</b>. Every entrant starts with the same <b>{usd.format(round.config.startingBankroll)}</b> bankroll. Trade the market, outlast the cut, take the pool.</p>
                      <button className="btn primary" onClick={() => (wallet ? setShowEnroll(true) : connect())} disabled={busy}>
                        {wallet ? "Enter the arena" : "Connect to enter"}
                      </button>
                    </>
                  ) : (
                    <p>This round is <b>{STATUS_LABEL[round?.status ?? ""]?.toLowerCase()}</b>. Enrollment is closed — the next arena opens when this one settles.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="vault">
                    <div><span>Bankroll</span><b>{usd2.format(me!.bankroll)}</b></div>
                    <div><span>Cash</span><b>{usd2.format(me!.cash)}</b></div>
                    <div><span>Position</span><b>{me!.side ? `${me!.shares.toFixed(1)} ${me!.side} @ ${me!.avgPrice.toFixed(0)}¢` : "—"}</b></div>
                    <div className={myPnl >= 0 ? "up" : "down"}><span>Round P&amp;L</span><b>{myPnl >= 0 ? "+" : ""}{usd2.format(myPnl)}</b></div>
                  </div>

                  {round?.status === "live" ? (
                    <>
                      <div className="sides">
                        <button className={side === "YES" ? "side yes on" : "side yes"} onClick={() => setSide("YES")}>YES <b>{yesPrice}¢</b></button>
                        <button className={side === "NO" ? "side no on" : "side no"} onClick={() => setSide("NO")}>NO <b>{100 - yesPrice}¢</b></button>
                      </div>
                      <label className="field">
                        Stake from bankroll (USDC)
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
          <div><b>1 · Enter</b><p>Deposit the entry fee. Every entrant gets the same isolated starting bankroll.</p></div>
          <div><b>2 · Trade</b><p>Buy YES or NO on the round&apos;s live Panta market. Bankroll marks to the live price.</p></div>
          <div><b>3 · Settle</b><p>When the window closes the oracle price ranks everyone by final bankroll.</p></div>
          <div><b>4 · Cut</b><p>The bottom half is eliminated. Survivors advance to a fresh market.</p></div>
          <div><b>5 · Win</b><p>Last survivor — or the top of the final round — takes the entry pool.</p></div>
          <div><b>Fair play</b><p>Ties break to earliest entry. Bots fill empty seats so the loop always runs.</p></div>
        </div>
        <p className="disclaimer">
          Rounds, bankrolls, elimination and the prize pool are real server-side game state on Postgres, priced by
          live Panta markets on Solana {CLUSTER}. On-chain entry-fee escrow via an Anchor TraderVault is the next
          milestone — until then the pool is a ledger figure.
        </p>
      </section>

      {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}

      {showEnroll && round && (
        <div className="modal-backdrop" onClick={() => setShowEnroll(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setShowEnroll(false)} aria-label="Close">×</button>
            <h2>Enter the arena</h2>
            <p className="sub">Round {round.roundNumber} · entry {usd.format(round.config.entryUsdc)} · bankroll {usd.format(round.config.startingBankroll)} · {round.config.asset}</p>
            <label>
              Callsign
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={shortPk(wallet ?? "")} maxLength={16} />
            </label>
            <button className="btn primary full" onClick={doEnroll} disabled={busy} style={{ marginTop: 8 }}>
              {busy ? "Entering…" : `Enter for ${usd.format(round.config.entryUsdc)}`}
            </button>
            <p className="disclaimer" style={{ marginTop: 12 }}>Entry is ledgered to the prize pool. On-chain escrow ships with the TraderVault program.</p>
          </div>
        </div>
      )}
    </main>
  );
}
