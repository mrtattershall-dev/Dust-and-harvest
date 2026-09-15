#!/usr/bin/env python3
"""
build_player.py — turn the CraftPix base character packs into recolourable
player layers.

The base packs are unclothed mannequins, which is exactly what is wanted here:
the game's player is not a fixed sprite but a customization system (skin tone,
hair style and colour, shirt style and colour, trousers, hat). So rather than
baking one look, this emits *region masks* that the runtime tints with whatever
the player picked.

Per gender it writes, for each clip:

  <clip>.png         skin: head + body, shade-LEVEL encoded (see below)
  <clip>_torso.png   torso and arms region, level encoded  -> shirt colour
  <clip>_legs.png    legs and feet region, level encoded   -> trouser colour
  <clip>_head.png    head silhouette, level encoded -> hair is cut from this
  <clip>_detail.png  eyes and mouth in true colour, never recoloured

Level encoding
  Each pack uses a 6-step ramp: one outline plus five skin shades. Those are
  collapsed to a level 0-5 stored in the red channel, so the runtime can map
  level -> colour for any palette without matching source RGB values. Alpha is
  preserved, so the masks stay antialias-free and composite cleanly.

Region split
  Head comes free: the packs ship separate head and body part layers. The body
  is split at the waist, found per frame as the narrowest row in the lower-middle
  of the silhouette, which tracks the legs as they swing rather than assuming a
  fixed row.

Usage:
  ./tools/build_player.py MALE_PACK FEMALE_PACK
"""

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "sprites" / "player"

CELL = 64
# Row order in these packs, verified in the Sprite Lab
DIR_ROWS = {"down": 0, "left": 1, "right": 2, "up": 3}

# Unarmed only: the player carries hoes and pickaxes, not a sword, and the
# game draws its own attack arc over the top.
CLIPS = ["Idle", "Walk", "Run", "Hurt", "Death"]
LOOP = {"Idle": True, "Walk": True, "Run": True, "Hurt": False, "Death": False}

# The two skin ramps, darkest first. Index in this list is the shade level.
RAMPS = {
    "male":   [(85, 45, 36), (121, 80, 72), (164, 111, 89),
               (190, 134, 95), (225, 178, 110), (246, 202, 116)],
    "female": [(89, 49, 46), (126, 86, 85), (165, 116, 108),
               (192, 138, 123), (233, 179, 142), (255, 202, 150)],
}
# Kept in true colour and drawn on top: eyes, eye whites, mouth.
DETAIL = {(210, 221, 232), (63, 106, 212), (55, 74, 143), (37, 170, 83),
          (34, 125, 86), (156, 53, 53), (125, 46, 62), (17, 11, 0), (0, 0, 0)}


def log(m):
    print(m, file=sys.stderr)


def level_of(rgb, ramp):
    """Shade level 0-5, or None when the colour is a detail (eye, mouth)."""
    if rgb in DETAIL:
        return None
    try:
        return ramp.index(rgb)
    except ValueError:
        # Not an exact ramp colour — fall back to nearest by luminance so a
        # stray anti-aliased pixel still renders rather than vanishing.
        lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
        best, bd = 0, 1e9
        for i, c in enumerate(ramp):
            d = abs(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] - lum)
            if d < bd:
                best, bd = i, d
        return best


