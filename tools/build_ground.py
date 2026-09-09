#!/usr/bin/env python3
"""
build_ground.py — bake the desert pack's sand surface into wrap-seamless textures.

The pack's sand is not a set of tiles you can pick from. Its ground is one flat
colour and every bit of texture lives in `spots.png`, a sheet of loose mottling
blobs meant to be strewn over that colour. So there is nothing to slice into
32x32 cells: the honest import is to lift the blobs out and re-scatter them.

This scatters them onto a square texture whose width is a whole number of game
tiles, wrapping every blob at the edges. The runtime then samples the window at
(tx*T mod P, ty*T mod P), so neighbouring tiles show neighbouring pieces of one
continuous surface. No tile grid, no repeated cell, no seams — which a per-tile
variant set could not give, because sand has no per-tile structure to repeat.

Blobs are extracted as connected components, never as rectangles, so a blob is
always whole. That is what keeps the wrap invisible: there is no cut edge to
line up.

Emits:
  assets/ground/ground.png   terrains stacked vertically, P px each
  assets/ground/ground.json  { period, tile, terrains: { name: {oy} } }

Usage:
  ./tools/build_ground.py /path/to/deserttilesettopdownpixelart
"""

import json
import random
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "ground"

TILE = 32          # the game's T
PERIOD = 512       # 16 tiles; must stay a multiple of TILE so a tile never straddles
SEED = 20260909    # fixed, so rebuilds are byte-identical

# The two tones in spots.png, measured off the sheet.
TONE_DARK = (174, 138, 90)
TONE_SOFT = (194, 160, 98)
PACK_SAND = (210, 178, 104)   # the pack's own flat ground colour

# base     — the flat colour under everything
# clusters — patches of mottling; sand clumps, it does not speckle evenly
# per      — blobs dropped around each cluster centre
# spread   — how far from the centre they land, in pixels
# loose    — extra blobs strewn uniformly, to keep the gaps from reading as bald
#
# DUSTFLOOR keeps the game's established badlands colour rather than the pack's,
# so the badlands does not shift hue; the blobs are re-tinted by the same delta
# to preserve the contrast the artist drew.
TERRAINS = {
    "sand": {"base": PACK_SAND,       "clusters": 26, "per": 14, "spread": 34, "loose": 90},
    "dust": {"base": (200, 168, 112), "clusters": 20, "per": 12, "spread": 38, "loose": 70},
}


def log(m):
    print(m, file=sys.stderr)


def extract_blobs(sheet):
    """Every connected run of opaque pixels, as its own cropped RGBA image."""
    px = sheet.load()
    w, h = sheet.size
    seen = bytearray(w * h)
    blobs = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0 * w + x0] or px[x0, y0][3] < 8:
                continue
            q = deque([(x0, y0)])
            seen[y0 * w + x0] = 1
            cells = []
            while q:
                x, y = q.popleft()
                cells.append((x, y))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if (0 <= nx < w and 0 <= ny < h
                                and not seen[ny * w + nx] and px[nx, ny][3] >= 8):
                            seen[ny * w + nx] = 1
                            q.append((nx, ny))
            xs = [c[0] for c in cells]
            ys = [c[1] for c in cells]
            bx, by = min(xs), min(ys)
            bw, bh = max(xs) - bx + 1, max(ys) - by + 1
            im = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
            ip = im.load()
            for x, y in cells:
                ip[x - bx, y - by] = px[x, y]
            blobs.append(im)
    return blobs


def tone_of(blob):
    """Which of the two families this blob belongs to, by nearest colour."""
    px = blob.load()
    for y in range(blob.size[1]):
        for x in range(blob.size[0]):
            p = px[x, y]
            if p[3] >= 8:
                d = sum((p[i] - TONE_DARK[i]) ** 2 for i in range(3))
                s = sum((p[i] - TONE_SOFT[i]) ** 2 for i in range(3))
                return "dark" if d <= s else "soft"
    return "soft"


