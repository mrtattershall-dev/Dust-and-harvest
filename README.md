# Dust & Harvest

A frontier farming/survival game. Single-page HTML5 canvas game, no build step.

## Run it

Sprites load over HTTP, so serve the folder rather than opening the file:

    python3 -m http.server 8000

Then open <http://localhost:8000>. (Opening `index.html` directly works too, but
falls back to the built-in hand-drawn art.)

## Layout

| Path | What |
|---|---|
| `index.html` | the entire game |
| `assets/js/` | sprite engine + dev sprite lab |
| `assets/sprites/` | shipped pixel art and its manifest |
| `tools/` | asset prep scripts |
| `docs/ART-PIPELINE.md` | how to add a sprite pack |

Press `` ` `` in game to open the Sprite Lab and preview every loaded actor.
