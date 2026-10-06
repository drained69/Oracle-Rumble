import { useId } from "react";

/**
 * The Pit mark — a tiered octagonal trading pit seen from above: three steps
 * down to the floor, four stairways in, and the price at the centre. The
 * favicon (app/icon.svg) mirrors this geometry.
 */
export function BrandMark({ size = 34, className = "mark" }: { size?: number; className?: string }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`pit-ring-${gid}`} x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d8b4fe" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="15" fill="#0b0e17" stroke="#262b40" />
      <path d="M 53.25 40.80 L 40.80 53.25 L 23.20 53.25 L 10.75 40.80 L 10.75 23.20 L 23.20 10.75 L 40.80 10.75 L 53.25 23.20 Z"
        fill="none" stroke={`url(#pit-ring-${gid})`} strokeWidth="3" strokeLinejoin="round" />
      <path d="M 46.78 38.12 L 38.12 46.78 L 25.88 46.78 L 17.22 38.12 L 17.22 25.88 L 25.88 17.22 L 38.12 17.22 L 46.78 25.88 Z"
        fill="none" stroke="#edf0f6" strokeOpacity="0.55" strokeWidth="2" strokeLinejoin="round" />
      <path d="M 40.78 35.64 L 35.64 40.78 L 28.36 40.78 L 23.22 35.64 L 23.22 28.36 L 28.36 23.22 L 35.64 23.22 L 40.78 28.36 Z"
        fill="#131826" stroke="#edf0f6" strokeOpacity="0.35" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M 53.25 32 H 40.78 M 10.75 32 H 23.22 M 32 10.75 V 23.22 M 32 53.25 V 40.78"
        stroke="#edf0f6" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
      <path d="M 35.70 33.53 L 33.53 35.70 L 30.47 35.70 L 28.30 33.53 L 28.30 30.47 L 30.47 28.30 L 33.53 28.30 L 35.70 30.47 Z"
        fill={`url(#pit-ring-${gid})`} />
    </svg>
  );
}

/** Two-tone wordmark next to the mark. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wm-a">THE</span>
      <span className="wm-b">PIT</span>
    </span>
  );
}
