#!/usr/bin/env python3
"""
prep_assets.py — normalize CraftPix sprite packs into assets/sprites/ + manifest.json

CraftPix packs all follow a handful of layouts. This tool reads a pack folder (or
zip), slices out only the sheets the game actually ships, renames them to a flat
convention, measures each actor's content box for anchoring, and appends the
result to assets/sprites/manifest.json.

Layouts
  dir4     One PNG per clip. 4 rows = 4 facings. Used by the rat / slime / plant
           packs: PNG/<Variant>/Without_shadow/<Variant>_<Clip>_without_shadow.png
  dir4x2   One PNG for the whole actor. 8 rows = walk on rows 0-3, idle on rows
           4-7. Used by the farm animal pack: PNG/Without_shadow/<Name>_without_shadow.png
  coldir   Transposed: direction is the COLUMN (walk 0-3, idle 4-7) and frame
           is the ROW. Used by the farm asset pack. Transposed on import so the
           engine only ever sees row-major sheets.
  grid     Flat folder of <Name>_<clip>.png with non-square cells, 4 rows =
           facings. Used by the Franuka townsfolk pack (32x48 cells in 2x/).
           Requires --cell WxH since cell size cannot be inferred.

Row order differs between packs and is NOT guessable, so it is passed in:
  --rows DULR   row0=down row1=up row2=left  row3=right   (rat / slime / plant)
  --rows DURL   row0=down row1=up row2=right row3=left    (farm animals)

Examples
  # a rat/slime/plant style pack, one actor per Variant folder
  ./tools/prep_assets.py ~/packs/giant_rat --layout dir4 --group enemies \
      --rows DULR --map Rat1=rat1,Rat2=rat2,Rat3=rat3

  # the farm animal pack, one actor per sheet
  ./tools/prep_assets.py ~/packs/farm_animals --layout dir4x2 --group farm \
      --rows DURL --map Goat=goat,Horse=horse

Run with --dry-run first to see what it would emit.
"""

import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install pillow")

REPO = Path(__file__).resolve().parent.parent
SPRITES = REPO / "assets" / "sprites"
MANIFEST = SPRITES / "manifest.json"

# CraftPix animates everything at 150ms/frame (confirmed in their Tiled .tmx files)
DEFAULT_FPS = round(1000 / 150, 3)  # 6.667

# Clips that play once and hold on the last frame rather than looping. Matched
# as substrings so pack-specific variants (orc's "run_attack_front") are caught.
ONESHOT_PARTS = ("attack", "hurt", "death")


def is_oneshot(clip):
    return any(p in clip for p in ONESHOT_PARTS)

ROW_ORDERS = {
    "DULR": {"down": 0, "up": 1, "left": 2, "right": 3},
    "DURL": {"down": 0, "up": 1, "right": 2, "left": 3},
    "DLRU": {"down": 0, "left": 1, "right": 2, "up": 3},
    "DLUR": {"down": 0, "left": 1, "up": 2, "right": 3},
}


def log(msg):
    print(msg, file=sys.stderr)


def unzip_if_needed(src: Path, workdir: Path) -> Path:
    """Accept either a folder or a .zip. Returns a folder path."""
    if src.is_dir():
        return src
    if src.suffix.lower() != ".zip":
        sys.exit(f"Not a folder or zip: {src}")
    dest = workdir / src.stem
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as z:
        z.extractall(dest)
    # CraftPix zips sometimes wrap everything in one top-level folder
    entries = [p for p in dest.iterdir() if not p.name.startswith((".", "__"))]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


def content_box(im: Image.Image, cell: int, row: int, frames: int, cell_h=None):
    """Union bounding box of every frame in one row, in cell-local coords.

    Used for anchoring: the engine centres on box mid-x and stands the actor on
    box bottom, so sprites with wildly different cell padding all line up on the
    same ground line without per-actor hand tuning.

    `cell` is the cell width; `cell_h` defaults to it for the square packs.
    """
    ch = cell_h or cell
    box = None
    for f in range(frames):
        cell_img = im.crop((f * cell, row * ch, (f + 1) * cell, (row + 1) * ch))
        bb = cell_img.getbbox()
        if bb is None:
            continue
        box = bb if box is None else (
            min(box[0], bb[0]), min(box[1], bb[1]),
            max(box[2], bb[2]), max(box[3], bb[3]),
        )
    if box is None:
        return {"x": 0, "y": 0, "w": cell, "h": ch}
    return {"x": box[0], "y": box[1], "w": box[2] - box[0], "h": box[3] - box[1]}


