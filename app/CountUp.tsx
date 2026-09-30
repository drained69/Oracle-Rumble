"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate a numeric value from its previous render to the new one.
 * Cheap, dependency-free, easing = fast-then-settle. Respects reduced-motion.
 *
 * `format` maps the animated number to a display string (e.g. USD formatting).
 * `duration` in ms — default 900.
 */
export default function CountUp({
  value,
  format,
  duration = 900,
  className
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = prev.current;
    const to = value;
    if (reduced || from === to) { setDisplay(to); prev.current = to; return; }

    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * eased);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else prev.current = to;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
}
