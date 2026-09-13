# Where the art work stands

Written to be read cold, by me or anyone else, without the conversation that
produced it. Sibling docs: `ART-PIPELINE.md` is how the tools work and the
rules they enforce; `ASSET-INVENTORY.md` is pack-by-pack, including what was
rejected and why.

## Check it still works

```
./tools/test_render.py              # four viewport SHAPES x eight zones
./tools/test_render.py <dir|file>   # or another build, or the standalone
./tools/test_play.py                # does it still play? (non-zero on failure)
./tools/test_play.py dist/dust-and-harvest.html    # ...and does the SHIPPED file?
./tools/audit_seams.py              # does a zone show its own tile grid?
./tools/tile_sheet.py               # every tile type of every zone, side by side
```
Non-zero exit on failure. It draws every overworld tile, enters all eight
zones, and separately checks the cold-start cache ordering. It was written
against a real black-screen bug and has been seen to fail on the commit before
that fix.

`test_play.py` boots a new game, walks about with the real frame loop running,
opens every modal panel, visits every zone, and fails on any uncaught error. It
also checks the loop is still ALIVE afterwards, which is not redundant:
gameLoop() ends with its own requestAnimationFrame, so an uncaught throw stops
it dead rather than skipping a frame, and only one error is ever emitted — on
the first frame, during boot. The first version of that test cleared boot noise
from its error list and so threw away the only report of the fault; it passed
clean with a deliberate throw wired into every dirt tile. Verified in both
directions now.

`tile_sheet.py` draws each tile type as a 3x3 patch OF ITSELF, labelled, into
`dist/tiles-<zone>.png`. It is the fastest way to find art that still looks
like a prototype — walking the map does not work, because you see what you
happen to walk past and stop seeing what you pass often. Its first run found
six placeholders on the overworld, four of which I had walked past repeatedly.
A 3x3 patch rather than one tile, because the commonest defect is a tile that
looks fine alone and outlines itself when tiled.

`audit_seams.py` is a SCREENING tool and exits zero — it has a known
false-positive class (anything deliberately banded: masonry courses, the gap
between deck boards, a shoreline). Read its list, do not trust it. It has
caught four real defects that were invisible in screenshots, including one I
introduced in the same commit that fixed the identical defect elsewhere. Its
header documents two earlier versions of it that reported everything clean
while measuring nothing; verify any change to it in both directions.

The cold-start check tests the INVARIANT (drawing a dirt tile must fill the
lazy caches other tiles index), not the symptom. It used to test the symptom —
an unguarded consumer throwing — and when every consumer became guarded the
check started passing on a copy with the bug deliberately put back. Verify any
change to it in both directions, as that one was.

## Rebuilding assets

```
./tools/build_ground.py    <desert> <farmlands> <greenforest> <farmwithanimals> <minerscave>
./tools/build_props.py     <desert>
./tools/build_fixtures.py  <hunterslodge> <armorweapons> <desert> <farmwithanimals> <fishingvillage> <chapel>
./tools/build_icons.py     <franuka-icon-pack>
./tools/build_standalone.py         # one runnable .html into dist/ (gitignored)
```
Source zips are not in the repo. `dist/` is a build artifact.

Both tests take a single .html file as well as a directory, so run them against
`dist/dust-and-harvest.html` before handing it over: that file is what ships,
and it goes through the asset-inlining shim, which the served build does not.

## Done

- **Overworld ground** 92% of tiles from baked art. Terrain clumps into
  regions (quantile-cut smooth field), stone and other solids stay scattered.
- **Props** trees via an overhang pass (props taller than a tile), rocks,
  bushes, a `stonewall` group derived by recolouring `rock` so impassable
  stone reads differently from the gatherable node.
- **HUD** nine-slice frames on 18 modal panels, hotbar slots, close buttons.
- **Icons** 188 of 219 items.
- **Content** Amos the trapper + camp + lodge; market stalls for Maya and
  Rex; a boot hill west of town.
