#!/usr/bin/env python3
"""Cut the trapper's camp decorations out of the Hunter's Lodge pack.

Run:  ./tools/build_camp.py <path-to-fantasyrpghunterslodge-pack>

Emits assets/camp/camp.png + camp.json — one small atlas of named pieces, each
at its native size, drawn at fixed offsets around Amos by drawTrapper().

Why a third atlas rather than reusing one of the two that exist:

* `assets/props/` is a 32x32 grid keyed by tile coordinate — it scatters a
  variant across every tile of a type. These pieces are 51x58 and 34x47, and
  they belong at one specific place, not scattered.
* `assets/sprites/` is the actor system: cell grids, clips, facings. A static
  crate is none of those.

So: named rects in one PNG, and the caller blits them. Nothing to animate,
nothing to key, nothing to save.

**The tanning animation in this pack is deliberately unused.** Its frames are
48x48 with content filling the cell edge-to-edge (bbox 0,0-40,42), because the
hide rack is drawn into them — it is a scene, not a character clip, unlike the
idle whose content is a 20x26 figure centred in the cell. Feeding it to the
sprite engine would draw a second, clipped hunter on top of Amos. The rack in
this atlas is the same art without that problem.
"""
import json
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "camp"

# Source rects, found by a connected-component scan of Exterior_objects.png
# and then identified by cropping each candidate and looking at it at 4x.
# Identifying them by component index instead put a coil of rope where the
# campfire should be and a pile of kindling where the crate should be — the
# indices are ordered by position, which is not the order anything reads in.
# Left, top, width, height.
PIECES = {
    "rack":      ("Exterior_objects.png",   5, 369, 51, 58),  # hide on an A-frame
    "rack2":     ("Exterior_objects.png",  69, 369, 51, 58),  # the other angle
    "hidecrate": ("Exterior_objects.png", 217, 337, 34, 47),  # folded hide on a crate
    "firewood":  ("Exterior_objects.png", 191, 356, 12, 27),  # split logs
    "fire":      ("Exterior_objects.png", 166, 340, 26, 36),  # fire pit, spit and pot
    "crate":     ("Exterior_objects.png", 291, 424, 25, 34),
    "trap":      ("Trap.png",               0,   0, 32, 32),  # set, first frame
}

PAD = 1   # a transparent gutter, so no piece bleeds into its neighbour


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1]) / "PNG"
    if not src.is_dir():
        raise SystemExit(f"no PNG/ directory under {sys.argv[1]}")

    cut = {}
    for name, (fn, x, y, w, h) in PIECES.items():
        sheet = Image.open(src / fn).convert("RGBA")
        im = sheet.crop((x, y, x + w, y + h))
        bb = im.getbbox()
        if bb is None:
            raise SystemExit(f"'{name}' is empty — the rect is wrong")
        im = im.crop(bb)          # trim to actual content so offsets are honest
        cut[name] = im

    total_w = sum(im.width + PAD for im in cut.values()) + PAD
    max_h = max(im.height for im in cut.values()) + PAD * 2
    atlas = Image.new("RGBA", (total_w, max_h), (0, 0, 0, 0))

    rects, x = {}, PAD
    for name, im in cut.items():
        atlas.alpha_composite(im, (x, PAD))
        rects[name] = [x, PAD, im.width, im.height]
        x += im.width + PAD

    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "camp.png")
    (OUT / "camp.json").write_text(json.dumps({"rects": rects}, indent=1) + "\n")

    for n, r in rects.items():
        print(f"{n:11s} {r[2]:3d}x{r[3]:<3d} at {r[0]},{r[1]}")
    size = (OUT / "camp.png").stat().st_size
    print(f"\n{len(rects)} pieces, {atlas.size[0]}x{atlas.size[1]}, {size/1024:.1f} KB")


if __name__ == "__main__":
    main()