def retint(blob, delta):
    if delta == (0, 0, 0):
        return blob
    out = blob.copy()
    px = out.load()
    for y in range(out.size[1]):
        for x in range(out.size[0]):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (max(0, min(255, r + delta[0])),
                            max(0, min(255, g + delta[1])),
                            max(0, min(255, b + delta[2])), a)
    return out


def stamp_wrapped(canvas, blob, x, y):
    """Paste so anything crossing an edge reappears on the opposite side."""
    p = canvas.size[0]
    bw, bh = blob.size
    for ox in (0, -p) if x + bw > p else (0,):
        for oy in (0, -p) if y + bh > p else (0,):
            canvas.alpha_composite(blob, (x + ox, y + oy))


def bake(name, cfg, pools, rng):
    base = cfg["base"]
    delta = tuple(base[i] - PACK_SAND[i] for i in range(3))
    canvas = Image.new("RGBA", (PERIOD, PERIOD), base + (255,))

    def drop(tone, x, y):
        pool = pools[tone]
        if not pool:
            return 0
        blob = retint(rng.choice(pool), delta)
        if rng.random() < 0.5:
            blob = blob.transpose(Image.FLIP_LEFT_RIGHT)
        if rng.random() < 0.5:
            blob = blob.transpose(Image.FLIP_TOP_BOTTOM)
        stamp_wrapped(canvas, blob, x % PERIOD, y % PERIOD)
        return 1

    for tone in ("soft", "dark"):
        if not pools[tone]:
            log(f"  !! no '{tone}' blobs in the sheet — skipping that layer")

    placed = 0
    # Clustered mottling: a patch is a centre with blobs falling off around it,
    # densest in the middle. Softer tone underneath, stronger on top.
    for _ in range(cfg["clusters"]):
        cx, cy = rng.randrange(PERIOD), rng.randrange(PERIOD)
        spread = cfg["spread"]
        for i in range(cfg["per"]):
            tone = "dark" if rng.random() < 0.3 else "soft"
            placed += drop(tone,
                           round(cx + rng.gauss(0, spread)),
                           round(cy + rng.gauss(0, spread)))
    # Loose grains between the patches.
    for _ in range(cfg["loose"]):
        tone = "dark" if rng.random() < 0.25 else "soft"
        placed += drop(tone, rng.randrange(PERIOD), rng.randrange(PERIOD))

    log(f"  {name:6s} base rgb{base}  {placed} blobs "
        f"({cfg['clusters']} patches + {cfg['loose']} loose)")
    return canvas


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]) / "PNG" / "spots.png"
    if not src.is_file():
        sys.exit(f"No PNG/spots.png in {sys.argv[1]} — is that the desert pack?")

    if PERIOD % TILE:
        sys.exit(f"PERIOD {PERIOD} must be a multiple of TILE {TILE}")

    blobs = extract_blobs(Image.open(src).convert("RGBA"))
    pools = {"dark": [], "soft": []}
    for b in blobs:
        pools[tone_of(b)].append(b)
    log(f"spots.png -> {len(blobs)} blobs "
        f"({len(pools['dark'])} dark, {len(pools['soft'])} soft)")

    rng = random.Random(SEED)
    names = sorted(TERRAINS)
    sheet = Image.new("RGBA", (PERIOD, PERIOD * len(names)), (0, 0, 0, 0))
    meta = {}
    for i, name in enumerate(names):
        sheet.paste(bake(name, TERRAINS[name], pools, rng), (0, i * PERIOD))
        meta[name] = {"oy": i * PERIOD}

    OUT.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(OUT / "ground.png", optimize=True)
    (OUT / "ground.json").write_text(json.dumps(
        {"period": PERIOD, "tile": TILE, "terrains": meta},
        indent=1, sort_keys=True) + "\n")

    kb = (OUT / "ground.png").stat().st_size / 1024
    log(f"\n{len(names)} terrains, {PERIOD}px period "
        f"({PERIOD // TILE} tiles) -> assets/ground/  [{kb:.0f} KB]")


if __name__ == "__main__":
    main()
