// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — JUNGLE ART
//  The jungle was the only zone in the game with no art: 168 fillRect calls and
//  not one drawImage. This serves the atlas built by tools/build_jungle.py so
//  trees, bushes, rocks and lianas can be drawn as real sprites.
//
//  Unlike the prop atlas these sprites are not uniform 32x32 — a large tree is
//  roughly 2x2.5 tiles — so each records its own rect plus an anchor. The anchor
//  is bottom-centre: a tree's trunk sits on its tile and the canopy overhangs
//  upward, which is what gives a top-down forest any sense of height.
//
//  Because canopies overhang, the caller must draw these in a second pass after
//  all ground, in increasing tile-y order, or a tree is clipped by the tile in
//  front of it. See drawJungleOverlay in index.html.
//
//  The variant is derived from the tile coordinate — same hash the props and fog
//  use — so a given tree is always the same tree, with nothing stored per tile
//  and no flicker as the camera moves.
//
//  Fails soft: draw() returns false when the atlas is not up, and the caller
//  paints its own shape instead.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHJungle = (function () {
  'use strict';

  const BASE = 'assets/jungle/';
  const state = { data: null, img: new Image(), ok: false };

  function init() {
    fetch(BASE + 'jungle.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        state.data = d;
        state.img.onload = () => { state.ok = true; };
        state.img.onerror = () => console.warn('[DHJungle] atlas failed to load');
        state.img.src = BASE + 'jungle.png';
      })
      .catch(err => {
        console.warn('[DHJungle] no jungle atlas (' + err.message +
                     ') — using the painted tiles.');
      });
  }

  function ready(group) {
    return !!(state.ok && state.data && state.data.groups[group] &&
              state.data.groups[group].length);
  }

  // Pick this tile's variant. Stable for a given tile, so the forest never
  // shimmers as you walk through it.
  function pick(group, tx, ty) {
    if (!ready(group)) return null;
    const list = state.data.groups[group];
    const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    return list[h % list.length];
  }

  // Draw a specific sprite from `group` by index — for animations, where the
  // frame comes from the clock rather than from the tile coordinate.
  function drawFrame(ctx, group, index, sx, sy, tileSize) {
    if (!ready(group)) return false;
    const list = state.data.groups[group];
    return blit(ctx, list[((index % list.length) + list.length) % list.length],
                sx, sy, tileSize);
  }

  // Draw one sprite from `group` anchored to the bottom-centre of the tile whose
  // top-left corner is at (sx, sy). `tileSize` is the zone's tile pixel size.
  // Returns false when the atlas is not up yet.
  function draw(ctx, group, sx, sy, tx, ty, tileSize) {
    const s = pick(group, tx, ty);
    if (!s) return false;
    return blit(ctx, s, sx, sy, tileSize);
  }

  // Shared placement: anchor the sprite's footprint on the tile, with whatever
  // is above it (canopy, roof, flame) overhanging upward.
  function blit(ctx, s, sx, sy, tileSize) {
    if (!s) return false;
    const T = tileSize || 32;
    const dx = Math.round(sx + T / 2 - s.ax);
    const dy = Math.round(sy + T - s.ay + Math.round(T * 0.15));
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.img, s.x, s.y, s.w, s.h, dx, dy, s.w, s.h);
    ctx.imageSmoothingEnabled = prev;
    return true;
  }

  function count() {
    if (!state.data) return 0;
    return Object.values(state.data.groups).reduce((n, g) => n + g.length, 0);
  }

  return { init, ready, draw, drawFrame, pick, count, _state: state };
})();

DHJungle.init();
