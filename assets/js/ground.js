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

  // ── Retoning ────────────────────────────────────────────────────────────────
  // One turf has to serve several biomes. The whole library holds exactly one
  // outdoor grass (see build_ground.py), and the jungle needs that same surface
  // under a canopy: darker and greener than a farmland field. Rather than
  // blending over every tile every frame, a terrain band is recoloured once
  // into an offscreen canvas the first time it is asked for, and drawn from
  // there — after that a jungle tile costs exactly what a farm tile costs.
  //
  // The caller names the MEAN COLOUR it wants, not a blend: the band's own mean
  // is measured and each channel scaled to land on it. That way the artist's
  // contrast carries over, and if the texture is ever rebaked to a different
  // tone the tinted version follows it instead of drifting.
  //
  // Per-channel scaling in JS rather than a 'multiply' fill because a target
  // can be BRIGHTER than the source in some channel (jungle sand is bluer than
  // desert sand), and multiply cannot brighten. Done once, so the cost is moot.
  const toned = {};

  function toneBand(name, css) {
    const key = name + css;
    if (key in toned) return toned[key];
    toned[key] = null;                      // remember failures; don't retry
    if (!ready(name)) { delete toned[key]; return null; }   // may load later
    const P = state.data.period, oy = state.data.terrains[name].oy;
    const m = /^#?([0-9a-f]{6})$/i.exec(css);
    if (!m) { console.warn('[DHGround] bad tone ' + css); return null; }
    const n = parseInt(m[1], 16);
    const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255];

    const cv = document.createElement('canvas');
    cv.width = cv.height = P;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingEnabled = false;
    c.drawImage(state.img, 0, oy, P, P, 0, 0, P, P);
    let px;
    try { px = c.getImageData(0, 0, P, P); }
    catch (e) {                              // tainted canvas: keep the original
      console.warn('[DHGround] cannot retone (' + e.message + ')');
      return null;
    }
    const d = px.data, N = d.length;
    const sum = [0, 0, 0];
    for (let i = 0; i < N; i += 4) { sum[0] += d[i]; sum[1] += d[i+1]; sum[2] += d[i+2]; }
    const count4 = N / 4;
    const gain = [0, 1, 2].map(k => {
      const mean = sum[k] / count4;
      return mean < 1 ? 1 : want[k] / mean;   // a black channel cannot be scaled
    });
    for (let i = 0; i < N; i += 4) {
      const r = d[i] * gain[0], g = d[i+1] * gain[1], b = d[i+2] * gain[2];
      d[i]   = r > 255 ? 255 : r;
      d[i+1] = g > 255 ? 255 : g;
      d[i+2] = b > 255 ? 255 : b;
    }
    c.putImageData(px, 0, 0);
    toned[key] = cv;
    return cv;
  }

  // Like draw(), but retoned so the surface's mean colour is `css`.
  function drawToned(ctx, name, css, sx, sy, tx, ty) {
    const cv = toneBand(name, css);
    if (!cv) return false;
    const d = state.data, n = state.tiles;
    const ox = (((tx % n) + n) % n) * d.tile;
    const oy = (((ty % n) + n) % n) * d.tile;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, ox, oy, d.tile, d.tile,
                  Math.round(sx), Math.round(sy), d.tile, d.tile);
    ctx.restore();
    return true;
  }

  function count() {
    return state.data ? Object.keys(state.data.terrains).length : 0;
  }

  return { init, ready, draw, drawToned, count, _state: state };
})();

DHGround.init();
