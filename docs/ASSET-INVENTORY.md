# Asset inventory

53 unique packs (56 delivered, 3 exact duplicates). Status of each, and what
each category still needs before it can reach the game.

Source zips are **not** in this repo — only the normalized output under
`assets/sprites/`. Keep the originals somewhere safe; re-importing needs them.

---

## Imported — 61 actors, 260 sheets

(Counted from `assets/sprites/manifest.json`, not by hand.)

Live in `assets/sprites/manifest.json`. Creature actors have
`idle walk run attack hurt death`; farm animals and townsfolk have
`walk` + `idle` only.

| Group | Actors |
|---|---|
| Rats (128px) | `rat_grey` `rat_armored` `rat_crimson` |
| Slimes (64px) | `slime_blue` `slime_gold` `slime_imp` · `slime_bomb` `slime_fire` `slime_void` · `slime_moss` `slime_bone` `slime_ash` |
| Plants (64px) | `plant_ember` `plant_azure` `plant_orchid` |
| Golems (128px) | `golem_stone` `golem_iron` `golem_magma` |
| Ents (128px) | `ent_sapling` `ent_elder` `ent_ancient` |
| Orcs (64px) | `orc_scout` `orc_brute` `orc_warlord` — also `run_attack` `walk_attack` |
| Gnolls (64px) | `gnoll_scav` `gnoll_hunter` `gnoll_alpha` |
| Ghosts (64px) | `ghost_wisp` `ghost_wraith` `ghost_revenant` |
| Skeletons (64px) | `skeleton_bones` `skeleton_guard` `skeleton_lord` |
| Farm (16–64px) | `horse` `foal` `goat` `goatling` `goose` `gosling` `rabbit` `rabbit_cub` `chicken` `cow` `pig` `sheep` — `walk` + `idle` only |
| Citizens (32×32) | `citizen1`–`citizen5` — market square townspeople |
| Townsfolk (32×48) | `folk_farmer` `folk_fisherman` `folk_blacksmith` `folk_merchant` `folk_alchemist` `folk_barmaid` `folk_bartender` `folk_kid1` `folk_kid2` |
| Hunter's Lodge | `hunter` (48×48) `dog` (32×32) — Amos the trapper and his dog |

**Ranch coverage: 7 of 7 species.** `chicken`, `cow` and `pig` come from
*Top-Down Farm with Animals*; `goat`, `horse` and `rabbit` from *Cute Farm
Animals*, which also supplies `goatling`, `foal` and `rabbit_cub` for the
game's `_baby` state.

**Sheep closes the set.** An earlier note here said no delivered pack had one.
That was wrong: *Top-Down Farmlands* ships `!$Sheep.png` in its RPG Maker
folder — a full four-direction walk cycle — and it was missed because the
sprite survey only looked at the CraftPix sheet layouts, not the RPG Maker
ones. Those sheets are the same art drawn at 3x, so it imports through the
new `--downscale` flag.

That is 33 hostile actors against roughly a dozen enemy types currently in the
game, so this category is already oversupplied. More monster packs are not the
bottleneck.

---

## Enemies — assessed and rejected

The 33 hostile actors above are imported and animating, but **none of them are
wired into combat**, and that is deliberate.

The game's roster is western: bandits, wolves, rattlesnakes, vultures,
scorpions, jaguars, spiders, a pirate skiff. The imported roster is generic
fantasy: slimes, orcs, skeletons, golems, ents, ghosts, gnolls. **There is no
human enemy sprite in any pack delivered so far**, which rules out bandits,
raiders, outlaws and desperados — the enemies the player meets most.

Mapping honestly, only two survive:

| Game enemy | Sprite | Why it works |
|---|---|---|
| `jungleBoar` | `pig` | Four-legged, right silhouette, right size |
| `dustDevil` | `ghost_wisp` | Formless drifting hazard either way |

