#!/usr/bin/env python3
"""Cut the world's fixed decorations out of two packs into one atlas.

Run:  ./tools/build_fixtures.py <hunters-lodge> <armor-and-weapons> <desert-tileset> <farm-with-animals> <fishing-village>

Emits assets/fixtures/fixtures.png + fixtures.json — one small atlas of named
pieces, each at its native size, blitted at fixed offsets by the draw code.

Two sources. The Hunter's Lodge pack supplies Amos's camp. The Armor and
Weapons pack supplies the market square's stall furniture: its `Furniture.png`
ships the shelf and the table **bare** as well as loaded with swords and
helmets, and the bare ones take this game's own item icons instead — which is
why that pack is credited here even though none of its icons are usable.

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
OUT = REPO / "assets" / "fixtures"

# Source rects, found by a connected-component scan of Exterior_objects.png
# and then identified by cropping each candidate and looking at it at 4x.
# Identifying them by component index instead put a coil of rope where the
# campfire should be and a pile of kindling where the crate should be — the
# indices are ordered by position, which is not the order anything reads in.
# Left, top, width, height.
PIECES = {
    # ── Amos's camp (Hunter's Lodge pack) ────────────────────────────────
    "rack":      ("Exterior_objects.png",   5, 369, 51, 58),  # hide on an A-frame
    "rack2":     ("Exterior_objects.png",  69, 369, 51, 58),  # the other angle
    "hidecrate": ("Exterior_objects.png", 217, 337, 34, 47),  # folded hide on a crate
    "firewood":  ("Exterior_objects.png", 191, 356, 12, 27),  # split logs
    "fire":      ("Exterior_objects.png", 166, 340, 26, 36),  # fire pit, spit and pot
    "crate":     ("Exterior_objects.png", 291, 424, 25, 34),
    "trap":      ("Trap.png",               0,   0, 32, 32),  # set, first frame
    # The lodge itself: log walls, thatched roof, chimney, door. 144x146 —
    # four and a half tiles wide and four and a half tall, so the overhang
    # rules apply and its footprint needs solid tiles under it.
    "lodge":     ("Exterior_objects.png", 11, 119, 144, 146),
}

# ── Market square (Armor and Weapons pack) ──────────────────────────────
# Both bare: the pack ships each fixture empty as well as loaded.
PIECES2 = {
    "shelf": ("Furniture.png",  1,  5, 46, 52),   # three empty shelves
    "table": ("Furniture.png", 53, 10, 39, 22),   # empty trestle table
}

# ── Trees (Desert Tileset) ──────────────────────────────────────────────
# 64x64, so bigger than a 32px tile — drawn by the overhang pass rather than
# by drawTile, anchored at the tile's base so the canopy spills over the tiles
# above it, which is what a tree does.
#
# Each tree has a ground disc painted into its base, in a sand version and a
# grass version. That looked like a reason to reject the whole set — a sand
# disc on grass reads as a mistake. It is the opposite: the caller picks the
# variant matching the ground the tree stands on, so the disc becomes the
# scrub-and-dust apron a real tree has. Hence the _grass/_sand suffixes here;
# they are not decoration, they are the selector.
#
# Tree1 is broadleaf and Tree3 a dense round bush. The pack's Tree2 and Tree4
# are spiky oasis palms and are deliberately left out — this is a dust-bowl
# frontier, not a lagoon.
PIECES3 = {
    "tree_sand_big":    ("Tree1_sand_shadow2.png",  0, 0, 64, 64),
    "tree_sand_small":  ("Tree1_sand_shadow3.png",  0, 0, 64, 64),
    "tree_bush":        ("Tree3_3.png",             0, 0, 64, 64),
}

# ── Trees for green ground (Top-Down Farm with Animals) ─────────────────
# Better trees than the desert pack's for anywhere grassy: broadleaf,
# conifers and gnarled old ones, with grass tufts at the base rather than a
# sand disc. Rects found by component scan of Objects_outside.png and then
# checked by eye — the scan merges objects that touch, and one 111x78 "tree"
# turned out to be two.
#
# This pack is 16px-per-tile and the game is 32px, which is why its fence
# tiles are unusable here. It does not disqualify these: a grid-aligned tile
# has to fill a tile, but a free-standing prop only has to match pixel
# DENSITY, and at 1:1 it does. An 80px tree is simply two and a half tiles
# tall instead of five.
PIECES4 = {
    "tree_oak":     ("Objects_outside.png", 385,  16, 61, 80),
    "tree_pine":    ("Objects_outside.png", 181,  21, 71, 74),
    "tree_gnarled": ("Objects_outside.png",  19, 101, 58, 70),
    "tree_round":   ("Objects_outside.png", 451,  22, 53, 69),
    "tree_sapling": ("Objects_outside.png", 517,  48, 39, 48),
    "tree_scrub":   ("Objects_outside.png", 324,  54, 39, 39),
    "tree_shrub":   ("Objects_outside.png", 245, 116, 37, 38),
}

# ── Trade goods (2D Pixel Fishing Village) ──────────────────────────────
# Almost everything in that pack's exterior sheet is barrels and crates
# spilling blue fish, which is right for a fishing village and wrong for a
# dust-bowl trading post. These are the pieces with none.
#
# Picked by measuring, not by eye: count the share of opaque pixels that are
# saturated blue or cyan and take only the rects that score zero. My first
# pass chose a sack pile "with no fish in it" that scored 2.6% and had two
# fish plainly sticking out of it once it was on screen at game scale.
PIECES5 = {
    "crate_tall": ("Exterior_objetcs.png", 134, 322, 22, 29),
    "crate_wide": ("Exterior_objetcs.png", 195, 324, 28, 23),
    "sack":       ("Exterior_objetcs.png",  68, 551, 21, 21),
}

PAD = 1   # a transparent gutter, so no piece bleeds into its neighbour


def main():
    if len(sys.argv) != 6:
        raise SystemExit(__doc__)
    # Each pack keeps its art somewhere slightly different. PNG/ for most; the
    # farm pack's outdoor objects are only in Tiled_files/.
    SUBDIRS = ["PNG", "PNG", "PNG", "Tiled_files", "PNG"]
    srcs = []
    for a, sub in zip(sys.argv[1:], SUBDIRS):
        d = Path(a) / sub
        if not d.is_dir():
            raise SystemExit(f"no {sub}/ directory under {a}")
        srcs.append(d)

    cut = {}
    ALL = list(PIECES.items()) + list(PIECES2.items()) + list(PIECES3.items()) + \
          list(PIECES4.items()) + list(PIECES5.items())
    for name, (fn, x, y, w, h) in ALL:
        src = (srcs[0] if name in PIECES else
               srcs[1] if name in PIECES2 else
               srcs[2] / "Objects_separately" if name in PIECES3 else
               srcs[3] if name in PIECES4 else srcs[4])
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
    atlas.save(OUT / "fixtures.png")
    (OUT / "fixtures.json").write_text(json.dumps({"rects": rects}, indent=1) + "\n")

    for n, r in rects.items():
        print(f"{n:11s} {r[2]:3d}x{r[3]:<3d} at {r[0]},{r[1]}")
    size = (OUT / "fixtures.png").stat().st_size
    print(f"\n{len(rects)} pieces, {atlas.size[0]}x{atlas.size[1]}, {size/1024:.1f} KB")


if __name__ == "__main__":
    main()
