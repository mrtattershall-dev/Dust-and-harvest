// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — ITEM ICONS
//  Replaces the emoji used for inventory items with pixel-art icons from a
//  single atlas, in the places the player actually looks at items.
//
//  Fails soft, like the sprite engine: if the atlas does not load, or an item
//  has no icon mapped, the caller gets its emoji back instead. Coverage is
//  deliberately partial — a wrong icon reads worse than an emoji — so the two
//  are expected to coexist.
//
//  Usage:
//    itemIcon('carrot', 18)          -> HTML string, icon or emoji
//    DHIcons.draw(ctx, 'carrot', x, y, 16)   -> canvas
// ═══════════════════════════════════════════════════════════════════════════════
window.DHIcons = (function () {
  'use strict';

  const BASE = 'assets/icons/';
  const state = { data: null, ok: false, img: new Image(), rows: 0 };

  function init() {
    fetch(BASE + 'items.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => {
        state.data = d;
        const count = Object.values(d.icons).reduce((m, v) => Math.max(m, v), 0) + 1;
        state.rows = Math.ceil(count / d.cols);
        state.img.onload = () => {
          state.ok = true;
          // Panels built before the atlas decoded still hold emoji, so ask the
          // open ones to rebuild once.
          try {
            if (typeof refreshInvUI === 'function' && typeof invOpen !== 'undefined' && invOpen) refreshInvUI();
            if (typeof buildHotbar === 'function') buildHotbar();
          } catch (e) { /* UI not ready yet — next open picks it up */ }
        };
        state.img.onerror = () => console.warn('[DHIcons] atlas failed to load');
        state.img.src = BASE + 'items.png';
      })
      .catch(err => {
        // Expected on file:// where fetch is blocked. Emoji carry the UI.
        console.warn('[DHIcons] no icon atlas (' + err.message + ') — using emoji.');
      });
  }

  function has(id) {
    return !!(state.ok && state.data && state.data.icons[id] !== undefined);
  }

  // Inline-block span positioned onto the atlas. Sized in CSS pixels so it
  // scales with the game's text-size setting like the emoji it replaces.
  function html(id, px) {
    if (!has(id)) return '';
    const d = state.data;
    const i = d.icons[id];
    const c = i % d.cols, r = Math.floor(i / d.cols);
    const w = d.cols * px, h = state.rows * px;
    return '<i class="dh-ic" style="width:' + px + 'px;height:' + px + 'px;' +
           'background-size:' + w + 'px ' + h + 'px;' +
           'background-position:-' + (c * px) + 'px -' + (r * px) + 'px"></i>';
  }

  // Canvas draw, for the few item icons rendered into the world rather than
  // the DOM (dropped ranch products).
  function draw(ctx, id, x, y, size) {
    if (!has(id)) return false;
    const d = state.data;
    const i = d.icons[id];
    const c = i % d.cols, r = Math.floor(i / d.cols);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.img, c * d.cell, r * d.cell, d.cell, d.cell,
                  Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    ctx.restore();
    return true;
  }

  function count() { return state.data ? Object.keys(state.data.icons).length : 0; }

  return { init, has, html, draw, count, _state: state };
})();

// Icon for an item if there is one, otherwise its emoji at a matching box size
// so mixed rows still line up. `id` may be an item id or null; `fallback` is the
// emoji to use when no icon exists.
function itemIcon(id, px, fallback) {
  px = px || 18;
  const ic = DHIcons.html(id, px);
  if (ic) return ic;
  const emoji = fallback !== undefined ? fallback
              : (typeof ITEMS !== 'undefined' && ITEMS[id] ? ITEMS[id].icon : '');
  return '<i class="dh-ic-emoji" style="width:' + px + 'px;height:' + px + 'px;' +
         'font-size:' + Math.round(px * 0.82) + 'px">' + (emoji || '') + '</i>';
}

DHIcons.init();
