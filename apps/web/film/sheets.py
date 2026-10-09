#!/usr/bin/env python3
"""
Contact sheets of a rendered film, for looking at it frame by frame (STORYBOARD §7, check 5).

    node film/render.mjs --trade <trade> --frames <frames-dir>
    python3 film/sheets.py <frames-dir> <out-dir> [<trade>]

Writes sheet-every-0.5s-<n>.png (every 15th frame) and one sheet per scene change at 0.1 s (every 3rd frame,
from 0.3 s before it to 0.9 s after), and motion.txt: how much the picture changes from each frame to the next (mean
absolute grey difference at 640 px wide), its largest, and any frame that changes more than three times as much as
its neighbours (a jump). Needs Pillow.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageStat

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


# a one pass (fence, tree) shows its hand-off in two views (0.75 s longer: its end at 22.05 s), closes on the pass's
# last text with no YES, the console answering it (what he paid) instead (film/src/timeline.ts): its phone leaves 1.3 s
# sooner, and its offer holds 0.2 s longer
ONE_PASS = {"fence", "tree", "painting"}
HANDOFF = 750


def changes_for(trade):
    if trade not in ONE_PASS:
        return CHANGES
    out = {k: v for k, v in CHANGES.items() if k != "yes"}
    for k in ("booked", "replies-to-overview", "the-rest-land", "close"):
        out[k] += HANDOFF
    out["handoff-end"] = 22050
    out["charges"] = 29900
    out["phone-out-offer"] -= 1300
    out["exit-and-seam"] -= 1100
    return out


def motion(frames_dir, out):
    names = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    prev = None
    diffs = []
    for f in names:
        im = Image.open(os.path.join(frames_dir, f)).convert("L")
        im = im.resize((640, round(640 * im.height / im.width)), Image.BILINEAR)
        if prev is not None:
            diffs.append(ImageStat.Stat(ImageChops.difference(im, prev)).mean[0])
        prev = im
    jumps = [i + 1 for i in range(1, len(diffs) - 1) if diffs[i] > 0.6 and diffs[i] > 3 * max(diffs[i - 1], diffs[i + 1])]
    top = sorted(range(len(diffs)), key=lambda i: -diffs[i])[:8]
    with open(out, "w") as fh:
        fh.write(f"frames {len(names)}; largest frame-to-frame change {max(diffs):.2f} (mean abs grey, 640 px)\n")
        fh.write("largest: " + ", ".join(f"{(i + 1) / FPS:.2f} s {diffs[i]:.2f}" for i in top) + "\n")
        fh.write("jumps (over 3x both neighbours): " + (", ".join(f"{i / FPS:.2f} s" for i in jumps) or "none") + "\n")
    print(open(out).read())


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
    trade = sys.argv[3] if len(sys.argv) > 3 else "lawn"
    os.makedirs(out_dir, exist_ok=True)
    n = len(os.listdir(frames_dir))
    every = list(range(0, n, 15))
    per = 24
    for s in range(0, len(every), per):
        sheet(frames_dir, every[s : s + per], os.path.join(out_dir, f"sheet-every-0.5s-{s // per + 1}.png"))
    for name, ms in changes_for(trade).items():
        f0 = round(ms / 1000 * FPS)
        sheet(frames_dir, list(range(f0 - 9, f0 + 28, 3)), os.path.join(out_dir, f"change-{name}.png"))
    motion(frames_dir, os.path.join(out_dir, "motion.txt"))
    print(f"sheets in {out_dir}")


if __name__ == "__main__":
    main()
