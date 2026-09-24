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
  if (ms <= 0) return "Closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function shortenPk(pk: string) {
  if (!pk) return "";
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
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

  // Countdown deadlines per arena (absolute), pinned on mount.
  const deadlinesRef = useRef<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => (typeof performance !== "undefined" ? Date.now() : 0));

  // Trade panel state.
  const [activeMarketId, setActiveMarketId] = useState<string>(seedArenas[0].markets[0].id);
  const activeMarket: Market = useMemo(
    () => activeArena.markets.find((m) => m.id === activeMarketId) ?? activeArena.markets[0],
    [activeArena, activeMarketId]
  );
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("25");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [trading, setTrading] = useState(false);

  // Parlay slip — parlayit-style native parlays.
  const [slipLegs, setSlipLegs] = useState<ParlayLeg[]>([]);
  const [slipStake, setSlipStake] = useState("10");
  const [slipOpen, setSlipOpen] = useState(false);
  const [placingParlay, setPlacingParlay] = useState(false);

  // Server-priced parlay quote (quote-based liquidity model).
  const [serverQuote, setServerQuote] = useState<ParlayQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  // Data source badge from /api/categories.
  const [dataSource, setDataSource] = useState<"panta" | "mock" | "unknown">("unknown");

  // UI misc.
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

    // Probe the server for a live Panta connection.
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

  // Quote-based liquidity: whenever the slip changes, ask the server to
  // re-price the parlay from live Panta prices. Debounced 400ms.
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
        if (!cancelled) setServerQuote(null); // fall back to local compute
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

  // Local quote — instant feedback while the server round-trips.
  const localQuote = useMemo(() => quoteParlay(slipLegs, Number(slipStake) || 0), [slipLegs, slipStake]);
  // Prefer the server-priced quote when we have a fresh one for the exact
  // (legs, stake) combo; otherwise fall back to the local compute. Both
  // use the same `quoteParlay` function, so the numbers only diverge when
  // Panta reports a different live price for a leg.
  const parlayQuote: ParlayQuote = serverQuote ?? localQuote;

  const countdownMs = hydrated ? Math.max(0, (deadlinesRef.current[activeArena.id] ?? 0) - now) : activeArena.endsInMs;
  const countdownLabel = hydrated ? formatCountdown(countdownMs) : formatCountdown(activeArena.endsInMs);

  // ---- actions -------------------------------------------------------

  const connect = useCallback(async () => {
    if (connected) {
      setWalletAddress(null);
      setWalletKind(null);
      setToast("Wallet disconnected.");
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

  /**
   * Runs the full Panta trade lifecycle: quote → build → sign → submit → report.
   * In demo mode every step hits our /api/* proxy, which serves realistic mock
   * responses. Adding PANTA_API_KEY to .env.local flips the whole flow to real
   * Panta with zero client-side changes.
   */
  const trade = useCallback(async () => {
    if (!walletAddress) return setToast("Connect a wallet before stepping in the ring.");
    const value = Number(amount);
    if (!value || value <= 0) return setToast("Enter an amount greater than $0.");
    if (value > 10_000) return setToast("Demo cap is $10,000 per position.");

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
    setToast("Position closed in demo mode.");
  }, []);

  const claimPosition = useCallback(async (p: Position) => {
    if (!walletAddress) return setToast("Connect a wallet to claim.");
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
    const price = pickedSide === "YES" ? market.yesPrice : 100 - market.yesPrice;
    const candidate: ParlayLeg = {
      marketId: market.id,
      question: market.question,
      side: pickedSide,
      price,
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
    if (!walletAddress) return setToast("Connect a wallet before placing a parlay.");
    if (slipLegs.length < 2) return setToast("A parlay needs at least two legs.");
    const stake = Number(slipStake);
    if (!stake || stake <= 0) return setToast("Enter a stake greater than $0.");

    setPlacingParlay(true);
    try {
      // For every leg, run the Panta lifecycle in parallel. Panta doesn't
      // have a native parlay endpoint, so a parlay is modelled as N linked
      // primary orders that share a client-side parlayId.
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
        `${slipLegs.length}-leg parlay placed at ${parlayQuote.combinedPrice.toFixed(1)}¢ · combined odds ${parlayQuote.impliedOdds.toFixed(2)}× · payout up to ${usd.format(parlayQuote.potentialPayoutUsdc)}`
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
    setToast(`"${title}" saved as a draft ring.`);
  }

  // ---- render --------------------------------------------------------

  const sourceBadge = dataSource === "panta"
    ? { text: "LIVE · Panta API", cls: "src live" }
    : dataSource === "mock"
      ? { text: "DEMO · Mock data", cls: "src demo" }
      : { text: "Connecting…", cls: "src pending" };

  const legInSlip = slipLegs.find((l) => l.marketId === activeMarket.id);

  return (
    <main>
      <nav>
        <a className="brand" href="#top"><span>◒</span> ORACLE <b>RUMBLE</b></a>
        <div className="nav-links">
          <a href="#arena">Rings</a>
          <a href="#positions">My ring</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#how-it-works">Panta</a>
        </div>
        <div className="nav-right">
          <span className={sourceBadge.cls} title={dataSource === "panta" ? "Talking to live-api.panta.market" : "Set PANTA_API_KEY in .env.local to go live"}>{sourceBadge.text}</span>
          <button
            className={connected ? "wallet connected" : "wallet"}
            onClick={connect}
            title={connected ? "Click to disconnect" : "Connect Phantom or spin up a demo wallet"}
          >
            {connected ? `● ${shortenPk(walletAddress!)}` : "Connect wallet"}
          </button>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="grid-glow" />
        <p className="eyebrow">SEASON 01 · LIVE NOW · SOLANA MAINNET</p>
        <h1>Call it.<br /><em>Prove it.</em><br />Climb.</h1>
        <p className="hero-copy">
          Oracle Rumble drops live prediction markets — powered by <a className="ilink" href="https://docs.panta.market/" target="_blank" rel="noreferrer">Panta</a> on Solana — into arenas where your hunches meet the crowd&apos;s.
          Take a side, stack legs into a parlay, and earn a place on the board.
        </p>
        <div className="hero-actions">
          <a href="#arena" className="button primary">Step into the ring <span>→</span></a>
          <button className="button secondary" onClick={() => setShowHost(true)}>Host a rumble</button>
        </div>
        <div className="stats">
          <div><b>1,248</b><span>Rumblers</span></div>
          <div><b>{arenas.length + hosted.length}</b><span>Live rings</span></div>
          <div><b>$284K</b><span>Volume tracked</span></div>
          <div><b>{PARLAY_MIN_LEGS}–{PARLAY_MAX_LEGS}</b><span>Parlay legs</span></div>
        </div>
      </section>

      <section className="arena-shell" id="arena">
        <div className="arena-heading">
          <div>
            <p className="eyebrow">FEATURED RING</p>
            <h2>{activeArena.name}</h2>
            <p>{activeArena.tagline}</p>
          </div>
          <div className="live"><i /> LIVE · {countdownLabel} remaining</div>
        </div>

        <div className="arena-tabs" role="tablist" aria-label="Rings">
          {arenas.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={a.id === activeArena.id}
              className={a.id === activeArena.id ? "tab active" : "tab"}
              onClick={() => setActiveArenaId(a.id)}
            >
              {a.name}
            </button>
          ))}
          {hosted.map((h, i) => (
            <span key={`draft-${i}`} className="tab draft" title="Draft ring — not live yet">
              {h} · draft
            </span>
          ))}
        </div>

        <div className="arena-grid">
          <div className="market-panel">
            <div className="panel-title">
              <span>MARKET BOARD</span>
              <small>Panta market id · {shortenPk(activeMarket.id)}</small>
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
            {filteredMarkets.map((market) => {
              const legHere = slipLegs.find((l) => l.marketId === market.id);
              return (
                <div key={market.id} className={activeMarket.id === market.id ? "market active" : "market"}>
                  <button className="market-body" onClick={() => { setActiveMarketId(market.id); setSide("YES"); }}>
                    <div>
                      <span className="tag">{market.category}</span>
                      <h3>{market.question}</h3>
                      <p>{market.volume} volume · {market.closes}</p>
                    </div>
                    <div className="price">
                      <b>{market.yesPrice}¢</b>
                      <span className={market.change >= 0 ? "up" : "down"}>
                        {market.change >= 0 ? "+" : ""}{market.change}¢
                      </span>
                    </div>
                  </button>
                  <div className="slip-add">
                    <button
                      className={legHere?.side === "YES" ? "slip-btn on" : "slip-btn"}
                      onClick={() => addLegToSlip(market, "YES")}
                      title="Add YES to your parlay slip"
                    >
                      + YES
                    </button>
                    <button
                      className={legHere?.side === "NO" ? "slip-btn on" : "slip-btn"}
                      onClick={() => addLegToSlip(market, "NO")}
                      title="Add NO to your parlay slip"
                    >
                      + NO
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredMarkets.length === 0 && (
              <div className="empty">No markets match that filter.</div>
            )}
          </div>

          <aside className="trade-panel">
            <div className="panel-title"><span>PLACE POSITION</span><small>{walletKind === "phantom" ? "Phantom signer" : walletKind === "demo" ? "Demo signer" : "Wallet-controlled"}</small></div>
            <span className="tag">{activeMarket.category}</span>
            <h3>{activeMarket.question}</h3>
            <div className="side-switch">
              <button className={side === "YES" ? "yes selected" : "yes"} onClick={() => setSide("YES")}>
                YES <b>{activeMarket.yesPrice}¢</b>
              </button>
              <button className={side === "NO" ? "no selected" : "no"} onClick={() => setSide("NO")}>
                NO <b>{100 - activeMarket.yesPrice}¢</b>
              </button>
            </div>
            <label>
              Amount
              <div className="amount">
                <span>$</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  aria-label="Trade amount in USDC"
                />
                <button type="button" onClick={() => setAmount("100")}>MAX</button>
              </div>
            </label>
            <div className="summary">
              <span>Avg. price</span><b>{price}¢</b>
              <span>Est. shares</span><b>{quantity.toFixed(1)}</b>
              <span>Potential payout</span><b>{usd.format(quantity)}</b>
              <span>Route</span><b>{dataSource === "panta" ? "Panta primary_order_usdc" : "Panta (mocked)"}</b>
            </div>
            <button className="button primary full" onClick={trade} disabled={trading}>
              {trading ? "Routing through Panta…" : connected ? `Buy ${side}` : "Connect to trade"} <span>→</span>
            </button>
            <button
              className="button secondary full"
              onClick={() => addLegToSlip(activeMarket, side)}
              disabled={trading}
            >
              {legInSlip ? "Update slip" : "Add to slip"} <span>+</span>
            </button>
            <p className="fine-print">
              Quote → build → sign → submit → attribute. Your wallet signs the Panta-built VersionedTransaction; Oracle Rumble never holds funds. Fees follow Panta&apos;s bonding-curve pricing.
            </p>
          </aside>
        </div>
      </section>

      <section className="positions-shell" id="positions">
        <div className="section-intro">
          <p className="eyebrow">MY RING</p>
          <h2>Your open positions.</h2>
          <p>
            Live P&amp;L updates as prices move. Positions include the on-chain signature returned by Panta so
            every trade is traceable and claimable on resolution.
          </p>
        </div>
        <div className="positions">
          <div className="positions-summary">
            <div><span>Open positions</span><b>{arenaPositions.length}</b></div>
            <div><span>Parlays this ring</span><b>{parlays.filter((p) => p.arenaId === activeArena.id).length}</b></div>
            <div><span>Cost basis</span><b>{usd2.format(arenaPositions.reduce((s, p) => s + p.cost, 0))}</b></div>
            <div className={openPnL >= 0 ? "pnl up" : "pnl down"}>
              <span>Open P&amp;L</span>
              <b>{openPnL >= 0 ? "+" : ""}{usd2.format(openPnL)}</b>
            </div>
          </div>
          {arenaPositions.length === 0 && parlays.filter((p) => p.arenaId === activeArena.id).length === 0 ? (
            <div className="empty tall">
              You haven&apos;t stepped in yet. Pick a market above and lock in a position, or stack a parlay in the slip.
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
                        <span className={p.side === "YES" ? "side yes" : "side no"}>{p.side}</span>
                        <div>
                          <h4>{p.question}</h4>
                          <p>
                            {p.shares.toFixed(1)} shares · entry {p.entryPrice}¢ · mark {mark}¢
                            {p.signature ? ` · sig ${shortenPk(p.signature)}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="pos-right">
                        <strong className={pnl >= 0 ? "up" : "down"}>
                          {pnl >= 0 ? "+" : ""}{usd2.format(pnl)}
                        </strong>
                        {claimable && (
                          <button className="close-pos claim" onClick={() => claimPosition(p)}>Claim</button>
                        )}
                        <button className="close-pos" onClick={() => closePosition(p.id)}>Close</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {parlays.filter((p) => p.arenaId === activeArena.id).length > 0 && (
                <div className="parlay-list">
                  <div className="parlay-title">PARLAYS</div>
                  {parlays.filter((p) => p.arenaId === activeArena.id).map((p) => (
                    <div className="parlay-card" key={p.id}>
                      <div>
                        <div className="parlay-head">
                          <span className="pill">{p.legs.length}-leg</span>
                          <span className="pill soft">{p.combinedPrice.toFixed(1)}¢ combined</span>
                          {p.signature && <span className="pill soft">sig {shortenPk(p.signature)}</span>}
                        </div>
                        <ul className="parlay-legs">
                          {p.legs.map((l) => (
                            <li key={l.marketId}>
                              <span className={l.side === "YES" ? "side yes" : "side no"}>{l.side}</span>
                              <span>{l.question}</span>
                              <b>{l.price}¢</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="parlay-num">
                        <div><span>Stake</span><b>{usd2.format(p.stake)}</b></div>
                        <div><span>Payout if hit</span><b className="up">{usd2.format(p.potentialPayout)}</b></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="leaderboard-section" id="leaderboard">
        <div className="section-intro">
          <p className="eyebrow">THE BOARD</p>
          <h2>Conviction meets results.</h2>
          <p>Live standings reflect verified rumble activity attributed via Panta. Final standings settle after markets resolve.</p>
        </div>
        <div className="leaderboard">
          {players.map((player) => (
            <div className="player" key={player.rank}>
              <span className={`rank rank-${player.rank}`}>{player.rank}</span>
              <span className={`avatar ${player.color}`}>{player.initials}</span>
              <b>{player.name}</b>
              <span className="player-meta">{player.markets} markets · {player.accuracy}% accuracy</span>
              <strong>+{player.returnPct}%</strong>
            </div>
          ))}
          <button className="view-all">View full leaderboard →</button>
        </div>
      </section>

      <section className="how" id="how-it-works">
        <p className="eyebrow">POWERED BY PANTA · SETTLED ON SOLANA</p>
        <h2>Deep integration, not a wrapper.</h2>
        <p className="how-lead">
          Every buy, claim, and attribution runs the real Panta lifecycle. Parlays are a client-space
          bundle of N linked orders, priced live from Panta&apos;s single-market book — the same
          quote-based liquidity idea parlayit uses. Solana is the settlement layer (~400ms slot times,
          USDC 1:1).
        </p>
        <div className="steps five">
          <article><span>01</span><h3>Discover</h3><p><code>GET /markets</code> — the market board is a Panta catalog view, filtered by category.</p></article>
          <article><span>02</span><h3>Quote</h3><p><code>POST /orders/quote</code> — simulate the fill on the bonding curve; get a short-lived quote session.</p></article>
          <article><span>03</span><h3>Build & sign</h3><p><code>POST /orders/build</code> — Panta returns an unsigned VersionedTransaction that your Solana wallet signs.</p></article>
          <article><span>04</span><h3>Submit</h3><p><code>POST /orders/submit</code> — the signed tx is broadcast to your RPC, and the signature is registered with Panta.</p></article>
          <article><span>05</span><h3>Attribute & claim</h3><p><code>POST /trades/report</code> then <code>POST /claims/build</code> — trades count on the leaderboard; winnings are claimable on resolution.</p></article>
        </div>

        <h3 className="parlay-mech-title">Native parlays — the mechanics</h3>
        <div className="parlay-mech">
          <article>
            <h4>Quote-based liquidity</h4>
            <p>
              <code>POST /api/parlay/quote</code> refreshes every leg&apos;s price from Panta and prices
              the parlay dynamically. No pre-listed parlay market — the combined price is the product
              of the live leg probabilities.
            </p>
          </article>
          <article>
            <h4>2–5 leg bounds</h4>
            <p>
              <code>PARLAY_MIN_LEGS</code> = 2, <code>PARLAY_MAX_LEGS</code> = 5. Enforced client-side on
              add and server-side on quote.
            </p>
          </article>
          <article>
            <h4>Correlation blocks</h4>
            <p>
              Legs that share a <code>correlationGroup</code> (KO vs Decision, up vs down) are mutually
              exclusive and can&apos;t coexist in a slip. Duplicates are rejected too.
            </p>
          </article>
          <article>
            <h4>Variance-based fee</h4>
            <p>
              Per-leg fee is <code>stake × 5% × 4p(1-p)</code>. Peaks at coinflip legs, near-zero for
              high-conviction legs; aggregate is capped at 5% of stake.
            </p>
          </article>
          <article>
            <h4>50/50 fallback</h4>
            <p>
              If a leg voids at resolution it pays 0.5×, so the parlay&apos;s payout is halved once per
              voided leg. The slip shows both the all-hit payout and the one-void downside.
            </p>
          </article>
          <article>
            <h4>Placement</h4>
            <p>
              A parlay is placed as N linked <code>primary_order_usdc</code> orders sharing a client
              <code>parlayId</code>. Every leg runs the full Panta lifecycle in parallel.
            </p>
          </article>
        </div>
      </section>

      <footer>
        <span>◒ ORACLE RUMBLE</span>
        <span>Prediction-market experiences, powered by <a className="ilink" href="https://www.panta.market/" target="_blank" rel="noreferrer">Panta</a> on <a className="ilink" href="https://solana.com/docs" target="_blank" rel="noreferrer">Solana</a>.</span>
        <a className="ilink" href="https://docs.panta.market/" target="_blank" rel="noreferrer">Panta API docs ↗</a>
      </footer>

      {/* Parlay slip drawer */}
      <button
        className={slipLegs.length > 0 ? "slip-fab on" : "slip-fab"}
        onClick={() => setSlipOpen((v) => !v)}
        aria-label="Toggle parlay slip"
      >
        SLIP <b>{slipLegs.length}</b>
      </button>
      {slipOpen && (
        <div className="slip">
          <div className="slip-head">
            <div>
              <b>Parlay slip</b>
              <p>{slipLegs.length} leg{slipLegs.length === 1 ? "" : "s"} · combined {parlayQuote.combinedPrice.toFixed(1)}¢ · {parlayQuote.impliedOdds.toFixed(2)}×</p>
            </div>
            <div className="slip-actions">
              <button onClick={clearSlip} disabled={slipLegs.length === 0}>Clear</button>
              <button onClick={() => setSlipOpen(false)} aria-label="Close">×</button>
            </div>
          </div>

          {slipLegs.length === 0 ? (
            <div className="slip-empty">Tap +YES or +NO on any market to stack a leg. Parlays hit only if every leg lands.</div>
          ) : (
            <>
              <ul className="slip-legs">
                {slipLegs.map((l) => (
                  <li key={l.marketId}>
                    <span className={l.side === "YES" ? "side yes" : "side no"}>{l.side}</span>
                    <div className="slip-leg-body">
                      <b>{l.question}</b>
                      <span>{l.price}¢ · {shortenPk(l.marketId)}</span>
                    </div>
                    <button onClick={() => removeLeg(l.marketId)} aria-label="Remove leg">×</button>
                  </li>
                ))}
              </ul>
              <label className="slip-stake">
                Stake
                <div className="amount">
                  <span>$</span>
                  <input
                    value={slipStake}
                    onChange={(e) => setSlipStake(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                  />
                </div>
              </label>
              <div className="slip-summary">
                <span>Combined price</span><b>{parlayQuote.combinedPrice.toFixed(2)}¢</b>
                <span>Implied odds</span><b>{parlayQuote.impliedOdds.toFixed(2)}×</b>
                <span title="Per-leg fee is stake × 5% × 4p(1-p) — peaks at coinflip legs, near zero for high-conviction legs. Capped at 5% of stake overall.">Variance fee</span>
                <b>{usd2.format(parlayQuote.feeUsdc)}</b>
                <span>Net stake</span><b>{usd2.format(parlayQuote.netStakeUsdc)}</b>
                <span>Payout if every leg hits</span><b className="up">{usd2.format(parlayQuote.potentialPayoutUsdc)}</b>
                <span title="If any leg voids to 50/50 at resolution, that leg pays 0.5× — the parlay payout is halved once per voided leg.">Payout if one leg voids</span>
                <b>{usd2.format(parlayQuote.halfPayoutIfOneVoidUsdc)}</b>
              </div>
              <div className="slip-legfees">
                {slipLegs.map((l, i) => (
                  <span key={l.marketId}>
                    <em>{l.question.slice(0, 28)}{l.question.length > 28 ? "…" : ""}</em>
                    <b>{usd2.format(parlayQuote.legFees[i] ?? 0)}</b>
                  </span>
                ))}
                <small>{quoting ? "Re-quoting from Panta…" : "Priced from live Panta prices · 15s TTL"}</small>
              </div>
              <button
                className="button primary full"
                onClick={placeParlay}
                disabled={placingParlay || slipLegs.length < 2}
              >
                {placingParlay ? "Placing parlay…" : slipLegs.length < 2 ? "Add another leg" : `Place ${slipLegs.length}-leg parlay`} <span>→</span>
              </button>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {showHost && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowHost(false)}>
          <form className="modal" onSubmit={createArena} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="close" onClick={() => setShowHost(false)} aria-label="Close">×</button>
            <p className="eyebrow">HOST A RUMBLE</p>
            <h2>Make forecasting a fight.</h2>
            <label>
              Ring name
              <input name="title" required placeholder="e.g. DeFi Sunday" maxLength={60} />
            </label>
            <label>
              Theme
              <select name="theme" defaultValue="Crypto & markets">
                <option>Crypto &amp; markets</option>
                <option>Sports &amp; events</option>
                <option>Community forecasts</option>
                <option>Product launches</option>
              </select>
            </label>
            <label>
              Duration
              <select name="duration" defaultValue="72 hours">
                <option>72 hours</option>
                <option>1 week</option>
                <option>1 month</option>
              </select>
            </label>
            <button className="button primary full" type="submit">Create draft <span>→</span></button>
            <p className="fine-print">
              Draft rings live in this browser. In production the host would call
              <code> POST /markets/quote</code> → <code>/markets/build</code> → <code>/markets/register</code> to spin up USDC markets on Panta.
            </p>
          </form>
        </div>
      )}
    </main>
  );
}