def row_frame_counts(im: Image.Image, cw: int, ch: int, base: int, frames: int):
    """Frames actually drawn in each of the 4 facing rows.

    Packs sometimes give one facing a shorter animation and pad the rest of the
    row with blank cells — the market citizens' back-facing idle is 6 frames
    where the other three are 12. Looping all four to the sheet width would make
    that actor vanish for half its cycle, so the per-row counts are recorded and
    the engine loops each facing on its own length.

    Returns None when every row is full, which is the common case and keeps the
    manifest free of noise.
    """
    counts = []
    for d in range(4):
        r = base + d
        n = 0
        for f in range(frames):
            if im.crop((f * cw, r * ch, (f + 1) * cw, (r + 1) * ch)).getbbox():
                n = f + 1
        counts.append(n)
    if all(c == frames for c in counts):
        return None
    return counts


def parse_map(s):
    """'Rat1=rat1,Rat2=rat2' -> {'Rat1': 'rat1', ...}"""
    if not s:
        return {}
    out = {}
    for pair in s.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if "=" not in pair:
            sys.exit(f"--map entry needs SRC=id form, got: {pair}")
        src, dst = pair.split("=", 1)
        out[src.strip()] = dst.strip()
    return out


def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def collect_dir4(pack: Path, name_map, rows, group, fps, dry, clip_alias=None):
    clip_alias = clip_alias or {}
    """One PNG per clip, 4 rows = facings."""
    actors = {}
    png_root = pack / "PNG"
    if not png_root.is_dir():
        sys.exit(f"No PNG/ folder in {pack}")

    for variant_dir in sorted(p for p in png_root.iterdir() if p.is_dir()):
        src_name = variant_dir.name
        actor_id = name_map.get(src_name, slug(src_name))
        if name_map and src_name not in name_map:
            log(f"  skip {src_name} (not in --map)")
            continue

        sheet_dir = variant_dir / "Without_shadow"
        if not sheet_dir.is_dir():
            log(f"  skip {src_name}: no Without_shadow/")
            continue

        # Variant folder is e.g. "Gnoll1" but sheets are sometimes named for the
        # bare species ("Gnoll_Death_..."), and case does not always match the
        # folder ("Orc1/" holding "orc1_attack_..."). Accept both spellings.
        stem = re.sub(r"\d+$", "", src_name)
        pats = [
            rf"{re.escape(src_name)}_(.+?)_+without_shadow\.png$",
            rf"{re.escape(stem)}\d*_(.+?)_+without_shadow\.png$",
        ]

        clips, cell, anchor = {}, None, None
        for png in sorted(sheet_dir.glob("*_without_shadow.png")):
            clip = None
            for pat in pats:
                m = re.match(pat, png.name, re.I)
                if m:
                    clip = m.group(1)
                    break
            if clip is None:
                log(f"  ?? {png.name}: filename does not match "
                    f"<{src_name}>_<clip>_without_shadow.png — SKIPPED")
                continue
            # Some sheets carry a stray space before the suffix, and clip case
            # varies between packs.
            clip = re.sub(r"[^a-z0-9]+", "_", clip.strip().lower()).strip("_")
            clip = clip_alias.get(clip, clip)
            im = Image.open(png).convert("RGBA")
            w, h = im.size
            if h % 4:
                log(f"  !! {png.name}: height {h} not divisible by 4, skipping")
                continue
            c = h // 4
            if w % c:
                log(f"  !! {png.name}: width {w} not a multiple of cell {c}, skipping")
                continue
            cell = cell or c
            if c != cell:
                log(f"  !! {png.name}: cell {c} != {cell} for this actor, skipping")
                continue
            frames = w // c
            clips[clip] = {
                "file": f"{clip}.png",
                "frames": frames,
                "loop": not is_oneshot(clip),
            }
            rf = row_frame_counts(im, cell, cell, 0, frames)
            if rf:
                clips[clip]["rowFrames"] = rf
                log(f"  ~~ {actor_id}/{clip}: ragged rows {rf}")
            if clip in ("idle", "walk") and anchor is None:
                anchor = content_box(im, cell, rows["down"], frames)
            if not dry:
                out_dir = SPRITES / group / actor_id
                out_dir.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(png, out_dir / f"{clip}.png")

        if not clips:
            log(f"  skip {src_name}: no usable sheets")
            continue

        actors[actor_id] = {
            "group": group,
            "path": f"{group}/{actor_id}",
            "cell": cell,
            "fps": fps,
            "dirRows": rows,
            "clips": clips,
            "anchor": anchor or {"x": 0, "y": 0, "w": cell, "h": cell},
        }
        log(f"  + {actor_id:14s} cell={cell:<4d} clips={','.join(sorted(clips))}")
    return actors


