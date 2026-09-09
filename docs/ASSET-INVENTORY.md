# Asset inventory

53 unique packs (56 delivered, 3 exact duplicates). Status of each, and what
each category still needs before it can reach the game.

Source zips are **not** in this repo — only the normalized output under
`assets/sprites/`. Keep the originals somewhere safe; re-importing needs them.

---

## Imported — 15 packs, 58 actors, 246 sheets

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
| Farm (16–64px) | `horse` `foal` `goat` `goatling` `goose` `gosling` `rabbit` `rabbit_cub` `chicken` `cow` `pig` — `walk` + `idle` only |
| Citizens (32×32) | `citizen1`–`citizen5` — market square townspeople |
| Townsfolk (32×48) | `folk_farmer` `folk_fisherman` `folk_blacksmith` `folk_merchant` `folk_alchemist` `folk_barmaid` `folk_bartender` `folk_kid1` `folk_kid2` |

**Ranch coverage: 6 of 7 species.** `chicken`, `cow` and `pig` come from
*Top-Down Farm with Animals*; `goat`, `horse` and `rabbit` from *Cute Farm
Animals*, which also supplies `goatling`, `foal` and `rabbit_cub` for the
game's `_baby` state. **There is no sheep sprite in any pack delivered so far**,
so sheep keep their painted art — the fallback handles this with no special
casing. A sheep pack would close the set.

That is 33 hostile actors against roughly a dozen enemy types currently in the
game, so this category is already oversupplied. More monster packs are not the
bottleneck.

---

## Townsfolk — imported and partly wired in

Maya, Trader Rex and the Farm Hand render as sprites. The remaining six await a
character-by-character decision; add them to `NPC_SPRITES` in `index.html`.

Silas, Maren and the hobo camp residents are deliberately still painted — their
hand-drawn art has specific poses and colour schemes (Silas sits on a crate with
a pickaxe; Maren wears a teal oilskin) that a generic standing townsperson would
lose.

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

`topdownfarmwithanimals` is **partly imported** already — its chicken, cow and
pig sprites are in use. Its buildings, barn interior and plant tiles are not.

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

## Later delivery — 4 packs

| Pack | Status |
|---|---|
| `pixelartmarketsquare…` | **Citizens imported** (5 actors). Its stall traders, lute player and flutist are single-row strips — one facing only, so they need a `strip` layout. `Objects.png` is market decor for the object pipeline. |
| `topdownvillagefarmanimals…` | **Not imported.** Buffalo, Buffalo_cub, Cat, Colt, Dog, Donkey, Drake, Duck, Duckling. **No sheep.** None map to an existing ranch species, so using these means *adding new livestock or pets* — a game-design change, not an art swap. |
| `freepixelartplantsforfarm` | **Not imported.** `Plants.png` is a crop growth-stage sheet: 4 stages per crop, ~10 crops, at native 32px, with each crop drawn twice (on tilled soil and on grass). Would replace `drawCrop`. |
| `freebasicpixelartuiforrpg` | **Not imported.** Buttons, panels, inventory frames, icons, numbers. Small and directly usable for the HUD. |

---

## Latest delivery — 7 packs

| Pack | Assessment |
|---|---|
| `deserttileset…` | **Strongest match in the whole library.** Native 32px sand, rock, cacti, skulls, bones, ruins, pyramids, dead trees — the exact palette of a dusty frontier and the Badlands. Crucially it ships ~250 **individually named** object PNGs in `Objects_separately/` (`Cactus3_sand_shadow1.png`, `Bones_sand_shadow2.png`, `Ruins1.png`), which sidesteps the atlas-region problem that makes the other object packs expensive. |
| `freebase4direction{male,female}…` | **Naked mannequins.** Bald, unclothed base bodies, 13×22px of content in a 64px cell. They are layering bases for a developer to draw clothing and hair over — not usable characters. Full `dir4` clip sets (idle/walk/run/attack/hurt/death, plus Sword variants). |
| `fantasyrpghunterslodge…` | Lodge building interior/exterior plus a hunter NPC with several activity animations (tanning, leaving with knife) and a dog. Object-pipeline shaped. |
| `fishingandgatheringicons` | 14 sheets, `Fish1`–`Fish10` plus gathering icons, 32px tall strips. Maps directly onto the game's fish items. |
| `armorandweaponsicons` | `Armor.png` `Weapons.png` `Furniture.png` `Icons.png` — uniform icon grids. |
| `freebasicpixelartuiforrpg` | **Duplicate** of the copy delivered earlier. |

### On the player character

The art style called out as preferred is CraftPix's market-square/base-character
family — the same family as the imported `citizen1`–`citizen5`.

Putting the **player** in that style is not a drop-in. The base packs have no
clothes or hair, and the game's player is not a fixed sprite: `drawCharacter`
is ~1,200 lines driving a customization system (gender, skin tone, hair style
and colour, shirt style and colour, trousers, hat) with its own creation UI and
save fields. Any fixed sprite replaces that system rather than re-skinning it.

Three ways forward, in increasing cost:
1. **Use a citizen sprite as the player.** Immediate, in the liked style, but
   character customization goes away — the creation screen would need removing
   or reducing to a name field.
2. **Keep customization, restyle by hand.** Redraw `drawCharacter`'s output to
   match the citizens' proportions. No new art needed; keeps the feature.
3. **Layer the base body.** Use the base mannequin plus new clothing and hair
   art drawn per facing and per frame. Preserves customization in the new
   style, but the clothing art does not exist in any delivered pack.

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