- **Badlands** terrain clumped; `BL.CRACKED` repainted (it drew an X per tile).
- **Mine** every wall, vein, shaft and exit cut into one `drawMineRock()` face;
  all ore through one `drawOreSeam()`; timbered adit for the exit and ladders
  in the shafts. The badlands mine shares this renderer.
- **Jungle, deep jungle, ruins** ground on baked terrain through
  `DHGround.drawToned()`, which retones a band to a named mean colour once into
  an offscreen canvas. One turf, three exposures, chosen by `JG_BIOME`.
- **Fence and gate** drawn from their four neighbours, over whatever ground
  they stand on. **Town wall** on baked stone with staggered courses.
- **The well** painted properly; **crates** wired to the baked fixtures.
- **Kit's settlement** built: cabins, drying racks, stores, fires, scrub. It
  was 400 identical tiles and one campfire.
- **Every zone-transition marker** off the "pulsing coloured rectangle"
  pattern — the badlands exit, the jungle exit, the dock's gangplank arrow, the
  badlands portal and the hobo portal were the brightest things in their zones
  and all five read as placeholders rather than as exits.
- **The barn, the forge, the workbench, the campfires, the wells, the feed
  trough, the ore deposits, the vents and the deadwood** all rebuilt as things
  standing on ground rather than as boxes.
- **Town props** scattered against a rule — a prop only goes on a floor tile
  that touches a wall, so street furniture stands against buildings and the
  routes stay clear without needing to know where they are.
- **Tree depth** `drawOverhangProps(cx, cy, late)` runs twice a frame and each
  tree picks its side from the entities near it.
- **Badlands** its three largest surfaces rebuilt: cracked earth as a
  connected polygonal network on a world-coordinate lattice, red rock and mesa
  with strata running on world y, sulfur as a crust that feathers at its edges.
- **Hobo camp and the dock** taken off flat per-tile fills and onto the baked
  ground; both had a light strip along every tile's top edge and a dark one
  along its bottom, which outlined every tile in both zones.
- **Water** retinted across the ocean into the same teal family as the rest,
  with swells running on world y and depth shelving against the bank.
- **Jungle characters** on sprite art through JG_NPC_SPRITES.
- **Mobile** canvas sizing fixed for in-app browsers; touch layout verified.

## Known unfinished, roughly by value

1. **The mine's walls and floor are almost the same colour.** With the ore now
   readable the next thing you see is that you cannot tell rock from floor
   without looking for the ore. The Miner's Cave pack cannot help: it is
   16px-native and its `32x32.png` is that sheet doubled, so its wall tiles at
   1:1 would be half this game's pixel density. `drawMineRock()` is the place.
2. **Mine props** — the Miner's Cave pack's pit props, barrels, crates, rails,
   mine carts, boulders and lanterns are cut-ready at 1:1 (16px props are half
   a tile, which is the right size for scatter) and still unused. The ore
   chunks and the loaded ore carts are baked; only the chunks are wired in.
2. **Feed trough** is still hand-painted, and no pack examined so far ships a
   trough: the farm pack's barn interior has only an empty bench and an empty
   rack, both drawn as dark silhouettes for an unlit barn. Left as it is on
   purpose, not overlooked.
3. **Terrain regions have square corners.** `clumpFill` cuts them on the tile
   lattice and only grass softens its edges (`_grassEdges`). A patch of sand in
   dirt ends in right angles. Every terrain pair wants that softening, not just
   grass.
4. **A zone's own copy of a shared tile type.** The hobo camp has its own
   renderer for TL.WELL, TL.CRATE, TL.TREE and more, so fixing the overworld's
   did nothing for it; the ocean and the badlands have their own too. Worth
   checking the tile sheets side by side when changing anything shared.
5. **True y-sorting.** `_treeIsInFront()` decides per tree from the entities
   near it, which is right except when two entities stand either side of one
   tree's root; the tree then goes in front of both. Sorting props and entities
   into one list is the real fix, and means restructuring the NPC, enemy,
   animal and player loops — several of which later slices patch again.
6. **Unexamined packs**: medieval interior, green village, green dungeon,
   tavern, nobles manor, mage tower, herbalist's hut, market square, and —
   most relevant to this game's setting — `craftpixnet874337deserttilesettopdownpixelart`.

