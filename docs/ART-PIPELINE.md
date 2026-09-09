# Art pipeline

How a CraftPix sprite pack gets from a downloaded zip into the game.

## Layout

```
index.html                 the game
assets/js/sprite-engine.js runtime loader + animator (DHArt)
assets/js/sprite-lab.js    dev preview overlay, toggle with `
assets/sprites/            shipped art
  manifest.json            every actor the engine knows about
  enemies/rat_grey/idle.png walk.png run.png attack.png hurt.png death.png
  farm/goat/sheet.png
tools/prep_assets.py       zip/folder -> assets/sprites/ + manifest entry
```

Only the `Without_shadow` sheets are copied in. The `.aseprite` / `.psd` sources
and the `With_shadow` variants stay out of the repo — keep the original zips
somewhere outside it. Shadows are drawn by the engine instead so they react to
the day/night cycle.

## Running the game

Sprites load over `fetch` + `<img>`, which browsers block on `file://`. So serve
the folder:

```
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening `index.html` directly still works — the engine logs one warning and the
game falls back to the existing hand-drawn art everywhere. Nothing breaks.

## Adding a pack

1. Unzip it somewhere outside the repo.
2. Work out which layout it uses:
   - **`dir4`** — one PNG per animation, 4 rows = 4 facings.
     Path shape: `PNG/<Variant>/Without_shadow/<Variant>_<Clip>_without_shadow.png`
   - **`dir4x2`** — one PNG for the whole actor, 8 rows: walk on 0–3, idle on 4–7.
     Path shape: `PNG/Without_shadow/<Name>_without_shadow.png`
   - **`coldir`** — *transposed*: direction is the **column** (walk 0–3, idle
     4–7) and frame is the **row**. Transposed on import, so the engine only
     ever sees row-major sheets. Needs `--cell`. Add `--baked-shadow` if the
     frames already have a drop shadow painted in.
   - **`grid`** — flat folder of `<Name>_<clip>.png`, 4 rows = facings, cells
     need not be square. Needs `--cell WxH`, because cell size cannot be
     inferred: a 128×192 sheet is equally consistent with 4×4 cells of 32×48 and
     4×8 cells of 32×24. `--src-dir` picks the subfolder holding the sheets.
3. Run the tool with `--dry-run` first:

```sh
./tools/prep_assets.py ~/packs/some_pack --layout dir4 --group enemies \
    --rows DULR --map Wolf1=wolf_grey,Wolf2=wolf_black --dry-run
```

4. Drop `--dry-run` to write the files and merge into `manifest.json`.
5. Open the game, press `` ` `` and check the pack in the Sprite Lab.

`--map` both renames and filters: only the listed variants are imported. Names
become the actor id used everywhere in game code, so pick descriptive ones
(`rat_crimson`, not `Rat3`).

## Row order — the one thing you must check

Packs do not agree on which row is which facing, and it cannot be detected
automatically. Two orders cover everything seen so far:

| Flag | row 0 | row 1 | row 2 | row 3 | Seen in |
|---|---|---|---|---|---|
| `DULR` | down | up | **left** | **right** | rats, slimes, predator plants |
| `DURL` | down | up | **right** | **left** | cute farm animals |
| `DLRU` | down | **left** | **right** | up | Franuka townsfolk |

In the Sprite Lab the four columns are labelled DOWN / UP / LEFT / RIGHT. **If
the last two columns look mirrored, re-run `prep_assets.py` with the other
`--rows` value.** That is the whole check.

## Ragged rows — the other thing that bites

Some packs give one facing a shorter animation and pad the rest of its row with
blank cells. The market citizens' back-facing idle is **6 frames where the other
three are 12**; looping all four to the sheet width made those NPCs vanish for
half their cycle while walking away from the camera.

`prep_assets.py` now measures every facing row and, when they differ, records
`rowFrames: [12,12,12,6]` on the clip and prints a `~~ ragged rows` line. The
engine loops each facing on its own length. **If you see that line during an
import, it is informational, not an error** — but do check that facing in the
Lab.

## Anchoring

