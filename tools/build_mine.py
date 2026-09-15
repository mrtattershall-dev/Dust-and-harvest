#!/usr/bin/env python3
"""
build_mine.py — pack the Miner's Cave tiles named in tools/mine-map.json.

Both mines were drawn in flat fillRect colours. The pack ships a 32x32 master
tileset at exactly the game's tile size, so unlike the jungle — where sprites
had to be cut out of scene sheets by connected region — every piece here is
already a grid cell and the map addresses it as [col, row].

Two kinds of entry:

  tiles    one 32x32 cell, drawn at the tile's top-left, no anchor. Floors,
           walls, veins, rails.
  sprites  several cells stacked, anchored bottom-centre so the thing stands on
           its tile and overhangs upward. A minecart is 32x64.

An empty cell is a build error rather than a silently missing sprite: a pack
revision that shifts its grid should fail here, not draw holes in the mine.

Emits:
  assets/mine/mine.png   one atlas, 16 per row
  assets/mine/mine.json  { groups: { name: [ {x,y,w,h,ax,ay}, ... ] } }

which is the same shape assets/js/jungle.js and props.js already consume.

Usage:
  ./tools/build_mine.py /path/to/unpacked/miners-cave-pack
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
MAP = REPO / "tools" / "mine-map.json"
OUT_DIR = REPO / "assets" / "mine"
PER_ROW = 16


def log(m):
    print("  " + m)


def main(pack_root):
    pack_root = Path(pack_root)
    spec = json.loads(MAP.read_text())
    cell = spec.get("cell", 32)

    src_path = pack_root / spec["source"]
    if not src_path.exists():
        sys.exit(f"no {spec['source']} under {pack_root}")
    sheet = Image.open(src_path).convert("RGBA")
    cols, rows = sheet.width // cell, sheet.height // cell
    log(f"source {spec['source']}  {cols}x{rows} cells of {cell}px")

    def crop(cx, cy, h_cells=1):
        if cx >= cols or cy + h_cells > rows:
            sys.exit(f"cell [{cx},{cy}] is outside the {cols}x{rows} sheet")
        return sheet.crop((cx * cell, cy * cell,
                           (cx + 1) * cell, (cy + h_cells) * cell))

    # name -> list of (image, anchor_x, anchor_y)
    collected = {}

    for group, cells in spec.get("tiles", {}).items():
        items = []
        for cx, cy in cells:
            im = crop(cx, cy)
            if not im.getbbox():
                sys.exit(f"{group}: cell [{cx},{cy}] is empty — has the pack's grid moved?")
            items.append((im, 0, 0))          # top-left placement, no anchor
        collected[group] = items
        log(f"{group}: {len(items)} tiles")

    for group, entries in spec.get("sprites", {}).items():
        items = []
        for entry in entries:
            cs = entry["cells"]
            cx = cs[0][0]
            top = min(c[1] for c in cs)
            if any(c[0] != cx for c in cs):
                sys.exit(f"{group}: sprite cells must share a column")
            im = crop(cx, top, len(cs))
            if not im.getbbox():
                sys.exit(f"{group}: sprite at [{cx},{top}] is empty")
            # Bottom-centre: it stands on its tile and rises above it.
            items.append((im, im.width // 2, im.height))
        collected[group] = items
        log(f"{group}: {len(items)} sprites of {items[0][0].size[0]}x{items[0][0].size[1]}")

    flat = [(g, im, ax, ay) for g, items in collected.items() for (im, ax, ay) in items]
    if not flat:
        sys.exit("nothing to pack — is tools/mine-map.json empty?")

    # Shelf pack, one row per PER_ROW sprites. Rows are as tall as their tallest
    # member, which keeps a 64px minecart from padding every floor tile.
    rows_of = [flat[i:i + PER_ROW] for i in range(0, len(flat), PER_ROW)]
    width = max(sum(im.width for _, im, _, _ in r) for r in rows_of)
    height = sum(max(im.height for _, im, _, _ in r) for r in rows_of)
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    groups = {}
    y = 0
    for r in rows_of:
        x = 0
        row_h = max(im.height for _, im, _, _ in r)
        for group, im, ax, ay in r:
            atlas.alpha_composite(im, (x, y))
            groups.setdefault(group, []).append(
                {"x": x, "y": y, "w": im.width, "h": im.height, "ax": ax, "ay": ay})
            x += im.width
        y += row_h

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT_DIR / "mine.png")
    (OUT_DIR / "mine.json").write_text(
        json.dumps({"groups": groups}, indent=1, sort_keys=True) + "\n")

    total = sum(len(v) for v in groups.values())
    kb = (OUT_DIR / "mine.png").stat().st_size / 1024
    print(f"\nwrote {(OUT_DIR / 'mine.png').relative_to(REPO)}  "
          f"{atlas.width}x{atlas.height}, {total} sprites in {len(groups)} groups, {kb:.0f}KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
