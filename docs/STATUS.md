# Where the art work stands

Written to be read cold, by me or anyone else, without the conversation that
produced it. Sibling docs: `ART-PIPELINE.md` is how the tools work and the
rules they enforce; `ASSET-INVENTORY.md` is pack-by-pack, including what was
rejected and why.

## Check it still works

```
./tools/test_render.py              # four viewport SHAPES x eight zones
./tools/test_render.py <dir>        # or some other build
./tools/test_play.py                # does it still play? (non-zero on failure)
./tools/audit_seams.py              # does a zone show its own tile grid?
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

1. **The source packs are not in the repo** and were not in the container this
   work was done in, so nothing new could be baked — only what is already in
   `assets/` could be re-used and retoned. Everything below that needs pack art
   is blocked until the zips are re-delivered.
2. **Mine props** — the Miner's Cave pack's `!$Metal Ores.png`, pit props,
   beams, ladders, lanterns and mine carts are still unused. The mine reads
   well now but every part of it is drawn, not imported.
3. **Terrain regions have square corners.** `clumpFill` cuts them on the tile
   lattice and only grass softens its edges (`_grassEdges`). A patch of sand in
   dirt ends in right angles. Every terrain pair wants that softening, not just
   grass.
4. **The town square is empty** — the street texture reads well and there is
   nothing standing on it. Content, not rendering.
5. **Ruins interior** is readable now but sparse — no furniture, no rubble
   props, and the torch vignette is the only lighting.
6. **True y-sorting.** `_treeIsInFront()` decides per tree from the entities
   near it, which is right except when two entities stand either side of one
   tree's root; the tree then goes in front of both. Sorting props and entities
   into one list is the real fix, and means restructuring the NPC, enemy,
   animal and player loops — several of which later slices patch again.
7. **Unexamined packs**: medieval interior, green village, green dungeon.

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