Two swaps is not worth a pipeline, and the rest would be worse than the painted
art: an orc in the badlands reads as a different game. The honest fix is a
western enemy pack (humans with hats and rifles, desert wildlife), not more
fantasy monsters.

The sprites stay imported. If the game ever grows a cave, ruin or haunted zone,
the golems, skeletons and ghosts are already in the manifest and animating.

---

## Townsfolk — imported and partly wired in

Maya, Trader Rex and the Farm Hand render as sprites (`NPC_SPRITES`), as do all
five hobo camp residents (`HC_NPC_SPRITES`): Dale, Vera, Simons, Dr. Lena and
Kit.

Two of the nine townsfolk are deliberately unused. The **Alchemist** is a purple
witch — wrong century and continent for a dusty frontier — and the **Bartender**
has a full beard, which ruled it out for the female roles that were left.
Sprites are reused across zones where needed; the characters are never on screen
together, and a wrong-looking character reads worse than a repeated one.

### The painted NPCs are finished art, not a backlog

An earlier version of this file listed the remaining painted characters as
though they were waiting to be replaced. They are not. Every one of them was
checked, and every one is deliberate character art with a pose and a story that
a generic standing townsperson would destroy:

| Character | Where | What the painted art does |
|---|---|---|
| Silas | the mine | sits on a crate, "barely bobs — old and still" |
| Maren | the dock | dockmaster in a teal oilskin, rolled boot cuffs |
| Briggs | badlands mine | seated against the wall, knees up, survey vest — "he's been here 3 years" |
| Elsbeth | badlands mine | same seated treatment |
| The traveling merchant | the road | trail-worn boots, pack |
| Tobias, Kit, Malu, Ren, Pira | jungle village | per-character: battered wide-brim hat, stubble, a manifest belt |

The jungle five are worth a note of their own: `_drawJGNPC` is defined twice.
The first definition really is two coloured rectangles, and a later
`window._drawJGNPC` replaces it with the per-character art. Reading only the
first one — which is what a search for the function finds — gives exactly the
wrong impression, and this file gave it. **The file is a monolith with
monkey-patched overrides; a function's first definition is not necessarily the
one that runs.**

So the sprite packs have no NPC left to replace. Any further character sprite
is new content, not a swap.

**`Fantasy_RPG_character_pack`** (Franuka) — 9 NPCs, `walk` + `idle`:
Farmer, Fisherman, Blacksmith, Merchant, Alchemist, Barmaid, Bartender,
Kid01, Kid02.

Probably the single most directly useful pack delivered. The game has ~15 named
NPCs (Silas, Maya, Rex, Jed, Crane, Maren, Kit, Tobias, Vera, the five hobo camp
residents) all drawn by hand in canvas path code.

This needed the `grid` layout: cells are **32×48, not square**, and the earlier
layouts derived cell size from `height / 4`, which would have produced 48×48
cells and misaligned every frame. Row order is `DLRU`, a third variant.

**Licence: CC-BY 4.0 — requires visible credit to Franuka.** The others are
CraftPix licence (commercial use fine, redistribution of the raw assets not).
Both matter for a paid Steam release; see *Licensing* below.

---

## Tilesets — 6 packs, 2.6 MB, native 16×16

`greenforest` · `greenvillage` · `greendungeon` · `medievalinterior` ·
`minerscave` · `topdownfarmlands`

Each ships `All Tileset/{16,32,48,64}.png`.

**Correction:** an earlier note here said the 32×32 sheets "match the game's
`T = 32` exactly". They match in *size*, not in resolution. All of these packs
are **16×16 native**; the 32, 48 and 64 sheets are exact nearest-neighbour
upscales (verified by re-downscaling and comparing). Drawing the 32px sheet at
1:1 would render every art pixel at 2×2 screen pixels — twice the size of the
props, characters and sand already in the game. The 16px sheets are the ones to
use, with a game tile spanning 2×2 of them.

