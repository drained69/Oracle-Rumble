/**
 * Renders review frames into review/.
 *   node --import tsx scripts/render-stills.ts [demo|pitch] [scale] [beats...] [--music-only]
 * Pitch defaults include the cover and each section's start, midpoint and end.
 */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS as DEMO_SECTIONS, beatToFrame as demoBeatToFrame } from "../src/timeline";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const argv = process.argv.slice(2);
const musicOnly = argv.includes("--music-only");
const [which = "demo", scaleArg = "0.5", ...beatArgs] = argv.filter((a) => a !== "--music-only");
const scale = Number(scaleArg);
if (!Number.isFinite(scale) || scale <= 0 || scale > 2) throw new Error("Review scale must be between 0 and 2.");
if (!["demo", "pitch", "both", "landscape", "portrait"].includes(which)) throw new Error("Choose demo or pitch, followed by a scale and optional musical beats.");
if (beatArgs.some((b) => !Number.isFinite(Number(b)) || Number(b) < 0)) throw new Error("Review beats must be non-negative numbers.");

const main = async () => {
  const pitch = which === "pitch";
  const clock = pitch ? await import("../src/pitch/timeline") : { SECTIONS: DEMO_SECTIONS, beatToFrame: demoBeatToFrame };
  const frames = beatArgs.length
    ? beatArgs.map((b) => ({ frame: Math.round(clock.beatToFrame(Number(b))), label: Number(b).toFixed(2) }))
    : pitch
      ? [{ frame: 0, label: "0000-cover" }, ...clock.SECTIONS.flatMap((s) => [
          { frame: s.startFrame, label: `${String(s.startFrame).padStart(4, "0")}-${s.id}-start` },
          { frame: Math.floor((s.startFrame + s.endFrame - 1) / 2), label: `${String(Math.floor((s.startFrame + s.endFrame - 1) / 2)).padStart(4, "0")}-${s.id}-mid` },
          { frame: s.endFrame - 1, label: `${String(s.endFrame - 1).padStart(4, "0")}-${s.id}-end` },
        ])]
      : clock.SECTIONS.flatMap((s) => [0.15, 0.4, 0.65, 0.9].map((f) => {
          const beat = s.startBeat + f * (s.endBeat - s.startBeat);
          return { frame: Math.round(clock.beatToFrame(beat)), label: String(beat.toFixed(2)).padStart(6, "0") };
        }));
  const serveUrl = await bundle({ entryPoint: join(root, "src/index.ts"), publicDir: join(root, "public") });
  const id = pitch ? "ThePitPitch" : "ThePitDemo";
  const inputProps = pitch ? { narration: !musicOnly } : {};
  mkdirSync(join(root, "review"), { recursive: true });
  const browserExecutable = process.env.REMOTION_BROWSER ?? null;
  {
    const composition = await selectComposition({ serveUrl, id, browserExecutable, inputProps });
    for (const point of frames) {
      const frame = Math.min(composition.durationInFrames - 1, point.frame);
      const prefix = pitch ? (musicOnly ? "pitch-music" : "pitch") : "L";
      const out = join(root, "review", `${prefix}-${point.label}.png`);
      await renderStill({ serveUrl, composition, frame, output: out, imageFormat: "png", scale, browserExecutable, inputProps });
      console.log(out.replace(root + "/", ""));
    }
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
