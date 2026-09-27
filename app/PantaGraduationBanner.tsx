"use client";

/**
 * PantaGraduationBanner — watches the tracked-markets list and celebrates
 * when any of them transitions to Panta's "graduated" phase.
 *
 * Panta credits the market creator 20% of the trading fees generated on
 * the primary and secondary books once a market graduates — a very
 * important moment for hosts that is otherwise silent. This component
 * makes that moment loud:
 *
 *   • A pinned banner appears once per market in a session.
 *   • The tracked market is flagged as "celebrated" in localStorage so
 *     re-mounts don't re-fire.
 *
 * The polling is cheap because only base58 Panta ids are checked; the
 * synthetic BTC/ETH/SOL direction-board ids are filtered out at the
 * tracking layer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listTrackedMarkets, markGraduatedCelebrated, type TrackedMarket } from "@/lib/tracked-markets";
import type { PantaMarket } from "@/lib/panta";

const POLL_MS = 20_000;

type Live = { marketId: string; question?: string; role: TrackedMarket["role"]; graduatedAt: number };

export default function PantaGraduationBanner() {
  const [banner, setBanner] = useState<Live | null>(null);
  const inflightRef = useRef(false);

  const tick = useCallback(async () => {
    if (inflightRef.current) return;
    const tracked = listTrackedMarkets().filter((m) => !m.celebratedGraduated);
    if (tracked.length === 0) return;
    inflightRef.current = true;
    try {
      for (const t of tracked) {
        try {
          const res = await fetch(`/api/markets/${encodeURIComponent(t.marketId)}`, { cache: "no-store" });
          if (!res.ok) continue;
          const j = (await res.json()) as { source: string; market?: PantaMarket };
          if (!j.market) continue;
          if (j.market.phase === "graduated") {
            markGraduatedCelebrated(t.marketId);
            setBanner({ marketId: t.marketId, question: j.market.question ?? t.question, role: t.role, graduatedAt: Date.now() });
            break;
          }
        } catch { /* transient */ }
      }
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  if (!banner) return null;

  const short = banner.marketId.length > 12 ? `${banner.marketId.slice(0, 6)}…${banner.marketId.slice(-4)}` : banner.marketId;

  return (
    <div className="panta-grad-banner" role="status">
      <span className="grad-dot" />
      <div className="grad-body">
        <b>Market graduated on Panta 🎉</b>
        <span>
          {banner.question ?? short}
          {banner.role === "creator" && <> · you earn 20% of trading fees for as long as this book keeps trading.</>}
          {banner.role === "player" && <> · this market crossed into the secondary book.</>}
        </span>
      </div>
      <button onClick={() => setBanner(null)}>Dismiss</button>
    </div>
  );
}
