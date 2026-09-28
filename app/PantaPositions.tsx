"use client";

/**
 * PantaPositions — wallet-scoped holdings pulled from Panta.
 *
 * Reads GET /positions?wallet=… (proxied through /api/positions). Renders a
 * page-embeddable view (no modal wrapper). Each position shows market
 * question, side, shares, entry vs mark, cost, and claimable state. If a
 * position is claimable, offers a one-click flow through /claims/build →
 * sign → confirm.
 */

import { useCallback, useEffect, useState } from "react";
import type { PantaPosition } from "@/lib/panta";
import { buildClaim, signAndBroadcastFromInstructions } from "@/lib/panta-client";

const POLL_MS = 15_000;

function shortMkt(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default function PantaPositions({ wallet }: { wallet: string | null }) {
  const [positions, setPositions] = useState<PantaPosition[]>([]);
  const [source, setSource] = useState<"panta" | "mock" | "unknown">("unknown");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/positions?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      if (!res.ok) { setLoading(false); return; }
      const j = (await res.json()) as { source: "panta" | "mock"; positions: PantaPosition[] };
      setSource(j.source);
      setPositions(j.positions ?? []);
    } catch { /* transient */ }
    finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const doClaim = async (marketId: string) => {
    if (!wallet) return;
    setClaiming(marketId); setMsg(null);
    try {
      const build = await buildClaim({ wallet, marketId });
      let signature = "";
      if (build.source === "panta" && build.instructions && build.instructions.length > 0) {
        const res = await signAndBroadcastFromInstructions({
          wallet,
          instructions: build.instructions,
          recentBlockhash: build.recentBlockhash
        });
        signature = res.signature;
      } else {
        signature = `demo-claim-${Date.now().toString(36)}`;
      }
      setMsg(`Claimed ${build.amountUsdc} USDC${signature ? ` · ${signature.slice(0, 8)}…` : ""}`);
      await load();
    } catch (err) {
      setMsg(`Claim failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setClaiming(null); }
  };

  return (
    <div className="positions-shell">
      <div className="positions-stats">
        <div>
          <span>Wallet</span>
          <b className="mono small">{wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "—"}</b>
        </div>
        <div>
          <span>Data</span>
          <b className={source === "panta" ? "state-live" : source === "mock" ? "state-demo" : ""}>{source === "panta" ? "Panta live" : source === "mock" ? "Sample" : "…"}</b>
        </div>
        <div>
          <span>Open</span>
          <b>{positions.length}</b>
        </div>
        <div>
          <span>Claimable</span>
          <b className="up">{positions.filter((p) => p.claimable).length}</b>
        </div>
      </div>

      <div className="positions-list">
        {loading && <div className="positions-empty">Loading positions from Panta…</div>}
        {!loading && !wallet && <div className="positions-empty">Connect a wallet to see your positions.</div>}
        {!loading && wallet && positions.length === 0 && (
          <div className="positions-empty">No open Panta positions for this wallet. Trade in an arena (with &quot;Also fill on Panta&quot; on) to open one.</div>
        )}
        {positions.map((p) => (
          <div key={`${p.marketId}-${p.side}`} className="panta-pos">
            <div className="panta-pos-head">
              <span className={`side ${p.side === "YES" ? "up" : "down"}`}>{p.side}</span>
              <span className="q">{p.question}</span>
              <span className={`phase ${p.phase}`}>{p.phase}</span>
            </div>
            <div className="panta-pos-grid">
              <div><span>Shares</span><b>{p.shares.toFixed(2)}</b></div>
              <div><span>Entry</span><b>{p.entryPrice}¢</b></div>
              <div><span>Mark</span><b>{p.markPrice}¢</b></div>
              <div><span>Cost</span><b>${p.cost}</b></div>
              <div><span>Market</span><b className="mono small">{shortMkt(p.marketId)}</b></div>
            </div>
            {p.claimable && (
              <button
                className="btn primary sm"
                onClick={() => doClaim(p.marketId)}
                disabled={claiming === p.marketId}
                style={{ width: "100%", marginTop: 8 }}
              >
                {claiming === p.marketId ? "Claiming…" : `Claim ${p.outcome ?? "win"}`}
              </button>
            )}
          </div>
        ))}
        {msg && <div className="panta-pos-msg">{msg}</div>}
      </div>
    </div>
  );
}
