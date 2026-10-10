/**
 * Builds the voice-over clips and the manifest the timeline is cut to.
 *
 *   npm run voiceover                 # synthesise every line with Kokoro (af_heart)
 *   npm run voiceover -- --measure    # keep existing public/vo/*.wav (e.g. your own recordings), just re-measure
 *   npm run voiceover -- --voice am_michael --speed 1.05
 *   npm run voiceover:pitch [-- --measure]   # the pitch film: src/pitch/narration.ts -> public/pitch-vo
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NARRATION as DEMO } from "../src/narration";
import { NARRATION as PITCH } from "../src/pitch/narration";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const film = flag("--film", "demo");
if (film !== "demo" && film !== "pitch") throw new Error(`Unknown --film ${film} (demo | pitch)`);
const NARRATION = film === "pitch" ? PITCH : DEMO;
const only = flag("--only", "");
const selected = only ? NARRATION.filter((l) => l.id === only) : NARRATION;
if (!selected.length) throw new Error(`Unknown narration line: ${only}`);
const outDir = join(root, "public", film === "pitch" ? "pitch-vo" : "vo");
const measureOnly = args.includes("--measure");
const voice = flag("--voice", "af_heart");
const speed = flag("--speed", "1.0");
mkdirSync(outDir, { recursive: true });

const run = (cmd: string, a: string[]) => {
  const r = spawnSync(cmd, a, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status})`);
};
const probe = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).stdout.toString().trim());

if (!measureOnly) {
  const py = join(root, ".tts-venv", "bin", "python");
  if (!existsSync(py)) throw new Error("Kokoro isn't installed: see README (Voice-over).");
  const tmp = mkdtempSync(join(tmpdir(), "pit-vo-"));
  const linesJson = join(tmp, "lines.json");
  writeFileSync(linesJson, JSON.stringify(selected.map((l) => ({ id: l.id, say: l.say ?? l.text }))));
  run(py, [join(root, "scripts", "tts_kokoro.py"), linesJson, tmp, voice, speed]);
  // Broadcast-style polish: low cut, a touch of presence, gentle compression, even loudness.
  const chain = "highpass=f=75,equalizer=f=240:t=q:w=1.2:g=-2,equalizer=f=3600:t=q:w=1.4:g=2.5,acompressor=threshold=-21dB:ratio=3:attack=6:release=90:makeup=2,loudnorm=I=-17:TP=-2:LRA=6";
  for (const l of selected) {
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", join(tmp, `${l.id}.raw.wav`), "-af", chain, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", join(outDir, `${l.id}.wav`)]);
  }
  rmSync(tmp, { recursive: true, force: true });
}

const lines: Record<string, number> = {};
for (const l of NARRATION) {
  const f = join(outDir, `${l.id}.wav`);
  if (!existsSync(f)) throw new Error(`Missing ${f}`);
  lines[l.id] = Math.round(probe(f) * 1000) / 1000;
}
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ voice: measureOnly ? "custom" : voice, speed: Number(speed), lines }, null, 2) + "\n");
const total = Object.values(lines).reduce((a, b) => a + b, 0);
console.log(`voice-over: ${NARRATION.length} lines · ${total.toFixed(1)}s of speech · ${NARRATION.reduce((n, l) => n + l.text.split(/\s+/).length, 0)} words`);