| Pack | 32×32 grid |
|---|---|
| `topdownfarmlands` | 32 × 43 tiles — **grass imported** |
| `medievalinterior` | 35 × 21 |
| `minerscave` | 26 × 29 |
| `greenforest` | 26 × 15 |
| `greendungeon` | 26 × 23 |
| `greenvillage` | 17 × 20 |

This is the biggest visual change available and the most invasive. `drawTile()`
is a ~800-line switch that draws all 54 `TL.*` tile types with canvas paths.
Doable incrementally — one tile type at a time, falling back to the painted
version for anything unmapped.

**Done so far: `TL.GRASS`, `TL.FLOWERS` and `TL.DIRT`** — 55% of the overworld
between them. Not via a tile atlas: these packs have no per-tile ground
structure to slice. Their grass and dirt are small 16px cells that are mutually
seamless, so `tools/build_ground.py` lays them as a random mosaic on one
wrap-seamless texture, the same surface the sand uses. See `docs/ART-PIPELINE.md`.

**Also done: `TL.TOWN_FLOOR` (14.3%), `TL.ROAD` and `TL.PEN_FLOOR` (5.9%)** —
packed dust, a wagon track and churned earth. That pass deleted the art it
replaced rather than layering over it, including 40KB of inline RGB arrays that
baked a cobblestone texture into the page: 41KB off the file, 2.1% of it.

**Not yet: `TL.STONE` (9.4%) and `TL.WATER` (2.4%).** `TL.STONE` is an overlay
tile rather than ground — dark rounded blobs standing on whatever is beneath —
so it belongs in the prop pipeline with the rocks. `TL.WATER` needs frame
handling for the desert pack's animated water sheets.

**The `Walls_street` sheet is rejected, not pending.** It appears in seven town
packs (tavern, chapel, guild hall, mage tower, blacksmith, nobles manor,
training arena) and an earlier note here called it the obvious `TL.TOWN_FLOOR`.
Looking at it, it is medieval castle wall and laid tan brick — a European town
square. A frontier street is packed dust and wagon ruts, so the town floor was
built from the desert pack's sand instead, retinted. Same reason the cobblestone
that `TL.ROAD` used to bake into the page went out.

The terrain-*edge* sets across these packs stay unusable until the game has an
autotiling concept; it currently has none, only a 4px colour blend on grass.

### Ground survey — all 56 packs

Every pack was scanned for grass and sand ground: each PNG reduced to native
scale, cut on a 16px grid, every opaque cell classified by hue and measured for
self-tiling. The library is narrower than the pack count suggests.

**Grass exists once.** `topdownfarmlands`, `greenforest`, `greenvillage` and
`greendungeon` ship the *same* turf — flat `rgb(84,126,100)` with the same
textured variants. Of 57 distinct native grass cells in the whole library, 5
join seamlessly and are in use. The rest are dungeon moss, cave crystal, or a
brighter green (`rgb(110,162,75)` in the farm pack, `rgb(122,173,85)` in the
mage tower) that tiles as visible patches against the main turf.

**Sand exists once too.** Only `deserttileset` has real sand ground. Everything
else the scan flagged was a UI panel, a book page, red roof tile, or pavement.
`pixelarttrainingarena` carries the identical flat `rgb(210,178,104)`,
confirming the shared palette but adding nothing.

So the current choices are not a first-fit — they are the only fit. More
tileset packs would not widen this; a pack in a *different* palette would.

---

## Object / building packs — 16 packs, 10.9 MB

Camp · chapel · guild hall · mage tower · blacksmith · nobles manor · tavern ·
herbalist hut · training arena · fishing village · farm-with-animals · dungeon ·
undead · free dungeon · paths and roads · adventure book.

CraftPix "object sheet" format: a handful of large PNGs of furniture, buildings
and props, plus `.tmx` files showing intended arrangement. Not sprite sheets —
these are decor atlases with irregular object sizes.

Needs an atlas-region pipeline: a named-region map (`"anvil": [x,y,w,h]`) rather
than a uniform grid. The `.tmx` files help but do not fully define the regions,
so this is the most hand-work per pack of any category.

