#!/usr/bin/env python3
"""
build_tower.py — import the Mage Tower pack's characters as game actors.

The pack is a top-down scene set: its people sit and read and gesture, and every
character sheet is a single row. There is no up/left/right art anywhere in it,
so none of these can drive a character who walks — the game's own townsfolk
sheets (citizen1-5, folk_*) are the four-facing ones. What these are good for is
standing still and looking like they were drawn by a person, which is exactly
what the player sprite is being measured against.

So each is registered with all four dirRows pointing at row 0, and marked
`singleFacing` in the manifest so nothing later mistakes that for a mistake.

The `_without_shadow` variants are the ones taken: the game draws its own
shadow ellipse under everything, and two shadows read as a smudge.

The anchor is the union of every frame's bounding box rather than frame 0's, so
an actor whose sleeve swings wide on frame 7 doesn't jitter against its own
anchor for the rest of the loop.

Emits, per actor:
  assets/sprites/npcs/<id>/idle.png
  assets/sprites/npcs/<id>/walk.png   (the same frames — they have no walk)
and merges entries into assets/sprites/manifest.json.

Usage:
  ./tools/build_tower.py /path/to/unpacked/mage-tower-pack
"""

import json
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "sprites"
MANIFEST = OUT / "manifest.json"

# id -> (source relative path, fps). The cell size is measured, not declared —
# see detect_cell_width. Guessing it wrong is silent: a cell twice too wide just
# draws two characters side by side and looks like a rendering bug.
SOURCES = {
    "tower_mage1":  ("PNG/Mages/Mage1_without_shadow.png", 8),
    "tower_mage2":  ("PNG/Mages/Mage2_without_shadow.png", 8),
    "tower_reader": ("PNG/Readers/Reader1.png",            8),
}


def detect_cell_width(im):
    """Smallest frame width whose every boundary lands on empty pixels.

    Frames on these sheets are separated by fully transparent columns, so a
    candidate width is only plausible if each of its cut lines falls in one.
    Take the smallest such width: any multiple of a real frame width also
    passes, and picking the largest is how you end up with two mages in a cell.
    """
    w, h = im.size
    px = im.load()
    empty = {x for x in range(w) if all(px[x, y][3] == 0 for y in range(h))}
    for cw in (8, 16, 24, 32, 48, 64, 96, 128):
        if w % cw or cw > w:
            continue
        if all((k * cw) in empty or (k * cw - 1) in empty for k in range(1, w // cw)):
            return cw
    return w


def union_bbox(im, cw, ch, cols):
    """Bounding box covering every frame, in cell-local coordinates."""
    box = None
    for i in range(cols):
        b = im.crop((i * cw, 0, (i + 1) * cw, ch)).getbbox()
        if not b:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]),
            max(box[2], b[2]), max(box[3], b[3]),
        )
    return box


def main(src_root):
    src_root = Path(src_root)
    if not src_root.is_dir():
        sys.exit(f"not a directory: {src_root}")

    manifest = json.loads(MANIFEST.read_text())
    actors = manifest.setdefault("actors", {})

    for actor_id, (rel, fps) in SOURCES.items():
        src = src_root / rel
        if not src.exists():
            print(f"  skip {actor_id}: no {rel}")
            continue
        im = Image.open(src).convert("RGBA")
        cw = detect_cell_width(im)
        ch = im.height
        cols, rows = im.width // cw, 1

        box = union_bbox(im, cw, ch, cols)
        if not box:
            sys.exit(f"{rel}: every frame is empty")

        dest = OUT / "npcs" / actor_id
        dest.mkdir(parents=True, exist_ok=True)
        im.save(dest / "idle.png")
        # No walk art in the pack. Point walk at the same frames rather than
        # leaving the clip out, so anything that asks for a walk still draws.
        shutil.copyfile(dest / "idle.png", dest / "walk.png")

        actors[actor_id] = {
            "anchor": {"x": box[0], "y": box[1],
                       "w": box[2] - box[0], "h": box[3] - box[1]},
            "cellW": cw,
            "cellH": ch,
            "clips": {
                "idle": {"file": "idle.png", "frames": cols, "loop": True},
                "walk": {"file": "walk.png", "frames": cols, "loop": True},
            },
            # One row of art, so every facing reads the same row.
            "dirRows": {"down": 0, "up": 0, "left": 0, "right": 0},
            "singleFacing": True,
            "fps": fps,
            "group": "npcs",
            "path": f"npcs/{actor_id}",
        }
        print(f"  {actor_id}: {cols} frames of {cw}x{ch}, anchor {actors[actor_id]['anchor']}")

    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    print(f"wrote {MANIFEST.relative_to(REPO)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