## The source packs ARE here

This section used to say the opposite, in this file, in the commit messages and
to the person who owns the game, and on that basis a barn, a forge, a
workbench, a well, five signposts, a dead tree and a palm tree were all painted
by hand while the art for every one of them sat in the library. I had looked in
two places, found nothing, and concluded instead of looking.

They are in `/root/.claude/uploads/<session-id>/` as ~70 zips, extracted to
`.asset-tmp/packs/` (gitignored). `tools/build_fixtures.py` takes that directory
as its root and resolves each piece by glob, so it runs anywhere the packs are
extracted:

    python3 tools/build_fixtures.py [PACKS_ROOT]     # default .asset-tmp/packs

**Before using a pack, measure its native scale.** The detector is in
`.asset-tmp/sheet.py`: a sheet is an N-fold nearest upscale if every NxN block
is uniform. The farm pack's `Houses.png` is step 1 — native, usable at 1:1.
The farmlands pack's `32x32.png` is step 2 — a 16px-native sheet doubled, so
its props at 1:1 are half this game's pixel density and cannot be used beside
the rest of the art. `size_in_file / native_step` is what you are actually
getting.

## Traps this file exists to stop you re-learning

- **Temporal dead zone.** Anything `buildMap()` reads must be declared above
  it, not beside its draw code. This bit three times: `TRAPPER_TY`, `MAYA_TX`,
  `BOOT_HILL`. The throw happens while the script block is still initialising,
  so it takes every later `const` with it and the visible symptom is an
  unrelated "cannot access X before initialization".
- **`drawTile`'s branches are not pure drawing.** The dirt branch builds the
  fence and gate caches as a side effect. Putting an early `return` in front
  of it blanked the screen for anyone with a fence on-screen.
- **A pack's 32/48/64 sheets are usually exact upscales of its 16px art.**
  Measured, every time. 16px grid-aligned tiles cannot fill this game's 32px
  tile; free-standing props only need matching pixel density and are fine.
- **Autotile sets are not variant sets.** Farm dirt, undead rock and miner's
  cobble all look like interchangeable variants and are not: directional
  edges, per-cell lighting. The seam and tone checks catch it.
- **Cull bounds are world pixels.** Comparing against `canvas.width` makes
  them ZOOM times too generous.
- **Tests that set `player.x/y` measure nothing** — the camera eases. Set
  `gameState.camera` directly.
- **The map is not the same twice.** `buildMap()` uses `Math.random` through
  `clumpFill`, so tile positions differ between page loads. A probe that finds
  a tile in one run and asserts about it in another is testing nothing — find
  and assert in the same evaluate.
- **A function's first definition may not be the one that runs.** Later slices
  reassign `window.drawJGTile` and friends. Trace an actual call before editing
  either copy; `drawJGTile` has a dead definition 8000 lines above the live one.
- **Detail hashed off `sx`/`sy` crawls.** Screen coordinates move with the
  camera, so anything seeded from them slides across the world as the player
  walks. Seed from `tx`/`ty`. Found in the mine (every wall, vein and floor
  detail) and the ruins (moss and floor stains).
- **Banding at the tile pitch is the commonest way a zone looks like a
  prototype.** A flat fill, a light strip along the tile's top edge, a dark one
  along its bottom: every tile is then outlined and the zone reads as a grid.
  It was in the hobo camp, the beach, the mine's rock, the mesa and the water,
  and it is invisible in a screenshot once you stop expecting it. Shade where
  the THING starts and stops, not where the tile does. `audit_seams.py` finds
  it.
- **Detail at a fixed offset inside every tile repeats as a pattern.** Three
  strata at the same three heights, the same three triangles of sulfur, one
  crack squiggle per tile. Put it on world coordinates and it becomes rock
  beds, a crust, a crack network.
- **Measure, don't eye it.** A sack "with no fish in it" had two. Tile
  censuses before and after caught majority-smoothing quietly deleting the
  sand. Render icon candidates at size AND through the game's own `itemIcon`.
