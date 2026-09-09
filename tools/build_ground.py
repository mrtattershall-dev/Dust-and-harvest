#!/usr/bin/env python3
"""
build_ground.py — bake the packs' ground art into wrap-seamless textures.

None of these packs ship ground you can slice into 32x32 game tiles, but they
fail to in two different ways, so this bakes two different ways.

  scatter — the desert pack's ground is one flat colour with loose mottling
            strewn over it in `spots.png`. The blobs are lifted out as connected
            components (never rectangles, so a blob is always whole) and
            re-scattered in clusters.

  mosaic  — the farmland and farm packs ship small textured ground cells that
            are mutually seamless: any one can follow any other in either
            direction with no visible join. Verified, not assumed — see
            "Mutual seams" below. They are laid as a random mosaic, clumped so
            the variants form patches rather than static.

Either way the result is one square texture whose width is a whole number of
game tiles, wrapping at the edges. The runtime samples the window at
(tx*T mod P, ty*T mod P), so neighbouring tiles show neighbouring pieces of one
continuous surface: no tile grid, no repeated cell, no seams.

Emits:
  assets/ground/ground.png   terrains stacked vertically, P px each
  assets/ground/ground.json  { period, tile, terrains: { name: {oy, base} } }

Usage — pass the pack folders in any order; each source is found by the file it
must contain, so the folder names do not matter:

  ./tools/build_ground.py ~/packs/deserttileset ~/packs/topdownfarmlands \
                          ~/packs/topdownfarmwithanimals
"""

import colorsys
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
PERIOD = 512       # 16 tiles; must stay a multiple of TILE and of CELL
CELL = 16          # the packs' native tile size — every one of them is 16px
SEED = 20260909    # fixed, so rebuilds are byte-identical

# Source sheets, each found by its path inside whichever pack folder holds it.
SOURCES = {
    "spots":     "PNG/spots.png",
    "farmland":  "All Tileset/16x16.png",
    "forest":    "All Tileset/16x16.png",
    "farmyard":  "PNG/ground_grass_bricks.png",
}
# Two packs ship a file at the same path, so each is pinned to the pack folder
# whose name contains this.
SOURCE_PACK = {"farmland": "farmlands", "forest": "greenforest"}

# The two tones in spots.png, measured off the sheet.
TONE_DARK = (174, 138, 90)
TONE_SOFT = (194, 160, 98)
PACK_SAND = (210, 178, 104)   # the desert pack's own flat ground colour

# Cells are (row, col) at CELL px. Only mutually-seamless cells may share a
# list; `--check` re-measures that and refuses to build if it stops holding.
TERRAINS = {
    # -- scatter: flat base + mottling ------------------------------------
    "sand": {"kind": "scatter", "hue":   0, "sat": 1.00,
             "clusters": 26, "per": 14, "spread": 34, "loose": 90},
    "dust": {"kind": "scatter", "hue": -13, "sat": 1.12,
             "clusters": 22, "per": 13, "spread": 38, "loose": 78},

    # -- mosaic: interchangeable textured cells ---------------------------
    # Grass. Every pack delivered was surveyed for ground; the whole library
    # holds exactly one outdoor turf, shared by the farmlands, green forest,
    # green village and green dungeon tilesets. These six cells are all of it
    # that joins seamlessly — the rest of the library's 57 native grass cells
    # were measured and rejected. See docs/ART-PIPELINE.md.
    "grass": {"kind": "mosaic",
              "cells": [("farmland", 0, 0), ("farmland", 0, 1),
                        ("farmland", 0, 2), ("farmland", 0, 3),
                        ("forest", 0, 8)],    # one variant only greenforest has
              "clump": 0.72, "hue": 0, "sat": 1.00},
    # Dirt: packed earth with small clumps. (14,10) and (21,7) are the same
    # cell in the sheet, so it is listed once.
    "dirt":  {"kind": "mosaic",
              "cells": [("farmyard", 14, 9), ("farmyard", 14, 10),
                        ("farmyard", 15, 9), ("farmyard", 15, 10)],
              "clump": 0.65, "hue": 0, "sat": 1.00},
}


def log(m):
    print(m, file=sys.stderr)


# ── sources ──────────────────────────────────────────────────────────────────

def locate(roots):
    """Find each source sheet under whichever of the given folders holds it."""
    found = {}
    for name, rel in SOURCES.items():
        want = SOURCE_PACK.get(name)
        for root in roots:
            if want and want not in root.name.lower():
                continue
            hits = [p for p in root.rglob(Path(rel).name)
                    if p.as_posix().endswith(rel) and "__MACOSX" not in p.as_posix()]
            if hits:
                found[name] = Image.open(sorted(hits)[0]).convert("RGBA")
                log(f"  {name:9s} <- {hits[0].relative_to(root.parent)}")
                break
    return found


