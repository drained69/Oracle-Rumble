"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectSolanaWallet, fetchCategories } from "@/lib/panta-client";
import { getRound, enrollWithEscrow, tradeRound, newRound, placeParlayApi, claimFromEscrow, serverSettleArena, type RoundView } from "@/lib/round-client";
import type { Entrant, Round } from "@/lib/royale";
import { PUBLIC_ARENA } from "@/lib/royale";
import { markets as boardMarkets } from "@/lib/arena-data";
import { quoteParlay, PARLAY_MAX_LEGS, type ParlayLeg } from "@/lib/parlay";
import { avatarDataUrl } from "@/lib/avatars";

type EscrowStatus = { active: boolean; reason?: string | null };

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

export default function ArenaView({ arenaCode }: { arenaCode: string }) {
  const isPublic = arenaCode === PUBLIC_ARENA;
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
  // When a host call succeeds we mint a fresh arena code; this state drives
  // the "share your invite link" screen inside the host modal.
  const [inviteInfo, setInviteInfo] = useState<{ code: string; url: string } | null>(null);
  const [escrow, setEscrow] = useState<EscrowStatus | null>(null);
  const pollRef = useRef<number | null>(null);

  // Live invite URL for THIS arena (visible in the HUD when non-public).
  const currentInviteUrl = useMemo(() => {
    if (typeof window === "undefined" || isPublic) return "";
    return `${window.location.origin}/a/${arenaCode}`;
  }, [arenaCode, isPublic]);

  // ── boot ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const w = localStorage.getItem(WALLET_KEY);
      if (w) setWallet(w);
    } catch { /* ignore */ }
    fetchCategories().then((c) => setDataSource(c.source === "panta" ? "panta" : "mock")).catch(() => setDataSource("mock"));
    // Fetch escrow status ONCE — the server's config doesn't change per request.
    fetch("/api/escrow/status", { cache: "no-store" }).then((r) => r.json()).then(setEscrow).catch(() => setEscrow({ active: false, reason: "unreachable" }));
  }, []);

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

  // ── actions (all arena-scoped) ────────────────────────────────────
  const doEnroll = useCallback(async () => {
    if (!wallet) { setShowEnroll(false); setToast("Connect a wallet first."); return; }
    setBusy(true);
    try {
      const nick = (nickname || shortPk(wallet)).slice(0, 16);
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
  }, [wallet, nickname, arenaCode, refresh]);

  // ── settlement + claim ────────────────────────────────────────────
  // When a hosted arena's round hits `complete` and has an on-chain vault,
  // any client can nudge the server to sign SettlePlayer + CloseSettlement.
  // Idempotent server-side — first caller wins, everyone else no-ops.
  const settleFiredRef = useRef(false);
  useEffect(() => {
    if (!round) return;
    if (round.status !== "complete") return;
    if (!round.escrow) return;
    if (round.escrow.settleSignatures && round.escrow.settleSignatures.length > 0) return;
    if (settleFiredRef.current) return;
    settleFiredRef.current = true;
    (async () => {
      const res = await serverSettleArena(arenaCode);
      if (res.error) setToast(`Settle: ${res.error}`);
      else if (res.signatures?.length) setToast(`Arena settled on-chain · ${res.signatures.length} txs`);
      await refresh();
    })();
  }, [round, arenaCode, refresh]);

  const doClaim = useCallback(async (recover = false) => {
    if (!wallet) return setToast("Connect a wallet first.");
    setBusy(true);
    try {
      const r = await claimFromEscrow(wallet, arenaCode, recover);
      if (r.error) setToast(`Claim: ${r.error}`);
      else if (r.signature) setToast(`${recover ? "Recovered" : "Claimed"} · ${r.signature.slice(0, 8)}…`);
      else setToast("Withdrawal submitted.");
    } finally { setBusy(false); }
  }, [wallet, arenaCode]);

  const doBuy = useCallback(async () => {
    if (!wallet) return setToast("Connect a wallet first.");
    if (!enrolled) return setToast("Enroll in the round first.");
    const v = Number(amount);
    if (!v || v <= 0) return setToast("Enter an amount.");
    setBusy(true);
    try {
      const r = await tradeRound({ wallet, action: "buy", side, usdc: v, arena: arenaCode });
      if (r.error) setToast(r.error);
      else { setToast(`Bought ${side} $${v.toFixed(0)}.`); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, amount, side, arenaCode, refresh]);

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
      else { setToast(`Parlay placed · ${parlayLegs.length} legs.`); setParlayLegs([]); await refresh(); }
    } finally { setBusy(false); }
  }, [wallet, enrolled, parlayLegs, parlayStake, arenaCode, refresh]);

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
      if (v.error) { setToast(v.error); }
      else if (v.arena) {
        const url = `${window.location.origin}/a/${v.arena}`;
        setInviteInfo({ code: v.arena, url });
        setToast(`Arena ${v.arena} is open. Share the link.`);
      }
    } finally { setBusy(false); }
  }, [hAsset, hFormat, hEntry, hVault, hCapacity, hRounds, wallet]);

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

  const sourceBadge = dataSource === "panta"
    ? { text: `LIVE · ${CLUSTER}`, cls: "src live" }
    : dataSource === "mock" ? { text: "DEMO", cls: "src demo" } : { text: "…", cls: "src pending" };

  const myPnl = me ? me.bankroll - (round?.config.startingBankroll ?? 0) : 0;
  const openParlays = (me?.parlays ?? []).filter((p) => p.status === "open");
  const openParlayPotential = openParlays.reduce((s, t) => s + t.potentialPayout, 0);

  return (
    <main>
      {/* ── HUD ─────────────────────────────────────────────── */}
      <nav className="hud-bar">
        <a href="/" className="brand" aria-label="Oracle Rumble">
          <svg className="mark" viewBox="0 0 64 64" width="24" height="24" aria-hidden="true">
            <circle cx="32" cy="32" r="19" stroke="#00ff9d" strokeWidth="6" fill="none" />
            <path d="M22 36L30 28L35 33L44 22" stroke="#ffb54c" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" fill="none" />
          </svg>
          ORACLE RUMBLE
        </a>
        <div className="hud-nav">
          <a href="#arena">Arena</a>
          <a href="#how">How it works</a>
          {!isPublic && <a href="/">Lobby</a>}
        </div>
        <div className="hud-right">
          <span className={sourceBadge.cls}>{sourceBadge.text}</span>
          {escrow && (
            <span
              className={`escrow-badge ${escrow.active ? "on" : "off"}`}
              title={escrow.active
                ? "Real on-chain USDC — wallet will sign every seat deposit."
                : `Practice mode: ${escrow.reason ?? "escrow not configured"}. No wallet prompts, no real USDC moves.`}
            >
              <span className="dot" />
              {escrow.active ? "ON-CHAIN" : "PRACTICE"}
            </span>
          )}
          {isPublic ? (
            <span className="arena-chip public" title="Public walk-in arena">PUBLIC</span>
          ) : (
            <button className="arena-chip private" onClick={() => doCopyInvite()} title="Copy invite link">
              {arenaCode}
              <span className="copy-hint">⧉</span>
            </button>
          )}
          <button className="btn secondary sm" onClick={() => { setInviteInfo(null); setShowHost(true); }}>+ Host</button>
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
          <div className="rb-cell grow">
            <span className="rb-v">
              {isPublic ? "Opening the arena…" : `Arena ${arenaCode} has no live rumble. `}
              {!isPublic && <a className="link" href="/">Jump to the public arena →</a>}
            </span>
          </div>
        )}
      </div>

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
                  <h1>{champ ? `${champ.nickname} wins ${usd2.format(champ.prizeUsdc)}` : "Rumble complete"}</h1>
                  <p className="lead">
                    {paid.length > 1
                      ? `${usd.format(round.prizePoolUsdc)} pool split across the top ${paid.length}.`
                      : `${usd.format(round.prizePoolUsdc)} pool to the winner.`}
                    {" "}Everyone withdraws their remaining vault; winners also take the pool share.
                  </p>

                  {/* Claim / settle status for on-chain arenas */}
                  {round.escrow && (
                    <div className="claim-box">
                      {!escrowSettled ? (
                        <p>Locking in on-chain settlement…</p>
                      ) : (
                        <>
                          <p><b>Your withdrawal:</b> {usd2.format(myEntitlement)}</p>
                          <button
                            className="btn primary"
                            onClick={() => doClaim(false)}
                            disabled={busy || !canClaim}
                            title={!wallet ? "Connect the wallet you played with" : myEntitlement <= 0 ? "Nothing to claim" : ""}
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

                  <button className="btn primary" onClick={() => { setInviteInfo(null); setShowHost(true); }} disabled={busy}>Host the next rumble →</button>
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
        ) : round?.status === "cancelled" ? (
          <div className="champion">
            <p className="eyebrow">Arena {arenaCode} · cancelled</p>
            <h1>Rumble didn&apos;t finish</h1>
            <p className="lead">This arena was cancelled before it could complete. Anyone who deposited on-chain can recover their entry + starting vault.</p>
            {round.escrow && wallet && (
              <div className="claim-box">
                <button className="btn primary" onClick={() => doClaim(true)} disabled={busy}>
                  {busy ? "Recovering…" : `Recover ${usd2.format(round.config.entryUsdc + round.config.startingBankroll)}`}
                </button>
                <p className="disclaimer">Recovery is enabled after the settle deadline. If it fails with &quot;too early&quot;, wait a moment and retry.</p>
              </div>
            )}
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="r-avatar" src={avatarDataUrl(e.wallet, 24)} width={24} height={24} alt="" />
                        <span className="r-name">{e.nickname}{e.isBot ? <em>bot</em> : ""}{e.wallet === wallet ? <em>you</em> : ""}</span>
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
          <div><b>1 · Host chooses the game</b><p>Any user opens their own arena — pick BTC, ETH or SOL, the player limit, the entry, the starting vault, and one to four rounds. You get a shareable link.</p></div>
          <div><b>2 · Invite friends</b><p>Send the arena link. Anyone with the link takes a seat in your room — everyone else plays a different arena on the same site.</p></div>
          <div><b>3 · Entry and vault separate</b><p>Your entry joins the shared prize pool. Your starting vault stays in your own game account to trade.</p></div>
          <div><b>4 · Trade the same market</b><p>Everyone in your arena trades UP and DOWN on the same live market. Buy, sell, or hold cash until it closes.</p></div>
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
              Arena <b>{arenaCode}</b> · {usd.format(round.config.entryUsdc)} entry → pool &nbsp;+&nbsp; {usd.format(round.config.startingBankroll)} vault → yours to trade &nbsp;=&nbsp; <b>{usd.format(round.config.entryUsdc + round.config.startingBankroll)} total</b>
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
                  Enrollment is open now. Bots fill any empty seats when the timer locks — no minimum to start.
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
