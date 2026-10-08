#!/usr/bin/env python3
"""
Contact sheets of a rendered film, for looking at it frame by frame (STORYBOARD §7, check 5).

    node film/render.mjs --frames <frames-dir>
    python3 film/sheets.py <frames-dir> <out-dir>

Writes sheet-every-0.5s-<n>.png (every 15th frame) and one sheet per scene change at 0.1 s (every 3rd frame,
from 0.3 s before it to 0.9 s after). Needs Pillow.
"""
import os
import sys

from PIL import Image, ImageDraw

FPS = 30
# the scene changes (ms), from film/src/timeline.ts
CHANGES = {
    "files-to-list": 2300,
    "others-fade-row-rises": 4150,
    "note-to-table": 7600,
    "phone-in": 9050,
    "welcome-handover": 10800,
    "ok-sent": 12600,
    "console-schedules": 13400,
    "our-answer": 14450,
    "first-day-sent": 15300,
    "pan-to-replies": 15950,
    "replies-arrive": 17800,
    "we-wrote-back": 19050,
    "handoff": 20050,
    "booked": 22350,
    "replies-to-overview": 24450,
    "the-rest-land": 26200,
    "close": 27550,
    "yes": 29350,
    "phone-out-offer": 32200,
    "exit-and-seam": 34750,
}


def sheet(frames_dir, idx, out, cols=4, scale=0.25):
    n = len(os.listdir(frames_dir))
    idx = [i for i in idx if 0 <= i < n]
    ims = [Image.open(os.path.join(frames_dir, f"f{i:04d}.png")).convert("RGB") for i in idx]
    w, h = int(ims[0].width * scale), int(ims[0].height * scale)
    rows = (len(ims) + cols - 1) // cols
    g = Image.new("RGB", (cols * w + (cols - 1) * 4, rows * (h + 16)), (52, 52, 60))
    d = ImageDraw.Draw(g)
    for k, (i, im) in enumerate(zip(idx, ims)):
        x, y = (k % cols) * (w + 4), (k // cols) * (h + 16)
        g.paste(im.resize((w, h), Image.LANCZOS), (x, y + 16))
        d.text((x + 4, y + 2), f"{i / FPS:5.2f} s", fill=(255, 255, 255))
    g.save(out)


def main():
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    n = len(os.listdir(frames_dir))
    every = list(range(0, n, 15))
    per = 24
    for s in range(0, len(every), per):
        sheet(frames_dir, every[s : s + per], os.path.join(out_dir, f"sheet-every-0.5s-{s // per + 1}.png"))
    for name, ms in CHANGES.items():
        f0 = round(ms / 1000 * FPS)
        sheet(frames_dir, list(range(f0 - 9, f0 + 28, 3)), os.path.join(out_dir, f"change-{name}.png"))
    print(f"sheets in {out_dir}")


if __name__ == "__main__":
    main()
