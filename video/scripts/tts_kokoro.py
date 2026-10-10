"""Synthesise narration lines with Kokoro-82M (Apache-2.0), one WAV per line.

  .tts-venv/bin/python scripts/tts_kokoro.py lines.json out_dir af_heart 1.0

lines.json: [{"id": "...", "say": "..."}]. Writes <out_dir>/<id>.raw.wav (24 kHz, trimmed).
"""
import json, sys, warnings
warnings.filterwarnings("ignore")
import numpy as np
import soundfile as sf
from kokoro import KPipeline

lines_path, out_dir, voice, speed = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
SR = 24000
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")

def trim(y, thresh_db=-42.0, pad=0.035):
    env = np.abs(y)
    k = int(0.01 * SR)
    sm = np.convolve(env, np.ones(k) / k, mode="same")
    on = np.where(sm > 10 ** (thresh_db / 20))[0]
    if len(on) == 0:
        return y
    a = max(0, on[0] - int(pad * SR))
    b = min(len(y), on[-1] + int(pad * 2 * SR))
    return y[a:b]

for line in json.load(open(lines_path)):
    parts = []
    for _, _, audio in pipe(line["say"], voice=voice, speed=speed):
        a = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
        parts.append(a.astype(np.float32))
        parts.append(np.zeros(int(0.12 * SR), dtype=np.float32))
    y = trim(np.concatenate(parts))
    sf.write(f"{out_dir}/{line['id']}.raw.wav", y, SR)
    print(f"{line['id']}\t{len(y) / SR:.2f}s", flush=True)
