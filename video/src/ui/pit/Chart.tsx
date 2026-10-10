import React from "react";
import { lerp, prog } from "../../anim";
import { F } from "../../fonts";
import { C } from "../../theme";

/**
 * app/OddsChart.tsx — the pit's price tape: the room's YES price over the
 * trading window, Panta's line as a labelled reference, the settlement window
 * shaded, and an Open / High / Low / Now readout.
 */
export const Chart: React.FC<{
  m: boolean; w: number; beat: number; tape: Array<{ beat: number; cents: number }>; from: number; to: number;
  reference: number | null; closingFrom: number | null; sub: string; label?: string; height?: number;
}> = ({ m, w, beat, tape, from, to, reference, closingFrom, sub, label = "Room YES price", height }) => {
  const H = height ?? (m ? 150 : 168);
  const PAD = { l: 34, r: m ? 62 : 70, t: 12, b: 22 };
  const pts = tape.filter((p) => p.beat <= beat);
  // Animate the newest step into place.
  const shown = pts.map((p, i) => {
    if (i === 0) return { ...p };
    const k = prog(beat, p.beat, 0.3);
    return { beat: p.beat, cents: lerp(pts[i - 1].cents, p.cents, k) };
  });
  const vals = [50, ...tape.map((p) => p.cents), ...(reference != null ? [reference] : [])];
  let lo = Math.max(0, Math.floor((Math.min(...vals) - 6) / 10) * 10);
  let hi = Math.min(100, Math.ceil((Math.max(...vals) + 6) / 10) * 10);
  if (hi - lo < 20) { lo = Math.max(0, lo - 10); hi = Math.min(100, hi + 10); }
  const plotW = Math.max(10, w - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const end = Math.min(beat, to);
  const drawn = shown.length ? [...shown, { beat: end, cents: shown[shown.length - 1].cents }] : [];
  const path = drawn.map((p, i) => (i === 0 ? `M${x(p.beat).toFixed(1)},${y(p.cents).toFixed(1)}` : `H${x(p.beat).toFixed(1)}V${y(p.cents).toFixed(1)}`)).join("");
  const area = drawn.length ? `${path}V${(PAD.t + plotH).toFixed(1)}H${x(drawn[0].beat).toFixed(1)}Z` : "";
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) ticks.push(v);
  const last = drawn[drawn.length - 1];
  const lastBorn = pts.length ? pts[pts.length - 1].beat : from;
  const ping = 1 - prog(beat, lastBorn, 0.9);
  const tv = pts.map((p) => p.cents);
  const stats = tv.length ? { open: tv[0], high: Math.max(...tv), low: Math.min(...tv), last: shown[shown.length - 1].cents } : null;
  const lastY = last ? y(last.cents) : 0;
  const refY = reference != null ? y(reference) : -99;
  return (
    <div style={{ width: w }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 2px 6px" }}>
        <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 10 : 11, letterSpacing: 1.3, textTransform: "uppercase", color: C.text2 }}>{label}</span>
        <span style={{ fontFamily: F.mono, fontSize: m ? 10 : 11, color: C.text3 }}>{sub}</span>
      </div>
      <svg width={w} height={H} style={{ display: "block", overflow: "visible" }}>
        {closingFrom != null && (
          <g>
            <rect x={x(closingFrom)} y={PAD.t} width={Math.max(0, x(to) - x(closingFrom))} height={plotH} fill="rgba(237,240,246,0.045)" />
            <text x={x(closingFrom) + 4} y={PAD.t + 11} fontFamily={F.mono} fontSize={9} fill={C.text3}>settles on avg</text>
          </g>
        )}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} stroke="rgba(237,240,246,0.07)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontFamily={F.mono} fontSize={9.5} fill={C.text3}>{v}¢</text>
          </g>
        ))}
        {reference != null && (
          <g>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={refY} y2={refY} stroke={C.ref} strokeWidth={1.5} strokeOpacity={0.85} />
            <text x={PAD.l + plotW + 6} y={refY + 4} fontFamily={F.mono} fontWeight={700} fontSize={m ? 9.5 : 10.5} fill={C.ref}>Panta {Math.round(reference)}¢</text>
          </g>
        )}
        {area && <path d={area} fill={C.series} fillOpacity={0.12} />}
        {path && <path d={path} fill="none" stroke={C.series} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
        {last && (
          <g>
            <circle cx={x(last.beat)} cy={lastY} r={4 + ping * 10} fill="none" stroke={C.plasma} strokeOpacity={ping * 0.8} strokeWidth={1.5} />
            <circle cx={x(last.beat)} cy={lastY} r={4} fill={C.series} stroke="#0f131b" strokeWidth={2} />
            <text x={PAD.l + plotW + 6} y={Math.abs(lastY - refY) < 16 ? (lastY <= refY ? refY - 13 : refY + 17) : lastY + 4} fontFamily={F.mono} fontWeight={800} fontSize={m ? 10.5 : 11.5} fill={C.text}>
              {Math.round(last.cents)}¢
            </text>
          </g>
        )}
        <text x={PAD.l} y={H - 6} fontFamily={F.mono} fontSize={9.5} fill={C.text3}>open</text>
        <text x={PAD.l + plotW} y={H - 6} textAnchor="end" fontFamily={F.mono} fontSize={9.5} fill={C.text3}>bell</text>
      </svg>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 6 }}>
          {[["Open", stats.open], ["High", stats.high], ["Low", stats.low], ["Now", stats.last]].map(([k, v]) => {
            const d = Math.round(stats.last - stats.open);
            return (
              <div key={k as string} style={{ padding: m ? "5px 7px" : "6px 9px", borderRadius: 8, background: "rgba(10,13,19,0.6)", border: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: F.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.text3 }}>{k}</div>
                <div style={{ fontFamily: F.mono, fontWeight: 800, fontSize: m ? 12 : 13, color: C.text }}>
                  {Math.round(v as number)}¢
                  {k === "Now" && <em style={{ fontStyle: "normal", fontSize: 10, marginLeft: 4, color: d > 0 ? C.plasma : d < 0 ? C.down : C.text3 }}>{d >= 0 ? "+" : "−"}{Math.abs(d)}</em>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
