#!/usr/bin/env python3
"""Cut the world's fixed decorations out of the packs into one atlas.

Run:  ./tools/build_fixtures.py [packs-root]     (default .asset-tmp/packs)

Emits assets/fixtures/fixtures.png + fixtures.json — one atlas of named pieces,
each at its native size, blitted at fixed offsets by the draw code.

Every piece names its source by a GLOB against the packs root, so adding art
from a pack this file has never mentioned takes one line and no argument
juggling. It used to take six positional pack paths with a parallel list of
per-pack subdirectories, which does not survive a library of fifty-six packs —
and worse, it made reaching for a pack feel expensive, so I hand-painted a
barn, a forge, a workbench, a palm tree and a set of signposts that were all
sitting in the library already.

A piece is either a whole file (rect None — most of the tree pack ships one
PNG per tree) or a rect cut out of a sheet. Either way it is trimmed to its
own bounding box, so the offsets in the JSON are honest.

Why a third atlas rather than reusing one of the two that exist:

* `assets/props/` is a 32x32 grid keyed by tile coordinate — it scatters a
  variant across every tile of a type. These pieces are not tile-sized and
  belong at one specific place, not scattered.
* `assets/sprites/` is the actor system: cell grids, clips, facings. A static
  crate is none of those.

So: named rects in one PNG, and the caller blits them.
"""
import json
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "fixtures"

# ── Where each piece comes from ──────────────────────────────────────────
#
# name: (glob under the packs root, rect or None)
#
# Rects were found by a connected-component scan of the sheet and then
# identified by cropping each candidate and looking at it at 4x. Identifying
# them by component index instead put a coil of rope where the campfire should
# be and a pile of kindling where the crate should be — the indices are ordered
# by position, which is not the order anything reads in.
LODGE = "*hunterslodge*/PNG/"
SMITH = "*blacksmith*/PNG/"
TREES = "*freetopdowntrees*/PNG/Assets_separately/Trees/"
FARM  = "*farmwithanimals*/"
FISH  = "*fishingvillage*2/PNG/"

