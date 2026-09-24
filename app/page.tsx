"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  arenas as seedArenas,
  type Arena,
  type Market,
  type Position,
  type StoredParlay
} from "@/lib/arena-data";
import {
  buildClaim,
  buildOrder,
  connectSolanaWallet,
  fetchMarketTrades,
  fetchMarkets,
  fetchPositions,
  marketCreateBuild,
  marketCreateQuote,
  marketCreateRegister,
  quoteOrder,
  quoteParlayLive,
  reportTrade,
  signAndBroadcast,
  submitOrder,
  verifyOrder
} from "@/lib/panta-client";
import type { PantaPosition } from "@/lib/panta";
import {
  PARLAY_MAX_LEGS,
  PARLAY_MIN_LEGS,
  quoteParlay,
  validateAddLeg,
  type ParlayLeg,
  type ParlayQuote
} from "@/lib/parlay";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const STORAGE_KEY = "oracle-rumble/state/v3";
const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

type Persisted = {
  walletAddress: string | null;
  walletKind: "phantom" | null;
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
      walletKind: p.walletKind === "phantom" ? "phantom" : null,
      positions: Array.isArray(p.positions) ? p.positions : [],
      hosted: Array.isArray(p.hosted) ? p.hosted : [],
      parlays: Array.isArray(p.parlays) ? p.parlays : []
    };
  } catch {
    return empty;
  }
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function shortenPk(pk: string) {
  if (!pk) return "";
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export default function Home() {
  // Persisted state — hydrated on mount to avoid SSR mismatch.
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletKind, setWalletKind] = useState<"phantom" | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [hosted, setHosted] = useState<string[]>([]);
  const [parlays, setParlays] = useState<StoredParlay[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [arenas, setArenas] = useState<Arena[]>(() => seedArenas.map((a) => ({ ...a, markets: a.markets.map((m) => ({ ...m })) })));
  const [activeArenaId, setActiveArenaId] = useState<string>(seedArenas[0].id);
  const activeArena = useMemo(() => arenas.find((a) => a.id === activeArenaId) ?? arenas[0], [arenas, activeArenaId]);

  const deadlinesRef = useRef<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => Date.now());

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
  type MarketTrade = { signature: string; side: "YES" | "NO"; shares: number; priceCents: number; usdcAmount: string; wallet: string; ts: string };
  const [marketTrades, setMarketTrades] = useState<MarketTrade[]>([]);
  const [remotePositions, setRemotePositions] = useState<PantaPosition[]>([]);

  const [toast, setToast] = useState("");
  const [showHost, setShowHost] = useState(false);
  const [hosting, setHosting] = useState(false);

  // ── lifecycle ─────────────────────────────────────────────────────

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

    fetchMarkets()
      .then((r) => {
        const src = r.source === "panta" ? "panta" : "mock";
        setDataSource(src);
        const list = r.arenas;
        if (Array.isArray(list) && list.length > 0) {
          const fresh: Arena[] = list.map((a) => ({
            id: a.id,
            name: a.name ?? a.id,
            tagline: a.tagline ?? "",
            endsInMs: a.endsInMs ?? 24 * 3_600_000,
            markets: a.markets as Market[]
          }));
          setArenas(fresh);
          if (!fresh.some((a) => a.id === activeArenaId)) setActiveArenaId(fresh[0].id);
          const nowLocal = Date.now();
          const dl: Record<string, number> = {};
          for (const a of fresh) dl[a.id] = nowLocal + a.endsInMs;
          deadlinesRef.current = dl;
        }
      })
      .catch(() => setDataSource("mock"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const payload: Persisted = { walletAddress, walletKind, positions, hosted, parlays };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  }, [walletAddress, walletKind, positions, hosted, parlays, hydrated]);

  // Live mode: refresh Panta markets every 20 s so prices stay authoritative.
  useEffect(() => {
    if (dataSource !== "panta") return;
    const id = window.setInterval(async () => {
      try {
        const r = await fetchMarkets();
        if (r.source !== "panta" || !Array.isArray(r.arenas)) return;
        const next: Arena[] = r.arenas.map((a) => ({
          id: a.id,
          name: a.name ?? a.id,
          tagline: a.tagline ?? "",
          endsInMs: a.endsInMs ?? 24 * 3_600_000,
          markets: a.markets as Market[]
        }));
        setArenas(next);
        const nowLocal = Date.now();
        for (const a of next) if (!(a.id in deadlinesRef.current)) deadlinesRef.current[a.id] = nowLocal + a.endsInMs;
      } catch { /* ignore */ }
    }, 20_000);
    return () => window.clearInterval(id);
  }, [dataSource]);

  // Mock-mode random walk (disabled in live mode).
  useEffect(() => {
    if (dataSource !== "mock") return;
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
  }, [dataSource]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Debounced parlay re-quote against Panta.
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

  // Live trade tape refreshes on active-market change + every 8 s.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetchMarketTrades(activeMarket.id);
        if (!cancelled) setMarketTrades(r.trades);
      } catch { /* ignore */ }
    }
    pull();
    const id = window.setInterval(pull, 8000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeMarket.id]);

  // Remote wallet-scoped positions from Panta.
  useEffect(() => {
    if (!walletAddress) { setRemotePositions([]); return; }
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetchPositions(walletAddress!);
        if (!cancelled) setRemotePositions(r.positions);
      } catch { /* ignore */ }
    }
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [walletAddress]);

  useEffect(() => {
    if (!activeArena.markets.some((m) => m.id === activeMarketId)) {
      setActiveMarketId(activeArena.markets[0].id);
      setSide("YES");
    }
    setCategoryFilter("All");
  }, [activeArena, activeMarketId]);

  // ── derived ───────────────────────────────────────────────────────

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

  const totalMarkets = useMemo(() => arenas.reduce((s, a) => s + a.markets.length, 0), [arenas]);
  const totalVolumeUsdc = useMemo(() => {
    let sum = 0;
    for (const a of arenas) for (const m of a.markets) {
      const raw = (m.volume ?? "").replace(/[$,]/g, "").trim();
      if (!raw) continue;
      const mult = raw.endsWith("k") ? 1_000 : raw.endsWith("M") ? 1_000_000 : 1;
      const n = parseFloat(raw);
      if (Number.isFinite(n)) sum += n * mult;
    }
    return sum;
  }, [arenas]);
  const volumeLabel = useMemo(() => {
    if (totalVolumeUsdc >= 1_000_000) return `$${(totalVolumeUsdc / 1_000_000).toFixed(1)}M`;
    if (totalVolumeUsdc >= 1_000) return `$${(totalVolumeUsdc / 1_000).toFixed(1)}k`;
    return usd2.format(totalVolumeUsdc);
  }, [totalVolumeUsdc]);

  const countdownMs = hydrated ? Math.max(0, (deadlinesRef.current[activeArena.id] ?? 0) - now) : activeArena.endsInMs;
  const countdownLabel = hydrated ? formatCountdown(countdownMs) : formatCountdown(activeArena.endsInMs);

  // ── actions ───────────────────────────────────────────────────────

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
      setToast(`Connected · ${shortenPk(real)}`);
    } else {
      setToast("No Solana wallet found. Install Phantom, Backpack, or Solflare and reload.");
    }
  }, [connected]);

  const trade = useCallback(async () => {
    if (!walletAddress) return setToast("Connect a wallet first.");
    const value = Number(amount);
    if (!value || value <= 0) return setToast("Amount must be greater than $0.");
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
      setToast(`Filled · ${quote.shares.toFixed(1)} shares of ${side} at ${quote.price}¢ · ${shortenPk(signed.signature)}`);

      (async () => {
        for (let i = 0; i < 8; i++) {
          try {
            const v = await verifyOrder({ signature: signed.signature });
            if (v.status === "confirmed") { setToast(`Panta confirmed · ${shortenPk(signed.signature)}`); return; }
            if (v.status === "failed") { setToast(`Panta rejected · ${shortenPk(signed.signature)}`); return; }
          } catch { /* keep polling */ }
          await new Promise((r) => setTimeout(r, 2500));
        }
      })();
    } catch (err) {
      setToast(`Trade failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setTrading(false);
    }
  }, [walletAddress, amount, side, activeMarket, activeArena.id]);

  const closePosition = useCallback((id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
    setToast("Position closed.");
  }, []);

  const claimPosition = useCallback(async (p: Position) => {
    if (!walletAddress) return setToast("Connect a wallet to claim.");
    try {
      const claim = await buildClaim({ wallet: walletAddress, marketId: p.marketId });
      const signed = await signAndBroadcast({ serializedTx: claim.serializedTx, wallet: walletAddress });
      await reportTrade({ signature: signed.signature, wallet: walletAddress, marketId: p.marketId });
      setToast(`Claimed $${claim.amountUsdc} · ${shortenPk(signed.signature)}`);
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
    if (!walletAddress) return setToast("Connect a wallet before placing a parlay.");
    if (slipLegs.length < 2) return setToast("A parlay needs at least two legs.");
    const stake = Number(slipStake);
    if (!stake || stake <= 0) return setToast("Enter a stake greater than $0.");

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
      setToast(`${slipLegs.length}-leg parlay placed · combined ${parlayQuote.combinedPrice.toFixed(1)}¢ · payout up to ${usd.format(parlayQuote.potentialPayoutUsdc)}`);
    } catch (err) {
      setToast(`Parlay failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setPlacingParlay(false);
    }
  }, [walletAddress, slipLegs, slipStake, parlayQuote, activeArena.id]);

  // Panta's category enum. Anything outside it 400s at /markets/create/quote.
  const THEME_TO_CATEGORY: Record<string, string> = {
    "Crypto & markets": "crypto",
    "Sports & events": "sports",
    "Politics & policy": "politics",
    "Entertainment": "entertainment",
    "Science & tech": "science",
    "Community forecasts": "world",
    "Product launches": "world"
  };

  async function createArena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "Untitled market").trim() || "Untitled market";
    const theme = String(form.get("theme") || "Community forecasts");
    const durationLabel = String(form.get("duration") || "72 hours");
    const HOURS: Record<string, number> = { "72 hours": 72, "1 week": 168, "1 month": 720 };
    const endsAtMs = Date.now() + (HOURS[durationLabel] ?? 72) * 3_600_000;

    if (!walletAddress) {
      setHosted((current) => [title, ...current]);
      setShowHost(false);
      setToast(`"${title}" saved as draft — connect a wallet to publish to Panta.`);
      return;
    }

    setHosting(true);
    try {
      const category = THEME_TO_CATEGORY[theme] ?? "world";
      const nowSec = Math.floor(Date.now() / 1000);
      const endSec = Math.floor(endsAtMs / 1000);
      const resolutionSec = endSec + 7 * 86400;

      const q = await marketCreateQuote({
        wallet: walletAddress,
        question: title,
        resolutionRule: `Resolves according to public reporting on ${new Date(endsAtMs).toUTCString()}. Draft rule — sharpen before real volume.`,
        sourcesOfTruth: ["https://oracle-rumble-production.up.railway.app"],
        category,
        startTime: nowSec,
        endTime: endSec,
        resolutionTime: resolutionSec,
        imageUrl: `https://placehold.co/512x512/121521/7aa2ff/png?text=${encodeURIComponent(title.slice(0, 24))}`
      });
      const feeUsdc = (Number(q.paymentUsdc) / 1_000_000).toFixed(2);
      setToast(`Quoted ${feeUsdc} USDC · signing…`);

      const b = await marketCreateBuild({ createId: q.createId, wallet: walletAddress });
      let signature: string;
      let signLabel: string;
      if (!b.transaction) {
        signature = "sandboxSignature" + "1".repeat(43);
        signLabel = "sandbox";
      } else {
        const s = await signAndBroadcast({ serializedTx: b.transaction, wallet: walletAddress });
        signature = s.signature;
        signLabel = s.confirmed ? "confirmed" : "broadcasting";
      }
      const reg = await marketCreateRegister({ createId: q.createId, signature });
      setHosted((current) => [`${title} · ${shortenPk(reg.marketId)}`, ...current]);
      setShowHost(false);
      setToast(`Market registered · ${shortenPk(reg.marketId)} (${signLabel})`);

      try {
        const r = await fetchMarkets();
        if (r.source === "panta" && Array.isArray(r.arenas)) {
          setArenas(r.arenas.map((a) => ({
            id: a.id, name: a.name ?? a.id, tagline: a.tagline ?? "",
            endsInMs: a.endsInMs ?? 24 * 3_600_000,
            markets: a.markets as Market[]
          })));
        }
      } catch { /* ignore */ }
    } catch (err) {
      setHosted((current) => [title, ...current]);
      setShowHost(false);
      setToast(`Registration failed — kept as draft. ${err instanceof Error ? err.message : ""}`);
    } finally {
      setHosting(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────

  const sourceBadge = dataSource === "panta"
    ? { text: `LIVE · ${CLUSTER}`, cls: "src live" }
    : dataSource === "mock"
      ? { text: "DEMO", cls: "src demo" }
      : { text: "…", cls: "src pending" };

  const initials = walletAddress ? walletAddress.slice(0, 2).toUpperCase() : "?";
  const legInSlip = slipLegs.find((l) => l.marketId === activeMarket.id);

  return (
    <main>
      {/* ─── HUD ────────────────────────────────────────────────── */}
      <nav className="hud-bar">
        <a href="#top" className="brand"><span className="dot" />Oracle Rumble</a>
        <div className="hud-nav">
          <a href="#markets">Markets</a>
          <a href="#positions">Positions</a>
          <button onClick={() => setShowHost(true)}>New market</button>
        </div>
        <div className="hud-right">
          <span className={sourceBadge.cls} title={dataSource === "panta" ? "Talking to live-api.panta.market" : "Set PANTA_API_KEY to go live"}>
            {sourceBadge.text}
          </span>
          <button className={connected ? "wallet connected" : "wallet"} onClick={connect}>
            <span className="avatar">{connected ? initials : "?"}</span>
            {connected ? shortenPk(walletAddress!) : "Connect"}
          </button>
        </div>
      </nav>

      {/* ─── HERO ───────────────────────────────────────────────── */}
      <section className="hero" id="top">
        <p className="eyebrow">Prediction markets · Solana {CLUSTER} · powered by <a href="https://docs.panta.market/" style={{ color: "var(--accent)" }}>Panta</a></p>
        <h1>Call it. Prove it. Climb.</h1>
        <p className="lead">
          Buy YES or NO on live on-chain markets. Stack legs into a parlay. Settle on Solana.
        </p>
      </section>

      {/* ─── MARKETS ────────────────────────────────────────────── */}
      <section className="shell" id="markets">
        <div className="section-head">
          <h2>{activeArena.name}</h2>
          <span className="meta">{activeArena.markets.length} markets · closes in {countdownLabel}</span>
        </div>

        <div className="tabs" role="tablist">
          {arenas.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={a.id === activeArena.id}
              className={a.id === activeArena.id ? "tab on" : "tab"}
              onClick={() => setActiveArenaId(a.id)}
            >
              {a.name}
              <span className="count">{a.markets.length}</span>
            </button>
          ))}
          {hosted.map((h, i) => (
            <span key={`draft-${i}`} className="tab" style={{ opacity: .5, borderStyle: "dashed" }}>
              {h} · draft
            </span>
          ))}
        </div>

        <div className="arena">
          <div className="board">
            <div className="board-head">
              <span>Market board</span>
              <span>{shortenPk(activeMarket.id)}</span>
            </div>
            <div className="chips">
              {categories.map((c) => (
                <button key={c} className={c === categoryFilter ? "chip on" : "chip"} onClick={() => setCategoryFilter(c)}>{c}</button>
              ))}
            </div>
            {filteredMarkets.length === 0 && <div className="empty">No markets match that filter.</div>}
            {filteredMarkets.map((market) => {
              const leg = slipLegs.find((l) => l.marketId === market.id);
              return (
                <div key={market.id} className={activeMarket.id === market.id ? "market active" : "market"}>
                  <button className="market-body" onClick={() => { setActiveMarketId(market.id); setSide("YES"); }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span className="cat">{market.category}</span>
                      <h3>{market.question}</h3>
                      <p>{market.volume} · {market.closes}</p>
                    </div>
                    <div className="market-price">
                      <b>{market.yesPrice}¢</b>
                      <span className={`delta ${market.change >= 0 ? "up" : "down"}`}>{market.change >= 0 ? "+" : ""}{market.change}¢</span>
                    </div>
                  </button>
                  <div className="slip-add">
                    <button className={`slip-btn yes ${leg?.side === "YES" ? "on" : ""}`} onClick={() => addLegToSlip(market, "YES")}>Yes</button>
                    <button className={`slip-btn no ${leg?.side === "NO" ? "on" : ""}`} onClick={() => addLegToSlip(market, "NO")}>No</button>
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="trade">
            <div className="trade-head">
              <span>Place order</span>
              <span>{connected ? "Wallet signer" : "Not connected"}</span>
            </div>
            <span className="cat">{activeMarket.category}</span>
            <h3>{activeMarket.question}</h3>
            <div className="sides">
              <button className={side === "YES" ? "side yes on" : "side yes"} onClick={() => setSide("YES")}>
                YES <b>{activeMarket.yesPrice}¢</b>
              </button>
              <button className={side === "NO" ? "side no on" : "side no"} onClick={() => setSide("NO")}>
                NO <b>{100 - activeMarket.yesPrice}¢</b>
              </button>
            </div>
            <label className="field">
              Amount (USDC)
              <div className="field-input">
                <span className="curr">$</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Trade amount" />
                <button type="button" className="max" onClick={() => setAmount("100")}>MAX</button>
              </div>
            </label>
            <div className="summary">
              <span>Price</span><b>{price}¢</b>
              <span>Shares</span><b>{quantity.toFixed(1)}</b>
              <span>Payout if hit</span><b className="accent">{usd.format(quantity)}</b>
              <span>Route</span><b>{dataSource === "panta" ? "Panta primary_order" : "Panta (mocked)"}</b>
            </div>
            <button className="btn primary full" onClick={trade} disabled={trading}>
              {trading ? "Routing…" : connected ? `Buy ${side}` : "Connect to trade"}
            </button>
            <button className="btn secondary full" style={{ marginTop: 8 }} onClick={() => addLegToSlip(activeMarket, side)} disabled={trading}>
              {legInSlip ? "Update slip leg" : "Add to slip"}
            </button>
            {marketTrades.length > 0 && (
              <div className="tape" aria-label="Recent trades">
                <div className="tape-title">Recent trades · /markets/{shortenPk(activeMarket.id)}/trades</div>
                <ul>
                  {marketTrades.slice(0, 3).map((t) => (
                    <li key={t.signature}>
                      <span className={t.side === "YES" ? "pill yes" : "pill no"}>{t.side}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortenPk(t.wallet)}</span>
                      <span>${t.usdcAmount}</span>
                      <span>{t.priceCents}¢</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="fine">
              Quote → build → sign → submit → attribute. Your wallet signs a Panta VersionedTransaction; Oracle Rumble never holds funds.
            </p>
          </aside>
        </div>
      </section>

      {/* ─── POSITIONS ──────────────────────────────────────────── */}
      {(arenaPositions.length > 0 || connected) && (
        <section className="shell" id="positions">
          <div className="section-head">
            <h2>Positions</h2>
            <span className="meta">
              {arenaPositions.length} open · cost basis {usd2.format(arenaPositions.reduce((s, p) => s + p.cost, 0))} ·
              <span className={openPnL >= 0 ? "up" : "down"}> {openPnL >= 0 ? "+" : ""}{usd2.format(openPnL)}</span>
            </span>
          </div>

          {arenaPositions.length === 0 ? (
            <div className="empty">No positions yet. Buy YES or NO above to fill this section.</div>
          ) : (
            <ul className="pos-list">
              {arenaPositions.map((p) => {
                const m = activeArena.markets.find((x) => x.id === p.marketId);
                const mark = m ? (p.side === "YES" ? m.yesPrice : 100 - m.yesPrice) : p.entryPrice;
                const pnl = (mark - p.entryPrice) * p.shares / 100;
                const claimable = m?.phase === "resolved" && m?.outcome === p.side;
                return (
                  <li key={p.id}>
                    <span className={p.side === "YES" ? "side-tag yes" : "side-tag no"}>{p.side}</span>
                    <div style={{ minWidth: 0 }}>
                      <h4>{p.question}</h4>
                      <span className="meta">
                        {p.shares.toFixed(1)} shares · entry {p.entryPrice}¢ · mark {mark}¢
                      </span>
                    </div>
                    <strong className={pnl >= 0 ? "up" : "down"}>{pnl >= 0 ? "+" : ""}{usd2.format(pnl)}</strong>
                    <div style={{ display: "flex", gap: 6 }}>
                      {claimable && <button className="btn sm primary" onClick={() => claimPosition(p)}>Claim</button>}
                      <button className="btn sm secondary" onClick={() => closePosition(p.id)}>Close</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ─── SLIP DRAWER ────────────────────────────────────────── */}
      <button className={slipLegs.length > 0 ? "slip-fab on" : "slip-fab"} onClick={() => setSlipOpen((v) => !v)}>
        Slip <b>{slipLegs.length}</b>
      </button>
      {slipOpen && (
        <div className="slip">
          <div className="slip-head">
            <div>
              <b>Parlay slip</b>
              <p>
                {slipLegs.length} leg{slipLegs.length === 1 ? "" : "s"} ·
                combined {parlayQuote.combinedPrice.toFixed(1)}¢ ·
                {" "}{parlayQuote.impliedOdds.toFixed(2)}×
              </p>
            </div>
            <div className="slip-head-actions">
              <button onClick={clearSlip} disabled={slipLegs.length === 0}>Clear</button>
              <button onClick={() => setSlipOpen(false)} aria-label="Close">×</button>
            </div>
          </div>

          {slipLegs.length === 0 ? (
            <div className="slip-empty">Tap Yes or No on any market to add it as a parlay leg. A parlay hits only if every leg lands.</div>
          ) : (
            <>
              <ul className="slip-legs">
                {slipLegs.map((l) => (
                  <li key={l.marketId}>
                    <span className={l.side === "YES" ? "pill yes" : "pill no"}>{l.side}</span>
                    <div className="body">
                      <b>{l.question}</b>
                      <span>{l.price}¢ · {shortenPk(l.marketId)}</span>
                    </div>
                    <button className="rm" onClick={() => removeLeg(l.marketId)} aria-label="Remove leg">×</button>
                  </li>
                ))}
              </ul>
              <label className="slip-stake field">
                Stake (USDC)
                <div className="field-input">
                  <span className="curr">$</span>
                  <input value={slipStake} onChange={(e) => setSlipStake(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" />
                </div>
              </label>
              <div className="slip-summary">
                <span>Combined price</span><b>{parlayQuote.combinedPrice.toFixed(2)}¢</b>
                <span>Implied odds</span><b>{parlayQuote.impliedOdds.toFixed(2)}×</b>
                <span title="stake × 5% × 4p(1-p) — variance-weighted per-leg fee, capped at 5% of stake">Fee</span>
                <b>{usd2.format(parlayQuote.feeUsdc)}</b>
                <span>Net stake</span><b>{usd2.format(parlayQuote.netStakeUsdc)}</b>
                <span>Payout if every leg hits</span><b className="accent">{usd2.format(parlayQuote.potentialPayoutUsdc)}</b>
                <span title="A voided leg resolves 50/50 and halves the parlay payout">Payout if one leg voids</span>
                <b>{usd2.format(parlayQuote.halfPayoutIfOneVoidUsdc)}</b>
              </div>
              <div className="slip-legfees">
                {slipLegs.map((l, i) => (
                  <span key={l.marketId}>
                    <em>{l.question.slice(0, 30)}{l.question.length > 30 ? "…" : ""}</em>
                    <b>{usd2.format(parlayQuote.legFees[i] ?? 0)}</b>
                  </span>
                ))}
                <small>{quoting ? "Re-quoting from Panta…" : "Priced live from Panta · 15s TTL"}</small>
              </div>
              <button className="btn primary full" onClick={placeParlay} disabled={placingParlay || slipLegs.length < 2}>
                {placingParlay ? "Placing…" : slipLegs.length < 2 ? "Add another leg" : `Place ${slipLegs.length}-leg parlay`}
              </button>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {showHost && (
        <div className="modal-backdrop" onClick={() => setShowHost(false)}>
          <form className="modal" onSubmit={createArena} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="close" onClick={() => setShowHost(false)} aria-label="Close">×</button>
            <h2>Create a market</h2>
            <p className="sub">Deploys a real Panta USDC market on Solana {CLUSTER}. Creation fee is quoted before signing.</p>
            <label>
              Question
              <input name="title" required placeholder="Will …?" maxLength={512} />
            </label>
            <label>
              Category
              <select name="theme" defaultValue="Crypto & markets">
                <option>Crypto &amp; markets</option>
                <option>Sports &amp; events</option>
                <option>Politics &amp; policy</option>
                <option>Entertainment</option>
                <option>Science &amp; tech</option>
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
            <button className="btn primary full" type="submit" disabled={hosting} style={{ marginTop: 8 }}>
              {hosting ? "Registering on Panta…" : connected ? "Publish to Panta" : "Save as draft"}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
