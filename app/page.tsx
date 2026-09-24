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
const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toUpperCase();

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

  // Live market trade tape for the active market (Panta /markets/{id}/trades).
  type MarketTrade = { signature: string; side: "YES" | "NO"; shares: number; priceCents: number; usdcAmount: string; wallet: string; ts: string };
  const [marketTrades, setMarketTrades] = useState<MarketTrade[]>([]);

  // Panta-authoritative positions when a wallet is connected.
  const [remotePositions, setRemotePositions] = useState<PantaPosition[]>([]);

  const [toast, setToast] = useState("");
  const [showHost, setShowHost] = useState(false);
  const [hosting, setHosting] = useState(false);

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

    // Fetch the authoritative arena/market list. When PANTA_API_KEY is set
    // this returns real Panta markets grouped by category; otherwise it
    // falls back to the seed data with source: "mock".
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
            endsInMs: a.endsInMs ?? 8 * 3_600_000,
            markets: a.markets as Market[]
          }));
          setArenas(fresh);
          if (!fresh.some((a) => a.id === activeArenaId)) setActiveArenaId(fresh[0].id);
          const now = Date.now();
          const dl: Record<string, number> = {};
          for (const a of fresh) dl[a.id] = now + a.endsInMs;
          deadlinesRef.current = dl;
        }
      })
      .catch(() => setDataSource("mock"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live mode: refresh Panta markets every 20s so prices stay authoritative.
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
        // Add deadlines for any newly-appearing arenas (host flow).
        const now = Date.now();
        for (const a of next) {
          if (!(a.id in deadlinesRef.current)) deadlinesRef.current[a.id] = now + a.endsInMs;
        }
      } catch { /* ignore transient */ }
    }, 20_000);
    return () => window.clearInterval(id);
  }, [dataSource]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const payload: Persisted = { walletAddress, walletKind, positions, hosted, parlays };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  }, [walletAddress, walletKind, positions, hosted, parlays, hydrated]);

  // Random-walk ticker — only runs in mock mode. In Panta mode the 20s
  // fetch above is the source of truth for prices.
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

  // Live trade tape for the focused market — refreshes on market change
  // and every 8s. When PANTA_LIVE=true this is /markets/{id}/trades.
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const r = await fetchMarketTrades(activeMarket.id);
        if (!cancelled) setMarketTrades(r.trades);
      } catch { /* ignore */ }
    }
    pull();
    const id = window.setInterval(pull, 8_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeMarket.id]);

  // Remote positions from Panta when a wallet is connected. Refreshes on
  // connect and every 12s while connected.
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

  // ---- honest hero stats + ticker (all derived from live data) ------

  const totalMarkets = useMemo(() => arenas.reduce((s, a) => s + a.markets.length, 0), [arenas]);

  // Volume tracked: parse each market's "$42.8k" / "$1.2M" / "$0.00" string
  // (produced by /api/markets from Panta's volumeUsdc field) into a number.
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

  // Ticker payload — honest data only. When there's nothing to say we
  // show a status strip instead of fabricated events.
  type TickerItem = { kind: "status" | "trade" | "market"; text: string };
  const tickerItems = useMemo<TickerItem[]>(() => {
    const items: TickerItem[] = [];
    items.push({ kind: "status", text: `${dataSource === "panta" ? "LIVE · PANTA" : "DEMO · MOCK"} · ${CLUSTER}` });
    items.push({ kind: "status", text: `${totalMarkets} MARKETS · ${arenas.length} RINGS` });
    for (const t of marketTrades.slice(0, 4)) {
      items.push({ kind: "trade", text: `${t.side} $${t.usdcAmount} @ ${t.priceCents}¢ · ${shortenPk(t.wallet)} · sig ${shortenPk(t.signature)}` });
    }
    if (activeMarket?.question) items.push({ kind: "market", text: `${activeMarket.category.toUpperCase()} · ${activeMarket.question} · YES ${activeMarket.yesPrice}¢` });
    return items;
  }, [dataSource, totalMarkets, arenas.length, marketTrades, activeMarket]);

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
      setWalletAddress(null);
      setWalletKind(null);
      setToast("No Solana wallet found. Install Phantom, Backpack, or Solflare and reload.");
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
      const label = signed.confirmed ? "on-chain, confirmed" : "on-chain, broadcasting";
      setToast(`${side} filled · ${quote.shares.toFixed(1)} shares at ${quote.price}¢ · sig ${shortenPk(signed.signature)} (${label})`);

      // Poll Panta for its own confirmation view. This may lag the RPC
      // confirmation by a slot or two.
      {
        (async () => {
          for (let i = 0; i < 8; i++) {
            try {
              const v = await verifyOrder({ signature: signed.signature });
              if (v.status === "confirmed") {
                setToast(`Panta confirmed · sig ${shortenPk(signed.signature)} settled on-chain.`);
                return;
              }
              if (v.status === "failed") {
                setToast(`Panta rejected · sig ${shortenPk(signed.signature)} did not settle.`);
                return;
              }
            } catch { /* keep polling */ }
            await new Promise((r) => setTimeout(r, 2_500));
          }
        })();
      }
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

  /**
   * Host a rumble = create a Panta market. Runs the full three-step
   * lifecycle:
   *   1. POST /markets/quote     → creation fee + short-lived quoteId
   *   2. POST /markets/build     → unsigned VersionedTransaction
   *   3. wallet signs, broadcasts to Solana RPC
   *   4. POST /markets/register  → Panta writes catalog metadata
   *
   * Without a connected wallet or on failure, falls back to a draft ring
   * saved in the local hosted[] list so the UI stays usable.
   */
  // Panta's category enum. Anything outside it 400s at /markets/create/quote.
  const PANTA_CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
  const THEME_TO_CATEGORY: Record<string, typeof PANTA_CATEGORIES[number]> = {
    "Crypto & markets": "crypto",
    "Sports & events": "sports",
    "Community forecasts": "world",
    "Product launches": "world",
    "Politics & policy": "politics",
    "Entertainment": "entertainment",
    "Science & tech": "science"
  };

  async function createArena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "Untitled ring").trim() || "Untitled ring";
    const theme = String(form.get("theme") || "Community forecasts");
    const durationLabel = String(form.get("duration") || "72 hours");
    const HOURS: Record<string, number> = { "72 hours": 72, "1 week": 168, "1 month": 720 };
    const endsAtMs = Date.now() + (HOURS[durationLabel] ?? 72) * 3_600_000;

    if (!walletAddress) {
      setHosted((current) => [title, ...current]);
      setShowHost(false);
      setToast(`"${title}" forged as a draft realm — connect a wallet to publish to Panta.`);
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
        imageUrl: `https://placehold.co/512x512/0b0d14/d4a24c/png?text=${encodeURIComponent(title.slice(0, 24))}`
      });
      const feeUsdc = (Number(q.paymentUsdc) / 1_000_000).toFixed(2);
      setToast(`Quoted ${feeUsdc} USDC creation fee · signing…`);

      const b = await marketCreateBuild({ createId: q.createId, wallet: walletAddress });
      let signature: string;
      let signLabel: string;
      if (!b.transaction) {
        // Sandbox: Panta returns an empty tx — no keypair is signing anything.
        signature = "sandboxSignature" + "1".repeat(43);
        signLabel = "sandbox (no on-chain tx)";
      } else {
        const s = await signAndBroadcast({ serializedTx: b.transaction, wallet: walletAddress });
        signature = s.signature;
        signLabel = s.confirmed ? "on-chain, confirmed" : "on-chain, broadcasting";
      }
      const reg = await marketCreateRegister({ createId: q.createId, signature });

      setHosted((current) => [`${title} · ${reg.marketId.slice(0, 4)}…${reg.marketId.slice(-4)}`, ...current]);
      setShowHost(false);
      setToast(`"${title}" registered · market ${shortenPk(reg.marketId)} (${signLabel}).`);
      // Force a fresh markets fetch so the new ring appears in the UI.
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
      setToast(`Panta registration failed — kept as draft. ${err instanceof Error ? err.message : ""}`);
    } finally {
      setHosting(false);
    }
  }

  // ---- render --------------------------------------------------------

  const sourceBadge = dataSource === "panta"
    ? { text: `LIVE · PANTA · ${CLUSTER}`, cls: "src live" }
    : dataSource === "mock"
      ? { text: "DEMO · SET PANTA_API_KEY", cls: "src demo" }
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

      {/* -------- LIVE TICKER (real Panta data) -------- */}
      <div className="ticker">
        <div className="ticker-track">
          {[...tickerItems, ...tickerItems].map((t, i) => (
            <span key={i} className={`t-${t.kind}`}>{t.text}</span>
          ))}
        </div>
      </div>

      {/* -------- PORTAL HERO -------- */}
      <section className="portal" id="top">
        <div className="portal-inner">
          <p className="eyebrow">SEASON 01 · GENESIS RUN · SOLANA {CLUSTER}</p>
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
            <div className="stat"><b>{totalMarkets}</b><span>◈ LIVE MARKETS</span></div>
            <div className="stat"><b>{arenas.length}</b><span>⚔ ACTIVE RINGS</span></div>
            <div className="stat"><b>{volumeLabel}</b><span>⛨ VOLUME (USDC)</span></div>
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

              {marketTrades.length > 0 && (
                <div className="tape" aria-label="Recent trades on this market">
                  <div className="tape-title">◆ RECENT FLOW · panta /markets/{shortenPk(activeMarket.id)}/trades</div>
                  <ul>
                    {marketTrades.slice(0, 3).map((t) => (
                      <li key={t.signature}>
                        <span className={t.side === "YES" ? "chip yes" : "chip no"}>{t.side}</span>
                        <span className="who">{shortenPk(t.wallet)}</span>
                        <span className="amt">${t.usdcAmount}</span>
                        <span className="px">@ {t.priceCents}¢</span>
                        <span className="sig">sig {shortenPk(t.signature)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
            <div title="Positions read from Panta's /positions endpoint using the connected wallet address.">
              <span>◊ PANTA ON-CHAIN</span>
              <b>{connected ? remotePositions.length : "—"}</b>
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

      {/* -------- YOUR HALL (real on-chain record) -------- */}
      <section className="hall-shell" id="hall">
        <div className="section-head">
          <div>
            <p className="eyebrow">◈ YOUR HALL</p>
            <h2>YOUR RECORD</h2>
          </div>
          <span className="flair"><i />PANTA · WALLET-SCOPED</span>
        </div>

        <div className="hall">
          <span className="cnr bl" /><span className="cnr br" />
          {!connected ? (
            <div className="hall-empty">
              <p><b>Connect a Solana wallet to see your on-chain record.</b></p>
              <p>Panta does not publish a global leaderboard yet — Oracle Rumble scopes standings to the connected wallet so nothing on this page is fabricated.</p>
              <button className="gbtn primary" onClick={connect}>CONNECT WALLET <span className="arr">▸</span></button>
            </div>
          ) : (
            <>
              <div className="hall-you">
                <span className="rank rank-1"><span className="crown">♛</span>YOU</span>
                <span className="avatar-lg gold">{initials}</span>
                <div className="hall-body">
                  <b>{shortenPk(walletAddress!)}</b>
                  <span className="player-meta">
                    {remotePositions.length} PANTA POSITIONS · {positions.length} LOCAL FILLS · {parlays.length} PARLAYS
                  </span>
                </div>
                <div className="hall-num">
                  <span>COST BASIS</span>
                  <b>{usd2.format(positions.reduce((s, p) => s + p.cost, 0))}</b>
                </div>
                <div className={`hall-num ${openPnL >= 0 ? "up" : "down"}`}>
                  <span>OPEN P&amp;L (SESSION)</span>
                  <b>{openPnL >= 0 ? "+" : ""}{usd2.format(openPnL)}</b>
                </div>
              </div>
              {remotePositions.length > 0 && (
                <ul className="hall-positions">
                  {remotePositions.slice(0, 6).map((p) => (
                    <li key={`${p.marketId}-${p.side}`}>
                      <span className={p.side === "YES" ? "side yes" : "side no"}>{p.side}</span>
                      <b>{p.question}</b>
                      <span>{Number(p.shares).toFixed(1)} sh · entry {p.entryPrice}¢ · mark {p.markPrice}¢</span>
                      <strong>{p.cost}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {remotePositions.length === 0 && (
                <p className="hall-note">No open positions on Panta yet. Buy YES/NO from the wager panel to fill your hall.</p>
              )}
            </>
          )}
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
                <option>Politics &amp; policy</option>
                <option>Entertainment</option>
                <option>Science &amp; tech</option>
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
            <button className="gbtn primary full" type="submit" disabled={hosting}>
              {hosting ? "REGISTERING ON PANTA…" : connected ? "PUBLISH TO PANTA" : "FORGE DRAFT"} <span className="arr">▸</span>
            </button>
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
