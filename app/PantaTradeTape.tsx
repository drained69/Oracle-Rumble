"use client";

/**
 * PantaTradeTape — live fills tape for a single Panta market.
 *
 * Renders under the arena cockpit. Polls GET /api/markets/{id}/trades every
 * few seconds and shows the last ~8 fills: side, shares, price cents,
 * wallet-truncated, and time-ago. New rows fade in.
 *
 * When Panta is in demo mode the tape shows the deterministic mock feed
 * so the strip is never empty — the source badge on the strip tells you
 * which one you're looking at.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Trade = {
  signature: string;
  side: "YES" | "NO";
  shares: number;
  priceCents: number;
  usdcAmount: string;
  wallet: string;
  ts: string;
};

const POLL_MS = 5000;
const CAP = 12;

function shortPk(pk: string) {
  if (!pk) return "—";
  if (pk.length <= 10) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}
function shortSig(s: string) {
  if (!s) return "";
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}
function timeAgo(now: number, iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 1) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
function explorerHref(sig: string) {
  if (!sig || sig.length < 20) return "";
  const cluster = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${sig}${cluster}`;
}

export default function PantaTradeTape({ marketId, marketQuestion }: { marketId: string; marketQuestion?: string }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [source, setSource] = useState<"panta" | "mock" | "unknown">("unknown");
  const [now, setNow] = useState(() => Date.now());
  const prevIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!marketId) return;
    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}/trades`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { source: "panta" | "mock"; trades: Trade[] };
      setSource(j.source);
      setTrades((j.trades ?? []).slice(0, CAP));
    } catch { /* transient */ }
  }, [marketId]);

  useEffect(() => {
    setTrades([]);
    prevIdsRef.current = new Set();
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Which rows are new since the last render? Newborn rows animate in.
  const newIds = useMemo(() => {
    const cur = new Set(trades.map((t) => t.signature));
    const born = new Set<string>();
    for (const t of trades) if (!prevIdsRef.current.has(t.signature)) born.add(t.signature);
    prevIdsRef.current = cur;
    return born;
  }, [trades]);

  if (!marketId) return null;

  return (
    <section className="tape-shell">
      <div className="tape-head">
        <div>
          <span className="eyebrow">Live fills · Panta {source === "panta" ? "primary book" : "demo feed"}</span>
          <h4>{marketQuestion || "Recent trades"}</h4>
        </div>
        <span className={`tape-src ${source}`}>{source === "panta" ? "PANTA" : source === "mock" ? "DEMO" : "…"}</span>
      </div>
      <div className="tape-body">
        {trades.length === 0 && <div className="tape-empty">No fills observed yet — waiting for the next print…</div>}
        {trades.map((t) => (
          <div key={t.signature || `${t.ts}-${t.wallet}`} className={`tape-fill ${t.side === "YES" ? "yes" : "no"} ${newIds.has(t.signature) ? "born" : ""}`}>
            <span className={`side ${t.side === "YES" ? "up" : "down"}`}>{t.side}</span>
            <span className="shares">{t.shares.toFixed(1)}</span>
            <span className="price">@ {t.priceCents}¢</span>
            <span className="amt">${t.usdcAmount}</span>
            <span className="wallet">{shortPk(t.wallet)}</span>
            <span className="ago">{timeAgo(now, t.ts)}</span>
            {t.signature && t.signature.length > 20 && (
              <a className="sig" href={explorerHref(t.signature)} target="_blank" rel="noopener noreferrer">
                {shortSig(t.signature)} ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