def collect_dir4x2(pack: Path, name_map, rows, group, fps, dry):
    """One PNG for the whole actor: rows 0-3 walk, rows 4-7 idle."""
    actors = {}
    sheet_dir = pack / "PNG" / "Without_shadow"
    if not sheet_dir.is_dir():
        sys.exit(f"No PNG/Without_shadow/ in {pack}")

    for png in sorted(sheet_dir.glob("*_without_shadow.png")):
        src_name = png.name.replace("_without_shadow.png", "")
        if src_name.lower().startswith("shadow"):
            continue
        actor_id = name_map.get(src_name, slug(src_name))
        if name_map and src_name not in name_map:
            log(f"  skip {src_name} (not in --map)")
            continue

        im = Image.open(png).convert("RGBA")
        w, h = im.size
        if h % 8:
            log(f"  !! {png.name}: height {h} not divisible by 8, skipping")
            continue
        cell = h // 8
        if w % cell:
            log(f"  !! {png.name}: width {w} not a multiple of cell {cell}, skipping")
            continue
        cols = w // cell

        # Walk fills every column; idle is shorter and right-padded with blanks.
        idle_frames = cols
        for f in range(cols):
            box = im.crop((f * cell, 4 * cell, (f + 1) * cell, 5 * cell)).getbbox()
            if box is None:
                idle_frames = f
                break

        clips = {
            "walk": {"file": "sheet.png", "frames": cols, "rowBase": 0, "loop": True},
            "idle": {"file": "sheet.png", "frames": idle_frames, "rowBase": 4, "loop": True},
        }
        for cname, cdef in clips.items():
            rf = row_frame_counts(im, cell, cell, cdef["rowBase"], cdef["frames"])
            if rf:
                cdef["rowFrames"] = rf
                log(f"  ~~ {actor_id}/{cname}: ragged rows {rf}")
        anchor = content_box(im, cell, rows["down"], cols)

        if not dry:
            out_dir = SPRITES / group / actor_id
            out_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(png, out_dir / "sheet.png")

        actors[actor_id] = {
            "group": group,
            "path": f"{group}/{actor_id}",
            "cell": cell,
            "fps": fps,
            "dirRows": rows,
            "clips": clips,
            "anchor": anchor,
        }
        log(f"  + {actor_id:14s} cell={cell:<4d} walk={cols} idle={idle_frames}")
    return actors