PIECES = {
    # ── Amos's camp (Hunter's Lodge) ─────────────────────────────────────
    "rack":      (LODGE + "Exterior_objects.png", (5, 369, 51, 58)),
    "rack2":     (LODGE + "Exterior_objects.png", (69, 369, 51, 58)),
    "hidecrate": (LODGE + "Exterior_objects.png", (217, 337, 34, 47)),
    "firewood":  (LODGE + "Exterior_objects.png", (191, 356, 12, 27)),
    "fire":      (LODGE + "Exterior_objects.png", (166, 340, 26, 36)),
    "crate":     (LODGE + "Exterior_objects.png", (291, 424, 25, 34)),
    "trap":      (LODGE + "Trap.png",             (0, 0, 32, 32)),
    "lodge":     (LODGE + "Exterior_objects.png", (11, 119, 144, 146)),

    # ── Market square (Armor and Weapons) ────────────────────────────────
    # Both bare: the pack ships each fixture empty as well as loaded.
    "shelf": ("*armorandweapons*/PNG/Furniture.png", (1, 5, 46, 52)),
    "table": ("*armorandweapons*/PNG/Furniture.png", (53, 10, 39, 22)),

    # ── Desert trees ─────────────────────────────────────────────────────
    # Each has a ground disc painted into its base, in a sand and a grass
    # version. That looked like a reason to reject the set — a sand disc on
    # grass reads as a mistake. It is the opposite: the caller picks the
    # variant matching the ground, so the disc becomes the scrub-and-dust
    # apron a real tree has.
    "tree_sand_big":   ("*deserttileset*/PNG/Objects_separately/Tree1_sand_shadow2.png", None),
    "tree_sand_small": ("*deserttileset*/PNG/Objects_separately/Tree1_sand_shadow3.png", None),
    "tree_bush":       ("*deserttileset*/PNG/Objects_separately/Tree3_3.png", None),

    # ── Trees for green ground (Top-Down Farm with Animals) ──────────────
    # This pack is 16px-per-tile and the game is 32px, which is why its fence
    # tiles are unusable here. That does not disqualify a free-standing prop:
    # a grid-aligned tile has to fill a tile, but a prop only has to match
    # pixel DENSITY, and at 1:1 it does.
    "tree_oak":     (FARM + "Tiled_files/Objects_outside.png", (385, 16, 61, 80)),
    "tree_pine":    (FARM + "Tiled_files/Objects_outside.png", (181, 21, 71, 74)),
    "tree_gnarled": (FARM + "Tiled_files/Objects_outside.png", (19, 101, 58, 70)),
    "tree_round":   (FARM + "Tiled_files/Objects_outside.png", (451, 22, 53, 69)),
    "tree_sapling": (FARM + "Tiled_files/Objects_outside.png", (517, 48, 39, 48)),
    "tree_scrub":   (FARM + "Tiled_files/Objects_outside.png", (324, 54, 39, 39)),
    "tree_shrub":   (FARM + "Tiled_files/Objects_outside.png", (245, 116, 37, 38)),

    # ── Trees, one file each (Free Top-Down Trees) ───────────────────────
    # A whole tree pack, all of it native at this game's pixel density: palms
    # in three growth stages, broadleaf, fruit, moss, and — the useful
    # surprise — seven broken trees and three burned ones, which is exactly
    # what the badlands' dead wood and the ruins' overgrowth wanted. I painted
    # both by hand first.
    # Palms come in three growth stages and the file numbering runs the other
    # way from the size: _1 is the mature tree (62x69 of content) and _3 the
    # sprout (33x32). Named by what they are, not by their filenames.
    "palm":        (TREES + "Palm_tree2_1.png", None),
    "palm2":       (TREES + "Palm_tree1_1.png", None),
    "palm_young":  (TREES + "Palm_tree2_2.png", None),
    "palm_sprout": (TREES + "Palm_tree2_3.png", None),
    "tree_broad":  (TREES + "Tree3.png", None),
    "tree_fruit":  (TREES + "Fruit_tree1.png", None),
    "tree_moss":   (TREES + "Moss_tree2.png", None),
    "tree_moss2":  (TREES + "Moss_tree3.png", None),
    "dead_burned": (TREES + "Burned_tree1.png", None),
    "dead_burned2":(TREES + "Burned_tree2.png", None),
    "dead_broken": (TREES + "Broken_tree1.png", None),
    "dead_broken2":(TREES + "Broken_tree2.png", None),
    "dead_stump":  (TREES + "Broken_tree3.png", None),

    # ── Trade goods (2D Pixel Fishing Village) ───────────────────────────
    # Almost everything in that pack's exterior sheet is barrels and crates
    # spilling blue fish, which is right for a fishing village and wrong for a
    # dust-bowl trading post. These are the pieces with none — picked by
    # measuring the share of opaque pixels that are saturated blue or cyan and
    # taking only the rects that score zero. My first pass chose a sack pile
    # "with no fish in it" that scored 2.6% and had two fish plainly sticking
    # out of it once it was on screen at game scale.
    "crate_tall": (FISH + "Exterior_objetcs.png", (134, 322, 22, 29)),
    "crate_wide": (FISH + "Exterior_objetcs.png", (195, 324, 28, 23)),
    "sack":       (FISH + "Exterior_objetcs.png", (68, 551, 21, 21)),

    # ── Boot hill (Free Chapel) ──────────────────────────────────────────
    # The chapel itself is a gothic cathedral with spires and a rose window and
    # has no place in a dust-bowl town. Its graveyard furniture does.
    "grave1": ("*chapel*/PNG/Exterior.png", (169, 165, 15, 21)),
    "grave2": ("*chapel*/PNG/Exterior.png", (199, 164, 17, 22)),
    "grave3": ("*chapel*/PNG/Exterior.png", (231, 164, 17, 21)),
    "grave4": ("*chapel*/PNG/Exterior.png", (167, 197, 17, 18)),
    "grave5": ("*chapel*/PNG/Exterior.png", (232, 226, 16, 24)),
    "grave6": ("*chapel*/PNG/Exterior.png", (199, 260, 17, 19)),

    # ── The forge (Pixel Blacksmith House) ───────────────────────────────
    # The anvil ships as its own file. The forge itself is the first frame of
    # Forge_animation.png — the later frames are the fire flaring, which the
    # tile does not need since it draws its own glow.
    # Anvil.png holds TWO anvils side by side in one 96x48 sheet — taking the
    # whole file put both of them on the tile.
    "anvil": (SMITH + "Smith/Forge/Anvil.png", (48, 0, 48, 48)),
}

PAD = 1   # a transparent gutter, so no piece bleeds into its neighbour


def find(root, pattern):
    """The one file under `root` matching `pattern`, ignoring __MACOSX junk."""
    hits = [p for p in root.glob(pattern) if "__MACOSX" not in p.as_posix()]
    if not hits:
        raise SystemExit(f"no file matches {pattern!r} under {root}")
    return sorted(hits)[0]


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / ".asset-tmp" / "packs"
    if not root.is_dir():
        raise SystemExit(f"{root} is not a directory — extract the packs there first")

    cut = {}
    for name, (pattern, rect) in PIECES.items():
        sheet = Image.open(find(root, pattern)).convert("RGBA")
        im = sheet if rect is None else sheet.crop(
            (rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]))
        bb = im.getbbox()
        if bb is None:
            raise SystemExit(f"'{name}' is empty — the rect is wrong")
        cut[name] = im.crop(bb)     # trim to content so the offsets are honest

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
