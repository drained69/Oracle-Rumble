"use client";

/**
 * PantaHUD — the visible Panta integration layer.
 *
 *   • Live badge pill in the HUD row: "Live · Panta API v1" (green) when a
 *     key is configured and the last few calls succeeded, "Degraded" (red)
 *     when a live call recently fell back to mock, "Demo" (amber) when no
 *     key is configured.
 *   • Loud fallback banner: pinned under the HUD when in the degraded state.
 *   • Attribution ticker: silent toast when a new `/trades/report` result
 *     comes back attributed to the Oracle Rumble partner key.
 *   • Request console drawer: right-hand slide-in with the last 50 outbound
 *     Panta calls — endpoint, method, status, latency, source. Clicking the
 *     badge opens it.
 *
 * The data comes from GET /api/panta/telemetry, which reads the server's
 * in-memory Panta observer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TelemetryEvent, TelemetrySnapshot } from "@/lib/panta-telemetry";

const POLL_MS = 2500;
const ATTR_TOAST_MS = 3800;

function shortEndpoint(ep: string) {
  const trimmed = ep.split("?")[0].replace(/\/+$/, "");
  return trimmed || "/";
}
function timeAgo(now: number, ts: number) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 1) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default function PantaHUD() {
  const [snap, setSnap] = useState<TelemetrySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [attrToast, setAttrToast] = useState<string | null>(null);
  const prevAttrRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/panta/telemetry", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as TelemetrySnapshot;
      setSnap(j);
      if (prevAttrRef.current !== null && j.attributionCount > prevAttrRef.current) {
        setAttrToast(`+1 trade attributed to Oracle Rumble · total ${j.attributionCount}`);
      }
      prevAttrRef.current = j.attributionCount;
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!attrToast) return;
    const id = window.setTimeout(() => setAttrToast(null), ATTR_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [attrToast]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const state: "live" | "demo" | "degraded" = useMemo(() => {
    if (!snap) return "demo";
    if (snap.degraded) return "degraded";
    if (snap.live) return "live";
    return "demo";
  }, [snap]);

  const label =
    state === "live" ? "Live · Panta"
    : state === "degraded" ? "Panta degraded"
    : "Panta demo";

  const successCount = snap?.totals.live ?? 0;
  const errCount = snap?.totals.fallback ?? 0;
  const avgLatency = useMemo(() => {
    if (!snap) return null;
    const recent = snap.events.filter((e) => e.outcome === "ok" && e.source === "panta").slice(-10);
    if (recent.length === 0) return null;
    return Math.round(recent.reduce((s, e) => s + e.latencyMs, 0) / recent.length);
  }, [snap]);

  const events = snap?.events ?? [];
  const eventsRev = useMemo(() => [...events].reverse(), [events]);

  return (
    <>
      <button
        className={`panta-badge ${state}`}
        title={
          state === "live"
            ? `Panta API v1${snap?.keyHint ? ` · key ${snap.keyHint}` : ""}${avgLatency !== null ? ` · ${avgLatency}ms avg` : ""} · click for request console`
            : state === "degraded"
              ? "Recent live calls failed — showing demo data. Click for request console."
              : "No PANTA_API_KEY set — server is serving deterministic demo data."
        }
        onClick={() => setOpen(true)}
      >
        <span className="dot" />
        <span className="label">{label}</span>
        {state !== "demo" && (
          <span className="calls">
            {successCount}
            {errCount > 0 && <em>·{errCount}!</em>}
          </span>
        )}
      </button>

      {state === "degraded" && (
        <div className="panta-degraded-banner" role="status">
          <b>Panta live-api unreachable.</b>
          <span>Showing deterministic demo data. Recent errors: {errCount}.</span>
          <button onClick={() => setOpen(true)}>Request console →</button>
        </div>
      )}

      {attrToast && (
        <div className="panta-attr-toast" role="status">
          <span className="dot" />
          <span>{attrToast}</span>
        </div>
      )}

      {open && (
        <div className="panta-drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="panta-drawer" onClick={(e) => e.stopPropagation()}>
            <header className="panta-drawer-head">
              <div>
                <span className="eyebrow">Panta Public API v1</span>
                <h3>Request console</h3>
              </div>
              <button className="close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </header>

            <div className="panta-drawer-stats">
              <div>
                <span>State</span>
                <b className={`state-${state}`}>{label}</b>
              </div>
              <div>
                <span>Key</span>
                <b>{snap?.keyHint ?? "—"}</b>
              </div>
              <div>
                <span>Live ok</span>
                <b>{successCount}</b>
              </div>
              <div>
                <span>Fallbacks</span>
                <b className={errCount > 0 ? "warn" : ""}>{errCount}</b>
              </div>
              <div>
                <span>Avg latency</span>
                <b>{avgLatency !== null ? `${avgLatency}ms` : "—"}</b>
              </div>
              <div>
                <span>Attributed trades</span>
                <b className="up">{snap?.attributionCount ?? 0}</b>
              </div>
            </div>

            <div className="panta-drawer-tape">
              {eventsRev.length === 0 && (
                <div className="empty">No Panta calls have been observed yet — hit a market or place a trade.</div>
              )}
              {eventsRev.map((e) => (
                <TapeRow key={e.id} ev={e} now={now} />
              ))}
            </div>

            <footer className="panta-drawer-foot">
              <span>Endpoints proxied through <code>/api/*</code>. The API key is server-side; never in the client bundle.</span>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

function TapeRow({ ev, now }: { ev: TelemetryEvent; now: number }) {
  const bad = ev.outcome === "error";
  const mock = ev.source === "mock" && ev.outcome === "ok";
  return (
    <div className={`tape-row ${bad ? "err" : mock ? "mock" : "ok"}`}>
      <span className="method">{ev.method}</span>
      <span className="ep">{shortEndpoint(ev.endpoint)}</span>
      <span className="status">
        {ev.status > 0 ? ev.status : bad ? (ev.errorClass ?? "err") : "mock"}
      </span>
      <span className="lat">{ev.latencyMs > 0 ? `${ev.latencyMs}ms` : "—"}</span>
      <span className="ago">{timeAgo(now, ev.ts)}</span>
      {ev.note && <span className="note">{ev.note}</span>}
    </div>
  );
}
