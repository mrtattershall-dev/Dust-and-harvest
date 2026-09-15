// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — SCATTER PROPS
//  Rocks, bushes, skulls and bones are each drawn as a single hand-painted shape
//  repeated across the whole map. This swaps them for named pixel-art variants
//  from the desert tileset, picked per tile.
//
//  The variant is derived from the tile coordinate, so a given rock is always
//  the same rock — no per-tile data to store, nothing to save, and no flicker
//  as the camera moves. Same hash constants the fog uses.
//
//  Fails soft: if the atlas does not load, draw() returns false and the caller
//  falls back to the painted shape.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHProps = (function () {
  'use strict';

  const BASE = 'assets/props/';
  const state = { data: null, img: new Image(), ok: false };

  function init() {
    fetch(BASE + 'props.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        state.data = d;
        state.img.onload = () => { state.ok = true; };
        state.img.onerror = () => console.warn('[DHProps] atlas failed to load');
        state.img.src = BASE + 'props.png';
      })
      .catch(err => {
        console.warn('[DHProps] no prop atlas (' + err.message +
                     ') — using the painted tiles.');
      });
  }

  function ready(group) {
    return !!(state.ok && state.data && state.data.groups[group] &&
              state.data.groups[group].length);
  }

  // Draw one prop from `group` at the tile's top-left. Returns false when the
  // atlas is not up yet, so callers can paint their own.
  function draw(ctx, group, sx, sy, tx, ty) {
    if (!ready(group)) return false;
    const d = state.data;
    const list = d.groups[group];
    // Same mix the fog uses, so props and fog do not share a visible pattern.
    const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    const idx = list[h % list.length];
    const c = idx % d.cols, r = Math.floor(idx / d.cols);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.img, c * d.cell, r * d.cell, d.cell, d.cell,
                  Math.round(sx), Math.round(sy), d.cell, d.cell);
    ctx.restore();
    return true;
  }

  function count() {
    if (!state.data) return 0;
    return Object.values(state.data.groups)
      .reduce((n, g) => n + g.length, 0);
  }

  return { init, ready, draw, count, _state: state };
})();

DHProps.init();