Directly relevant to existing locations: fishing village → your Ocean/Dock zone,
blacksmith → the forge, herbalist hut and tavern → town buildings, camp → the
hobo camp, farm-with-animals → the ranch, miner's cave → the mine.

`topdownfarmwithanimals` is **partly imported** already — its chicken, cow and
pig sprites are in use, and `ground_grass_bricks.png` now supplies the main
map's packed earth. Its buildings, barn interior and plant tiles are not; the
same sheet also holds cobble and water for a later pass.

Its `All Tileset` sheet also contains a **sheep** (plus dog, wolf, buffalo),
which would close the ranch's one missing species noted above.

---

## UI and icons — 6 packs, 119.6 MB

| Pack | Contents | Note |
|---|---|---|
| `Free__Raven_Fantasy_Icons` | 6,580 icons, one sheet at 16/32/64px | Uniform grid — easiest icon win |
| `Fantasy_RPG_icon_pack_by_Franuka` | 4,580 icons, base set + expansions | CC-BY |
| `rpgultimate` | 579 item sprites in 12800×128 strips (100 frames of 128px) | Weapons, loot, props, GUI |
| `RPG_UI_pack_by_Franuka` | **Frames, slots, buttons and dividers imported.** 11 pieces in `assets/ui/`, baked by `tools/build_ui.py` and colorized onto the game's palette; 2.4 KB total. The "ship one scale only" note is now measured, not assumed: the 2x/3x files are exact nearest-neighbour upscales of the 1x, so CSS scales the 1x instead. **Still unused:** the animated spellbook, resource orbs, checkboxes, cursors, title banners, the gamepad/keyboard input glyphs, and the three .ttf fonts. |
| `hpmanastamina…` | `Bars.png` 368×976, plus icons | **Assessed and rejected — the earlier "drop-in" note here was written from the file listing, not from looking at the art.** The sheet is ~20 bar frames and almost all are high fantasy: feathered wings, gemstones, scrollwork, a serpent. Two plain wood-and-brass frames could be retinted, which is not worth a pipeline when the HUD's existing bars already read correctly. |
| `rpguielements` | **PSD only, zero PNGs** | Unusable as delivered — needs export from Photoshop/GIMP first |

The icon packs mattered because the game used to render **every inventory item
as an emoji** (`🥕` `⛏` `🐟`), which renders differently per OS and looks wrong
next to pixel art. **Done:** `tools/icon-map.json` maps all 114 items onto 96
unique icons, packed by `tools/build_icons.py` into a 19 KB atlas and drawn by
`assets/js/icons.js` through `itemIcon()` — inventory grid, seed pouch, chest,
hotbar, tooltips and the nine market/shop rows. Items with no mapped icon fall
back to their emoji, so nothing goes blank.

The Minecraft expansion inside `Fantasy_RPG_icon_pack_by_Franuka` is
**deliberately excluded** from the atlas: those icons copy a trademarked game's
item designs, which is not a risk worth taking on a paid Steam release.

---

## Duplicates and stragglers

- `dpixelfishingvillage…_2` — byte-identical to the non-`_2` copy, ignore.
- `hpmanastamina…_2` — byte-identical, ignore.
- `freetopdowntreespixelart` — 164 tree PNGs, no `.tmx`. Individual trees rather
  than a tileset; fits the object-atlas pipeline.

---

## Later delivery — 4 packs

