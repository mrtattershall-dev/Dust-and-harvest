#!/usr/bin/env python3
"""
build_icons.py — pack the item icons named in tools/icon-map.json into one atlas.

Reads the individual 32x32 PNGs from Franuka's Fantasy RPG Icon Pack and emits:

  assets/icons/items.png   one atlas, 16 icons per row
  assets/icons/items.json  { cell, cols, icons: { itemId: index } }

A single atlas rather than ~90 separate files because the HTML side draws icons
as CSS background-position on a shared image — one request, and no flash of
unstyled slots when a panel opens.

Usage:
  ./tools/build_icons.py /path/to/Fantasy_RPG_icon_pack_by_Franuka
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
MAP = REPO / "tools" / "icon-map.json"
OUT_DIR = REPO / "assets" / "icons"

CELL = 32
COLS = 16

# Where each set's individual icons live inside the pack
SET_DIRS = {
    "base":   "Base set/Individual icons (32x32)",
    "colour": "Expansions/01 - Colour variations/Individual icons (32x32)",
    "fish":   "Expansions/02 - Fishing set/Individual icons (32x32)",
}


def load_map():
    """Flatten the grouped, commented map file into {itemId: 'set:num'}."""
    raw = json.loads(MAP.read_text())
    flat = {}
    for group, entries in raw.items():
        if group.startswith("_") or not isinstance(entries, dict):
            continue
        for k, v in entries.items():
            if k.startswith("_"):
                continue
            if not isinstance(v, str) or ":" not in v:
                sys.exit(f"{group}.{k}: expected 'set:number', got {v!r}")
            flat[k] = v
    return flat


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pack = Path(sys.argv[1])
    if not pack.is_dir():
        sys.exit(f"Not a folder: {pack}")

    mapping = load_map()
    print(f"{len(mapping)} items mapped", file=sys.stderr)

    # Several items share an icon (every seed is one packet), so pack unique
    # sources once and point the duplicates at the same cell.
    order, seen = [], {}
    for item, ref in sorted(mapping.items()):
        if ref not in seen:
            seen[ref] = len(order)
            order.append(ref)

    rows = (len(order) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))

    missing = []
    for i, ref in enumerate(order):
        set_name, num = ref.split(":", 1)
        sub = SET_DIRS.get(set_name)
        if not sub:
            sys.exit(f"Unknown icon set {set_name!r} in {ref}")
        src = pack / sub / f"{num}.png"
        if not src.is_file():
            missing.append(ref)
            continue
        im = Image.open(src).convert("RGBA")
        if im.size != (CELL, CELL):
            im = im.resize((CELL, CELL), Image.NEAREST)
        atlas.paste(im, ((i % COLS) * CELL, (i // COLS) * CELL), im)

    if missing:
        sys.exit(f"Missing source icons: {', '.join(missing)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT_DIR / "items.png")
    json.dump(
        {"cell": CELL, "cols": COLS,
         "icons": {item: seen[ref] for item, ref in sorted(mapping.items())}},
        open(OUT_DIR / "items.json", "w"), indent=1, sort_keys=True)

    print(f"atlas {COLS}x{rows} ({len(order)} unique icons, "
          f"{len(mapping)} items) -> assets/icons/", file=sys.stderr)


if __name__ == "__main__":
    main()
