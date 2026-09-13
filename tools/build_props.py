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

import colorsys
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


# Groups baked by recolouring another group rather than from their own files.
#
# TL.STONE (574 tiles — the massif around the mine, and boulders through the
# wilderness) was 574 identical flat grey rounded rectangles on a rigid grid.
# The desert pack has no cliff or mountain art at this density: its big rocks
# are 64px stacked cairns with grass tufts baked into their bases, which suit
# neither a mountain face nor stone ground.
#
# What it does have is 24 good 32px boulders — already the `rock` group, used
# by the gatherable TL.ROCK. Pointing STONE at them directly would make the
# scenery you cannot mine identical to the node you can, which is a real
# readability loss. So STONE gets the same silhouettes, recoloured cold: same
# variety, obviously different material, and the distinction survives.
#
# dl shifts lightness, sr scales saturation. Hue is left alone — these are the
# artist's own shapes and shading, only the material changes.
DERIVED = {
    "stonewall": {"from": "rock", "dl": -0.08, "sr": 0.35},
}


def recolour(im, dl, sr):
    out = im.copy()
    px = out.load()
    for y in range(out.size[1]):
        for x in range(out.size[0]):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            l = max(0.0, min(1.0, l + dl))
            s = max(0.0, min(1.0, s * sr))
            nr, ng, nb = colorsys.hls_to_rgb(h, l, s)
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


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

    # Derived groups reuse the already-loaded images, recoloured.
    for name, spec in DERIVED.items():
        base = groups.get(spec["from"])
        if not base:
            log(f"  ?? derived '{name}': no source group '{spec['from']}'")
            continue
        idxs = []
        for f in base:
            if f not in seen:
                continue
            tinted = recolour(order[seen[f]][1], spec["dl"], spec["sr"])
            idxs.append(len(order))
            order.append((f + f"#{name}", tinted))
        if idxs:
            out_groups[name] = idxs
            log(f"  {name:12s} {len(idxs)} variants (recoloured from '{spec['from']}')")

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
