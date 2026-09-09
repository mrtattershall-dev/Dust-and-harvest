# Credits & attribution

Third-party assets used in Dust & Harvest, and the terms they come under.

The in-game credits screen (title screen → **CREDITS**) renders the same
information and counts characters from the live sprite manifest, so it cannot
fall out of date as art is added. **Keep this file and `ART_CREDITS` in
`index.html` in step when importing a new pack.**

---

## Sprite art

### Franuka — *Fantasy RPG: Medieval townsfolk*
**Licence: Creative Commons BY 4.0** — commercial use permitted, **credit required**.

- <https://franuka.itch.io>
- <https://creativecommons.org/licenses/by/4.0/>

Used for: the 9 townsfolk (`folk_*`) — market keeper, trader, farm hand,
blacksmith, fisherman, alchemist, barmaid, bartender, two children.

Because this is CC-BY, the visible in-game credit is a **licence obligation**,
not a courtesy. Do not ship a build with the credits screen removed or
unreachable.

### Franuka — *Fantasy RPG Icon Pack*
**Licence: Creative Commons BY 4.0** — commercial use permitted, **credit required**.

- <https://franuka.itch.io>
- <https://creativecommons.org/licenses/by/4.0/>

Used for the inventory, market, chest and hotbar item icons (base set, colour
variations and fishing expansions).

The pack's **Minecraft expansion is deliberately unused**: those icons are
recreations of Minecraft's items and carry trademark risk in a paid release.
Do not add them to `tools/icon-map.json`.

### CraftPix.net — creature and animal packs
**Licence: CraftPix file licence** — commercial use permitted; redistribution of
the raw assets is not.

- <https://craftpix.net>
- <https://craftpix.net/file-licenses/>

Used for the creature and livestock actors: giant rats, three slime packs,
predator plants, golems, orcs, gnolls, ents, ghosts, skeletons, and the ranch
animals — `horse` `foal` `goat` `goatling` `goose` `gosling` `rabbit`
`rabbit_cub` (*Top-Down Cute Farm Animals*) and `chicken` `cow` `pig`
(*Top-Down Farm with Animals*). Also the five market-square townspeople
`citizen1`-`citizen5` (*Pixel Art Market Square*).

Actor ids are the attribution key: the in-game credits screen groups actors by
id prefix, `folk_*` to Franuka and the rest to CraftPix. Never reuse a prefix
across two authors.

---

## Fonts

**Special Elite** and **Rye**, via Google Fonts, under the SIL Open Font License.

- <https://fonts.google.com>

---

## Notes for release

- Assets ship as part of a compiled game, not as reusable source. The `.aseprite`
  and `.psd` files, and the `With_shadow` sheet variants, are deliberately kept
  out of this repository.
- Several other purchased packs are on hand but not yet used; add them here
  **as they are imported**, not in a batch before release — tracing which pack a
  given sprite came from after the fact is painful.
- This summarizes the licence files as shipped in each pack. Read the
  `license.txt` in the original download before release; it is not legal advice.
