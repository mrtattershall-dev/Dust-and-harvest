# Where the art work stands

Written to be read cold, by me or anyone else, without the conversation that
produced it. Sibling docs: `ART-PIPELINE.md` is how the tools work and the
rules they enforce; `ASSET-INVENTORY.md` is pack-by-pack, including what was
rejected and why.

## Check it still works

```
./tools/test_render.py              # four viewport SHAPES x eight zones
./tools/test_render.py <dir>        # or some other build
```
Non-zero exit on failure. It draws every overworld tile, enters all eight
zones, and separately clears the lazy tile caches to reproduce cold-start
ordering. It was written against a real black-screen bug and has been seen to
fail on the commit before that fix.

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
- **Mine** floor baked; `drawMineTile` now takes world tile coords.
- **Mobile** canvas sizing fixed for in-app browsers; touch layout verified.

## Known unfinished, roughly by value

1. **Jungle and ruins look flat** — 4-7 distinct colours in a sampled frame,
   against 12-16 for mine/ocean/hobo camp. Never examined properly.
2. **Mine walls and ore veins** still painted; walls are near-black boxes, the
   exit is a green square. `!$Metal Ores.png` in the Miner's Cave pack has
   real ore seams, and that pack also has pit props, beams, ladders, lanterns
   and mine carts.
3. **The well** at the player's spawn is a grey box with blue squares. No
   delivered pack has a well — this one needs painting, not importing.
4. **`TL.FENCE`** (131 tiles) and town `WALL` (109) still painted.
5. **Tree canopies draw under entities** — `drawOverhangProps` runs before the
   entity pass, so someone standing above a tree is drawn over its canopy. The
   fix is y-sorting props and entities in one list.

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
- **Measure, don't eye it.** A sack "with no fish in it" had two. Tile
  censuses before and after caught majority-smoothing quietly deleting the
  sand. Render icon candidates at size AND through the game's own `itemIcon`.
