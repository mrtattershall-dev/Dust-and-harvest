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
    if (!ent._art) ent._art = { clip: null, dir: 'down', t: 0, frame: 0, done: false };
    return ent._art;
  }

  // Pick a clip, resetting the frame counter only when the clip actually changes
  // so a walk cycle is not restarted every frame.
  function play(ent, clipName, opts) {
    const s = ensureState(ent);
    if (s.clip !== clipName || (opts && opts.restart)) {
      s.clip = clipName;
      s.t = 0;
      s.frame = 0;
      s.done = false;
    }
    return s;
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

  // Advance the clock. Call once per frame per visible entity.
  function step(ent, dt, actorId) {
    const s = ensureState(ent);
    const a = state.actors[actorId];
    if (!a || !s.clip) return s;
    const clip = a.clips[s.clip];
    if (!clip || clip.frames <= 1) return s;

    s.t += dt * (a.fps || 6.667);
    if (clip.loop === false) {
      s.frame = Math.min(clip.frames - 1, Math.floor(s.t));
      if (s.frame >= clip.frames - 1) s.done = true;
    } else {
      s.frame = Math.floor(s.t) % clip.frames;
    }
    return s;
  }

  // True once a non-looping clip (attack / hurt / death) has reached its end.
  function finished(ent) {
    return !!(ent._art && ent._art.done);
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
    const clipName = (s.clip && a.clips[s.clip]) ? s.clip
                   : (a.clips.idle ? 'idle' : Object.keys(a.clips)[0]);
    const clip = a.clips[clipName];
    const entry = a.images[clipName];
    if (!clip || !entry || !entry.ok) return false;

    const o = opts || {};
    const cell = a.cell;
    const anchor = a.anchor;

    // Scale so the measured content height matches the requested size.
    const targetH = o.size || 24;
    const k = targetH / (anchor.h || cell);

    const row = (clip.rowBase || 0) + (a.dirRows[s.dir] != null ? a.dirRows[s.dir] : 0);
    const frame = Math.min(s.frame, clip.frames - 1);

    // Where the anchor box sits inside the cell, in destination px
    const anchorCX = (anchor.x + anchor.w / 2) * k;
    const anchorBottom = (anchor.y + anchor.h) * k;

    const dx = sx - anchorCX;
    const dy = sy + (o.footY || 0) - anchorBottom;
    const dw = cell * k;
    const dh = cell * k;

    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(entry.img,
      frame * cell, row * cell, cell, cell,
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
    play, face, faceFromVector, step, finished,
    drawActor, drawShadow,
    _state: state,
  };
})();

DHArt.init();
