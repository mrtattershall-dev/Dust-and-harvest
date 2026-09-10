#!/usr/bin/env python3
"""
build_jungle.py — pack the jungle's art into an atlas.

The jungle zone was the only part of the game with no art at all: 168 fillRect
calls and zero drawImage. This packs trees, bushes, rocks and lianas out of the
delivered packs into one atlas so drawJGTile can draw them.

Unlike props.png these sprites are not uniform 32x32 — a large tree is roughly
2x2.5 tiles — so the atlas is a variable-rect pack and the JSON records each
sprite's rect plus an anchor. The anchor is the bottom-centre of the sprite:
trees are drawn with their trunk on the tile, canopy overhanging upward, which
is what makes a top-down forest read as having height.

Emits:
  assets/jungle/jungle.png   one atlas
  assets/jungle/jungle.json  { groups: { name: [ {x,y,w,h,ax,ay}, ... ] } }

Usage:
  ./tools/build_jungle.py --herbalist DIR --rocky DIR
"""

import argparse
import json
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
MAP = REPO / "tools" / "jungle-map.json"
OUT = REPO / "assets" / "jungle"
ALPHA = 30
PAD = 1          # transparent gutter so neighbours never bleed when scaled


def log(m):
    print(m, file=sys.stderr)


def cut_sheet(path, min_px):
    """Every connected opaque region in the sheet, largest area first."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    found = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or px[sx, sy][3] < ALPHA:
                continue
            q = deque([(sx, sy)])
            seen[sy * w + sx] = 1
            x0 = x1 = sx
            y0 = y1 = sy
            n = 0
            while q:
                x, y = q.popleft()
                n += 1
                x0 = min(x0, x); x1 = max(x1, x)
                y0 = min(y0, y); y1 = max(y1, y)
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny*w+nx] and px[nx,ny][3] >= ALPHA:
                        seen[ny*w+nx] = 1
                        q.append((nx, ny))
            if n >= min_px:
                found.append((x0, y0, x1-x0+1, y1-y0+1))
    found.sort(key=lambda r: -(r[2] * r[3]))
    return im, found


def collect(args):
    """Resolve the map into { group: [Image, ...] }, in map order."""
    raw = json.loads(MAP.read_text())
    packs = {"herbalist": args.herbalist, "rocky": args.rocky,
             "fishing": args.fishing, "greenforest": args.greenforest}
    groups, problems = {}, []

    for sheet_name, spec in raw.get("sheets", {}).items():
        root = packs.get(spec["pack"])
        if not root:
            problems.append(f"no --{spec['pack']} directory given")
            continue
        path = Path(root) / spec["file"]
        if not path.is_file():
            problems.append(f"missing sheet {path}")
            continue
        im, rects = cut_sheet(path, spec.get("minPx", 64))
        log(f"{sheet_name}: {len(rects)} sprites cut from {spec['file']}")
        for group, entries in spec["groups"].items():
            for idx, want in entries:
                if idx >= len(rects):
                    problems.append(f"{group}[{idx}] out of range ({len(rects)} cut)")
                    continue
                x, y, w, h = rects[idx]
                got = f"{w}x{h}"
                if got != want:
                    problems.append(f"{group}[{idx}] is {got}, map says {want} — pack changed?")
                    continue
                groups.setdefault(group, []).append(im.crop((x, y, x+w, y+h)))

    # Ground fill: fixed crops, drawn at the tile's top-left rather than anchored.
    for tile_name, spec in raw.get("tiles", {}).items():
        root = packs.get(spec["pack"])
        if not root:
            problems.append(f"no --{spec['pack']} directory given")
            continue
        path = Path(root) / spec["file"]
        if not path.is_file():
            problems.append(f"missing tile sheet {path}")
            continue
        im = Image.open(path).convert("RGBA")
        cell = spec.get("cell", 32)
        for group, coords in spec["groups"].items():
            for x, y in coords:
                if x + cell > im.width or y + cell > im.height:
                    problems.append(f"{group} crop at ({x},{y}) runs off {spec['file']}")
                    continue
                groups.setdefault(group, []).append(im.crop((x, y, x + cell, y + cell)))
        log(f"{tile_name}: {sum(len(v) for v in spec['groups'].values())} tiles from {spec['file']}")

    # Animation frames are cut at a fixed pitch rather than by connected region:
    # the campfire's five frames touch, so a region cut returns them as one blob.
    for strip_name, spec in raw.get("strips", {}).items():
        root = packs.get(spec["pack"])
        if not root:
            problems.append(f"no --{spec['pack']} directory given")
            continue
        path = Path(root) / spec["file"]
        if not path.is_file():
            problems.append(f"missing strip {path}")
            continue
        im = Image.open(path).convert("RGBA")
        fw, fh = spec["frameW"], spec["frameH"]
        for f in spec["frames"]:
            x = spec["x"] + f * fw
            y = spec["y"]
            if x + fw > im.width or y + fh > im.height:
                problems.append(f"{strip_name} frame {f} runs off the sheet")
                continue
            groups.setdefault(spec["group"], []).append(im.crop((x, y, x + fw, y + fh)))
        log(f"{strip_name}: {len(spec['frames'])} frames from {spec['file']}")

    for pack_name, spec in raw.get("files", {}).items():
        root = packs.get(spec["pack"])
        if not root:
            problems.append(f"no --{spec['pack']} directory given")
            continue
        base = Path(root) / spec["dir"]
        for group, names in spec["groups"].items():
            for n in names:
                p = base / n
                if not p.is_file():
                    problems.append(f"missing {p}")
                    continue
                groups.setdefault(group, []).append(Image.open(p).convert("RGBA"))

    return groups, problems


def pack(groups):
    """Shelf-pack the sprites, tallest first, into a power-of-two-wide atlas."""
    items = [(g, i, im) for g, ims in groups.items() for i, im in enumerate(ims)]
    items.sort(key=lambda t: -t[2].height)
    width = 512
    x = y = shelf = 0
    placed = []
    for g, i, im in items:
        w, h = im.width + PAD, im.height + PAD
        if x + w > width:
            x = 0
            y += shelf
            shelf = 0
        placed.append((g, i, im, x, y))
        x += w
        shelf = max(shelf, h)
    height = y + shelf

    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    out = {}
    for g, i, im, px, py in placed:
        atlas.paste(im, (px, py), im)
        out.setdefault(g, []).append({
            "x": px, "y": py, "w": im.width, "h": im.height,
            # anchor: bottom centre — the sprite's footprint sits on the tile
            "ax": im.width // 2, "ay": im.height,
        })
    return atlas, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--herbalist", help="Herbalist's Hut pack root")
    ap.add_argument("--rocky", help="Rocky tileset pack root")
    ap.add_argument("--fishing", help="Fishing Village pack root")
    ap.add_argument("--greenforest", help="Green Forest tileset pack root")
    args = ap.parse_args()

    groups, problems = collect(args)
    for p in problems:
        log(f"  !! {p}")
    if not groups:
        sys.exit("Nothing packed — check the pack paths.")

    atlas, out = pack(groups)
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "jungle.png")
    (OUT / "jungle.json").write_text(
        json.dumps({"groups": out}, indent=1, sort_keys=True) + "\n")

    log("")
    for g in sorted(out):
        log(f"  {g:11s} {len(out[g]):2d} variants")
    log(f"\natlas {atlas.width}x{atlas.height} -> assets/jungle/")
    if problems:
        sys.exit(f"\n{len(problems)} problem(s) above — atlas written anyway.")


if __name__ == "__main__":
    main()