`prep_assets.py` measures the union bounding box of the down-facing idle/walk
frames and stores it as `anchor`. The engine centres the sprite on that box's
mid-x and stands it on the box's bottom edge, so a 128px rat cell and a 16px
rabbit cell land on the same ground line without per-actor tuning.

In the Lab, every row draws a red ground line. All four facings should touch it.
Attack frames often overflow it — that is correct, since explosions and lightning
are not part of the anchor.

## Using an actor from game code

The engine keeps animation state on the entity itself, as `_art`. Callers never
track frame counters.

```js
// inside a draw function, sx/sy are the existing screen coords
if (DHArt.ready('goat')) {
  DHArt.faceFromVector(a, a.vx, a.vy);            // or DHArt.face(a, 'down')
  DHArt.play(a, a.moving ? 'walk' : 'idle');
  DHArt.drawShadow(ctx, 'goat', sx, sy + 9, { size: 26 });
  DHArt.drawActor(ctx, 'goat', a, sx, sy + 9, { size: 26 });
} else {
  // existing hand-drawn code, untouched
}
```

There is no per-frame `step()` call. Frames are derived from wall-clock time
elapsed since `play()` last changed the clip, which means draw code does not
need a `dt` in scope — `render()` does not have one — and an actor animates at
the correct rate whether it is drawn once, drawn twice, or skipped entirely
while offscreen.

`size` is the drawn height of the sprite's **content**, not the cell, so `size:
26` means 26px tall on screen whatever the source cell size is.

### API

| Call | Does |
|---|---|
| `DHArt.ready(id[, clip])` | sheets decoded and safe to draw |
| `DHArt.has(id)` / `list()` / `info(id)` | manifest queries |
| `DHArt.progress()` | `{status, pending, loaded, failed}` |
| `DHArt.play(ent, clip[, {restart}])` | select clip; only resets frame if the clip changed |
| `DHArt.face(ent, dir)` | set facing to `'down'\|'up'\|'left'\|'right'` |
| `DHArt.faceFromVector(ent, dx, dy)` | set facing from movement; ties keep current facing |
| `DHArt.finished(ent, id)` | a one-shot clip reached its last frame |
| `DHArt.drawActor(ctx, id, ent, sx, sy, opts)` | draw. `opts: {size, alpha, flash, footY}` |
| `DHArt.drawShadow(ctx, id, sx, sy, opts)` | ground ellipse sized from the anchor box; a no-op for actors whose art has a shadow baked in |

`attack`, `hurt` and `death` are marked non-looping at prep time: they play once
and hold the last frame, and `finished()` goes true. Everything else loops.

## Current inventory

58 actors, 246 sheets. See `docs/ASSET-INVENTORY.md` for the full list and for
the packs not yet imported.

| Group | Actors |
|---|---|
| `enemies` | 33 creatures — rats, 9 slimes, plants, golems, orcs, gnolls, ents, ghosts, skeletons |
| `farm` | 11 ranch animals |
| `npcs` | 9 townsfolk (`folk_*`, 32×48) + 5 market citizens (`citizen1-5`, 32×32) |

Creatures have all six clips; orcs also have `run_attack` / `walk_attack`. Farm
animals, townsfolk and citizens have `walk` and `idle` only.

Actor ids matter for attribution: the credits screen groups by id prefix, so
`folk_*` is Franuka and everything else is CraftPix. Do not reuse a prefix
across authors.

## Credits

Importing a pack means adding its author to **both** `CREDITS.md` and the
`ART_CREDITS` table in `index.html`. Some packs are CC-BY, where the in-game
credit is a licence obligation rather than a courtesy.

## Item icons

Separate from the sprite engine, and simpler: one atlas plus a hand-curated map.

```
tools/icon-map.json     item id -> 'set:number', grouped and commented
tools/build_icons.py    packs the named icons into an atlas
assets/icons/items.png  the atlas, 16 icons per row at 32px
assets/icons/items.json { cell, cols, icons: { itemId: index } }
assets/js/icons.js      runtime (DHIcons) + the itemIcon() helper
```

To change or extend the mapping, edit `tools/icon-map.json` and re-run:

```sh
./tools/build_icons.py ~/packs/Fantasy_RPG_icon_pack_by_Franuka
```

The numbers are the ones in the pack's own `License and index.txt`, which are
also its individual PNG filenames — so picking an icon means finding it in that
index, not counting cells in a sheet.

### Using an icon

```js
`<span class="pr-icon">${itemIcon(itemId, 20, fallbackEmoji)}</span>`
```

`itemIcon` returns the icon when one is mapped and the emoji otherwise, both in
a box of the requested size so mixed rows still line up. Canvas callers use
`DHIcons.draw(ctx, id, x, y, size)`.

### Coverage is deliberately partial

114 of ~240 items have icons. The rest keep their emoji, because a wrong icon
reads worse than an emoji — a "Cloth cap" standing in for cloth, say. Some
entries are deliberate approximations that read correctly at 20px (pumpkin =
orange, wool = yarn, hoe = shovel); these are listed in the map's comment block.

Unmapped areas worth filling if a suitable pack turns up: badlands loot, jungle
crops and produce, most cooked meals, and the mine's quality-tiered ores.

## The player character

The player is the one thing that could not be a sprite drop-in: it is not a
fixed character but a customization system — gender, skin tone, hair style and
colour, shirt style and colour, trousers, hat — with its own creation screen and
save fields. A fixed sprite would have deleted that feature.

So nothing is baked. The CraftPix base packs ship unclothed mannequins, which is
exactly the right raw material: `tools/build_player.py` turns them into region
masks, and the runtime tints each region with whatever the player picked.

```
tools/build_player.py         base packs -> layers
assets/sprites/player/
  player.json                 clips, frame counts, per-frame head boxes
  {male,female}/
    <clip>.png                skin, shade-LEVEL encoded
    <clip>_torso.png          torso + arms   -> shirt colour
    <clip>_legs.png           legs + feet    -> trouser colour
    <clip>_head.png           head silhouette -> hair is cut from this
    <clip>_detail.png         eyes and mouth, never recoloured
