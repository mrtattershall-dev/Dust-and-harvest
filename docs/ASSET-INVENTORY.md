# Asset inventory

43 unique packs (45 delivered, 2 exact duplicates). Status of each, and what
each category still needs before it can reach the game.

Source zips are **not** in this repo — only the normalized output under
`assets/sprites/`. Keep the originals somewhere safe; re-importing needs them.

---

## Imported — 12 packs, 41 actors, 212 sheets, 4.2 MB

All use the `dir4` layout and are live in `assets/sprites/manifest.json`.
Every actor has `idle walk run attack hurt death` unless noted.

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
| Farm (16–64px) | `horse` `foal` `goat` `goatling` `goose` `gosling` `rabbit` `rabbit_cub` — `walk` + `idle` only |

That is 33 hostile actors against roughly a dozen enemy types currently in the
game, so this category is already oversupplied. More monster packs are not the
bottleneck.

---

## Townsfolk — 1 pack, needs a new layout handler

**`Fantasy_RPG_character_pack`** (Franuka) — 9 NPCs, `walk` + `idle`:
Farmer, Fisherman, Blacksmith, Merchant, Alchemist, Barmaid, Bartender,
Kid01, Kid02.

Probably the single most directly useful pack delivered. The game has ~15 named
NPCs (Silas, Maya, Rex, Jed, Crane, Maren, Kit, Tobias, Vera, the five hobo camp
residents) all drawn by hand in canvas path code.

Why it needs new code: cells are **32×48, not square**, and the layout is
4 cols × 4 rows per file with `walk` and `idle` in separate files. Row order
looks like down / left / right / up (`DLRU`) but needs a Sprite Lab check.
`prep_assets.py` currently assumes square cells and derives cell size from
`height / 4`, which would produce 48×48 cells and misalign every frame.

**Licence: CC-BY 4.0 — requires visible credit to Franuka.** The others are
CraftPix licence (commercial use fine, redistribution of the raw assets not).
Both matter for a paid Steam release; see *Licensing* below.

---

## Tilesets — 6 packs, 2.6 MB, native 32×32

`greenforest` · `greenvillage` · `greendungeon` · `medievalinterior` ·
`minerscave` · `topdownfarmlands`

Each ships `All Tileset/{16,32,48,64}.png`. **The 32×32 sheets match the game's
`T = 32` exactly** — no scaling, no resampling.

| Pack | 32×32 grid |
|---|---|
| `topdownfarmlands` | 32 × 43 tiles |
| `medievalinterior` | 35 × 21 |
| `minerscave` | 26 × 29 |
| `greenforest` | 26 × 15 |
| `greendungeon` | 26 × 23 |
| `greenvillage` | 17 × 20 |

This is the biggest visual change available and the most invasive. `drawTile()`
is a ~800-line switch that draws all 54 `TL.*` tile types with canvas paths.
Replacing it means a tile atlas plus a `TL.* -> (atlas, col, row)` table, built
by picking tiles out of the sheets by hand. Doable incrementally — one tile type
at a time, falling back to the painted version for anything unmapped.

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

---

## UI and icons — 6 packs, 119.6 MB

| Pack | Contents | Note |
|---|---|---|
| `Free__Raven_Fantasy_Icons` | 6,580 icons, one sheet at 16/32/64px | Uniform grid — easiest icon win |
| `Fantasy_RPG_icon_pack_by_Franuka` | 4,580 icons, base set + expansions | CC-BY |
| `rpgultimate` | 579 item sprites in 12800×128 strips (100 frames of 128px) | Weapons, loot, props, GUI |
| `RPG_UI_pack_by_Franuka` | Panels, frames, buttons, animated spellbook | **89.7 MB** — 1x/2x/3x plus animation frames; ship one scale only |
| `hpmanastamina…` | `Bars.png` 368×976, plus icons | Drop-in for the HP/stamina/hunger bars |
| `rpguielements` | **PSD only, zero PNGs** | Unusable as delivered — needs export from Photoshop/GIMP first |

The icon packs matter because the game currently renders **every inventory item
as an emoji** (`🥕` `⛏` `🐟`). Emoji render differently per OS and look wrong
next to pixel art — swapping them for real icons is a large perceived-quality
jump for comparatively little code, since it touches item rendering in one or
two places rather than the map.

---

## Duplicates and stragglers

- `dpixelfishingvillage…_2` — byte-identical to the non-`_2` copy, ignore.
- `hpmanastamina…_2` — byte-identical, ignore.
- `freetopdowntreespixelart` — 164 tree PNGs, no `.tmx`. Individual trees rather
  than a tileset; fits the object-atlas pipeline.

---

## Licensing — needs attention before Steam

Two different licences are mixed together here:

- **CraftPix** (most packs): commercial use permitted; redistributing the raw
  assets is not. Fine for a shipped game, and their free packs generally ask for
  attribution — check each `license.txt`.
- **CC-BY 4.0** (Franuka's character pack, icon pack, UI pack): commercial use
  permitted **but requires visible credit**.

Practical consequence: the game needs a credits screen listing at minimum
Franuka (link to their itch page) and CraftPix. Worth adding as its own guide
tab or title-screen entry before release rather than as an afterthought — and
worth keeping a `CREDITS.md` updated as packs are imported, since tracking down
which pack an asset came from later is painful.

This is a summary of the licence files as shipped, not legal advice; read the
`license.txt` in each pack before release.
