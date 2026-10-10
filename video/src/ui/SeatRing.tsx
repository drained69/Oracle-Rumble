import React from "react";
import { F } from "../fonts";
import { C } from "../theme";

/** app/SeatRing.tsx — `capacity` dots in an oval, filled up to `taken`; the latest seat glows. */
export const SeatRing: React.FC<{ taken: number; capacity: number; compact?: boolean; pulse?: number; scale?: number }> = ({ taken, capacity, compact = true, pulse = 0, scale = 1 }) => {
  const n = Math.max(2, Math.min(16, capacity));
  const filled = Math.max(0, Math.min(n, taken));
  const size = compact ? 68 : 96;
  const cx = size / 2, cy = size / 2;
  const rx = compact ? 28 : 42, ry = compact ? 18 : 26;
  return (
    <div style={{ position: "relative", width: size * scale, height: size * scale, flexShrink: 0 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size * scale} height={size * scale} style={{ overflow: "visible" }}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(192, 132, 252, 0.16)" strokeWidth="1" strokeDasharray="2 3" />
        {Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
          const on = i < filled;
          const latest = i === filled - 1;
          return (
            <g key={i}>
              {latest && <circle cx={x} cy={y} r={5.5 + pulse * 3} fill="none" stroke={C.plasma} strokeWidth="1" opacity={1 - pulse * 0.6} />}
              <circle cx={x} cy={y} r={on ? 3.5 : 2.4} fill={on ? C.plasma : "transparent"} stroke={on ? C.plasma : "rgba(192, 132, 252, 0.35)"} strokeWidth={on ? 0 : 1.2}
                style={on ? { filter: `drop-shadow(0 0 4px ${C.plasma})` } : undefined} />
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: F.mono, fontSize: 12 * scale, color: C.text3 }}>
        <span><b style={{ color: C.text, fontWeight: 800 }}>{filled}</b>/{n}</span>
      </div>
    </div>
  );
};
