"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  arenas as seedArenas,
  players,
  type Arena,
  type Market,
  type Position,
  type StoredParlay
} from "@/lib/arena-data";
import {
  buildClaim,
  buildOrder,
  connectSolanaWallet,
  fetchCategories,
  quoteOrder,
  quoteParlayLive,
  reportTrade,
  signAndBroadcast,
  submitOrder
} from "@/lib/panta-client";
import {
  PARLAY_MAX_LEGS,
  PARLAY_MIN_LEGS,
  quoteParlay,
  validateAddLeg,
  type ParlayLeg,
  type ParlayQuote
} from "@/lib/parlay";
import { mockPubkey } from "@/lib/panta";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const STORAGE_KEY = "oracle-rumble/state/v3";

type Persisted = {
  walletAddress: string | null;
  walletKind: "phantom" | "demo" | null;
  positions: Position[];
  hosted: string[];
  parlays: StoredParlay[];
};

function loadPersisted(): Persisted {
  const empty: Persisted = { walletAddress: null, walletKind: null, positions: [], hosted: [], parlays: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw);
    return {
      walletAddress: typeof p.walletAddress === "string" ? p.walletAddress : null,
      walletKind: p.walletKind === "phantom" || p.walletKind === "demo" ? p.walletKind : null,
      positions: Array.isArray(p.positions) ? p.positions : [],
      hosted: Array.isArray(p.hosted) ? p.hosted : [],
      parlays: Array.isArray(p.parlays) ? p.parlays : []
    };
  } catch {
    return empty;
  }
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "CLOSED";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}D ${h}H ${m}M`;
  if (h > 0) return `${h}H ${m}M ${sec}S`;
  return `${m}M ${sec}S`;
}

function shortenPk(pk: string) {
  if (!pk) return "";
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

function realmSigil(id: string) {
  // Deterministic little rune for each realm.
  switch (id) {
    case "solana-signals": return "◈";
    case "fight-night": return "⚔";
    case "shipmas": return "⛨";
    default: return "❖";
  }
}

function realmClass(id: string) {
  switch (id) {
    case "solana-signals": return "MAGE · SIGNAL RUNE";
    case "fight-night": return "WARRIOR · BLOOD CIRCLE";
    case "shipmas": return "ARCHITECT · SIEGE RING";
    default: return "WANDERER · OPEN RING";
  }
}

export default function Home() {
  // Persisted state — hydrated on mount to avoid SSR mismatch.
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletKind, setWalletKind] = useState<"phantom" | "demo" | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [hosted, setHosted] = useState<string[]>([]);
  const [parlays, setParlays] = useState<StoredParlay[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Arenas + live prices.
  const [arenas, setArenas] = useState<Arena[]>(() => seedArenas.map((a) => ({ ...a, markets: a.markets.map((m) => ({ ...m })) })));
  const [activeArenaId, setActiveArenaId] = useState<string>(seedArenas[0].id);
  const activeArena = useMemo(() => arenas.find((a) => a.id === activeArenaId) ?? arenas[0], [arenas, activeArenaId]);

  const deadlinesRef = useRef<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => (typeof performance !== "undefined" ? Date.now() : 0));

  const [activeMarketId, setActiveMarketId] = useState<string>(seedArenas[0].markets[0].id);
  const activeMarket: Market = useMemo(
    () => activeArena.markets.find((m) => m.id === activeMarketId) ?? activeArena.markets[0],
    [activeArena, activeMarketId]
  );
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("25");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [trading, setTrading] = useState(false);

  const [slipLegs, setSlipLegs] = useState<ParlayLeg[]>([]);
  const [slipStake, setSlipStake] = useState("10");
  const [slipOpen, setSlipOpen] = useState(false);
  const [placingParlay, setPlacingParlay] = useState(false);

  const [serverQuote, setServerQuote] = useState<ParlayQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const [dataSource, setDataSource] = useState<"panta" | "mock" | "unknown">("unknown");

  const [toast, setToast] = useState("");
  const [showHost, setShowHost] = useState(false);

  // ---- lifecycle -----------------------------------------------------

  useEffect(() => {
    const p = loadPersisted();
    setWalletAddress(p.walletAddress);
    setWalletKind(p.walletKind);
    setPositions(p.positions);
    setHosted(p.hosted);
    setParlays(p.parlays);
    const t = Date.now();
    setNow(t);
    const deadlines: Record<string, number> = {};
    for (const a of seedArenas) deadlines[a.id] = t + a.endsInMs;
    deadlinesRef.current = deadlines;
    setHydrated(true);

    fetchCategories()
      .then((c) => setDataSource(c.source === "panta" ? "panta" : "mock"))
      .catch(() => setDataSource("mock"));
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const payload: Persisted = { walletAddress, walletKind, positions, hosted, parlays };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  }, [walletAddress, walletKind, positions, hosted, parlays, hydrated]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setArenas((prev) => prev.map((arena) => ({
        ...arena,
        markets: arena.markets.map((m) => {
          const delta = Math.round((Math.random() - 0.5) * 4);
          const next = Math.min(96, Math.max(4, m.yesPrice + delta));
          return { ...m, yesPrice: next, change: m.change + delta };
        })
      })));
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (slipLegs.length === 0) { setServerQuote(null); return; }
    const stake = Number(slipStake);
    if (!Number.isFinite(stake) || stake <= 0) { setServerQuote(null); return; }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setQuoting(true);
      try {
        const res = await quoteParlayLive({
          legs: slipLegs.map((l) => ({
            marketId: l.marketId,
            side: l.side,
            correlationGroup: l.correlationGroup,
            question: l.question
          })),
          stakeUsdc: stake
        });
        if (!cancelled) setServerQuote(res.quote);
      } catch {
        if (!cancelled) setServerQuote(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [slipLegs, slipStake]);

  useEffect(() => {
    if (!activeArena.markets.some((m) => m.id === activeMarketId)) {
      setActiveMarketId(activeArena.markets[0].id);
      setSide("YES");
    }
    setCategoryFilter("All");
  }, [activeArena, activeMarketId]);

  // ---- derived -------------------------------------------------------

  const connected = !!walletAddress;
  const price = side === "YES" ? activeMarket.yesPrice : 100 - activeMarket.yesPrice;
  const quantity = useMemo(() => Number(amount || 0) / (price / 100), [amount, price]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    activeArena.markets.forEach((m) => set.add(m.category));
    return ["All", ...Array.from(set)];
  }, [activeArena]);

  const filteredMarkets = useMemo(
    () => (categoryFilter === "All" ? activeArena.markets : activeArena.markets.filter((m) => m.category === categoryFilter)),
    [activeArena, categoryFilter]
  );

  const arenaPositions = useMemo(
    () => positions.filter((p) => p.arenaId === activeArena.id),
    [positions, activeArena.id]
  );

  const openPnL = useMemo(() => {
    let total = 0;
    for (const p of arenaPositions) {
      const m = activeArena.markets.find((x) => x.id === p.marketId);
      if (!m) continue;
      const mark = p.side === "YES" ? m.yesPrice : 100 - m.yesPrice;
      total += (mark - p.entryPrice) * p.shares / 100;
    }
    return total;
  }, [arenaPositions, activeArena]);

  const localQuote = useMemo(() => quoteParlay(slipLegs, Number(slipStake) || 0), [slipLegs, slipStake]);
  const parlayQuote: ParlayQuote = serverQuote ?? localQuote;

  const countdownMs = hydrated ? Math.max(0, (deadlinesRef.current[activeArena.id] ?? 0) - now) : activeArena.endsInMs;
  const countdownLabel = hydrated ? formatCountdown(countdownMs) : formatCountdown(activeArena.endsInMs);

  // ---- actions -------------------------------------------------------

  const connect = useCallback(async () => {
    if (connected) {
      setWalletAddress(null);
      setWalletKind(null);
      setToast("Wallet disconnected · your rumbler has left the realm.");
      return;
    }
    const real = await connectSolanaWallet();
    if (real) {
      setWalletAddress(real);
      setWalletKind("phantom");
      setToast(`Phantom connected · ${shortenPk(real)}`);
    } else {
      const demo = mockPubkey();
      setWalletAddress(demo);
      setWalletKind("demo");
      setToast(`Demo wallet spun up · ${shortenPk(demo)}`);
    }
  }, [connected]);

  const trade = useCallback(async () => {
    if (!walletAddress) return setToast("Connect a wallet before entering the ring.");
    const value = Number(amount);
    if (!value || value <= 0) return setToast("Wager must be greater than $0.");
    if (value > 10_000) return setToast("Demo cap is $10,000 per wager.");

    setTrading(true);
    try {
      const quote = await quoteOrder({
        marketId: activeMarket.id,
        side,
        usdcAmount: value.toFixed(2),
        wallet: walletAddress
      });
      const built = await buildOrder({ quoteId: quote.quoteId, wallet: walletAddress });
      const signed = await signAndBroadcast({ serializedTx: built.serializedTx, wallet: walletAddress });
      const submitted = await submitOrder({ quoteId: quote.quoteId, signature: signed.signature, wallet: walletAddress });
      await reportTrade({ signature: signed.signature, wallet: walletAddress, marketId: activeMarket.id });

      const pos: Position = {
        id: `${activeMarket.id}-${Date.now().toString(36)}`,
        arenaId: activeArena.id,
        marketId: activeMarket.id,
        question: activeMarket.question,
        side,
        entryPrice: quote.price,
        shares: quote.shares,
        cost: Number(quote.usdcAmount),
        ts: Date.now(),
        signature: submitted.signature,
        quoteId: quote.quoteId
      };
      setPositions((prev) => [pos, ...prev]);
      const label = signed.simulated ? "simulated" : "on-chain";
      setToast(`${side} filled · ${quote.shares.toFixed(1)} shares at ${quote.price}¢ · sig ${shortenPk(signed.signature)} (${label})`);
    } catch (err) {
      console.error(err);
      setToast(`Trade failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setTrading(false);
    }
  }, [walletAddress, amount, side, activeMarket, activeArena.id]);

  const closePosition = useCallback((id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
    setToast("Position retired.");
  }, []);

  const claimPosition = useCallback(async (p: Position) => {
    if (!walletAddress) return setToast("Connect a wallet to claim the spoils.");
    try {
      const claim = await buildClaim({ wallet: walletAddress, marketId: p.marketId });
      const signed = await signAndBroadcast({ serializedTx: claim.serializedTx, wallet: walletAddress });
      await reportTrade({ signature: signed.signature, wallet: walletAddress, marketId: p.marketId });
      setToast(`Claimed $${claim.amountUsdc} · sig ${shortenPk(signed.signature)}`);
    } catch (err) {
      setToast(`Claim failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [walletAddress]);

  const addLegToSlip = useCallback((market: Market, pickedSide: "YES" | "NO") => {
    const p = pickedSide === "YES" ? market.yesPrice : 100 - market.yesPrice;
    const candidate: ParlayLeg = {
      marketId: market.id,
      question: market.question,
      side: pickedSide,
      price: p,
      correlationGroup: market.correlationGroup
    };
    setSlipLegs((prev) => {
      const check = validateAddLeg(prev, candidate);
      if (!check.ok) { setToast(check.reason); return prev; }
      if (prev.some((l) => l.marketId === market.id)) {
        return prev.map((l) => l.marketId === market.id ? candidate : l);
      }
      return [...prev, candidate];
    });
    setSlipOpen(true);
  }, []);

  const removeLeg = useCallback((marketId: string) => {
    setSlipLegs((prev) => prev.filter((l) => l.marketId !== marketId));
  }, []);

  const clearSlip = useCallback(() => setSlipLegs([]), []);

  const placeParlay = useCallback(async () => {
    if (!walletAddress) return setToast("Connect a wallet before invoking a parlay.");
    if (slipLegs.length < 2) return setToast("A parlay needs at least two legs.");
    const stake = Number(slipStake);
    if (!stake || stake <= 0) return setToast("Stake must be greater than $0.");

    setPlacingParlay(true);
    try {
      const parlayId = `parlay_${Date.now().toString(36)}`;
      const perLeg = parlayQuote.netStakeUsdc / slipLegs.length;
      const results = await Promise.all(slipLegs.map(async (leg) => {
        const q = await quoteOrder({ marketId: leg.marketId, side: leg.side, usdcAmount: perLeg.toFixed(2), wallet: walletAddress });
        const b = await buildOrder({ quoteId: q.quoteId, wallet: walletAddress });
        const s = await signAndBroadcast({ serializedTx: b.serializedTx, wallet: walletAddress });
        await submitOrder({ quoteId: q.quoteId, signature: s.signature, wallet: walletAddress });
        await reportTrade({ signature: s.signature, wallet: walletAddress, marketId: leg.marketId });
        return { legId: leg.marketId, signature: s.signature };
      }));

      const parlay: StoredParlay = {
        id: parlayId,
        arenaId: activeArena.id,
        ts: Date.now(),
        legs: slipLegs.map((l) => ({ marketId: l.marketId, question: l.question, side: l.side, price: l.price })),
        combinedPrice: parlayQuote.combinedPrice,
        stake: parlayQuote.stakeUsdc,
        fee: parlayQuote.feeUsdc,
        shares: parlayQuote.shares,
        potentialPayout: parlayQuote.potentialPayoutUsdc,
        signature: results[0]?.signature
      };
      setParlays((prev) => [parlay, ...prev]);
      setSlipLegs([]);
      setSlipOpen(false);
      setServerQuote(null);
      setToast(
        `${slipLegs.length}-leg parlay sworn · ${parlayQuote.combinedPrice.toFixed(1)}¢ combined · ${parlayQuote.impliedOdds.toFixed(2)}× · payout up to ${usd.format(parlayQuote.potentialPayoutUsdc)}`
      );
    } catch (err) {
      setToast(`Parlay failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setPlacingParlay(false);
    }
  }, [walletAddress, slipLegs, slipStake, parlayQuote, activeArena.id]);

  function createArena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "Untitled ring").trim() || "Untitled ring";
    setHosted((current) => [title, ...current]);
    setShowHost(false);
    setToast(`"${title}" forged as a draft realm.`);
  }

  // ---- render --------------------------------------------------------

  const sourceBadge = dataSource === "panta"
    ? { text: "LIVE · PANTA", cls: "src live" }
    : dataSource === "mock"
      ? { text: "DEMO · MOCK", cls: "src demo" }
      : { text: "CONNECTING…", cls: "src pending" };

  const legInSlip = slipLegs.find((l) => l.marketId === activeMarket.id);
  const initials = walletAddress ? walletAddress.slice(0, 2).toUpperCase() : "?";
  const lvl = Math.min(99, 1 + positions.length * 3 + parlays.length * 5);

  return (
    <main>
      {/* -------- HUD BAR -------- */}
      <nav className="hud-bar">
        <a className="brand" href="#top">
          <span className="sigil"><span>◈</span></span>
          ORACLE <b>RUMBLE</b>
        </a>
        <div className="hud-nav">
          <a href="#realms" className="on">RINGS</a>
          <a href="#arena">BATTLE</a>
          <a href="#warband">WARBAND</a>
          <a href="#hall">HALL</a>
          <a href="#codex">CODEX</a>
        </div>
        <div className="hud-right">
          <span
            className={sourceBadge.cls}
            title={dataSource === "panta" ? "Talking to live-api.panta.market" : "Set PANTA_API_KEY in .env.local to go live"}
          >
            {sourceBadge.text}
          </span>
          <button
            className={connected ? "wallet connected" : "wallet"}
            onClick={connect}
            title={connected ? "Click to disconnect" : "Connect Phantom or spin up a demo wallet"}
          >
            <span className="avatar">{connected ? initials : "◈"}</span>
            <div>
              <div>{connected ? shortenPk(walletAddress!) : "ENTER THE WORLD"}</div>
              {connected && <div className="lvl">LVL {lvl} · {walletKind === "phantom" ? "PHANTOM" : "DEMO"}</div>}
            </div>
          </button>
        </div>
      </nav>

      {/* -------- LIVE TICKER -------- */}
      <div className="ticker">
        <div className="ticker-track">
          <span><b>SEASON 01</b> · GENESIS RUN</span>
          <span><em>+$412.20</em> mira.vale on <b>SOL &gt; $200</b></span>
          <span><i>−$88.10</i> dune on <b>KO finish</b></span>
          <span>3-LEG PARLAY hit · <em>4.82×</em> · witness</span>
          <span><b>1,248</b> RUMBLERS ONLINE</span>
          <span><em>+$1,020.00</em> onchain.aya · OpenAI ships</span>
          <span>NEW RING · <b>SHIPMAS</b> opens in 4H</span>
          <span><b>SEASON 01</b> · GENESIS RUN</span>
          <span><em>+$412.20</em> mira.vale on <b>SOL &gt; $200</b></span>
          <span><i>−$88.10</i> dune on <b>KO finish</b></span>
          <span>3-LEG PARLAY hit · <em>4.82×</em> · witness</span>
          <span><b>1,248</b> RUMBLERS ONLINE</span>
          <span><em>+$1,020.00</em> onchain.aya · OpenAI ships</span>
          <span>NEW RING · <b>SHIPMAS</b> opens in 4H</span>
        </div>
      </div>

      {/* -------- PORTAL HERO -------- */}
      <section className="portal" id="top">
        <div className="portal-inner">
          <p className="eyebrow">SEASON 01 · GENESIS RUN · SOLANA MAINNET</p>
          <h1>CALL IT.<br/><em>PROVE IT.</em><br/>CLIMB.</h1>
          <p className="portal-copy">
            Oracle Rumble is a game lobby for prediction markets. Pick a ring, stake your conviction on live
            Panta markets, stack legs into a parlay, and carve your name into the hall of champions.
          </p>
          <div className="portal-actions">
            <a href="#realms" className="gbtn primary">ENTER THE LOBBY <span className="arr">▸</span></a>
            <button className="gbtn secondary" onClick={() => setShowHost(true)}>FORGE A RING <span className="arr">+</span></button>
          </div>

          <div className="hud-stats">
            <div className="stat"><b>1,248</b><span>◈ RUMBLERS</span></div>
            <div className="stat"><b>{arenas.length + hosted.length}</b><span>⚔ ACTIVE RINGS</span></div>
            <div className="stat"><b>$284K</b><span>⛨ VOLUME TRACKED</span></div>
            <div className="stat"><b>{PARLAY_MIN_LEGS}–{PARLAY_MAX_LEGS}</b><span>❖ PARLAY LEGS</span></div>
          </div>
        </div>
      </section>

      {/* -------- REALM SELECT -------- */}
      <section className="realm-shell" id="realms">
        <div className="section-head">
          <div>
            <p className="eyebrow">CHOOSE YOUR REALM</p>
            <h2>THE RINGS</h2>
          </div>
          <span className="flair"><i />LIVE · {arenas.length} RINGS RUNNING</span>
        </div>

        <div className="realm-grid">
          {arenas.map((a) => {
            const ms = hydrated ? Math.max(0, (deadlinesRef.current[a.id] ?? 0) - now) : a.endsInMs;
            return (
              <button
                key={a.id}
                className={a.id === activeArenaId ? "realm on" : "realm"}
                onClick={() => { setActiveArenaId(a.id); document.getElementById("arena")?.scrollIntoView({ behavior: "smooth" }); }}
              >
                <span className="cnr bl" /><span className="cnr br" />
                <span className="rank-tag">{realmSigil(a.id)} {realmClass(a.id)}</span>
                <h3>{a.name}</h3>
                <p>{a.tagline}</p>
                <div className="realm-meta">
                  <span>{a.markets.length} MKTS · {formatCountdown(ms)}</span>
                  <span className="enter">{a.id === activeArenaId ? "ACTIVE ▸" : "ENTER ▸"}</span>
                </div>
              </button>
            );
          })}
          {hosted.map((h, i) => (
            <div key={`draft-${i}`} className="realm draft">
              <span className="rank-tag">❖ DRAFT · UNSEALED</span>
              <h3>{h}</h3>
              <p>A ring waiting to be sealed on Panta. Complete the ritual to open it to rumblers.</p>
              <div className="realm-meta">
                <span>DRAFT</span>
                <span className="enter">PENDING…</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------- BATTLE ARENA -------- */}
      <section className="arena-shell" id="arena">
        <div className="arena-crown">
          <span className="cnr bl" /><span className="cnr br" />
          <div>
            <p className="eyebrow">◈ ACTIVE RING</p>
            <h2>{activeArena.name}</h2>
            <p>{activeArena.tagline}</p>
          </div>
          <div className="timer">
            ⌛ RING CLOSES IN
            <b>{countdownLabel}</b>
          </div>
        </div>

        <div className="arena-body">
          <div className="arena-panel">
            <span className="cnr bl" /><span className="cnr br" />
            <div className="panel-head">
              <span>◈ MARKET BOARD</span>
              <small>Panta id · {shortenPk(activeMarket.id)}</small>
            </div>
            <div className="chips">
              {categories.map((c) => (
                <button
                  key={c}
                  className={c === categoryFilter ? "chip on" : "chip"}
                  onClick={() => setCategoryFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="battle-list">
              {filteredMarkets.map((market) => {
                const legHere = slipLegs.find((l) => l.marketId === market.id);
                return (
                  <div key={market.id} className={activeMarket.id === market.id ? "battle active" : "battle"}>
                    <button
                      className="battle-body"
                      onClick={() => { setActiveMarketId(market.id); setSide("YES"); }}
                    >
                      <div>
                        <span className="cat">{market.category}</span>
                        <h3>{market.question}</h3>
                        <p className="sub">{market.volume} vol · {market.closes}</p>
                      </div>
                      <div className="odds">
                        <b>{market.yesPrice}¢</b>
                        <span className={market.change >= 0 ? "up" : "down"}>
                          {market.change >= 0 ? "▲" : "▼"} {Math.abs(market.change)}¢
                        </span>
                      </div>
                    </button>
                    <div className="pick-col">
                      <button
                        className={legHere?.side === "YES" ? "pick yes on" : "pick yes"}
                        onClick={() => addLegToSlip(market, "YES")}
                        title="Stack YES leg on the parlay scroll"
                      >
                        ▲ YES
                      </button>
                      <button
                        className={legHere?.side === "NO" ? "pick no on" : "pick no"}
                        onClick={() => addLegToSlip(market, "NO")}
                        title="Stack NO leg on the parlay scroll"
                      >
                        ▼ NO
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredMarkets.length === 0 && (
                <div className="empty">No markets match that filter.</div>
              )}
            </div>
          </div>

          <aside className="arena-panel combat">
            <span className="cnr bl" /><span className="cnr br" />
            <div className="panel-head">
              <span>⚔ WAGER PANEL</span>
              <small>{walletKind === "phantom" ? "PHANTOM SIGNER" : walletKind === "demo" ? "DEMO SIGNER" : "WALLET-CONTROLLED"}</small>
            </div>
            <div className="inner">
              <div>
                <span className="cat" style={{ marginBottom: 8, display: "inline-block" }}>{activeMarket.category}</span>
                <h3 className="marketq">{activeMarket.question}</h3>
              </div>

              <div className="side-switch">
                <button className={side === "YES" ? "side yes on" : "side yes"} onClick={() => setSide("YES")}>
                  ▲ YES <span className="odds">{activeMarket.yesPrice}¢</span>
                </button>
                <button className={side === "NO" ? "side no on" : "side no"} onClick={() => setSide("NO")}>
                  ▼ NO <span className="odds">{100 - activeMarket.yesPrice}¢</span>
                </button>
              </div>

              <div className="field">
                <label>Wager (USDC)</label>
                <div className="amount-row">
                  <span className="curr">$</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    aria-label="Wager amount in USDC"
                  />
                  <button type="button" className="max" onClick={() => setAmount("100")}>MAX</button>
                </div>
              </div>

              <div className="summary">
                <span>Avg. price</span><b>{price}¢</b>
                <span>Est. shares</span><b>{quantity.toFixed(1)}</b>
                <span>Potential payout</span><b className="gold">{usd.format(quantity)}</b>
                <span>Route</span><b>{dataSource === "panta" ? "Panta primary_order" : "Panta (mocked)"}</b>
              </div>

              <button className="gbtn primary full" onClick={trade} disabled={trading}>
                {trading ? "ROUTING…" : connected ? `STRIKE ${side}` : "CONNECT TO STRIKE"} <span className="arr">▸</span>
              </button>
              <button
                className="gbtn secondary full"
                onClick={() => addLegToSlip(activeMarket, side)}
                disabled={trading}
              >
                {legInSlip ? "UPDATE SCROLL" : "ADD TO SCROLL"} <span className="arr">+</span>
              </button>

              <p className="fine">
                Quote → build → sign → submit → attribute. Your wallet signs the Panta VersionedTransaction;
                Oracle Rumble never holds funds. Fees follow Panta&apos;s bonding-curve pricing.
              </p>
            </div>
          </aside>
        </div>
      </section>

      {/* -------- WARBAND (positions) -------- */}
      <section className="warband" id="warband">
        <div className="section-head">
          <div>
            <p className="eyebrow">◈ YOUR WARBAND</p>
            <h2>OPEN POSITIONS</h2>
          </div>
          <span className="flair">
            <i />
            {arenaPositions.length} POS · {parlays.filter((p) => p.arenaId === activeArena.id).length} PARLAYS · {activeArena.name.toUpperCase()}
          </span>
        </div>

        <div className="warband-frame">
          <span className="cnr bl" /><span className="cnr br" />
          <div className="warband-totals">
            <div>
              <span>◈ OPEN POSITIONS</span>
              <b>{arenaPositions.length}</b>
            </div>
            <div>
              <span>❖ PARLAYS THIS RING</span>
              <b>{parlays.filter((p) => p.arenaId === activeArena.id).length}</b>
            </div>
            <div>
              <span>⛨ COST BASIS</span>
              <b>{usd2.format(arenaPositions.reduce((s, p) => s + p.cost, 0))}</b>
            </div>
            <div className={openPnL >= 0 ? "pnl up" : "pnl down"}>
              <span>⚔ OPEN P&amp;L</span>
              <b>{openPnL >= 0 ? "+" : ""}{usd2.format(openPnL)}</b>
            </div>
          </div>

          {arenaPositions.length === 0 && parlays.filter((p) => p.arenaId === activeArena.id).length === 0 ? (
            <div className="empty tall">
              YOUR BLADE IS SHEATHED. PICK A MARKET ABOVE OR STACK A PARLAY SCROLL TO ENTER THE FRAY.
            </div>
          ) : (
            <>
              <ul className="pos-list">
                {arenaPositions.map((p) => {
                  const m = activeArena.markets.find((x) => x.id === p.marketId);
                  const mark = m ? (p.side === "YES" ? m.yesPrice : 100 - m.yesPrice) : p.entryPrice;
                  const pnl = (mark - p.entryPrice) * p.shares / 100;
                  const claimable = m?.phase === "resolved" && m?.outcome === p.side;
                  return (
                    <li key={p.id} className="pos">
                      <div className="pos-main">
                        <span className={p.side === "YES" ? "badge yes" : "badge no"}>{p.side}</span>
                        <div>
                          <h4>{p.question}</h4>
                          <p className="pos-sub">
                            {p.shares.toFixed(1)} SHARES · ENTRY {p.entryPrice}¢ · MARK {mark}¢
                            {p.signature ? ` · SIG ${shortenPk(p.signature)}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="pos-right">
                        <strong className={pnl >= 0 ? "up" : "down"}>
                          {pnl >= 0 ? "+" : ""}{usd2.format(pnl)}
                        </strong>
                        {claimable && (
                          <button className="gbtn small primary" onClick={() => claimPosition(p)}>CLAIM</button>
                        )}
                        <button className="gbtn small secondary" onClick={() => closePosition(p.id)}>RETIRE</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {parlays.filter((p) => p.arenaId === activeArena.id).length > 0 && (
                <div>
                  <div className="parlay-title">❖ PARLAY SCROLLS</div>
                  {parlays.filter((p) => p.arenaId === activeArena.id).map((p) => (
                    <div className="parlay-card" key={p.id}>
                      <div>
                        <div className="parlay-head">
                          <span className="pill gold">{p.legs.length}-LEG</span>
                          <span className="pill arcane">{p.combinedPrice.toFixed(1)}¢ COMBINED</span>
                          {p.signature && <span className="pill soft">SIG {shortenPk(p.signature)}</span>}
                        </div>
                        <ul className="parlay-legs">
                          {p.legs.map((l) => (
                            <li key={l.marketId}>
                              <span className={l.side === "YES" ? "badge yes" : "badge no"} style={{ padding: "3px 7px", minWidth: 40, fontSize: 10 }}>{l.side}</span>
                              <span>{l.question}</span>
                              <b>{l.price}¢</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="parlay-num">
                        <div><span>STAKE</span><b>{usd2.format(p.stake)}</b></div>
                        <div><span>PAYOUT IF HIT</span><b className="up">{usd2.format(p.potentialPayout)}</b></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* -------- HALL OF CHAMPIONS -------- */}
      <section className="hall-shell" id="hall">
        <div className="section-head">
          <div>
            <p className="eyebrow">◈ HALL OF CHAMPIONS</p>
            <h2>THE BOARD</h2>
          </div>
          <span className="flair"><i />SEASON 01 STANDINGS · LIVE</span>
        </div>

        <div className="hall">
          <span className="cnr bl" /><span className="cnr br" />
          {players.map((player) => (
            <div className="player" key={player.rank}>
              <span className={`rank rank-${player.rank}`}>
                {player.rank === 1 && <span className="crown">♛</span>}
                {String(player.rank).padStart(2, "0")}
              </span>
              <span className={`avatar-lg ${player.color}`}>{player.initials}</span>
              <b>{player.name}</b>
              <span className="player-meta">{player.markets} MARKETS · {player.accuracy}% ACCURACY</span>
              <strong>+{player.returnPct}%</strong>
            </div>
          ))}
        </div>
      </section>

      {/* -------- CODEX -------- */}
      <section className="codex-shell" id="codex">
        <div className="section-head">
          <div>
            <p className="eyebrow">◈ THE CODEX · POWERED BY PANTA</p>
            <h2>THE LIFECYCLE</h2>
          </div>
        </div>
        <p className="codex-lead">
          Every strike, claim, and attribution runs the real Panta lifecycle on Solana. Parlays are a
          client-space bundle of N linked orders, priced live from Panta&apos;s single-market book — the same
          quote-based liquidity idea parlayit uses. ~400ms slot times. USDC 1:1.
        </p>

        <div className="steps">
          <article><span>I.</span><h3>DISCOVER</h3><p><code>GET /markets</code> — the board is a Panta catalog view, filtered by category.</p></article>
          <article><span>II.</span><h3>QUOTE</h3><p><code>POST /orders/quote</code> — simulate the fill on the bonding curve; short-lived quote session.</p></article>
          <article><span>III.</span><h3>BUILD & SIGN</h3><p><code>POST /orders/build</code> — Panta returns a VersionedTransaction your wallet signs.</p></article>
          <article><span>IV.</span><h3>SUBMIT</h3><p><code>POST /orders/submit</code> — the signed tx broadcasts to RPC, and Panta registers it.</p></article>
          <article><span>V.</span><h3>ATTRIBUTE</h3><p><code>POST /trades/report</code> then <code>POST /claims/build</code> — trades count on the board; winnings claimable.</p></article>
        </div>

        <h3 className="parlay-mech-title">❖ PARLAY MECHANICS</h3>
        <div className="parlay-mech">
          <article>
            <h4>QUOTE-BASED LIQUIDITY</h4>
            <p><code>POST /api/parlay/quote</code> refreshes every leg&apos;s price from Panta and prices the parlay dynamically.</p>
          </article>
          <article>
            <h4>2–5 LEG BOUNDS</h4>
            <p><code>PARLAY_MIN_LEGS</code> = 2, <code>PARLAY_MAX_LEGS</code> = 5. Enforced on client and server.</p>
          </article>
          <article>
            <h4>CORRELATION BLOCKS</h4>
            <p>Legs sharing a <code>correlationGroup</code> (KO vs Decision) are mutually exclusive.</p>
          </article>
          <article>
            <h4>VARIANCE-BASED FEE</h4>
            <p>Per-leg fee is <code>stake × 5% × 4p(1-p)</code>. Peaks at coinflip legs; capped at 5% of stake overall.</p>
          </article>
          <article>
            <h4>50/50 FALLBACK</h4>
            <p>If a leg voids at resolution it pays 0.5×, so payout halves once per voided leg.</p>
          </article>
          <article>
            <h4>PLACEMENT</h4>
            <p>A parlay is placed as N linked <code>primary_order_usdc</code> orders sharing a client <code>parlayId</code>.</p>
          </article>
        </div>
      </section>

      <footer>
        <span className="brand-mini">◈ ORACLE RUMBLE</span>
        <span>Prediction-market rings on <a className="ilink" href="https://www.panta.market/" target="_blank" rel="noreferrer">Panta</a> · settled on <a className="ilink" href="https://solana.com/docs" target="_blank" rel="noreferrer">Solana</a></span>
        <a className="ilink" href="https://docs.panta.market/" target="_blank" rel="noreferrer">PANTA API DOCS ▸</a>
      </footer>

      {/* -------- PARLAY SCROLL (fab + drawer) -------- */}
      <button
        className={slipLegs.length > 0 ? "slip-fab on" : "slip-fab"}
        onClick={() => setSlipOpen((v) => !v)}
        aria-label="Toggle parlay scroll"
      >
        ❖ SCROLL <b>{slipLegs.length}</b>
      </button>
      {slipOpen && (
        <div className="slip">
          <div className="slip-head">
            <div>
              <b>◈ PARLAY SCROLL</b>
              <p>{slipLegs.length} LEG{slipLegs.length === 1 ? "" : "S"} · COMBINED {parlayQuote.combinedPrice.toFixed(1)}¢ · {parlayQuote.impliedOdds.toFixed(2)}×</p>
            </div>
            <div className="slip-actions">
              <button onClick={clearSlip} disabled={slipLegs.length === 0}>CLEAR</button>
              <button onClick={() => setSlipOpen(false)} aria-label="Close">×</button>
            </div>
          </div>

          {slipLegs.length === 0 ? (
            <div className="slip-empty">
              STACK LEGS BY TAPPING ▲ YES OR ▼ NO ON ANY MARKET.<br/>
              A PARLAY LANDS ONLY IF EVERY LEG HITS.
            </div>
          ) : (
            <>
              <ul className="slip-legs">
                {slipLegs.map((l) => (
                  <li key={l.marketId}>
                    <span className={l.side === "YES" ? "badge yes" : "badge no"} style={{ padding: "4px 8px", minWidth: 42, fontSize: 10 }}>{l.side}</span>
                    <div className="slip-leg-body">
                      <b>{l.question}</b>
                      <span>{l.price}¢ · {shortenPk(l.marketId)}</span>
                    </div>
                    <button className="rm" onClick={() => removeLeg(l.marketId)} aria-label="Remove leg">×</button>
                  </li>
                ))}
              </ul>
              <label className="slip-stake">STAKE</label>
              <div className="amount-row">
                <span className="curr">$</span>
                <input
                  value={slipStake}
                  onChange={(e) => setSlipStake(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                />
              </div>
              <div className="slip-summary" style={{ marginTop: 14 }}>
                <span>Combined price</span><b>{parlayQuote.combinedPrice.toFixed(2)}¢</b>
                <span>Implied odds</span><b>{parlayQuote.impliedOdds.toFixed(2)}×</b>
                <span title="Per-leg fee is stake × 5% × 4p(1-p) — peaks at coinflip legs. Capped at 5% overall.">Variance fee</span>
                <b>{usd2.format(parlayQuote.feeUsdc)}</b>
                <span>Net stake</span><b>{usd2.format(parlayQuote.netStakeUsdc)}</b>
                <span>Payout if every leg hits</span><b className="up">{usd2.format(parlayQuote.potentialPayoutUsdc)}</b>
                <span title="If any leg voids to 50/50 at resolution, that leg pays 0.5×.">Payout if one voids</span>
                <b>{usd2.format(parlayQuote.halfPayoutIfOneVoidUsdc)}</b>
              </div>
              <div className="slip-legfees">
                {slipLegs.map((l, i) => (
                  <span key={l.marketId}>
                    <em>{l.question.slice(0, 30)}{l.question.length > 30 ? "…" : ""}</em>
                    <b>{usd2.format(parlayQuote.legFees[i] ?? 0)}</b>
                  </span>
                ))}
                <small>{quoting ? "RE-QUOTING FROM PANTA…" : "PRICED FROM LIVE PANTA · 15S TTL"}</small>
              </div>
              <button
                className="gbtn primary full"
                onClick={placeParlay}
                disabled={placingParlay || slipLegs.length < 2}
              >
                {placingParlay ? "SEALING PARLAY…" : slipLegs.length < 2 ? "ADD ANOTHER LEG" : `SEAL ${slipLegs.length}-LEG PARLAY`} <span className="arr">▸</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* -------- TOAST -------- */}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* -------- HOST MODAL -------- */}
      {showHost && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowHost(false)}>
          <form className="modal" onSubmit={createArena} onClick={(e) => e.stopPropagation()}>
            <span className="cnr bl" /><span className="cnr br" />
            <button type="button" className="close" onClick={() => setShowHost(false)} aria-label="Close">×</button>
            <p className="eyebrow">◈ FORGE A RING</p>
            <h2>OPEN THE GATES.</h2>
            <label>
              RING NAME
              <input name="title" required placeholder="e.g. DeFi Sunday" maxLength={60} />
            </label>
            <label>
              REALM
              <select name="theme" defaultValue="Crypto & markets">
                <option>Crypto &amp; markets</option>
                <option>Sports &amp; events</option>
                <option>Community forecasts</option>
                <option>Product launches</option>
              </select>
            </label>
            <label>
              DURATION
              <select name="duration" defaultValue="72 hours">
                <option>72 hours</option>
                <option>1 week</option>
                <option>1 month</option>
              </select>
            </label>
            <button className="gbtn primary full" type="submit">FORGE DRAFT <span className="arr">▸</span></button>
            <p className="fine">
              Draft rings live in this browser. In production the host would call
              <code> POST /markets/quote</code> → <code>/markets/build</code> → <code>/markets/register</code> to seal USDC markets on Panta.
            </p>
          </form>
        </div>
      )}
    </main>
  );
}
