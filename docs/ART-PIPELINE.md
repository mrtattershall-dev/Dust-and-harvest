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

In the Sprite Lab the four columns are labelled DOWN / UP / LEFT / RIGHT. **If
the last two columns look mirrored, re-run `prep_assets.py` with the other
`--rows` value.** That is the whole check.

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
  DHArt.step(a, dt, 'goat');
  DHArt.drawShadow(ctx, 'goat', sx, sy + 9, { size: 26 });
  DHArt.drawActor(ctx, 'goat', a, sx, sy + 9, { size: 26 });
} else {
  // existing hand-drawn code, untouched
}
```

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
| `DHArt.step(ent, dt, id)` | advance the clock, once per frame per visible entity |
| `DHArt.finished(ent)` | a one-shot clip reached its last frame |
| `DHArt.drawActor(ctx, id, ent, sx, sy, opts)` | draw. `opts: {size, alpha, flash, footY}` |
| `DHArt.drawShadow(ctx, id, sx, sy, opts)` | ground ellipse sized from the anchor box |

`attack`, `hurt` and `death` are marked non-looping at prep time: they play once
and hold the last frame, and `finished()` goes true. Everything else loops.

## Current inventory

20 actors, 80 sheets, 1.4 MB.

| Group | Actors |
|---|---|
| `enemies` | `rat_grey` `rat_armored` `rat_crimson` (128px) · `slime_blue` `slime_gold` `slime_imp` `slime_bomb` `slime_fire` `slime_void` (64px) · `plant_ember` `plant_azure` `plant_orchid` (64px) |
| `farm` | `horse` `foal` (64px) · `goat` `goatling` `goose` `gosling` `rabbit` (32px) · `rabbit_cub` (16px) |

Enemies have all six clips. Farm animals have `walk` and `idle` only.

## Note for the Steam build

Keeping art as loose files (rather than base64 inside the HTML) is what makes an
Electron/Tauri wrap straightforward later: the wrapper ships this folder as-is.
The same folder zips directly for an itch.io HTML5 upload.
