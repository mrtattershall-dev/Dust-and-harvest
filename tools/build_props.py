#!/usr/bin/env python3
"""
build_props.py — pack the scatter props named in tools/prop-map.json into an atlas.

The game's rock, bush, skull and bone tiles are each one hand-drawn shape
repeated across the whole map. The desert pack ships dozens of named 32x32
variants of exactly those things, so this packs the chosen ones into a single
atlas and records which indices belong to which group. The runtime then picks a
variant per tile from the tile coordinate, giving the map real variety without
any per-tile data.

Emits:
  assets/props/props.png   one atlas, 16 per row
  assets/props/props.json  { cell, cols, groups: { name: [index, ...] } }

Usage:
  ./tools/build_props.py /path/to/deserttilesettopdownpixelart
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
MAP = REPO / "tools" / "prop-map.json"
OUT = REPO / "assets" / "props"

CELL = 32
COLS = 16
SRC_SUB = "PNG/Objects_separately"


def log(m):
    print(m, file=sys.stderr)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pack = Path(sys.argv[1])
    src = pack / SRC_SUB
    if not src.is_dir():
        sys.exit(f"No {SRC_SUB} in {pack}")

    raw = json.loads(MAP.read_text())
    groups = {k: v for k, v in raw.items() if not k.startswith("_")}

    # Pack unique files once; groups can share a variant (a small bush serves
    # both the overworld and the badlands).
    order, seen, missing, wrong_size = [], {}, [], []
    out_groups = {}
    for name, files in groups.items():
        idxs = []
        for f in files:
            if f not in seen:
                p = src / f
                if not p.is_file():
                    missing.append(f)
                    continue
                im = Image.open(p).convert("RGBA")
                if im.size != (CELL, CELL):
                    wrong_size.append(f"{f} is {im.size[0]}x{im.size[1]}")
                    continue
                seen[f] = len(order)
                order.append((f, im))
            idxs.append(seen[f])
        if idxs:
            out_groups[name] = idxs
        log(f"  {name:12s} {len(idxs)} variants")

    for f in missing:
        log(f"  ?? missing source: {f}")
    for w in wrong_size:
        log(f"  !! not 32x32, skipped: {w}")
    if not order:
        sys.exit("No props packed — check the pack path and prop-map.json")

    rows = (len(order) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, (_, im) in enumerate(order):
        atlas.paste(im, ((i % COLS) * CELL, (i // COLS) * CELL), im)

    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "props.png")
    (OUT / "props.json").write_text(json.dumps(
        {"cell": CELL, "cols": COLS, "groups": out_groups}, indent=1, sort_keys=True) + "\n")

    log(f"\natlas {COLS}x{rows} ({len(order)} unique props, "
        f"{len(out_groups)} groups) -> assets/props/")


if __name__ == "__main__":
    main()
