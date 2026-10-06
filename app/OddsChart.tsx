"use client";

/**
 * OddsChart — the pit's price tape as a terminal chart.
 *
 * One series (the room's YES price, or a crypto pit's UP price) over the
 * trading window, the time left to the bell kept visible as empty runway,
 * Panta's line as a labelled reference, and the settlement window shaded.
 * Crosshair + tooltip on pointer and keyboard; every value also shows in the
 * Open / High / Low / Now readout, so nothing is reachable only by hovering.
 */

import { useEffect, useMemo, useRef, useState } from "react";

const SERIES = "#0ea5c4";   // validated on the dark surface with REF (dataviz checks)
const REF = "#a463f2";
const H = 168;
const PAD = { l: 34, r: 70, t: 12, b: 22 };

type Props = {
  tape: [number, number][];
  /** Series name, e.g. "Room YES" or "UP price". */
  label: string;
  /** Panta's YES price (cents), drawn as a reference line. */
  reference?: number | null;
  /** x-axis span: trading open → bell. */
  from: number;
  to: number;
  /** Shaded settlement window [start, bell], if the pit settles on an average. */
  closingFrom?: number | null;
  now: number;
};

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function OddsChart({ tape, label, reference, from, to, closingFrom, now }: Props) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => tape.filter(([t]) => t >= from - 1 && t <= to + 1), [tape, from, to]);
  const stats = useMemo(() => {
    if (pts.length === 0) return null;
    const vals = pts.map((p) => p[1]);
    return { open: vals[0], high: Math.max(...vals), low: Math.min(...vals), last: vals[vals.length - 1] };
  }, [pts]);

  // y-range: always include 50¢ and the reference, padded, snapped to 10s.
  const [lo, hi] = useMemo(() => {
    const vals = [50, ...pts.map((p) => p[1]), ...(reference != null ? [reference] : [])];
    const a = Math.max(0, Math.floor((Math.min(...vals) - 6) / 10) * 10);
    const b = Math.min(100, Math.ceil((Math.max(...vals) + 6) / 10) * 10);
    return b - a < 20 ? [Math.max(0, a - 10), Math.min(100, b + 10)] : [a, b];
  }, [pts, reference]);

  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const span = Math.max(1, to - from);
  const x = (t: number) => PAD.l + ((Math.min(Math.max(t, from), to) - from) / span) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;

  // Extend the last sample to "now" (the price holds until the next trade).
  const drawn = useMemo(() => {
    if (pts.length === 0) return [] as [number, number][];
    const last = pts[pts.length - 1];
    const end = Math.min(now, to);
    return end > last[0] ? [...pts, [end, last[1]] as [number, number]] : pts;
  }, [pts, now, to]);

  const linePath = drawn.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
  // Step shape: hold each price flat until the next sample.
  const stepPath = drawn.map(([t, v], i) => i === 0
    ? `M${x(t).toFixed(1)},${y(v).toFixed(1)}`
    : `H${x(t).toFixed(1)}V${y(v).toFixed(1)}`).join("");
  const path = drawn.length > 120 ? linePath : stepPath;
  const area = drawn.length ? `${path}V${(PAD.t + plotH).toFixed(1)}H${x(drawn[0][0]).toFixed(1)}Z` : "";

  const ticks = useMemo(() => {
    const step = hi - lo > 50 ? 25 : 10;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }, [lo, hi]);

  const lastPt = drawn[drawn.length - 1];
  const hoverPt = hover !== null ? pts[Math.min(hover, pts.length - 1)] : null;

  const pickNearest = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    let best = 0, bestD = Infinity;
    pts.forEach(([t], i) => { const d = Math.abs(x(t) - px); if (d < bestD) { bestD = d; best = i; } });
    setHover(pts.length ? best : null);
  };

  const summary = stats
    ? `${label}: opened ${Math.round(stats.open)}¢, high ${Math.round(stats.high)}¢, low ${Math.round(stats.low)}¢, now ${Math.round(stats.last)}¢${reference != null ? `. Panta's line ${Math.round(reference)}¢` : ""}.`
    : `${label}: no trades yet.`;

  return (
    <div className="oc">
      <div className="oc-head">
        <span className="oc-title">{label}</span>
        <span className="oc-sub">{now < to ? `bell in ${clock(to - now)}` : "closed"}</span>
      </div>
      <div ref={boxRef} className="oc-plot">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={summary}
            tabIndex={0}
            onPointerMove={(e) => pickNearest(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (!pts.length) return;
              if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? pts.length) - 1)); }
              else if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(pts.length - 1, (h ?? -1) + 1)); }
              else if (e.key === "Escape") setHover(null);
            }}
          >
            {closingFrom != null && closingFrom < to && (
              <g>
                <rect x={x(closingFrom)} y={PAD.t} width={Math.max(0, x(to) - x(closingFrom))} height={plotH} fill="rgba(237,240,246,0.045)" />
                <text x={x(closingFrom) + 4} y={PAD.t + 11} className="oc-band-label">settles on avg</text>
              </g>
            )}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} stroke="rgba(237,240,246,0.07)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" className="oc-tick">{v}¢</text>
              </g>
            ))}
            {reference != null && (
              <g>
                <line x1={PAD.l} x2={PAD.l + plotW} y1={y(reference)} y2={y(reference)} stroke={REF} strokeWidth={1.5} strokeOpacity={0.85} />
                <text x={PAD.l + plotW + 6} y={y(reference) + 4} className="oc-ref-label">Panta {Math.round(reference)}¢</text>
              </g>
            )}
            {area && <path d={area} fill={SERIES} fillOpacity={0.1} />}
            {path && <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {lastPt && (
              <g>
                <circle cx={x(lastPt[0])} cy={y(lastPt[1])} r={4} fill={SERIES} stroke="#0f131b" strokeWidth={2} />
                <text x={PAD.l + plotW + 6} y={Math.abs(y(lastPt[1]) - (reference != null ? y(reference) : -99)) < 12 ? y(lastPt[1]) - 8 : y(lastPt[1]) + 4} className="oc-last-label">{Math.round(lastPt[1])}¢</text>
              </g>
            )}
            {hoverPt && (
              <g aria-hidden="true">
                <line x1={x(hoverPt[0])} x2={x(hoverPt[0])} y1={PAD.t} y2={PAD.t + plotH} stroke="rgba(237,240,246,0.35)" strokeWidth={1} />
                <circle cx={x(hoverPt[0])} cy={y(hoverPt[1])} r={4.5} fill={SERIES} stroke="#0f131b" strokeWidth={2} />
              </g>
            )}
            <text x={PAD.l} y={H - 6} className="oc-tick">open</text>
            <text x={PAD.l + plotW} y={H - 6} textAnchor="end" className="oc-tick">bell</text>
          </svg>
        )}
        {hoverPt && width > 0 && (
          <div
            className="oc-tip"
            role="status"
            style={{ left: Math.min(Math.max(x(hoverPt[0]) - 60, 0), width - 128), top: 4 }}
          >
            <b>{Math.round(hoverPt[1] * 10) / 10}¢</b>
            <span><i style={{ background: SERIES }} aria-hidden="true" />{label}</span>
            <em>{hoverPt[0] >= to ? "at the bell" : `${clock(to - hoverPt[0])} before the bell`}</em>
          </div>
        )}
      </div>
      {stats && (
        <dl className="oc-stats">
          <div><dt>Open</dt><dd>{Math.round(stats.open)}¢</dd></div>
          <div><dt>High</dt><dd>{Math.round(stats.high)}¢</dd></div>
          <div><dt>Low</dt><dd>{Math.round(stats.low)}¢</dd></div>
          <div><dt>Now</dt><dd>{Math.round(stats.last)}¢ <em className={stats.last > stats.open ? "up" : stats.last < stats.open ? "down" : ""}>{stats.last >= stats.open ? "+" : "−"}{Math.abs(Math.round(stats.last - stats.open))}</em></dd></div>
        </dl>
      )}
    </div>
  );
}
