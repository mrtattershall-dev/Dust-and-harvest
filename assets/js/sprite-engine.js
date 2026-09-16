// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — SPRITE ENGINE
//  Loads CraftPix-style sheets described by assets/sprites/manifest.json and
//  draws them into the existing canvas render pipeline.
//
//  Everything here is additive and fails soft: if the manifest or a sheet does
//  not load, DHArt.ready() returns false forever and callers fall back to the
//  hand-drawn art they already have. The game never blocks on art.
//
//  Usage from a draw function:
//    if (DHArt.ready('goat')) DHArt.drawActor(ctx, 'goat', a, sx, sy);
//    else { ...existing hand-drawn code... }
//
//  Where `a` is any game entity. The engine stores its animation state on the
//  entity as `a._art`, so callers do not manage frame counters.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHArt = (function () {
  'use strict';

  const BASE = 'assets/sprites/';

  const state = {
    manifest: null,
    actors: {},        // id -> descriptor from manifest, plus .images
    status: 'idle',    // 'idle' | 'loading' | 'ready' | 'error'
    error: null,
    pending: 0,
    loaded: 0,
    failed: [],
  };

  // ── Image loading ───────────────────────────────────────────────────────────
  const imgCache = new Map();  // url -> {img, ok}

  function loadImage(url) {
    let e = imgCache.get(url);
    if (e) return e;
    e = { img: new Image(), ok: false, url };
    state.pending++;
    e.img.onload = () => {
      e.ok = true;
      state.pending--;
      state.loaded++;
    };
    e.img.onerror = () => {
      state.pending--;
      state.failed.push(url);
      console.warn('[DHArt] failed to load', url);
    };
    e.img.src = BASE + url;
    imgCache.set(url, e);
    return e;
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  // Kicks off manifest fetch. Safe to call more than once.
  function init() {
    if (state.status !== 'idle') return;
    state.status = 'loading';
    fetch(BASE + 'manifest.json', { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(m => {
        state.manifest = m;
        for (const [id, def] of Object.entries(m.actors || {})) {
          const a = Object.assign({}, def);
          a.images = {};
          for (const [clipName, clip] of Object.entries(a.clips)) {
            a.images[clipName] = loadImage(a.path + '/' + clip.file);
          }
          state.actors[id] = a;
        }
        state.status = 'ready';
        console.info('[DHArt] manifest loaded —',
          Object.keys(state.actors).length, 'actors');
      })
      .catch(err => {
        state.status = 'error';
        state.error = err;
        // This is the expected path when opening index.html via file:// —
        // fetch() is blocked. Hand-drawn art carries the game; say so once.
        console.warn('[DHArt] no sprite manifest (' + err.message +
          ') — using built-in art. Serve the folder over http:// to enable sprites.');
      });
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  // True when this actor's sheets are decoded and safe to draw.
  function ready(actorId, clipName) {
    const a = state.actors[actorId];
    if (!a) return false;
    if (clipName) {
      const e = a.images[clipName];
      return !!(e && e.ok);
    }
    // No clip named: ready if at least the resting clip decoded.
    const rest = a.clips.idle ? 'idle' : Object.keys(a.clips)[0];
    const e = a.images[rest];
    return !!(e && e.ok);
  }

  function has(actorId) { return !!state.actors[actorId]; }
  function list() { return Object.keys(state.actors); }
  function info(actorId) { return state.actors[actorId] || null; }
  function progress() {
    return { status: state.status, pending: state.pending,
             loaded: state.loaded, failed: state.failed.slice() };
  }

  // ── Animation state ─────────────────────────────────────────────────────────
  // Held on the entity as `_art` so it survives across frames without the
  // caller tracking anything.

  function ensureState(ent) {
    if (!ent._art) {
      // Non-enumerable so it stays out of JSON.stringify. Ranch animals are
      // saved as whole objects, and `t0` is a performance.now() timestamp that
      // means nothing once reloaded in a new page session.
      Object.defineProperty(ent, '_art', {
        value: { clip: null, dir: 'down', t0: performance.now() },
        writable: true, configurable: true, enumerable: false,
      });
    }
    return ent._art;
  }

  // Pick a clip, restarting the clock only when the clip actually changes so a
  // walk cycle is not reset every frame.
  function play(ent, clipName, opts) {
    const s = ensureState(ent);
    if (s.clip !== clipName || (opts && opts.restart)) {
      s.clip = clipName;
      s.t0 = performance.now();
    }
    return s;
  }

  // Frame index from wall-clock elapsed time since the clip started.
  //
  // Deriving the frame from a timestamp rather than accumulating a delta means
  // callers do not need a dt in scope — which matters because the game's
  // render() does not have one — and an entity animates at the right rate no
  // matter how many times per frame it is drawn, or if it is skipped while
  // offscreen.
  // `dirIdx` is the facing's row within the clip (0-3), not the absolute sheet
  // row. Some packs give one facing fewer frames than the others and pad the
  // rest of the row with blanks — the market citizens' back-facing idle is 6
  // frames against 12 — so the loop has to be per facing, or the actor vanishes
  // for half its cycle.
  function frameOf(a, s, clip, dirIdx) {
    if (!clip) return 0;
    const n = (clip.rowFrames && clip.rowFrames[dirIdx]) || clip.frames;
    if (n <= 1) return 0;
    const elapsed = (performance.now() - s.t0) / 1000;
    const i = Math.floor(elapsed * (a.fps || 6.667));
    if (i < 0) return 0;
    if (clip.loop === false) return Math.min(i, n - 1);
    return i % n;
  }

  function dirIndex(a, s) {
    return a.dirRows[s.dir] != null ? a.dirRows[s.dir] : 0;
  }

  function resolveClip(a, s) {
    if (s.clip && a.clips[s.clip]) return s.clip;
    return a.clips.idle ? 'idle' : Object.keys(a.clips)[0];
  }

  // Set facing from a movement vector. Larger axis wins; ties keep the old
  // facing so diagonal movement does not flicker between two rows.
  function faceFromVector(ent, dx, dy) {
    const s = ensureState(ent);
    if (Math.abs(dx) > Math.abs(dy)) s.dir = dx < 0 ? 'left' : 'right';
    else if (Math.abs(dy) > 0)       s.dir = dy < 0 ? 'up' : 'down';
    return s.dir;
  }

  function face(ent, dir) {
    const s = ensureState(ent);
    if (dir) s.dir = dir;
    return s.dir;
  }

  // True once a non-looping clip (attack / hurt / death) has reached its end.
  function finished(ent, actorId) {
    const a = state.actors[actorId];
    if (!a || !ent._art) return false;
    const s2 = ent._art;
    const clip = a.clips[resolveClip(a, s2)];
    if (!clip || clip.loop !== false) return false;
    const di = dirIndex(a, s2);
    const n = (clip.rowFrames && clip.rowFrames[di]) || clip.frames;
    return frameOf(a, s2, clip, di) >= n - 1;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  // Draw one frame. (sx, sy) is the entity's world-to-screen position — the same
  // value the existing hand-drawn code uses. The sprite is centred on sx and
  // stands on sy, using the anchor box measured at prep time, so actors with
  // different cell padding share one ground line.
  //
  // opts:
  //   size    target height in px of the sprite's *content* (default: 24)
  //   alpha   0..1
  //   flash   CSS colour composited over the sprite (hit flash)
  //   footY   nudge the ground line down by this many px
  function drawActor(ctx, actorId, ent, sx, sy, opts) {
    const a = state.actors[actorId];
    if (!a) return false;
    const s = ensureState(ent);
    const clipName = resolveClip(a, s);
    const clip = a.clips[clipName];
    const entry = a.images[clipName];
    if (!clip || !entry || !entry.ok) return false;

    const o = opts || {};
    // Square packs carry `cell`; packs with non-square frames (the townsfolk
    // sheets are 32x48) carry cellW/cellH instead.
    const cw = a.cellW || a.cell;
    const ch = a.cellH || a.cell;
    const anchor = a.anchor;

    // `size` normalizes every actor to the same drawn height, which is what you
    // want for creatures of unrelated species. For a cast that is meant to
    // differ in stature — a child should not be as tall as an adult — pass
    // `scale` instead and heights stay in proportion to the source art.
    const k = (o.scale != null) ? o.scale
                                : (o.size || 24) / (anchor.h || ch);

    const di = dirIndex(a, s);
    const row = (clip.rowBase || 0) + di;
    const frame = frameOf(a, s, clip, di);

    // Where the anchor box sits inside the cell, in destination px
    const anchorCX = (anchor.x + anchor.w / 2) * k;
    const anchorBottom = (anchor.y + anchor.h) * k;

    const dx = sx - anchorCX;
    const dy = sy + (o.footY || 0) - anchorBottom;
    const dw = cw * k;
    const dh = ch * k;

    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(entry.img,
      frame * cw, row * ch, cw, ch,
      Math.round(dx), Math.round(dy), Math.ceil(dw), Math.ceil(dh));

    // Hit flash — re-draw the frame as a solid silhouette in the flash colour.
    if (o.flash) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = o.flash;
      ctx.fillRect(Math.round(dx), Math.round(dy), Math.ceil(dw), Math.ceil(dh));
    }
    ctx.restore();
    return true;
  }

  // Convenience: soft elliptical ground shadow matching the sprite's footprint.
  // The packs ship separate shadow PNGs, but a drawn ellipse reacts to the
  // game's day/night lighting, which a baked shadow cannot.
  function drawShadow(ctx, actorId, sx, sy, opts) {
    const a = state.actors[actorId];
    // Some packs paint the drop shadow into the frames themselves; adding
    // another underneath doubles it up.
    if (a && a.bakedShadow) return;
    const o = opts || {};
    const targetH = o.size || 24;
    let rx = targetH * 0.32;
    if (a && a.anchor && a.anchor.h) {
      rx = (a.anchor.w / a.anchor.h) * targetH * 0.42;
    }
    ctx.save();
    ctx.fillStyle = o.color || 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + (o.footY || 0), rx, rx * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    init, ready, has, list, info, progress,
    play, face, faceFromVector, finished,
    drawActor, drawShadow,
    _state: state,
  };
})();

DHArt.init();