| Pack | Status |
|---|---|
| `pixelartmarketsquare…` | **Citizens imported** (5 actors). Its stall traders, lute player and flutist are single-row strips — one facing only, so they need a `strip` layout. `Objects.png` is market decor for the object pipeline. |
| `topdownvillagefarmanimals…` | **Not imported.** Buffalo, Buffalo_cub, Cat, Colt, Dog, Donkey, Drake, Duck, Duckling. **No sheep.** None map to an existing ranch species, so using these means *adding new livestock or pets* — a game-design change, not an art swap. |
| `freepixelartplantsforfarm` | **Assessed and rejected.** `Plants.png` is a crop growth-stage sheet: 4 stages per crop, ~10 crops, at native 32px, each crop drawn twice (tilled soil and grass). The pack grows grapes, beans, chili, cauliflower, squash, pumpkin, pineapple, wheat and sunflower; the game grows 19 crops, and only **pumpkin, pepper and dustwheat** match cleanly. Six sprite crops beside thirteen painted ones would look worse than thirteen painted ones, so `drawCrop` stays as it is until a pack covers the roster. |
| `freebasicpixelartuiforrpg` | **Assessed and rejected.** Its buttons carry baked English labels (RESUME, SETTINGS, BUY) in a green that is nowhere in this game, and the game's own labels (ACT, TILL, SELL EVERYTHING) do not match the set. Its `Main_tiles.png` nine-slice panels in wood-and-parchment are genuinely usable, but Franuka's pack covers the same ground with separate files and no baked text, so there is nothing here worth a second pipeline. |

---

## Latest delivery — 7 packs

