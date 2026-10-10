"""Tile review frames into labelled contact sheets: python3 scripts/contact-sheet.py L 3 640"""
import glob, sys
from PIL import Image, ImageDraw
prefix, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sorted(glob.glob(f"review/{prefix}-*.png"))
per = cols * (3 if prefix == "L" else 2)
for s in range(0, len(files), per):
    chunk = files[s:s + per]
    ims = [Image.open(f).convert("RGB") for f in chunk]
    h = int(ims[0].height * w / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), (20, 20, 20))
    for i, (f, im) in enumerate(zip(chunk, ims)):
        im = im.resize((w, h))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 150, 22], fill=(0, 0, 0))
        d.text((6, 4), f.split("/")[-1], fill=(255, 255, 255))
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    sheet.save(f"review/sheet-{prefix}-{s // per}.png")
    print(f"review/sheet-{prefix}-{s // per}.png")
