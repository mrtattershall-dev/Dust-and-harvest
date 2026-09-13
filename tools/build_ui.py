#!/usr/bin/env python3
"""Bake the HUD's frames, slots and buttons from Franuka's RPG UI pack.

Run:  ./tools/build_ui.py <path-to-RPG_UI_pack_by_Franuka>

Why this exists
---------------
The game's overlays are DOM, not canvas, so the art is applied with CSS
`border-image` rather than drawn. That wants one small PNG per piece, at 1x,
in the game's own palette.

Three things this tool checks or does that are easy to get wrong by hand:

* **1x only.** The pack ships 1x/2x/3x, and the 2x/3x files are exact
  nearest-neighbour upscales (measured, see `assert_native`). Shipping 3x
  would be 9x the bytes for pixel-identical output, since CSS scales the 1x
  art with `image-rendering: pixelated` anyway. Scaling in CSS also lets the
  factor be responsive, which a baked 3x file cannot be.

* **Retinted, not raw.** The pack is pastel-warm; the game is dark brown and
  amber on near-black. Dropped in raw the pieces wash the HUD out. The same
  HLS transform the ground pipeline uses moves each piece onto the game's
  palette: hue and lightness by addition, saturation by ratio. Ratio matters
  here for the same reason it did there — subtracting drains the darker
  shading pixels to grey while the flat fill is still coloured.

* **Alpha is preserved exactly.** These are nine-slice frames with shaped
  corners and soft edges. Retinting must not touch the alpha channel or the
  corners grow halos when CSS scales them up.
"""
import colorsys
import shutil
import sys
from pathlib import Path

from PIL import Image

# The palette the HUD already uses, sampled from index.html: the amber of the
# panel borders and the near-black of their fill.
TARGET_ACCENT = "#b48c3c"   # rgba(180,140,60) — the existing border amber
TARGET_FILL   = "#241a10"   # the dark wood the panels sit on

# What to take, and what each piece is retinted towards. `None` means the piece
# keeps the pack's own colour, which is right for anything already amber.
#   (category, source stem, output name, target)
PIECES = [
    # Panel frames. 01C reads as tooled leather once it is darkened; 05A has
    # plank corners, which suits a frontier notice board.
    ("Background boxes", "BGbox_01C", "panel",      TARGET_FILL),
    ("Background boxes", "BGbox_05A", "panel_wood", TARGET_FILL),
    # Inventory and hotbar cells. Only `_Empty` is used: the pack's other slots
    # carry ghost glyphs for rings, shields and gauntlets, and this is a
    # farming game.
    ("Item slots", "Slot_01_Empty", "slot",     TARGET_FILL),
    ("Item slots", "Slot_03_Empty", "slot_sel", TARGET_ACCENT),
    # Buttons. Family 01 is the only muted one; the rest are red, turquoise,
    # royal blue or crimson, and none of those belong in a western HUD.
    ("Buttons", "Button_01A_Normal",   "btn",          TARGET_FILL),
    ("Buttons", "Button_01A_Selected", "btn_hover",    TARGET_ACCENT),
    ("Buttons", "Button_01A_Pressed",  "btn_active",   TARGET_FILL),
    ("Buttons", "Button_01D_Normal",   "btn_sq",       TARGET_FILL),
    ("Buttons", "Button_01D_Selected", "btn_sq_hover", TARGET_ACCENT),
    ("Buttons", "Button_01D_Pressed",  "btn_sq_active",TARGET_FILL),
    # Rules between sections.
    ("Dividers", "Divider_02", "divider", TARGET_ACCENT),
]

OUT = Path(__file__).resolve().parent.parent / "assets" / "ui"


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def assert_native(name, im):
    """Refuse a file that is an exact upscale of smaller art.

    Same check the ground tool makes, for the same reason: an upscale looks
    right alone and wrong beside everything else, and nothing about the file
    announces it.
    """
    a = im.tobytes()
    w, h = im.size
    for k in (2, 3, 4):
        if w % k or h % k:
            continue
        small = im.resize((w // k, h // k), Image.NEAREST)
        if small.resize((w, h), Image.NEAREST).tobytes() == a:
            raise SystemExit(
                f"'{name}' is an exact {k}x upscale of {w // k}x{h // k} art. "
                f"Point this tool at the pack's 1x folder.")


def mean_ls(im):
    """Mean lightness and saturation over the opaque pixels only.

    Deliberately does NOT average hue. Hue is an angle, so a plain mean is
    meaningless the moment the values straddle the 0/1 wrap: a frame whose
    pixels sit at 0.02 and 0.97 — both red — averages to 0.5, which is cyan.
    An earlier version of this tool did exactly that and turned the panels
    purple and the buttons green. Hue is not averaged here because it is not
    needed: `retint` assigns the target hue outright.

    Transparent pixels are skipped. They carry whatever RGB the exporter left
    behind, usually black, which is not a colour in the visible art.
    """
    px = im.load()
    n = 0
    ls = ss = 0.0
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            ls += l
            ss += s
            n += 1
    if not n:
        raise SystemExit("piece is fully transparent")
    return ls / n, ss / n


def retint(im, target_hex):
    """Colorize the piece onto `target_hex`, keeping its internal contrast.

    This is a colorize, not the hue-delta the ground pipeline uses, and the
    difference is the point. The ground's cells were all one sand hue, so
    rotating them together preserved the artist's relationships. These pieces
    arrive in six unrelated hues — dusty rose, turquoise, royal blue — and the
    goal is for all of them to come out the same frontier brown. So hue is
    assigned, not shifted:

      hue        := the target's hue, for every pixel
      lightness  := shifted so the piece's mean matches the target's, which
                    preserves every light/dark step the artist drew
      saturation := scaled by ratio, for the same reason as in the ground
                    tool — subtracting drains the dark shading pixels to grey
                    while the flat fill is still coloured
    """
    if target_hex is None:
        return im
    l0, s0 = mean_ls(im)
    h1, l1, s1 = colorsys.rgb_to_hls(*(c / 255 for c in hex_rgb(target_hex)))
    dl = l1 - l0
    sr = (s1 / s0) if s0 > 1e-6 else 1.0

    out = im.copy()
    px = out.load()
    for y in range(out.size[1]):
        for x in range(out.size[0]):
            r, g, b, a = px[x, y]
            if a == 0:
                continue                      # leave fully clear pixels alone
            _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            l = max(0.0, min(1.0, l + dl))
            s = max(0.0, min(1.0, s * sr))
            nr, ng, nb = colorsys.hls_to_rgb(h1, l, s)
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


def find(root, category, stem):
    hits = [p for p in (root / "Individual files" / "1x" / category).rglob(stem + ".png")
            if "__MACOSX" not in str(p)]
    if not hits:
        raise SystemExit(f"missing: {category}/{stem}.png under {root}")
    return hits[0]


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for category, stem, name, target in PIECES:
        src = find(root, category, stem)
        im = Image.open(src).convert("RGBA")
        assert_native(f"{category}/{stem}", im)
        out = retint(im, target)
        out.save(OUT / f"{name}.png")
        print(f"{name:14s} {im.size[0]:3d}x{im.size[1]:<3d}  <- {category}/{stem}")

    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    print(f"\n{len(PIECES)} pieces, {total / 1024:.1f} KB total")


if __name__ == "__main__":
    main()