def waist_row(img, box):
    """Row where the legs begin: narrowest row in the lower-middle of the body.

    Found per frame rather than fixed, so it follows the legs through a walk
    cycle instead of slicing through them.
    """
    x0, y0, x1, y1 = box
    h = y1 - y0
    if h < 6:
        return y0 + max(1, h // 2)
    lo = y0 + int(h * 0.45)
    hi = y0 + int(h * 0.80)
    best, bw = lo, 1e9
    for y in range(lo, max(lo + 1, hi)):
        w = sum(1 for x in range(x0, x1) if img.getpixel((x, y))[3] > 0)
        if w and w < bw:
            best, bw = y, w
    return best


def encode(src, ramp, keep=None, detail=False, occluder=None):
    """Level-encode a frame.

    `keep` limits output to a y-range (y0, y1).
    `occluder` drops pixels hidden behind another layer — the body's shoulders
    sit behind the head in the source art, so without this the shirt would be
    painted over the chin.
    """
    w, h = src.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    oc = occluder.load() if occluder is not None else None
    for y in range(h):
        if keep and not (keep[0] <= y < keep[1]):
            continue
        for x in range(w):
            if oc is not None and oc[x, y][3] > 0:
                continue
            p = sp[x, y]
            if p[3] == 0:
                continue
            rgb = p[:3]
            is_detail = rgb in DETAIL
            if detail:
                if is_detail:
                    op[x, y] = p
                continue
            if is_detail:
                continue
            lv = level_of(rgb, ramp)
            op[x, y] = (lv, lv, lv, 255)
    return out


def build_gender(pack: Path, gender: str):
    ramp = RAMPS[gender]
    src_dir = pack / "PNG" / "Unarmed" / "Parts"
    if not src_dir.is_dir():
        sys.exit(f"No Unarmed/Parts in {pack}")

    outdir = OUT / gender
    outdir.mkdir(parents=True, exist_ok=True)
    clips, heads = {}, {}

    for clip in CLIPS:
        body_p = src_dir / f"Unarmed_{clip}2_body.png"
        head_p = src_dir / f"Unarmed_{clip}3_head.png"
        if not body_p.is_file() or not head_p.is_file():
            log(f"  skip {clip}: missing part layers")
            continue
        body = Image.open(body_p).convert("RGBA")
        head = Image.open(head_p).convert("RGBA")
        if body.size != head.size:
            log(f"  !! {clip}: body/head sheets differ in size, skipping")
            continue
        frames = body.size[0] // CELL

        skin = Image.new("RGBA", body.size, (0, 0, 0, 0))
        torso = Image.new("RGBA", body.size, (0, 0, 0, 0))
        legs = Image.new("RGBA", body.size, (0, 0, 0, 0))
        det = Image.new("RGBA", body.size, (0, 0, 0, 0))
        headm = Image.new("RGBA", body.size, (0, 0, 0, 0))
        head_boxes = {}

        for d, row in DIR_ROWS.items():
            boxes = []
            for f in range(frames):
                ox, oy = f * CELL, row * CELL
                bcell = body.crop((ox, oy, ox + CELL, oy + CELL))
                hcell = head.crop((ox, oy, ox + CELL, oy + CELL))

                # Skin = head + body, level encoded; details kept separately
                merged = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
                merged.alpha_composite(bcell)
                merged.alpha_composite(hcell)
                skin.paste(encode(merged, ramp), (ox, oy))
                det.paste(encode(merged, ramp, detail=True), (ox, oy))
                # Head on its own: the runtime cuts hair shapes out of this so
                # they follow the skull instead of sitting on it as a cap.
                headm.paste(encode(hcell, ramp), (ox, oy))

                # Body split into torso (with arms) and legs
                bb = bcell.getbbox()
                if bb:
                    # Raised one row above the true waist: on these chibi
                    # proportions the legs are only ~3px, and trousers that stop
                    # at the hip read as boots rather than clothing.
                    w = max(bb[1] + 1, waist_row(bcell, bb) - 1)
                    torso.paste(encode(bcell, ramp, keep=(bb[1], w),
                                       occluder=hcell), (ox, oy))
                    legs.paste(encode(bcell, ramp, keep=(w, bb[3]),
                                      occluder=hcell), (ox, oy))

                # Head box, for placing hair and hats
                hb = hcell.getbbox()
                boxes.append(list(hb) if hb else None)
            head_boxes[d] = boxes

        skin.save(outdir / f"{clip.lower()}.png")
        torso.save(outdir / f"{clip.lower()}_torso.png")
        legs.save(outdir / f"{clip.lower()}_legs.png")
        det.save(outdir / f"{clip.lower()}_detail.png")
        headm.save(outdir / f"{clip.lower()}_head.png")
        clips[clip.lower()] = {"frames": frames, "loop": LOOP[clip]}
        heads[clip.lower()] = head_boxes
        log(f"  + {gender}/{clip.lower():6s} {frames} frames")

    return {"cell": CELL, "dirRows": DIR_ROWS, "clips": clips, "heads": heads}


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    male, female = Path(sys.argv[1]), Path(sys.argv[2])
    manifest = {"version": 1, "genders": {}}
    for g, p in (("male", male), ("female", female)):
        if not p.is_dir():
            sys.exit(f"Not a folder: {p}")
        manifest["genders"][g] = build_gender(p, g)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "player.json").write_text(json.dumps(manifest, indent=1) + "\n")
    log(f"wrote {OUT.relative_to(REPO)}/player.json")


if __name__ == "__main__":
    main()
