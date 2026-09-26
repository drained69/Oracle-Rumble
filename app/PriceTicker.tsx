"use client";

/**
 * Live BTC / ETH / SOL price ticker — the top strip that runs across every
 * page. Numbers are monospaced (tabular figures) so they don't jitter as
 * they update. Polls /api/prices every 20s; the server-side cache keeps the
 * upstream calls to a trickle.
 */

import { useEffect, useState } from "react";

type PriceItem = { symbol: "BTC" | "ETH" | "SOL"; name: string; priceUsd: number; change24h: number };

const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtPrice(p: number): string {
  if (!p) return "—";
  if (p >= 1000) return usd0.format(p);
  return usd2.format(p);
}

export default function PriceTicker() {
  const [items, setItems] = useState<PriceItem[]>([]);
  const [pulse, setPulse] = useState<Record<string, "up" | "down" | null>>({});

  useEffect(() => {
    let alive = true;
    let lastPrices: Record<string, number> = {};

    const tick = async () => {
      try {
        const res = await fetch("/api/prices", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        const next = (data.items ?? []) as PriceItem[];
        // Flash a brief up/down pulse when the price actually changed.
        const nextPulse: Record<string, "up" | "down" | null> = {};
        for (const it of next) {
          const prev = lastPrices[it.symbol];
          if (prev && it.priceUsd !== prev) nextPulse[it.symbol] = it.priceUsd > prev ? "up" : "down";
        }
        lastPrices = Object.fromEntries(next.map((it) => [it.symbol, it.priceUsd]));
        setItems(next);
        if (Object.keys(nextPulse).length) {
          setPulse((p) => ({ ...p, ...nextPulse }));
          window.setTimeout(() => setPulse((p) => {
            const cleared = { ...p };
            for (const k of Object.keys(nextPulse)) cleared[k] = null;
            return cleared;
          }), 1200);
        }
      } catch { /* transient */ }
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // Build a repeating row so the ticker fills the strip on wide screens.
  const REPS = 4;
  const display = items.length > 0 ? Array.from({ length: REPS }, () => items).flat() : [];

  return (
    <div className="ticker" role="marquee" aria-live="polite">
      <div className="ticker-track">
        {display.map((it, i) => {
          const p = pulse[it.symbol];
          const chg = it.change24h;
          const chgSign = chg > 0 ? "+" : "";
          return (
            <span key={`${it.symbol}-${i}`} className={`t-item ${p ?? ""}`}>
              <span className="t-sym">{it.symbol}</span>
              <span className="t-px">${fmtPrice(it.priceUsd)}</span>
              <span className={`t-chg ${chg >= 0 ? "up" : "down"}`}>{chgSign}{chg.toFixed(2)}%</span>
              <span className="t-sep">·</span>
            </span>
          );
        })}
        {items.length === 0 && <span className="t-item"><span className="t-sym">—</span><span className="t-px">loading prices…</span></span>}
      </div>
    </div>
  );
}
