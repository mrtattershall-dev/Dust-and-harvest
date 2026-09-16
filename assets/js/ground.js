// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — GROUND SURFACES
//  Sand is drawn from the desert pack's own art instead of canvas paths.
//
//  Not a tile set. The pack's ground is a flat colour with loose mottling strewn
//  over it, so tools/build_ground.py re-scatters that mottling onto one large
//  wrap-seamless texture. Each map tile samples the window at
//  (tx*T mod period, ty*T mod period), which means neighbouring tiles show
//  neighbouring pieces of a single continuous surface — the desert reads as one
//  expanse rather than a grid of stamps, and there is no repeated cell to spot.
//
//  The period is a whole number of tiles, so a tile never straddles the texture
//  edge and every draw is one blit.
//
//  Fails soft: if the texture does not load, draw() returns false and the caller
//  falls back to the painted tile.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHGround = (function () {
  'use strict';

  const BASE = 'assets/ground/';
  const state = { data: null, img: new Image(), ok: false, tiles: 0 };

  function init() {
    fetch(BASE + 'ground.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        // The texture is baked for one tile size. Drawing it at another would
        // resample the pixel art, so refuse rather than blur it.
        if (typeof T === 'number' && d.tile !== T) {
          throw new Error('baked for ' + d.tile + 'px tiles, game uses ' + T);
        }
        state.data = d;
        state.tiles = d.period / d.tile;
        state.img.onload = () => { state.ok = true; };
        state.img.onerror = () => console.warn('[DHGround] texture failed to load');
        state.img.src = BASE + 'ground.png';
      })
      .catch(err => {
        console.warn('[DHGround] no ground texture (' + err.message +
                     ') — using the painted tiles.');
      });
  }

  function ready(name) {
    return !!(state.ok && state.data && state.data.terrains[name]);
  }

  // Draw one map tile of `name` at its top-left. Returns false when the texture
  // is not up yet, so callers can paint their own.
  function draw(ctx, name, sx, sy, tx, ty) {
    if (!ready(name)) return false;
    const d = state.data, n = state.tiles;
    // Modulo that stays positive for negative tile coordinates.
    const ox = (((tx % n) + n) % n) * d.tile;
    const oy = (((ty % n) + n) % n) * d.tile;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.img, ox, d.terrains[name].oy + oy, d.tile, d.tile,
                  Math.round(sx), Math.round(sy), d.tile, d.tile);
    ctx.restore();
    return true;
  }

  function count() {
    return state.data ? Object.keys(state.data.terrains).length : 0;
  }

  return { init, ready, draw, count, _state: state };
})();

DHGround.init();
