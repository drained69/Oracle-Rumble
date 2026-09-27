"use client";

/**
 * PantaResolution — surfaces Panta's AI Resolver + dispute-window state.
 *
 * Polls GET /api/markets/{id}. When the market phase is "resolved" it
 * renders a strip with:
 *   • "Resolved YES/NO · by Panta AI Resolver"
 *   • Dispute-window countdown (2 hours from resolvedAt).
 *
 * Only mounts when the round has a Panta market id. Hides itself if the
 * market is still active.
 */

import { useCallback, useEffect, useState } from "react";
import type { PantaMarket } from "@/lib/panta";

const POLL_MS = 10_000;
const DISPUTE_WINDOW_MS = 2 * 60 * 60 * 1000;

function fmtWindow(ms: number) {
  if (ms <= 0) return "closed";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function PantaResolution({ marketId }: { marketId: string }) {
  const [market, setMarket] = useState<PantaMarket | null>(null);
  const [source, setSource] = useState<"panta" | "mock" | "unknown">("unknown");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!marketId) return;
    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { source: "panta" | "mock"; market: PantaMarket };
      setSource(j.source);
      setMarket(j.market ?? null);
    } catch { /* transient */ }
  }, [marketId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!market) return null;
  if (market.phase !== "resolved") return null;

  const outcome = market.outcome ?? null;
  const resolvedAt = market.resolvedAt ? Date.parse(market.resolvedAt) : NaN;
  const disputeEndsAt = Number.isFinite(resolvedAt) ? resolvedAt + DISPUTE_WINDOW_MS : null;
  const disputeMs = disputeEndsAt !== null ? Math.max(0, disputeEndsAt - now) : null;
  const disputeOpen = disputeMs !== null && disputeMs > 0;

  return (
    <section className="resolution-shell">
      <div className={`resolution-card ${outcome === "YES" ? "yes" : outcome === "NO" ? "no" : ""}`}>
        <div className="resolution-lead">
          <span className="tag">
            <span className="dot" />
            {outcome
              ? <>Resolved <b>{outcome}</b></>
              : <>Market resolved</>}
          </span>
          <span className="by">by Panta AI Resolver</span>
        </div>
        <p className="resolution-question">{market.question}</p>
        <div className="resolution-meta">
          <div>
            <span>Resolved</span>
            <b>{Number.isFinite(resolvedAt) ? new Date(resolvedAt).toLocaleString() : "—"}</b>
          </div>
          <div>
            <span>Dispute window</span>
            <b className={disputeOpen ? "warn" : ""}>
              {disputeMs === null ? "2h" : disputeOpen ? `${fmtWindow(disputeMs)} left` : "closed — final"}
            </b>
          </div>
          <div>
            <span>Source</span>
            <b className={source === "panta" ? "up" : "amber"}>{source === "panta" ? "PANTA LIVE" : "DEMO"}</b>
          </div>
        </div>
        {disputeOpen && (
          <p className="resolution-note">
            Panta&apos;s AI Resolver posts a verdict, then keeps a 2-hour dispute window before payouts settle. If this call looks wrong to you, dispute it on Panta before the timer runs out.
          </p>
        )}
      </div>
    </section>
  );
}