def collect_grid(pack: Path, name_map, rows, group, fps, dry,
                 cell_w, cell_h, src_dir, clip_alias=None):
    """Flat folder of <Name>_<clip>.png, each a grid of non-square cells.

    Cell size cannot be derived here: a 128x192 sheet is equally consistent with
    4x4 cells of 32x48 and 4x8 cells of 32x24, so --cell is required.
    """
    clip_alias = clip_alias or {}
    actors = {}
    sheet_dir = pack / src_dir if src_dir else pack
    if not sheet_dir.is_dir():
        sys.exit(f"No such folder: {sheet_dir}")

    # Group the flat file list by character name
    by_name = {}
    for png in sorted(sheet_dir.glob("*.png")):
        # Some packs suffix every sheet with _without_shadow; it is not a clip.
        stem = re.sub(r"_with(out)?_shadow$", "", png.stem, flags=re.I)
        if re.fullmatch(r"(?i).*shadow.*", stem):
            continue   # a bare shadow sheet, not a character
        m = re.match(r"(.+?)_([A-Za-z0-9]+)$", stem)
        if not m:
            log(f"  ?? {png.name}: not <Name>_<clip>.png — SKIPPED")
            continue
        by_name.setdefault(m.group(1), []).append((m.group(2).lower(), png))

    for src_name, entries in sorted(by_name.items()):
        actor_id = name_map.get(src_name, slug(src_name))
        if name_map and src_name not in name_map:
            log(f"  skip {src_name} (not in --map)")
            continue

        clips, anchor = {}, None
        for clip, png in sorted(entries):
            clip = clip_alias.get(clip, clip)
            im = Image.open(png).convert("RGBA")
            w, h = im.size
            if w % cell_w or h % cell_h:
                log(f"  !! {png.name}: {w}x{h} is not a multiple of "
                    f"{cell_w}x{cell_h}, skipping")
                continue
            n_rows, frames = h // cell_h, w // cell_w
            if n_rows < 4:
                log(f"  !! {png.name}: only {n_rows} rows, need 4 facings, skipping")
                continue
            clips[clip] = {
                "file": f"{clip}.png",
                "frames": frames,
                "loop": not is_oneshot(clip),
            }
            rf = row_frame_counts(im, cell_w, cell_h, 0, frames)
            if rf:
                clips[clip]["rowFrames"] = rf
                log(f"  ~~ {actor_id}/{clip}: ragged rows {rf}")
            if clip in ("idle", "walk") and anchor is None:
                anchor = content_box(im, cell_w, rows["down"], frames, cell_h)
            if not dry:
                out_dir = SPRITES / group / actor_id
                out_dir.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(png, out_dir / f"{clip}.png")

        if not clips:
            log(f"  skip {src_name}: no usable sheets")
            continue

        actors[actor_id] = {
            "group": group,
            "path": f"{group}/{actor_id}",
            "cellW": cell_w,
            "cellH": cell_h,
            "fps": fps,
            "dirRows": rows,
            "clips": clips,
            "anchor": anchor or {"x": 0, "y": 0, "w": cell_w, "h": cell_h},
        }
        log(f"  + {actor_id:14s} {cell_w}x{cell_h}  clips={','.join(sorted(clips))}")
    return actors


def collect_coldir(pack: Path, name_map, rows, group, fps, dry, cell, src_dir,
                   baked_shadow=False):
    """Transposed sheets: direction is the COLUMN, frame is the ROW.

    Columns 0-3 are the walk cycle per facing, 4-7 the idle cycle. The farm
    asset pack ships <Name>_animation.png this way, which is the opposite
    orientation to every other pack.

    Rather than teach the engine a second orientation, the sheet is transposed
    here and written out row-major like everything else, so there is exactly one
    runtime convention.
    """
    actors = {}
    sheet_dir = pack / src_dir if src_dir else pack
    if not sheet_dir.is_dir():
        sys.exit(f"No such folder: {sheet_dir}")

    for png in sorted(sheet_dir.glob("*.png")):
        src_name = re.sub(r"_animation$", "", png.stem)
        actor_id = name_map.get(src_name, slug(src_name))
        if name_map and src_name not in name_map:
            continue

        im = Image.open(png).convert("RGBA")
        w, h = im.size
        if w % cell or h % cell:
            log(f"  !! {png.name}: {w}x{h} not a multiple of {cell}, skipping")
            continue
        n_cols, n_rows = w // cell, h // cell
        if n_cols < 8:
            log(f"  !! {png.name}: {n_cols} columns, need 8 "
                f"(4 walk facings + 4 idle), skipping")
            continue

        clips, anchor = {}, None
        for clip_name, col0 in (("walk", 0), ("idle", 4)):
            # Frame count varies per clip — trailing rows are blank when a clip
            # is shorter than the sheet is tall.
            frames = n_rows
            for r in range(n_rows):
                if not im.crop((col0 * cell, r * cell,
                                (col0 + 1) * cell, (r + 1) * cell)).getbbox():
                    frames = r
                    break
            if frames == 0:
                continue

            # Build the normalized sheet: 4 rows of facings, `frames` columns.
            out = Image.new("RGBA", (frames * cell, 4 * cell), (0, 0, 0, 0))
            for d in range(4):
                for f in range(frames):
                    src_col = col0 + d
                    out.paste(
                        im.crop((src_col * cell, f * cell,
                                 (src_col + 1) * cell, (f + 1) * cell)),
                        (f * cell, d * cell))

            clips[clip_name] = {
                "file": f"{clip_name}.png",
                "frames": frames,
                "loop": True,
            }
            rf = row_frame_counts(out, cell, cell, 0, frames)
            if rf:
                clips[clip_name]["rowFrames"] = rf
                log(f"  ~~ {actor_id}/{clip_name}: ragged rows {rf}")
            if anchor is None:
                anchor = content_box(out, cell, rows["down"], frames)
            if not dry:
                out_dir = SPRITES / group / actor_id
                out_dir.mkdir(parents=True, exist_ok=True)
                out.save(out_dir / f"{clip_name}.png")

        if not clips:
            log(f"  skip {src_name}: no usable clips")
            continue

        actors[actor_id] = {
            "group": group,
            "path": f"{group}/{actor_id}",
            "cell": cell,
            "fps": fps,
            "dirRows": rows,
            "clips": clips,
            "anchor": anchor,
        }
        # These sheets have the drop shadow painted in, so the engine must not
        # add its own underneath.
        if baked_shadow:
            actors[actor_id]["bakedShadow"] = True
        summary = ", ".join(f"{k}={v['frames']}" for k, v in sorted(clips.items()))
        log(f"  + {actor_id:14s} cell={cell:<4d} {summary}")
    return actors