| Pack | Assessment |
|---|---|
| `deserttileset…` | **Strongest match in the whole library — props and sand now imported.** Sand, rock, cacti, skulls, bones, ruins, pyramids, dead trees. It ships ~250 **individually named** object PNGs in `Objects_separately/`, which sidesteps the atlas-region problem that makes the other object packs expensive. 50 of those objects back `TL.ROCK`, `TL.BUSH`, `BL.SKULL_ROCK`, `BL.TUMBLEWEED` and `BL.BL_BONE` (`tools/prop-map.json` → `assets/props/`), and the sand surface backs `TL.SAND` and `BL.DUSTFLOOR` (`tools/build_ground.py` → `assets/ground/`). **Correction:** this pack is **16×16 native**, not 32×32 — its own `Tiled_files/*.tmx` set `tilewidth="16"`. The objects are 32×32 and larger because they span several tiles, not because the grid is 32. Density still matches the game at 1:1; nothing is scaled. **Still pending:** the 64×64 and 128×128 pieces (large trees, mesas, pyramids, ruins), which need multi-tile handling, and the cliff/ledge transition tiles, which need autotiling the game does not have. **Assessed and rejected for TL.TREE and TL.STONE:** the pack's trees are 64px oasis palms with sand or grass discs baked into them (wrong for a dusty wilderness, and the discs clash with the ground underneath), and its big rocks are 64px stacked cairns with grass tufts at the base — neither a mountain face nor stone ground. There is no 32px tree in the pack at all. TL.STONE is served instead by a `stonewall` group derived from the pack's own 32px boulders, recoloured cold at bake time (`tools/build_props.py`). |
| `topdownfarmwithanimals…` (`Objects_outside.png`) | **Trees imported — the good ones.** Broadleaf, conifers, gnarled old trees and bushes at several sizes, with grass tufts at the base, in `assets/fixtures/` as `tree_oak` `tree_pine` `tree_gnarled` `tree_round` `tree_sapling` `tree_scrub` `tree_shrub`. These are what green ground uses; the desert pack's sand-disc trees are kept for dry ground. **Note the scale rule:** this pack is 16px-per-tile and the game is 32px, which is why its *fence tiles* are unusable — a grid-aligned tile must fill a tile. It does not disqualify free-standing props, which only need matching pixel **density**, and at 1:1 these do. An 80px tree is simply two and a half tiles tall instead of five. `Houses.png`, `Water_coasts.png`, `Plants.png` and `wicket_animation.png` are still unexamined. |
| `dpixelfishingvillage…` | **Surveyed, not yet imported — and worth returning to.** `Exterior_objetcs.png` has four timber houses with shingle roofs (more frontier than the Hunter's Lodge cabin, and candidates for the town's buildings), **fish drying racks** that would suit the river's `TL.FISHING_SPOT` tiles, plus barrels, crates, sacks, a net frame and fish crates. Also `piles.png` (dock piles), `Water_coasts.png` and two water-detail sheets. Nothing here is a well. |
| `freechapelpixelart…` | **Graveyard furniture imported; the chapel rejected.** The building is a gothic cathedral with spires, a rose window and stained glass — European, and nothing to do with a dust-bowl town. Its headstones are the opposite: six of them are in `assets/fixtures/` as `grave1`–`grave6` and make a boot hill west of town at x38–44, y19–21. Its wrought-iron fencing and flowers are still unused. |
| `freetopdownpixelartguildhall…` | **Assessed and rejected.** Half-timbered Tudor with red tile roofs and a "GUILD HALL" sign board — medieval fantasy village, not frontier. The wheelbarrow, crates and barrels in it duplicate props already imported. |
| `freeglassblowersworkshop…` | **Assessed and rejected.** Same Tudor architecture as the guild hall. |
| `free2dtopdownpixeldungeon…` | **Assessed and rejected for the mine.** Blue-grey dressed castle masonry — arches, wooden doors, flagstone. The mine is a rough-hewn frontier shaft, so this is the wrong material as well as the wrong palette, and colourising it would not fix the architecture. It is also 16px per tile (its own `.tmx` says so) against the mine's 32px, so its walls could not fill a tile anyway. |
| `freeundeadtileset…` | **Assessed and not imported.** `Ground_rocks.png` is a chasm/cliff-edge autotile set — jagged dark rock that would suit a mine face, but it is edge tiles, and the game has no autotiling. Searching it for flat ground cells turns up only the sheet's plain background fill, not the cracked earth visible in the composed tiles. Worth revisiting if autotiling ever lands. |
| `minerscavetopdowntileset…` | **Its colour is imported; its tiles are not.** The mine floor is now a baked `minefloor` scatter whose base is derived from `#b9946b`, 42% of this pack's cave floor. Its cobble *cells* were tried first as a mosaic and the tool refused them three times: row 5 is not fully opaque, (4,2) is 69 apart in tone from (3,0), (3,2) is 42 apart, and the three that survived the tone check do not join (seam 67 against tolerance 27). That block is an autotile set with directional edges and per-cell lighting. Its 32/48/64 sheets are exact nearest-neighbour upscales of the 16px one (measured), so they are no help either. **Still unused and worth returning to:** `!$Metal Ores.png` (ore seams for the vein tiles), the wooden pit props, beams, ladders, lanterns and mine carts. |
| `medievalinteriortopdown…` | **Not yet examined.** |
| `greenvillagetopdown…` | **Not yet examined.** |
| `greendungeonpixelart…` | **Not yet examined.** |
| `freebase4direction{male,female}…` | **Naked mannequins — now the player base.** Bald, unclothed bodies, 13×22px of content in a 64px cell, with full `dir4` clip sets (idle/walk/run/attack/hurt/death, plus Sword variants). Unusable as characters on their own, which turned out to suit the customization system: `tools/build_player.py` splits each frame into skin / torso / legs / head / detail masks and `assets/js/player-sprite.js` tints and composites them per save, so hair, shirt, trousers and hat all still come from the creation screen. |
| `fantasyrpghunterslodge…` | **Characters and camp props imported.** The hunter (48×48, `DLRU`, ragged idle rows `[12,12,12,6]`) and the dog (32×32, `DLRU`) are in the manifest as `hunter` and `dog`; eight pieces from `Exterior_objects.png` and `Trap.png` are in `assets/fixtures/` (`tools/build_fixtures.py`) and make Amos's camp at map (48,44) — seven decorations plus **the lodge itself**, a 144×146 log cabin drawn by the overhang pass with a 3×2 solid footprint under its walls. The camp moved from (48,39) so the cabin's roof, which reaches four and a half tiles above its base, clears the river at y34–35. **The tanning / taking-knife / leaving-knife animations are rejected, not pending:** their frames are 48×48 with content filling the cell edge-to-edge (bbox 0,0–40,42) because the hide rack is drawn into them — they are scenes, not character clips, unlike the idle whose content is a 20×26 figure centred in the cell. Feeding one to the sprite engine draws a second, clipped hunter over Amos. The rack is in the camp atlas instead, which is the same art without the problem. **Still unused:** the interior tiles, doors and fireplace, which would need a whole interior zone rather than an art import. |
| `fishingandgatheringicons` | 14 sheets, `Fish1`–`Fish10` plus gathering icons, 32px tall strips. Maps directly onto the game's fish items. |
| `armorandweaponsicons` | **Its furniture is imported; its icons are not.** `Icons.png` is 200-odd helmets, breastplates, swords and shields, and this game has no armour and no weapons as items — none of it maps, and the original note here calling the pack "uniform icon grids" had been written from the file listing rather than from opening it. But `Furniture.png` ships its shelf and trestle table **bare** as well as loaded, and the bare ones now furnish the market square (`assets/fixtures/`, `tools/build_fixtures.py`) with this game's own item icons laid out on them. Rejecting the whole pack on the strength of its icons was the wrong call; the fixtures were always the usable part. **Still unused:** every icon in it, and the loaded variants of the furniture. |
| `freebasicpixelartuiforrpg` | **Duplicate** of the copy delivered earlier. |