def check_native(name, im):
    """Refuse a sheet that is an upscale of smaller art.

    Most of these packs ship the same tileset at 1x/2x/3x/4x, and the RPG Maker
    sheets are upscales too. Slicing one of those on a 16px grid yields cells
    made of magnified pixels, which look right in isolation and wrong beside
    everything else in the game. Checked, because it is invisible otherwise.
    """
    a = im.tobytes()
    w, h = im.size
    for k in (2, 3, 4):
        if w % k or h % k:
            continue
        small = im.resize((w // k, h // k), Image.NEAREST)
        if small.resize((w, h), Image.NEAREST).tobytes() == a:
            raise SystemExit(
                f"source '{name}' is an exact {k}x upscale of {w//k}x{h//k} art. "
                f"Its 16px cells would be magnified pixels. Use the pack's "
                f"native sheet instead.")


def cell_of(sheet, rc):
    _, r, c = rc
    box = (c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL)
    if box[2] > sheet.size[0] or box[3] > sheet.size[1]:
        raise SystemExit(f"cell {rc} is outside the sheet ({sheet.size[0]//CELL}"
                         f"x{sheet.size[1]//CELL} cells)")
    im = sheet.crop(box)
    if im.getextrema()[3][0] < 255:
        raise SystemExit(f"cell {rc} is not fully opaque — ground must be solid")
    return im.convert("RGB")


# ── mutual-seam check ────────────────────────────────────────────────────────

def edges(im):
    px = im.load()
    w, h = im.size
    return {"L": [px[0, y] for y in range(h)], "R": [px[w - 1, y] for y in range(h)],
            "T": [px[x, 0] for x in range(w)], "B": [px[x, h - 1] for x in range(w)]}


def mean_step(im):
    """Average neighbouring-pixel difference — the tile's own internal grain."""
    px = im.load()
    w, h = im.size
    tot = n = 0
    for y in range(h):
        for x in range(w - 1):
            tot += sum(abs(px[x, y][i] - px[x + 1, y][i]) for i in range(3)) / 3
            n += 1
    return tot / max(n, 1)


def seam(a, b):
    return sum(sum(abs(p[i] - q[i]) for i in range(3)) / 3
               for p, q in zip(a, b)) / max(len(a), 1)


# Flipping and rotating a cell moves its motif inside the 16px square, which is
# what stops a mosaic of near-identical cells reading as wallpaper. It also
# changes the cell's edges, so a transform is only usable if the set stays
# mutually seamless with it added. Which ones qualify is measured, not assumed.
TRANSFORMS = [
    ("flip-h", Image.FLIP_LEFT_RIGHT),
    ("flip-v", Image.FLIP_TOP_BOTTOM),
    ("rot-90", Image.ROTATE_90),
    ("rot-180", Image.ROTATE_180),
    ("rot-270", Image.ROTATE_270),
]


def worst_seam(tiles):
    """Largest join cost over every ordered pair, both directions."""
    es = [edges(t) for t in tiles]
    worst, pair = 0.0, None
    for i, ea in enumerate(es):
        for j, eb in enumerate(es):
            for cost in (seam(ea["R"], eb["L"]), seam(ea["B"], eb["T"])):
                if cost > worst:
                    worst, pair = cost, (i, j)
    return worst, pair


def tolerance(grain):
    """A seam is invisible when it is no larger than the grain the artist drew,
    or a small enough fraction of full scale that nothing could show it."""
    return max(max(grain, 1.0) * 1.6, 8.0)


# Two cells can join with a clean edge and still read as blocks, because what
# shows is the difference in overall tone, not the join. A darker grass variant
# passed the seam test at 11.88 against a tolerance of 12.36 and tiled as
# obvious dark squares. So tone is checked separately from seams.
TONE_SPREAD = 18.0


def tone_gap(tiles, cells):
    """Largest distance between any two cells' mean colours."""
    means = [mean_rgb(t) for t in tiles]
    worst, pair = 0.0, None
    for i, a in enumerate(means):
        for j, b in enumerate(means):
            d = sum((a[k] - b[k]) ** 2 for k in range(3)) ** 0.5
            if d > worst:
                worst, pair = d, (cells[i], cells[j])
    return worst, pair


def build_variants(name, tiles, cells, strict):
    """The cells, plus every transform of them that keeps the set seamless."""
    grain = sum(mean_step(t) for t in tiles) / len(tiles)
    tol = tolerance(grain)

    gap, gpair = tone_gap(tiles, cells)
    if gap > TONE_SPREAD:
        msg = (f"'{name}': cells {gpair[0]} and {gpair[1]} are {gap:.1f} apart "
               f"in tone (limit {TONE_SPREAD:.0f}). They would tile as visible "
               f"patches however clean the join is. Drop one, or pass --loose.")
        if strict:
            raise SystemExit(msg)
        log(f"  !! {msg}")

    worst, pair = worst_seam(tiles)
    if worst > tol:
        msg = (f"'{name}': cells {cells[pair[0]]} and {cells[pair[1]]} do not "
               f"join cleanly (seam {worst:.2f}, tolerance {tol:.2f}). Drop one "
               f"from TERRAINS, or pass --loose to bake anyway.")
        if strict:
            raise SystemExit(msg)
        log(f"  !! {msg}")

    variants = list(tiles)
    kept = []
    for label, op in TRANSFORMS:
        trial = variants + [t.transpose(op) for t in tiles]
        if worst_seam(trial)[0] <= tol:
            variants = trial
            kept.append(label)
    log(f"  ok {name:6s} {len(tiles)} cells, seam {worst:5.2f} <= {tol:5.2f}, "
        f"tone {gap:4.1f} <= {TONE_SPREAD:.0f}"
        f"  +{len(variants) - len(tiles):2d} from " +
        (", ".join(kept) if kept else "no transforms (edges too asymmetric)"))
    return variants


# ── colour ───────────────────────────────────────────────────────────────────

def shift(rgb, hue, sat):
    """Rotate a colour's hue and scale its saturation, leaving brightness alone."""
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    h = (h + hue / 360.0) % 1.0
    s = max(0.0, min(1.0, s * sat))
    return tuple(round(c * 255) for c in colorsys.hls_to_rgb(h, l, s))


def retint(blob, hue, sat):
    if hue == 0 and sat == 1.0:
        return blob
    out = blob.copy()
    px = out.load()
    cache = {}
    for y in range(out.size[1]):
        for x in range(out.size[0]):
            r, g, b, a = px[x, y]
            if not a:
                continue
            key = (r, g, b)
            if key not in cache:
                cache[key] = shift(key, hue, sat)
            px[x, y] = cache[key] + (a,)
    return out


def mean_rgb(im):
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    n = w * h
    tot = [0, 0, 0]
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            tot[0] += p[0]; tot[1] += p[1]; tot[2] += p[2]
    return tuple(t // n for t in tot)


# ── scatter ──────────────────────────────────────────────────────────────────

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
            im = Image.new("RGBA", (max(xs) - bx + 1, max(ys) - by + 1), (0, 0, 0, 0))
            ip = im.load()
            for x, y in cells:
                ip[x - bx, y - by] = px[x, y]
            blobs.append(im)
    return blobs


def tone_of(blob):
    px = blob.load()
    for y in range(blob.size[1]):
        for x in range(blob.size[0]):
            p = px[x, y]
            if p[3] >= 8:
                d = sum((p[i] - TONE_DARK[i]) ** 2 for i in range(3))
                s = sum((p[i] - TONE_SOFT[i]) ** 2 for i in range(3))
                return "dark" if d <= s else "soft"
    return "soft"


def stamp_wrapped(canvas, blob, x, y):
    """Paste so anything crossing an edge reappears on the opposite side."""
    p = canvas.size[0]
    bw, bh = blob.size
    for ox in (0, -p) if x + bw > p else (0,):
        for oy in (0, -p) if y + bh > p else (0,):
            canvas.alpha_composite(blob, (x + ox, y + oy))


def bake_scatter(name, cfg, pools, rng):
    hue, sat = cfg["hue"], cfg["sat"]
    base = shift(PACK_SAND, hue, sat)
    canvas = Image.new("RGBA", (PERIOD, PERIOD), base + (255,))

    def drop(tone, x, y):
        pool = pools[tone]
        if not pool:
            return 0
        blob = retint(rng.choice(pool), hue, sat)
        if rng.random() < 0.5:
            blob = blob.transpose(Image.FLIP_LEFT_RIGHT)
        if rng.random() < 0.5:
            blob = blob.transpose(Image.FLIP_TOP_BOTTOM)
        stamp_wrapped(canvas, blob, x % PERIOD, y % PERIOD)
        return 1

    placed = 0
    # Clustered mottling: a patch is a centre with blobs falling off around it.
    for _ in range(cfg["clusters"]):
        cx, cy = rng.randrange(PERIOD), rng.randrange(PERIOD)
        for _ in range(cfg["per"]):
            tone = "dark" if rng.random() < 0.3 else "soft"
            placed += drop(tone, round(cx + rng.gauss(0, cfg["spread"])),
                           round(cy + rng.gauss(0, cfg["spread"])))
    for _ in range(cfg["loose"]):
        placed += drop("dark" if rng.random() < 0.25 else "soft",
                       rng.randrange(PERIOD), rng.randrange(PERIOD))

    log(f"  {name:6s} scatter  hue{hue:+4d} sat x{sat:.2f} "
        f"-> #{base[0]:02x}{base[1]:02x}{base[2]:02x}  {placed} blobs")
    return canvas, base


# ── mosaic ───────────────────────────────────────────────────────────────────

def bake_mosaic(name, cfg, tiles, rng):
    """Lay the cells at random, but clumped, so variants form patches."""
    hue, sat = cfg.get("hue", 0), cfg.get("sat", 1.0)
    if hue or sat != 1.0:
        tiles = [retint(t.convert("RGBA"), hue, sat).convert("RGB") for t in tiles]
    n = PERIOD // CELL
    canvas = Image.new("RGBA", (PERIOD, PERIOD))
    # A coarse field of preferred variants, at a quarter of the cell resolution.
    coarse = n // 4
    field = [[rng.randrange(len(tiles)) for _ in range(coarse)]
             for _ in range(coarse)]
    clump = cfg.get("clump", 0.7)
    counts = [0] * len(tiles)
    for r in range(n):
        for c in range(n):
            # `clump` of the time take the patch's variant, else pick freely —
            # patches with frayed edges rather than visible blocks.
            i = (field[r * coarse // n][c * coarse // n]
                 if rng.random() < clump else rng.randrange(len(tiles)))
            counts[i] += 1
            canvas.paste(tiles[i], (c * CELL, r * CELL))
    base = mean_rgb(canvas)
    tone = f"hue{hue:+4d} sat x{sat:.2f}  " if (hue or sat != 1.0) else ""
    log(f"  {name:6s} mosaic   {tone}{len(tiles)} variants over {n}x{n} cells"
        f"  -> #{base[0]:02x}{base[1]:02x}{base[2]:02x}")
    return canvas, base


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    flags = {a for a in sys.argv[1:] if a.startswith("-")}
    if not args:
        sys.exit(__doc__)
    if PERIOD % TILE or PERIOD % CELL:
        sys.exit(f"PERIOD {PERIOD} must divide by TILE {TILE} and CELL {CELL}")

    roots = [Path(a) for a in args]
    for r in roots:
        if not r.is_dir():
            sys.exit(f"Not a folder: {r}")

    log("sources:")
    sheets = locate(roots)
    for name, im in sheets.items():
        check_native(name, im)

    rng = random.Random(SEED)
    names = sorted(TERRAINS)

    # Gather what each terrain needs, skipping any whose pack was not supplied.
    ready, pools = [], None
    for name in names:
        cfg = TERRAINS[name]
        if cfg["kind"] == "scatter":
            if "spots" not in sheets:
                log(f"  -- {name}: no spots.png supplied, skipping")
                continue
            if pools is None:
                pools = {"dark": [], "soft": []}
                for b in extract_blobs(sheets["spots"]):
                    pools[tone_of(b)].append(b)
                log(f"  spots.png -> {len(pools['dark'])} dark, "
                    f"{len(pools['soft'])} soft blobs")
            ready.append((name, cfg, None))
        else:
            need = {rc[0] for rc in cfg["cells"]}
            missing = need - set(sheets)
            if missing:
                log(f"  -- {name}: no " +
                    ", ".join(SOURCES[m] for m in sorted(missing)) +
                    " supplied, skipping")
                continue
            tiles = [cell_of(sheets[rc[0]], rc) for rc in cfg["cells"]]
            ready.append((name, cfg, tiles))
    if not ready:
        sys.exit("No terrains could be built — check the pack folders given.")

    log("\nmutual seams (a mosaic is only safe if every cell joins every other):")
    any_mosaic = False
    for i, (name, cfg, tiles) in enumerate(ready):
        if cfg["kind"] == "mosaic":
            any_mosaic = True
            ready[i] = (name, cfg,
                        build_variants(name, tiles, cfg["cells"],
                                       "--loose" not in flags))
    if not any_mosaic:
        log("  (none)")

    log("\nbaking:")
    sheet = Image.new("RGBA", (PERIOD, PERIOD * len(ready)), (0, 0, 0, 0))
    meta = {}
    for i, (name, cfg, tiles) in enumerate(ready):
        if cfg["kind"] == "scatter":
            img, base = bake_scatter(name, cfg, pools, rng)
        else:
            img, base = bake_mosaic(name, cfg, tiles, rng)
        sheet.paste(img, (0, i * PERIOD))
        meta[name] = {"oy": i * PERIOD, "base": "#%02x%02x%02x" % base}

    OUT.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(OUT / "ground.png", optimize=True)
    (OUT / "ground.json").write_text(json.dumps(
        {"period": PERIOD, "tile": TILE, "terrains": meta},
        indent=1, sort_keys=True) + "\n")

    kb = (OUT / "ground.png").stat().st_size / 1024
    log(f"\n{len(ready)} terrains, {PERIOD}px period "
        f"({PERIOD // TILE} tiles) -> assets/ground/  [{kb:.0f} KB]")


if __name__ == "__main__":
    main()
