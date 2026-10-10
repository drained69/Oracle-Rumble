/**
 * Brand tokens — copied from app/globals.css so the film matches the product.
 */
export const C = {
  bg: "#0a0d13",
  bgElev: "#0f131b",
  surface: "#131824",
  surfaceAlt: "#171d2c",
  surfaceHover: "#1a2131",
  border: "#1b2130",
  borderStrong: "#262e40",
  borderFocus: "#364260",
  text: "#edf0f6",
  text2: "#8b93a7",
  text3: "#7d8599",
  up: "#22c55e",
  down: "#f43f5e",
  amber: "#f59e0b",
  neon: "#c084fc",
  neon2: "#38bdf8",
  plasma: "#22d3ee",
  gold: "#fcd34d",
  xp: "#fb923c",
  series: "#0ea5c4", // OddsChart series colour
  ref: "#a463f2" // OddsChart Panta-line colour
} as const;

export const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const GLOW = {
  neon: `0 0 20px ${rgba(C.neon, 0.5)}, 0 0 3px ${rgba(C.neon, 0.85)}`,
  plasma: `0 0 20px ${rgba(C.plasma, 0.5)}, 0 0 3px ${rgba(C.plasma, 0.85)}`,
  gold: `0 0 20px ${rgba(C.gold, 0.5)}, 0 0 3px ${rgba(C.gold, 0.85)}`
};