assets/js/player-sprite.js    DHPlayer: composes and caches the finished sheet
```

Rebuild with:

```sh
./tools/build_player.py MALE_PACK FEMALE_PACK
```

### How the recolouring works

The source art uses a 6-step ramp (one outline plus five skin shades). The tool
collapses those to a **level 0-5 stored in the red channel**, so the runtime
maps level → colour without matching source RGB. The game's palettes are
`[shadow, mid, highlight]`; `ramp6()` expands each to six stops by adding an
outline below the shadow and midpoints between the stops.

### How the regions are found

- **Head** is free — the packs ship separate head and body part layers.
- **Waist** is found per frame as the narrowest row in the lower-middle of the
  body, so it tracks the legs through a walk cycle instead of assuming a fixed
  row. It is then raised one row: on these chibi proportions the legs are only
  ~3px, and trousers that stop at the hip read as boots.
- **Torso and legs exclude anything behind the head**, or the shirt paints over
  the chin — the body layer's shoulders sit behind the head in the source.

### Hair

Hair is **cut out of the head silhouette**, not drawn as a shape on top. The
game's original `_drawHair` draws a rectangular cap fitted to the old square
head; on this round skull it read as a bracket. Instead `HAIR_STYLES` in
`player-sprite.js` describes each style as coverage rules — how far down the
crown reaches, how far the sides hang — and the runtime keeps that portion of
the head mask and tints it. The hairline then follows the skull in every frame
and facing, including the walk cycle's head bob. Facing away, the whole head is
hair.

Hats still use the game's `_drawHat`, re-anchored to the measured head box.

### Sizing

Matched by measurement, not by eye: the painted character stands **40px tall
with its feet exactly on the anchor** `drawCharacter` is called with, so the
sprite uses `size: 38` at the same anchor. Toggling **Settings → Sprite
Character** swaps between them without the player appearing to shrink or float.

### The seam

`drawCharacter` is wrapped once. Both the in-world player and the character
creation preview go through it, so both re-skin together, and it falls through
to the painted character whenever the layers are missing or the setting is off.
`drawPlayer` sets `window._dhCharClip` each frame to pick idle / walk / run.

## Note for the Steam build

Keeping art as loose files (rather than base64 inside the HTML) is what makes an
Electron/Tauri wrap straightforward later: the wrapper ships this folder as-is.
The same folder zips directly for an itch.io HTML5 upload.
