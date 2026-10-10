/** Export the spoken pitch, measured timing data, and matching subtitle cues. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GITHUB, SPEAKER_NAME } from "../src/pitch/narration";
import { DURATION_SECONDS, FPS, SECTIONS, VO, beatToSeconds } from "../src/pitch/timeline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "out");
mkdirSync(outDir, { recursive: true });

const names = {
  intro: "Introduction",
  who: "Finance, security, and building",
  ship: "What I have shipped",
  problem: "The problem",
  pit: "The Pit",
  why: "Why I am building this",
  close: "Closing invitation",
};

function stamp(seconds: number, srt = false): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const ms = total % 1000;
  const digits = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${srt ? "," : "."}${String(ms).padStart(3, "0")}`;
  return srt ? `${String(h).padStart(2, "0")}:${digits}` : digits;
}

// Match src/pitch/Subtitles.tsx: readable sentence/comma chunks, placed by
// character share inside each measured voice clip. This is line timing,
// not word alignment, and can be re-exported after narration changes.
const chunks = VO.flatMap((line) => {
  const parts = line.text.length <= 44 ? [line.text] : line.text.split(/(?<=[.!?:])\s+/).map((p) => p.trim()).filter(Boolean);
  const pieces = parts.flatMap((p) => {
    if (p.length <= 64) return [p];
    const mid = p.length / 2;
    let best = -1;
    for (let i = 0; i < p.length; i++) if (p[i] === "," && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best > 0 ? [p.slice(0, best + 1), p.slice(best + 1).trim()] : [p];
  });
  const characters = pieces.reduce((n, p) => n + p.length, 0);
  let from = beatToSeconds(line.startBeat);
  return pieces.map((text) => {
    const start = from;
    const end = from + (line.seconds * text.length) / characters;
    from = end;
    return { line: line.id, text, start, end };
  });
});

const words = VO.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
const md: string[] = [
  "# The Pit — builder pitch voice-over script", "",
  `Speaker: **${SPEAKER_NAME}** · ${words} words · current edit **${stamp(DURATION_SECONDS)}** · ${FPS} fps.`, "",
  "Delivery: warm, direct, and conversational. Pause between sections. Stress the connection between finance, security research, and what you have built.", "",
  "The current film uses a generated Kokoro voice. This is the spoken script; timecodes and section headings are production notes and are not read aloud.", "",
];
for (const section of SECTIONS) {
  md.push(`## ${stamp(section.startFrame / FPS)}–${stamp(section.endFrame / FPS)} · ${names[section.id]}`, "");
  for (const line of VO.filter((l) => l.section === section.id)) {
    md.push(`**${stamp(beatToSeconds(line.startBeat))}–${stamp(beatToSeconds(line.endBeat))}** · ${line.id}`, "", line.text, "");
  }
}
md.push("## Recording or replacing the voice", "",
  "Save one trimmed 48 kHz mono, 16-bit WAV per line at `public/pitch-vo/<line-id>.wav`. Keep the line IDs shown above.", "",
  "Run `npm run voiceover:pitch -- --measure`, then `npm run script:pitch` and `npm run render:pitch`. The measured clip lengths update the scene timings automatically.", "",
  "For generated narration, edit `src/pitch/narration.ts` and run `npm run voiceover:pitch -- --voice af_heart --speed 0.94` before exporting and rendering.", "",
  `Closing links: https://www.trythepit.xyz · https://${GITHUB}`, "",
  "Project names and creation dates were checked against the public drained69 GitHub repositories on 2026-10-09. The finance and security biography comes from the supplied brief.", "");

const wrap = (text: string): string => {
  const rows: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > 48) { rows.push(current); current = word; }
    else current += (current ? " " : "") + word;
  }
  if (current) rows.push(current);
  return rows.join("\n");
};
const srt = chunks.map((c, i) => `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${wrap(c.text)}\n`).join("\n");
const timing = {
  speaker: SPEAKER_NAME,
  durationSeconds: DURATION_SECONDS,
  fps: FPS,
  words,
  sections: SECTIONS.map((s) => ({ id: s.id, label: names[s.id], startSeconds: s.startFrame / FPS, endSeconds: s.endFrame / FPS })),
  lines: VO.map((l) => ({ id: l.id, section: l.section, text: l.text, startSeconds: beatToSeconds(l.startBeat), endSeconds: beatToSeconds(l.endBeat) })),
  subtitles: chunks,
};
for (const [name, data] of [
  ["the-pit-pitch-script.md", md.join("\n")],
  ["the-pit-pitch-subtitles.srt", srt],
  ["the-pit-pitch-timing.json", JSON.stringify(timing, null, 2) + "\n"],
] as const) {
  writeFileSync(join(outDir, name), data);
  console.log(`out/${name}`);
}
