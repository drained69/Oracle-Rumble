# The Pit — hackathon demo video

A 2:04 narrated product demo (1920×1080, 30 fps) built in [Remotion](https://www.remotion.dev). Every frame and every sound is code: the score and interface sounds are synthesised by `scripts/build-audio.ts`, and the narration is generated locally with the open-source Kokoro voice model, so there is nothing to license.

Output: `out/the-pit-1920x1080.mp4` (H.264 CRF 14, AAC 320k, about −14 LUFS).

## Builder pitch

`ThePitPitch` is the separate 1:38 Colosseum introduction for **drained69**. It has seven scenes covering the builder's finance and security background, ten public projects, the problem, The Pit, its escrow design, and the closing invitation. The narrated export uses a locally generated Kokoro voice, music, interface sounds, and burned captions. No personal recording is needed.

```bash
cd video
npm run render:pitch        # narrated film
npm run render:pitch:music  # clean picture with music and effects, no voice or captions
```

The exports are `out/the-pit-pitch-1920x1080.mp4` and `out/the-pit-pitch-music-only-1920x1080.mp4`. `npm run script:pitch` also writes the timed script, SRT captions, and timing JSON into `out/`. The source voice lines are in `src/pitch/narration.ts`, and `npm run voiceover:pitch` regenerates them with Kokoro after an edit. `node --import tsx scripts/render-stills.ts pitch 0.5` renders review frames from every section.

## Render

```bash
cd video
npm install
npm run voiceover   # only when src/narration.ts changes (needs the Kokoro setup below)
npm run render      # builds public/soundtrack.wav, then the MP4
```

| Command | Does |
|---|---|
| `npm run studio` | Remotion Studio for scrubbing the timeline |
| `npm run voiceover` | Synthesise every narration line into `public/vo/*.wav` and re-measure `public/vo/manifest.json` |
| `npm run voiceover -- --measure` | Keep the WAVs already in `public/vo/` (e.g. your own recordings) and just re-measure them |
| `npm run audio` | Rebuild `public/soundtrack.wav` (score + interface sounds + narration, ducked) |
| `npx tsx scripts/render-stills.ts demo 0.5 [beats…]` | Review frames into `review/` |

Remotion downloads its own headless Chrome on the first render. To use an installed Chrome instead, set
`REMOTION_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

## Narration

The script lives in [`src/narration.ts`](src/narration.ts), one entry per line. `text` is what the subtitles show; `say` (optional) is spelled for the voice ("L M S R", "try the pit dot x y z").

The voice is Kokoro-82M (`af_heart`, Apache-2.0), installed into a local venv:

```bash
cd video
uv venv -p 3.12 .tts-venv
VIRTUAL_ENV=.tts-venv uv pip install "kokoro>=0.9.4" "misaki[en]>=0.9.4" "transformers>=4.44" soundfile \
  "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
```

The first run downloads the model from Hugging Face (`hexgrad/Kokoro-82M`). Each clip gets a light broadcast polish (low cut, presence, compression, even loudness).

**To use your own voice or ElevenLabs:** record each line, save it as `public/vo/<id>.wav` (48 kHz mono, 16-bit, trimmed), run `npm run voiceover -- --measure`, then `npm run render`. The edit re-times itself: every section is at least its planned length and long enough for its lines, and on-screen actions are cued to the lines (`vo("seat-2", 0.28)` = 28% into that line).

`npm run voiceover:say` is the older macOS `say` script (single file); it isn't used by the film.

## Structure

At ≈124.14 BPM one bar is exactly 58 frames, so every section starts on a downbeat.

| Section | Bars | Time |
|---|---|---|
| Hook — cover, the room empties on "solo sport" | 3 | 0:00.0–0:05.8 |
| The problem | 6 | 0:05.8–0:17.4 |
| The Pit — experience layer on Panta, four steps | 6 | 0:17.4–0:29.0 |
| Who it's for | 3 | 0:29.0–0:34.8 |
| 01 Sign in with X | 4 | 0:34.8–0:42.5 |
| 02 Take a seat (escrow, hidden call) | 6 | 0:42.5–0:54.1 |
| 03 Trade live (Panta's line, room odds, ticket) | 5 | 0:54.1–1:03.8 |
| 04 Royale cut + Oracle read | 5 | 1:03.8–1:13.5 |
| 05 The bell + prize split | 4 | 1:13.5–1:21.2 |
| 06 Withdraw with your own signature | 4 | 1:21.2–1:28.9 |
| 07 Host: Panta market / new market, code, QR, overlay | 5 | 1:28.9–1:38.6 |
| Under the hood (Panta API, LMSR, Solana escrow) | 7 | 1:38.6–1:52.1 |
| Formats & fees | 2 | 1:52.1–1:56.0 |
| Close — "Host. Trade. Split." + CTA | 4 | 1:56.0–2:03.7 |

## Example data

All of it is made up. The product runs on Solana devnet with Circle test USDC, and the film says so on screen.

- **Players / X handles:** pit_rookie (you), kai_calls, vault_vera, moonmira, omar_odds, yes_yuki, bellbeto, cam_cutline; chat handles on the problem slide are fictional too
- **Wallet:** `7xKp…3fQa` (a shortened placeholder, not a real address)
- **Pits:** `K7Q2XM` (joined) and `R9V3PQ` (hosted); markets "Will SOL close above $300 on Friday?" and "Will the home team win tonight's final?", plus the other Panta markets in the picker
- **Money:** $2 entry + $10 vault, 8 players, $16 pool, 30 USDC starting balance; trades priced with the app's LMSR maths; payouts and the 0.1% fee follow `lib/royale.ts` and `lib/fees.ts`
- **Oracle read, lobby stats, other pits, poll numbers:** example values
- **QR code:** points at https://www.trythepit.xyz
