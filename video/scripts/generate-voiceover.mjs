import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const usage = `Usage: npm run voiceover -- --script narration.txt [--output public/voiceover.wav] [--voice Samantha] [--rate 155]

Generate a 48 kHz WAV voiceover from text using a macOS voice and FFmpeg.
Run say -v '?' to list voices installed on this Mac.`;

function fail(message) {
  console.error(`${message}\n\n${usage}`);
  process.exit(1);
}

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (key === "--help") {
    console.log(usage);
    process.exit(0);
  }
  if (!["--script", "--output", "--voice", "--rate"].includes(key) || !value) {
    fail(`Unknown or incomplete option: ${key ?? "(none)"}`);
  }
  options[key.slice(2)] = value;
}

if (process.platform !== "darwin") fail("This voiceover command requires macOS.");
if (!options.script) fail("A narration script is required.");

const scriptPath = resolve(options.script);
if (!existsSync(scriptPath)) fail(`Script not found: ${scriptPath}`);
const narration = readFileSync(scriptPath, "utf8").trim();
if (!narration) fail("The narration script is empty.");

const rate = Number(options.rate ?? 155);
if (!Number.isInteger(rate) || rate < 80 || rate > 300) {
  fail("Speech rate must be an integer from 80 to 300 words per minute.");
}

const outputPath = resolve(options.output ?? "public/voiceover.wav");
mkdirSync(dirname(outputPath), { recursive: true });
const tempDir = mkdtempSync(join(tmpdir(), "panta-voiceover-"));
const aiffPath = join(tempDir, "voiceover.aiff");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

try {
  const sayArgs = ["-r", String(rate), "-f", scriptPath, "-o", aiffPath];
  if (options.voice) sayArgs.unshift("-v", options.voice);
  run("say", sayArgs);
  if (!existsSync(aiffPath) || statSync(aiffPath).size < 1024) {
    throw new Error("macOS speech produced no audio. Codex may need system access outside the restricted sandbox.");
  }
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", aiffPath,
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", outputPath]);
  if (statSync(outputPath).size < 1024) {
    throw new Error("The converted voiceover contains no audio.");
  }
  console.log(`Voiceover saved: ${outputPath}`);
  console.log(`Script: ${basename(scriptPath)} (${narration.split(/\s+/).length} words)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
