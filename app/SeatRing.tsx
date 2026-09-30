"use client";

/**
 * Seat-ring visualization — makes "the room" visible on the featured
 * arena tile. Renders `capacity` dots arranged in an oval, filled up to
 * `taken`. The most-recently-filled seat pulses cyan.
 */
export default function SeatRing({
  taken,
  capacity,
  compact = false
}: {
  taken: number;
  capacity: number;
  compact?: boolean;
}) {
  const n = Math.max(2, Math.min(16, capacity));
  const filled = Math.max(0, Math.min(n, taken));
  const size = compact ? 68 : 96;
  const cx = size / 2;
  const cy = size / 2;
  const rx = compact ? 28 : 42;
  const ry = compact ? 18 : 26;

  const dots = Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const isFilled = i < filled;
    const isLatest = i === filled - 1;
    return { x, y, isFilled, isLatest };
  });

  return (
    <div className="seat-ring" style={{ width: size, height: size }} aria-label={`${filled} of ${n} seats taken`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <ellipse
          cx={cx} cy={cy} rx={rx} ry={ry}
          fill="none"
          stroke="rgba(192, 132, 252, 0.16)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {dots.map((d, i) => (
          <g key={i}>
            {d.isLatest && (
              <circle
                cx={d.x} cy={d.y} r={5.5}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1"
                className="seat-latest-halo"
              />
            )}
            <circle
              cx={d.x} cy={d.y}
              r={d.isFilled ? 3.5 : 2.4}
              fill={d.isFilled ? "#22d3ee" : "transparent"}
              stroke={d.isFilled ? "#22d3ee" : "rgba(192, 132, 252, 0.35)"}
              strokeWidth={d.isFilled ? 0 : 1.2}
              style={d.isFilled ? { filter: "drop-shadow(0 0 4px #22d3ee)" } : undefined}
            />
          </g>
        ))}
      </svg>
      <div className="seat-ring-label">
        <b>{filled}</b><span>/{n}</span>
      </div>
    </div>
  );
}