### On the player character

The art style called out as preferred is CraftPix's market-square/base-character
family — the same family as the imported `citizen1`–`citizen5`.

Putting the **player** in that style is not a drop-in. The base packs have no
clothes or hair, and the game's player is not a fixed sprite: `drawCharacter`
is ~1,200 lines driving a customization system (gender, skin tone, hair style
and colour, shirt style and colour, trousers, hat) with its own creation UI and
save fields. Any fixed sprite replaces that system rather than re-skinning it.

Three ways forward were considered, in increasing cost:
1. **Use a citizen sprite as the player.** Immediate, in the liked style, but
   character customization goes away — the creation screen would need removing
   or reducing to a name field.
2. **Keep customization, restyle by hand.** Redraw `drawCharacter`'s output to
   match the citizens' proportions. No new art needed; keeps the feature.
3. **Layer the base body.** Use the base mannequin plus clothing and hair drawn
   per facing and per frame. Preserves customization in the new style, but the
   clothing art does not exist in any delivered pack.

**Option 3 was taken, with the clothing generated rather than drawn.**
`tools/build_player.py` reads each base frame and emits region masks — skin,
torso, legs, head, detail — encoded as shade levels 0–5 in the red channel,
plus per-frame head boxes. `assets/js/player-sprite.js` expands a 3-stop palette
ramp to 6 stops per save field and composites the layers, cutting hair from the
head silhouette and placing hats from the measured head box. Shirt styles
(suspenders / full / vest / rolled / jacket, and the female set) are pixel rules
over the torso mask, not separate art.

`drawCharacter` is wrapped rather than replaced: one seam covers both the
in-world player and the creation-screen preview, and it falls through to the
painted character when the sheets are missing or `settings.spriteChar` is off.
Every creation-screen field still does what it did.

---

## Licensing — needs attention before Steam

Two different licences are mixed together here:

- **CraftPix** (most packs): commercial use permitted; redistributing the raw
  assets is not. Fine for a shipped game, and their free packs generally ask for
  attribution — check each `license.txt`.
- **CC-BY 4.0** (Franuka's character pack, icon pack, UI pack): commercial use
  permitted **but requires visible credit**.

**Done:** the title screen has a CREDITS button, and `CREDITS.md` mirrors it.
Character counts there are read from the live manifest, so they cannot drift.
Keep both updated as packs are imported — tracing which pack an asset came from
after the fact is painful.

This is a summary of the licence files as shipped, not legal advice; read the
`license.txt` in each pack before release.
