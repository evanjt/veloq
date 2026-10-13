"""Report how far repeated captures of the same screens differ.

    python3 -I diff.py <dir> [--mask name=x0,y0,x1,y1 ...]

<dir> holds run1, run2, ... each with the same set of png files. For every
screen it prints, over every pair of runs, the share of pixels whose largest
channel difference exceeds the threshold, as max and median, and the bounding
box of the differing pixels. Masks are rectangles in fractions of the image,
applied to the screen whose file name starts with <name>, or to every screen
when <name> is '*'.
"""

import itertools
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image

THRESHOLD = 0


def parse_masks(args):
    masks = []
    for arg in args:
        name, box = arg.split("=")
        masks.append((name, [float(v) for v in box.split(",")]))
    return masks


def main():
    root = Path(sys.argv[1])
    masks = parse_masks(a for a in sys.argv[2:] if a != "--mask")
    runs = sorted(p for p in root.iterdir() if p.is_dir())
    for screen in sorted(p.name for p in runs[0].glob("*.png")):
        images = [np.asarray(Image.open(r / screen).convert("RGB")).astype(int) for r in runs]
        h, w, _ = images[0].shape
        keep = np.ones((h, w), bool)
        for name, (x0, y0, x1, y1) in masks:
            if name == "*" or screen.startswith(name):
                keep[int(y0 * h) : int(y1 * h), int(x0 * w) : int(x1 * w)] = False
        shares = []
        box = None
        for a, b in itertools.combinations(images, 2):
            differs = (np.abs(a - b).max(axis=2) > THRESHOLD) & keep
            shares.append(differs.sum() / keep.sum() * 100)
            ys, xs = np.nonzero(differs)
            if len(ys):
                here = (ys.min() / h, xs.min() / w, ys.max() / h, xs.max() / w)
                box = here if box is None else (
                    min(box[0], here[0]), min(box[1], here[1]),
                    max(box[2], here[2]), max(box[3], here[3]))
        span = "" if box is None else " y %.3f-%.3f x %.3f-%.3f" % (box[0], box[2], box[1], box[3])
        print(f"{screen:28} max {max(shares):7.3f}%  median {statistics.median(shares):7.3f}%{span}")


main()
