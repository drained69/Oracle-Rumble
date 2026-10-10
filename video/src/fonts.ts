import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadOrbitron } from "@remotion/google-fonts/Orbitron";

/**
 * Inter for text and JetBrains Mono for numbers (app/globals.css). Orbitron is
 * the product's own display face — the wordmark, nav, buttons and big numbers
 * inside the app — so the rebuilt screens use it where the app does.
 */
export const INTER = loadInter("normal", { weights: ["400", "500", "600", "700", "800", "900"], subsets: ["latin"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const ORBITRON = loadOrbitron("normal", { weights: ["700", "800", "900"], subsets: ["latin"] }).fontFamily;

export const F = {
  text: `${INTER}, system-ui, sans-serif`,
  mono: `${MONO}, ui-monospace, monospace`,
  display: `${ORBITRON}, ${INTER}, sans-serif`
};
