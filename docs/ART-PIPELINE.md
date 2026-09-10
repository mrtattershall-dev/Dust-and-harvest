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

### RPG Maker sheets are 3x — reduce them

Several packs ship a `RPG Maker MV and MZ/` folder alongside the CraftPix
sheets. Those are the same art drawn at 3x for RPG Maker's 48px tiles: every
pixel is a 3x3 block. Slicing one at face value gives a sprite whose pixels are
three times the size of everything else on screen — right on its own, wrong
beside anything.

`prep_assets.py --downscale 3` reduces each sheet before slicing,
nearest-neighbour, so it is exact when the upscale was. A sheet that is not
close to an N x upscale says so rather than being quietly resampled; a few
percent is the artist's anti-aliasing (the sheep drops 3.3%) and is fine.

The reduced image is what gets written, not a copy of the source. That is worth
stating because the first version copied: the manifest's cell size and anchor
were measured from the reduced image while the sheet on disk stayed at 3x, so
the sprite sampled a 48x32 corner of a 144x96 frame and the sheep rendered as a
three-pixel dot.



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

**Use `scale` instead of `size` for a cast meant to differ in stature.** `size`
normalizes every actor to one height, which is right for unrelated creatures but
wrong for people: the townsfolk pack ranges from 28px of content (a child) to
42px (the alchemist's hat), and normalizing drew the child exactly as tall as
the adults. `scale: 0.85` keeps them in proportion and standing on the same
ground line.

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
| `DHArt.drawActor(ctx, id, ent, sx, sy, opts)` | draw. `opts: {size, scale, alpha, flash, footY}` |
| `DHArt.drawShadow(ctx, id, sx, sy, opts)` | ground ellipse sized from the anchor box; a no-op for actors whose art has a shadow baked in |

`attack`, `hurt` and `death` are marked non-looping at prep time: they play once
and hold the last frame, and `finished()` goes true. Everything else loops.

## Current inventory

61 actors, 260 sheets. See `docs/ASSET-INVENTORY.md` for the full list and for
the packs not yet imported.

| Group | Actors |
|---|---|
| `enemies` | 33 creatures — rats, 9 slimes, plants, golems, orcs, gnolls, ents, ghosts, skeletons |
| `farm` | 12 ranch animals, plus `dog` (Amos's dog) |
| `npcs` | 9 townsfolk (`folk_*`, 32×48), 5 market citizens (`citizen1-5`, 32×32), and `hunter` (48×48, Amos the trapper) |

Creatures have all six clips; orcs also have `run_attack` / `walk_attack`. Farm
animals, townsfolk and citizens have `walk` and `idle` only.

Actor ids matter for attribution: the credits screen groups by id prefix, so
`folk_*` is Franuka and everything else is CraftPix. Do not reuse a prefix
across authors.

## Wiring a new character into the page

`index.html` is one baked file with a 1.7MB script block, and the order things
run in inside that block is not the order they are written in. Amos the trapper
was added this pass; every one of these was found by the game misbehaving, not
by reading the code.

**Map landmarks must be declared before `buildMap()`, not beside their NPC.**
The trapper's `const TRAPPER_TX/TY` originally sat with the rest of his module
at line ~9800. `buildMap()` runs at line ~5850 and clears his ground, so it hit
the temporal dead zone: *Cannot access 'TRAPPER_TY' before initialization*.
Coordinates that world-gen reads live with `CHEST_TX` and friends, above
`buildMap()`. Only the runtime pieces — the panel, the draw call — go in the
character's own module.

**Clear your ground last.** `buildMap()` makes several passes over the same
tiles: a wilderness fill, a tree/rock scatter, then a ranch-zone pass that
re-randomises the whole SW quadrant (`x<34`, `y36–70`). A clearing written
before a later pass is simply overwritten, silently — the camp was buried and
the only symptom was grass where dirt should be. Put landmark clearings at the
very end of `buildMap()`, and check the 3x3 with `getT()` in a test rather than
by eye.

**`useTool()` is not the interaction path everywhere.** The traveling merchant
hangs off `useTool()`, which is the obvious template — but that only works
because he stands in town. In the Wilderness zone the `KeyE` handler tries
gathering, then attacking, and only reaches `useTool()` if both miss, so a
wilderness NPC wired that way never opens. Standing NPCs belong in the
adjacency block beside Maya and Rex. The touch ACT button synthesises a `KeyE`
keydown, so that one block covers both inputs and no separate touch path is
needed.

**Phones have no Escape key.** An overlay whose only keyboard exit is Escape is
unclosable on mobile if its CLOSE button is ever missed. Let `KeyE` toggle it
shut the way talk/chest/farmhand do, and allow `KeyE` through the
key-swallowing guard.

**A new overlay needs two registrations.** Add its id to `OVERLAY_IDS` (so
`isAnyOverlayOpen()` hides the touch controls under it) and to the modal-sizing
CSS selector list (so it cannot overflow a phone screen). Neither is automatic
and neither fails loudly.

**Confirm nothing overrides you.** Before believing a draw function runs, grep
the whole file for its name: a later Slice can reassign `window.yourFn`, and a
pixel-diff test will happily report success while the override draws something
else. The check that actually catches it is a draw-call trace — wrap
`DHArt.drawActor`, call your draw function, and assert on the ids it pushed.

## Camp decorations

`tools/build_camp.py` cuts seven pieces out of the Hunter's Lodge pack into
`assets/camp/` — one small atlas of named rects, 5 KB, blitted by
`drawTrapper()` at fixed offsets.

```
./tools/build_camp.py <path-to-fantasyrpghunterslodge-pack>
```

A third atlas rather than reusing one of the two that exist, because it is
neither: `assets/props/` is a 32px grid keyed by tile coordinate and scatters
a variant across every tile of a type, and `assets/sprites/` is cell grids,
clips and facings. A 51×58 tanning rack that belongs at one specific place is
neither of those.

**Find rects by component scan, identify them by looking.** The scan gives
honest bounding boxes, but its indices are ordered by position, which is not
the order anything reads in. Picking by index put a coil of rope where the
campfire should be and a pile of kindling where the crate should be. Crop each
candidate, render it at 4×, label it with its coordinates, and look — the same
rule the icon pass earned.

**Split the layout by depth.** Props with a positive y offset stand in front
of the character and must be drawn after him, or he floats over his own
campfire. Two lists, `CAMP_BEHIND` and `CAMP_FRONT`, drawn either side of the
actor.

**Give the props room.** Six pieces plus a man and a dog do not fit in a 3×3
clearing — 48px at 16px tiles, against ~20px of character. Amos's clearing is
5×5.

## HUD frames

The overlays are DOM, not canvas, so their art is applied with CSS
`border-image` rather than drawn. `tools/build_ui.py` bakes the pieces from
Franuka's RPG UI pack into `assets/ui/` — 11 files, 2.4 KB total.

```
./tools/build_ui.py <path-to-RPG_UI_pack_by_Franuka>
```

**1x only.** The pack ships 1x/2x/3x and the larger two are exact
nearest-neighbour upscales (measured by `assert_native`, same check the ground
tool makes). CSS scales the 1x art with `image-rendering: pixelated`, so a 3x
file would be nine times the bytes for pixel-identical output — and unlike a
baked file, a CSS factor can respond to screen size. `--ui-art` is that factor:
2 on desktop, 1 under 560px, whole numbers only.

**Colorized, not hue-shifted.** The pack is pastel and spans six unrelated
hues; the game is brown and amber on near-black. `retint()` assigns the target
hue outright, shifts lightness so the mean matches, and scales saturation by
ratio. It does **not** average hue — hue is an angle, and a mean across the
0/1 wrap is meaningless: a frame whose pixels sit at 0.02 and 0.97, both red,
averages to 0.5, which is cyan. The first version of the tool did that and
produced purple panels and green buttons.

**Slice values are read off the art, not guessed.** `panel_wood` is sliced at
12 because its corner nails reach x=8..11 and a smaller inset cuts one in half;
`btn` at 4; `slot` at 2, because that piece is a flat field with a one-pixel
lip and a wider slice would scale the flat middle and lose the lip. Dump a
piece as ASCII before picking a number.

**Two things every framed element needs.** A `border-image` with `fill` paints
the pack's centre slice, which is semi-transparent — so the element keeps an
opaque `background` of its own or the world shows through it. And `.ui-panel`
is a class while `#invOverlay` is an id, so the id's own `background` and
`border` must be **deleted**, not just overridden; a class cannot outrank an
id.

### What is framed, and what deliberately is not

`.ui-panel` is on the 18 centred modal panels. Three groups are left flat on
purpose:

* **The always-on HUD chips** — `stat-pill`, `timeDisp`, `goldDisp`,
  `zoneDisp`, `seasonTag`, `msgBanner`, `farmPanel`, `invTooltip`. A 24px
  plank frame on a stat pill is absurd, and these already read correctly.
* **The full-screen scrims** — `saveSlotModal`, `difficultyModal`,
  `charCustomModal`, `confirmModal` are `inset:0` backdrops, not panels.
* **Buttons whose colour carries meaning** — `.btn-sell` is green and
  `.btn-buy` is blue, and that difference is the fastest thing to read in the
  market. `.tbtn` keeps its `border-left` accent because that marks the
  selected tool. Only `.panel-close`, which is neutral and appears in every
  header, became a `.ui-btn`. Art that erases a functional signal is a
  downgrade however good it looks.

The hotbar's selected slot was a rust border plus an ember top edge;
`border-image` replaces both, so selection moved to the pack's amber slot,
which is what that piece is for and reads far better at 57px than a 1px edge.

### Size the panels off `.ui-panel`, not off a list

The mobile guard that keeps a panel inside the screen used to be a
hand-maintained list of ids. It went stale exactly as you would expect:
`daySummary` was never added and overflowed an 844x390 landscape screen the
moment the frame made it taller. The guard now leads with `.ui-panel`, so
every framed panel is covered and so is the next one somebody adds. The id
list is kept behind it as a backstop for the unframed few.

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

188 of 219 items have icons. The rest keep their emoji, because a wrong icon
reads worse than an emoji — a "Cloth cap" standing in for cloth, say. Some
entries are deliberate approximations that read correctly at 20px (pumpkin =
orange, wool = yarn, hoe = shovel); these are listed in the map's comment block.

The 31 still on emoji have no honest match anywhere in the delivered packs:
mostly crafted hardware (`ironSpike`, `copperFitting`, `mineBrace`), a few
jungle crops (`darkroot`, `ashgrain`, `crimsonBloom`, `caneReed`) and the
deep-ocean treasures. **A new icon pack is not the answer** — the one
delivered for this (*Armor and Weapons RPG Icons*) is helmets, swords and
shields, and this game has neither.

### Two rules the coverage pass earned

**Share one icon across a kind rather than forcing near-matches.** All 19
seeds already share one packet. Cooked dishes now share five vessels — pot,
plate, glass, jar, loaf — because twenty near-identical bowls read worse than
five clear ones, and every list view puts the name beside the icon. A jungle
or ocean variant borrows the icon of the item it is a variant of: `jgWood`
takes `wood`'s log, `canopyMelon` takes `watermelon`'s melon.

**Render every candidate at size before mapping it.** Matching from a
thumbnail contact sheet is how `caneReed` got a green slime, `jgWood` a bread
roll, `canopyMelon` an apple with a skull on it, and `watermelonSlice` a cut
of meat — all four looked plausible at 32px in a grid of 300 and were obviously
wrong at 192px. The check that catches it is cheap: render the picks large,
labelled, and look, then render them again *through the game's own*
`itemIcon()` at the size a panel actually draws them.

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

### Shirt styles

Same technique: `SHIRT_STYLES` describes each garment as a rule over the torso
mask — which pixels it covers, and where it shifts a level darker or lighter so
accents stay inside the player's chosen colour ramp.

| Style | Rule |
|---|---|
| Work shirt / full | covers everything |
| Vest | drops the sleeve columns |
| Rolled sleeves | drops sleeves below the elbow |
| Jacket | full cover, collar and lapels one level darker |
| Suspenders | full cover with two straps two levels darker |
| Blouse | full cover, collar one level lighter |
| Prairie dress | full cover, and the leg region takes the shirt colour |
| Tied shirt | cropped above the waist, leaving a midriff |

Bare shoulders with only the straps covered was the first attempt at suspenders
and it turned to mush — the torso is ~11px wide, so a 2px strap against bare
skin does not read at all. Dark straps over full cover is legible at 26px and
still obviously not the plain work shirt.

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

## Scatter props

Rocks, bushes, skulls and bones were each one hand-painted shape repeated across
the entire map. The desert tileset ships dozens of named 32×32 variants of
exactly those things, so they are now picked per tile.

```
tools/prop-map.json     group -> source filenames
tools/build_props.py    packs them into an atlas
assets/props/props.png  one atlas, 16 per row at 32px
assets/props/props.json { cell, cols, groups: { name: [index, ...] } }
assets/js/props.js      DHProps.draw(ctx, group, sx, sy, tx, ty)
```

Rebuild with:

```sh
./tools/build_props.py ~/packs/deserttilesettopdownpixelart
```

### Variant choice is derived, not stored

`DHProps.draw` hashes the tile coordinate — the same mix the fog uses — and
indexes the group with it. A given rock is therefore always the same rock: no
per-tile data to store, nothing added to saves, and no flicker as the camera
moves. Groups can share a source file (a small bush serves both the overworld
and the badlands) and it is packed only once.

Currently wired: `TL.ROCK` (24 variants), `TL.BUSH`, `BL.SKULL_ROCK`,
`BL.TUMBLEWEED`, `BL.BL_BONE`. Every call site keeps its painted shape as the
`else` branch, so a missing atlas changes nothing.

Only 32×32 objects are used. The pack's 64×64 and 128×128 pieces — large trees,
mesas, pyramids, full ruins — need multi-tile handling and are left for later.

## Ground surfaces

Grass, dirt and sand are the packs' own art now. None of it arrives as
32×32 game tiles, and the packs fail to supply them in two different ways, so
the tool bakes two different ways.

**Everything is 16×16 native.** Every pack checked — desert, farmlands, green
forest, green village, farm-with-animals — draws at 16px. Their `32x32.png`
sheets are exact 2× nearest-neighbour upscales, verified, not assumed. Using
those would double the pixel size against the props and characters already in
the game, so the 16px sources are used at 1:1 and a game tile spans 2×2 of them.

**`scatter` — the desert pack's ground is a flat colour.** Every sand tile in
`Ground_grass.png` and `Water_coasts.png` measures a standard deviation of
exactly 0 — one solid `rgb(210,178,104)`. All the texture lives in `spots.png`,
a sheet of loose mottling blobs meant to be strewn over that colour. There is
nothing to slice, so the blobs are lifted out and re-scattered.

**`mosaic` — the farm packs ship interchangeable cells.** Their grass and dirt
come as small textured 16px cells that are *mutually seamless*: any cell can
follow any other in either direction with no visible join. That makes them a
random mosaic rather than a tile set, and it is a property that has to be
measured, so the tool measures it (see *Mutual seams*).

```
tools/build_ground.py       extracts the blobs and bakes the textures
assets/ground/ground.png    terrains stacked vertically, 512px each
assets/ground/ground.json   { period, tile, terrains: { name: {oy} } }
assets/js/ground.js         DHGround.draw(ctx, name, sx, sy, tx, ty)
```

Rebuild with:

```sh
./tools/build_ground.py ~/packs/deserttilesettopdownpixelart
```

### Why one big texture instead of tile variants

Sand has no per-tile structure to repeat, so a variant set is the wrong shape
for it — a grid of stamps reads as a grid however many stamps you cut. Instead
the blobs are scattered onto a single wrap-seamless texture and each map tile
samples the window at `(tx*T mod period, ty*T mod period)`. Neighbouring tiles
therefore show neighbouring pieces of one continuous surface: no tile grid, no
repeated cell, no seams.

Two rules keep that working:

- **The period is a whole number of tiles** (512 = 16 tiles at `T` = 32), so a
  tile never straddles the texture edge and every draw is a single blit.
- **Blobs are extracted as connected components, never as rectangles.** A blob
  is always whole, so there is no cut edge that has to line up at the wrap — it
  is what makes the seam invisible rather than merely subtle.

Placement is clustered, not uniform: patches of blobs falling off around a
centre, plus loose grains between them. Uniform scatter looks like even
speckling, which is the one thing sand never looks like.

`SEED` in the tool is fixed, so a rebuild is byte-identical.

### Where the ground art came from

Every one of the 56 delivered packs was scanned for grass and sand ground —
each PNG reduced to its native scale, cut on a 16px grid, every fully-opaque
cell classified by hue and measured for self-tiling. The result is worth
recording because it is smaller than it looks:

- **Grass: the library holds exactly one outdoor turf.** The farmlands, green
  forest, green village and green dungeon tilesets all ship the *same* art —
  flat base `rgb(84,126,100)` with the same textured variants over it. Of 57
  distinct native grass cells across every pack, 5 join seamlessly; the rest are
  dungeon moss, cave crystal, or a brighter green from a different palette that
  tiles as visible patches. There is no second grass to choose between.
- **Sand: the desert pack is the only true sand ground.** Everything else the
  scan turned up as "sand" was a UI panel, a book page, red roof tile, or the
  cobbled `Walls_street` surface shared by the town packs — that last one is
  real ground, but it is pavement, and it belongs to `TL.TOWN_FLOOR`, not here.

Two traps this scan walked into first, both worth knowing:

- **Upscaled sheets.** Most packs ship the same tileset at 1×/2×/3×/4×, and the
  RPG Maker `A5` sheets are upscales too — `RF_Green Forest_A5.png` is an exact
  3× of 128×256 art. Slicing one on a 16px grid yields cells built from
  magnified pixels that look fine alone and wrong beside everything else. A
  first pass "found" 17 extra grass variants this way; all were artefacts. The
  tool now refuses any source that is an exact upscale.
- **Hue tests that are too loose.** `r >= g >= b` calls red roof tiles sand.

### Mutual seams, and why cells get flipped

A mosaic is only safe if every cell joins every other cell invisibly. The tool
checks all ordered pairs in both directions and compares the worst join against
the *grain* the artist already drew — the average neighbouring-pixel step inside
the cells. A seam no larger than the grain cannot be seen, because the texture
already varies that much; a seam under 8/255 cannot be seen either way. If a
pair fails, the build stops and names the two cells rather than shipping a
visible grid (`--loose` overrides).

Four near-identical cells still repeat on the 16px grid, which reads as
wallpaper — the dirt did exactly that on the first bake. Flipping and rotating a
cell moves its motif inside the square and breaks the lattice, but it also
changes the cell's edges, so each transform is *tried and measured*: it is kept
only if the whole set stays seamless with it added.

```
dirt   4 cells, seam  7.79 <=  8.00   + 8 from flip-h, rot-90
grass  4 cells, seam  2.85 <= 12.52   +20 from flip-h, flip-v, rot-90, rot-180, rot-270
```

Dirt's edges are asymmetric enough that flip-v and rot-180 push the join over
tolerance, so they are dropped. That is measured per terrain, not assumed.

### Tone, which is a separate test

A clean join is not sufficient. Two cells can meet edge-to-edge perfectly and
still read as blocks, because what shows at a glance is the difference in
overall tone, not the join. A darker grass variant passed the seam test at
11.88 against a tolerance of 12.36 and tiled as obvious dark squares — the exact
grid artefact the mosaic exists to avoid.

So the mean colours of a set are checked separately and must sit within 18 of
each other. That cell measures 28.5 from its neighbours and is now rejected by
name. The current sets: grass 11.5, dirt 1.4.

### Terrains

The scatter terrains are all the same sand under different light. A terrain
names the **colour it should end up** and the tool works out the HLS move from
the pack's own sand, applying it to the mottling as well as the flat ground —
so contrast survives instead of flattening. Naming the target beats naming a
hue rotation once there is more than one of them to keep in tune.

| Name | Kind | Tile | Base |
|---|---|---|---|
| `grass` | mosaic | `TL.GRASS`, `TL.FLOWERS` | `#598166` — farmlands turf, plus one greenforest variant |
| `dirt` | mosaic | `TL.DIRT` | `#8f4f35` — farmyard packed earth |
| `sand` | scatter | `TL.SAND` | `#d2b268` — the desert pack's sand |
| `dust` | scatter | `BL.DUSTFLOOR` | `#d89b62` — badlands, orange-shifted |
| `street` | scatter | `TL.TOWN_FLOOR` | `#a38762` — walked-on town dust |
| `road` | scatter | `TL.ROAD` | `#8f7c66` — wagon track, greyer |
| `pen` | scatter | `TL.PEN_FLOOR` | `#8a6840` — churned earth |

Retuning any of them is one hex value and a rebuild.

**Hue and lightness move by addition; saturation moves by ratio.** Subtracting
saturation drains the mottling to grey long before the flat ground gets there,
because the blobs start less saturated than the base and the same subtraction
takes them further. The first bake of the street did exactly that: grey pebbles
on warm tan, which is the one thing a western palette cannot be.

Each terrain's baked base colour is written into `ground.json`, so the value the
game needs is recorded rather than inferred from the tool source.

The game's own colour tables were moved to match: `TC[TL.SAND]`, `TC[TL.ROAD]`,
`TC[TL.PEN_FLOOR]`, `BL_TC[BL.DUSTFLOOR]`, both minimap tables and the
`_blBase()` depth fallback. Overlay tiles sample those for the ground they sit
on, so a missed one shows as a tile whose edge does not match its neighbour.

### What the ground replaced

These are not additions layered over the painted tiles — the painted art they
stand in for is deleted, leaving a one-line flat fill as the fail-soft branch.

| Tile | Was | Removed |
|---|---|---|
| `TL.ROAD` | four inline RGB arrays baking a cobblestone texture pixel-by-pixel | **40,467 chars** — 48% of all tile-drawing code |
| `TL.TOWN_FLOOR` | a hard `(tx+ty)%2` checkerboard of two flat tans, across all 915 town tiles | 630 chars |
| `TL.PEN_FLOOR` | `%5` and `%4` tests that produced a checkerboard despite a comment saying otherwise | 837 chars |
| — | a second `TL.ROAD` branch, unreachable in the same if-else chain | 270 chars |

41KB off the page, 2.1% of the file.

The cobble was good art in the wrong genre: a frontier town has dust streets and
wagon ruts, not medieval paving. The `Walls_street` sheet shared by seven town
packs was rejected for the same reason — it is laid brick and castle wall.

### Not done, and why

- **`TL.STONE` (598 tiles)** — draws as identical dark rounded blobs. It is an
  overlay tile rather than ground, so it belongs in the prop pipeline with the
  rocks, not here.
- **`TL.WATER` (152 tiles)** — still stripes per tile the way the old ground
  did. The desert pack ships animated water sheets, which need frame handling
  the ground pipeline does not have.
- **The road and terrain-edge sets** — `freepathandroad` and the packs'
  `Ground_grass` sheets are mostly *transition* pieces for terrain meeting
  terrain. The game has no terrain-edge concept, so they need autotiling first.
  `TL.GRASS` keeps its 4px neighbour blend, which is the cheap stand-in.

- **`BL.CRACKED`** — the pack's `sand.png` is not sand at all; it is a set of
  thin vertical *crack segments* meant to stack into continuous fissures. That
  is real cracked-earth art and a genuine match for this tile, but scattering it
  the way the mottling is scattered would give disconnected dashes. It needs a
  crack-path generator, which is a different job.
- **`BL.REDROCK`** — no red sandstone terrain in the pack. Stays painted.
- **Cliff and ledge transitions** — `Ground_grass.png` rows 0–34 are edge pieces
  for terrain meeting terrain. The game has no terrain-edge concept, so wiring
  them means adding autotiling first.
- **`Sand_element1`–`11`** — dune mounds with baked drop shadows. Objects, not
  ground; they belong in the prop pipeline, not here.

## Note for the Steam build

Keeping art as loose files (rather than base64 inside the HTML) is what makes an
Electron/Tauri wrap straightforward later: the wrapper ships this folder as-is.
The same folder zips directly for an itch.io HTML5 upload.