def parse_cell(s):
    m = re.fullmatch(r"(\d+)x(\d+)", s.strip())
    if not m:
        sys.exit(f"--cell wants WxH, e.g. 32x48 — got: {s}")
    return int(m.group(1)), int(m.group(2))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack", type=Path, help="pack folder or .zip")
    ap.add_argument("--layout", required=True,
                    choices=["dir4", "dir4x2", "grid", "coldir"])
    ap.add_argument("--group", required=True,
                    help="output bucket, e.g. enemies / farm / npcs")
    ap.add_argument("--rows", default="DULR", choices=sorted(ROW_ORDERS),
                    help="row order (default DULR). Farm animals are DURL.")
    ap.add_argument("--map", default="",
                    help="SRC=id,SRC=id — rename actors and restrict to these")
    ap.add_argument("--clip-alias", default="",
                    help="OLD=NEW,OLD=NEW — rename clips after normalizing, to "
                         "reconcile packs that name the same animation "
                         "inconsistently between variants")
    ap.add_argument("--cell", default="",
                    help="grid layout: cell size as WxH, e.g. 32x48. "
                         "coldir layout: square cell size, e.g. 32x32")
    ap.add_argument("--baked-shadow", action="store_true",
                    help="the sheets already have a drop shadow painted in, so "
                         "the engine must not draw its own")
    ap.add_argument("--src-dir", default="",
                    help="grid layout only: subfolder inside the pack holding "
                         "the sheets, e.g. 2x")
    ap.add_argument("--fps", type=float, default=DEFAULT_FPS)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    workdir = REPO / ".asset-tmp"
    workdir.mkdir(exist_ok=True)
    pack = unzip_if_needed(args.pack, workdir)
    rows = ROW_ORDERS[args.rows]
    name_map = parse_map(args.map)

    log(f"pack   {pack}")
    log(f"layout {args.layout}  group {args.group}  rows {args.rows}")

    if args.layout == "dir4":
        actors = collect_dir4(pack, name_map, rows, args.group, args.fps,
                              args.dry_run, parse_map(args.clip_alias))
    elif args.layout == "grid":
        if not args.cell:
            sys.exit("--layout grid requires --cell WxH")
        cw, ch = parse_cell(args.cell)
        actors = collect_grid(pack, name_map, rows, args.group, args.fps,
                              args.dry_run, cw, ch, args.src_dir,
                              parse_map(args.clip_alias))
    elif args.layout == "coldir":
        if not args.cell:
            sys.exit("--layout coldir requires --cell WxH (square, e.g. 32x32)")
        cw, ch = parse_cell(args.cell)
        if cw != ch:
            sys.exit("--layout coldir needs square cells")
        actors = collect_coldir(pack, name_map, rows, args.group, args.fps,
                                args.dry_run, cw, args.src_dir, args.baked_shadow)
    else:
        actors = collect_dir4x2(pack, name_map, rows, args.group, args.fps, args.dry_run)

    if not actors:
        sys.exit("No actors produced — check --map and the pack layout.")

    if args.dry_run:
        log(f"\n[dry run] would write {len(actors)} actors, manifest untouched")
        return

    manifest = {"version": 1, "actors": {}}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text())
        manifest.setdefault("actors", {})
    manifest["actors"].update(actors)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    log(f"\nwrote {len(actors)} actors -> {MANIFEST.relative_to(REPO)} "
        f"({len(manifest['actors'])} total)")


if __name__ == "__main__":
    main()
