"use client";

import { useEffect, useRef, useState } from "react";

type Row = { asset: "BTC" | "ETH" | "SOL"; price: number; changePct: number };

/**
 * Live BTC/ETH/SOL price ticker under the HUD bar. Reads from the same
 * public spot endpoint the round oracle uses (Coinbase, with Kraken as
 * backup), refreshing every ~4s. Falls back silently on error.
 *
 * The ticker is intentionally slim (26px) so it doesn't fight the
 * jumper-stage's no-scroll viewport budget.
 */
export default function PriceTicker() {
  const [rows, setRows] = useState<Row[]>([
    { asset: "BTC", price: 0, changePct: 0 },
    { asset: "ETH", price: 0, changePct: 0 },
    { asset: "SOL", price: 0, changePct: 0 }
  ]);
  const seedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const specs: Row["asset"][] = ["BTC", "ETH", "SOL"];
        const results = await Promise.all(
          specs.map(async (a) => {
            const r = await fetch(`https://api.coinbase.com/v2/prices/${a}-USD/spot`, { cache: "no-store" }).then((r) => r.json());
            return { asset: a, price: Number(r?.data?.amount ?? 0) };
          })
        );
        if (cancelled) return;
        setRows((prev) => results.map((r) => {
          const seed = seedRef.current[r.asset] ?? r.price;
          if (!seedRef.current[r.asset]) seedRef.current[r.asset] = r.price;
          const changePct = seed > 0 ? ((r.price - seed) / seed) * 100 : 0;
          const prevRow = prev.find((p) => p.asset === r.asset);
          return { asset: r.asset, price: r.price || prevRow?.price || 0, changePct };
        }));
      } catch { /* silent — ticker just stays on last values */ }
    };
    pull();
    const id = window.setInterval(pull, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  return (
    <div className="live-ticker" aria-label="Live prices">
      <span className="lt-tag"><span className="lt-dot" aria-hidden="true" />LIVE</span>
      {rows.map((r) => {
        const up = r.changePct >= 0;
        const price = r.price >= 1000
          ? r.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
          : r.price.toLocaleString("en-US", { maximumFractionDigits: 2 });
        return (
          <span key={r.asset} className={`lt-row ${up ? "up" : "down"}`}>
            <b>{r.asset}</b>
            <em>{r.price ? `$${price}` : "—"}</em>
            <span className="lt-chg">
              {r.price ? `${up ? "▲" : "▼"} ${Math.abs(r.changePct).toFixed(2)}%` : ""}
            </span>
          </span>
        );
      })}
      <span className="lt-tail">SESSION · Δ FROM FIRST TICK</span>
    </div>
  );
}
