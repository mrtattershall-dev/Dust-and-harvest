// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — MINE ART
//  Both mines were flat colour: a brown rectangle for floor, a darker one for
//  wall, a coloured blob per ore vein, and some fillRect speckle over the top.
//  This serves the atlas built by tools/build_mine.py so the Mine and the
//  Company Mine are drawn from the Miner's Cave pack instead.
//
//  Two shapes of sprite, and the difference matters to the caller:
//
//    drawTile()    a 32x32 cell at the tile's top-left, no anchor. Floors,
//                  walls, veins, rails — anything that fills its tile.
//    draw()        a taller sprite anchored bottom-centre, so it stands on its
//                  tile and overhangs upward. A minecart is 32x64.
//
//  The variant is derived from the tile coordinate with the same hash the
//  props, the fog and the jungle use, so a given tile is always the same tile:
//  nothing is stored per tile and the mine does not shimmer as you walk.
//
//  Fails soft. ready() is false and every draw returns false when the atlas is
//  not up, and drawMineTile falls back to the painted tiles it always had.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHMine = (function () {
  'use strict';

  const BASE = 'assets/mine/';

  const state = { data: null, img: null, ok: false, warned: false };

  function init() {
    fetch(BASE + 'mine.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        state.data = d;
        const im = new Image();
        im.onload = () => { state.img = im; state.ok = true; };
        im.onerror = () => console.warn('[DHMine] mine.png failed to load');
        im.src = BASE + 'mine.png';
      })
      .catch(err => {
        if (state.warned) return;
        state.warned = true;
        console.warn('[DHMine] no mine atlas (' + err.message +
                     ') — using the painted tiles.');
      });
  }

  function ready(group) {
    return !!(state.ok && state.data && state.data.groups[group] &&
              state.data.groups[group].length);
  }

  function count(group) {
    return ready(group) ? state.data.groups[group].length : 0;
  }

  // Stable per tile, so a floor tile keeps its variant however you approach it.
  function pick(group, tx, ty) {
    if (!ready(group)) return null;
    const list = state.data.groups[group];
    const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    return list[h % list.length];
  }

  // A second hash, for deciding *whether* a tile gets a prop at all. Using the
  // same one as pick() would tie "is there a barrel here" to "which barrel",
  // and every barrel in the mine would be the same barrel.
  function chance(tx, ty, salt, oneIn) {
    const h = ((tx * 2654435761) ^ (ty * 40503) ^ (salt * 2246822519)) >>> 0;
    return (h % oneIn) === 0;
  }

  // Same as pick(), but the caller names the variant. The seven ore groups and
  // the seven loaded ore carts are listed in the same order, so an iron vein
  // can be given the cart of iron rather than whichever cart the hash landed on.
  function at(group, i) {
    if (!ready(group)) return null;
    const list = state.data.groups[group];
    return list[((i % list.length) + list.length) % list.length];
  }

  function blit(ctx, s, dx, dy) {
    if (!s) return false;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.img, s.x, s.y, s.w, s.h, Math.round(dx), Math.round(dy), s.w, s.h);
    ctx.imageSmoothingEnabled = prev;
    return true;
  }

  function drawTile(ctx, group, sx, sy, tx, ty) {
    return blit(ctx, pick(group, tx, ty), sx, sy);
  }

  // Bottom-centre anchored. (sx, sy) is the centre of the tile it stands on.
  function draw(ctx, group, sx, sy, tx, ty) {
    const s = pick(group, tx, ty);
    return s ? blit(ctx, s, sx - s.ax, sy - s.ay) : false;
  }

  function drawTileIdx(ctx, group, i, sx, sy) {
    return blit(ctx, at(group, i), sx, sy);
  }

  function drawIdx(ctx, group, i, sx, sy) {
    const s = at(group, i);
    return s ? blit(ctx, s, sx - s.ax, sy - s.ay) : false;
  }

  return { init, ready, count, pick, at, drawTile, draw, drawTileIdx, drawIdx,
           chance, _state: state };
})();

DHMine.init();
