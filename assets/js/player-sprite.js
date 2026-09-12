// ═══════════════════════════════════════════════════════════════════════════════
//  DUST & HARVEST — PLAYER SPRITE
//  Draws the player from the CraftPix base-character art while keeping the
//  game's character customization intact.
//
//  The source art is an unclothed mannequin plus region masks built by
//  tools/build_player.py. Nothing is baked: at runtime each region is tinted
//  from the palette the player picked (skin tone, shirt, trousers), the hair
//  and hat are drawn on top by the game's existing pixel-art routines, and the
//  whole lot is composed once into a cached sheet that is redrawn only when the
//  customization actually changes.
//
//  Fails soft: if the layers do not load, isReady() stays false and
//  drawCharacter falls back to the original hand-drawn player.
// ═══════════════════════════════════════════════════════════════════════════════
window.DHPlayer = (function () {
  'use strict';

  const BASE = 'assets/sprites/player/';
  const LAYERS = ['', '_torso', '_legs', '_detail', '_head'];

  const state = {
    manifest: null,
    imgs: {},        // "gender/clip_layer" -> Image
    pending: 0,
    ok: false,
    sheets: new Map(),   // cacheKey -> canvas
    warned: false,
  };

  function init() {
    fetch(BASE + 'player.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(m => {
        state.manifest = m;
        for (const [g, gd] of Object.entries(m.genders)) {
          for (const clip of Object.keys(gd.clips)) {
            for (const suf of LAYERS) {
              const key = g + '/' + clip + suf;
              const im = new Image();
              state.pending++;
              im.onload = () => { if (--state.pending === 0) state.ok = true; };
              im.onerror = () => {
                state.pending--;
                console.warn('[DHPlayer] failed:', key);
              };
              im.src = BASE + key + '.png';
              state.imgs[key] = im;
            }
          }
        }
      })
      .catch(err => {
        console.warn('[DHPlayer] no player sprite (' + err.message +
                     ') — using the hand-drawn character.');
      });
  }

  function isReady() { return state.ok && !!state.manifest; }

  function info(gender) {
    if (!state.manifest) return null;
    return state.manifest.genders[gender] || state.manifest.genders.male;
  }

  // ── Palette ─────────────────────────────────────────────────────────────────
  // The game stores every palette as [shadow, mid, highlight]. The source art
  // has six shading levels, so the ramp is expanded: an outline below the
  // shadow, and midpoints between the three given stops.
  function hex(h) {
    h = String(h).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function ramp6(three) {
    const D = hex(three[0]), M = hex(three[1]), L = hex(three[2]);
    const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
    return [D.map(c => Math.round(c * 0.55)), D, mix(D, M, .5), M, mix(M, L, .5), L];
  }

  // Draw one level-encoded layer, recoloured, onto ctx.
  function tintLayer(ctx, img, ramp) {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w) return;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const oc = off.getContext('2d');
    oc.imageSmoothingEnabled = false;
    oc.drawImage(img, 0, 0);
    const id = oc.getImageData(0, 0, w, h);
    const p = id.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) continue;
      const c = ramp[Math.min(p[i], 5)];
      p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2];
    }
    oc.putImageData(id, 0, 0);
    ctx.drawImage(off, 0, 0);
  }

  // Hair styles as coverage rules over the head silhouette.
  //   crown  how far down the head the hair reaches, as a fraction of head height
  //   sides  how far down the outer edges hang (0 = same as crown)
  //   inset  how many px in from the edge still counts as "side"
  // Index matches CC_HAIR_STYLES_MALE / _FEMALE.
  const HAIR_STYLES = {
    male: [
      { crown: .42, sides: .42, inset: 2 },  // Short crop
      { crown: .46, sides: .60, inset: 2 },  // Side part
      { crown: .48, sides: .72, inset: 3 },  // Wavy
      { crown: .34, sides: .34, inset: 2 },  // Slicked back
      { crown: .52, sides: .80, inset: 3 },  // Shaggy
      null,                                   // Bald
    ],
    female: [
      { crown: .46, sides: .70, inset: 2 },  // Ponytail
      { crown: .44, sides: .44, inset: 2 },  // Bun
      { crown: .50, sides: .95, inset: 3 },  // Long & loose
      { crown: .48, sides: .66, inset: 3 },  // Bob
      { crown: .48, sides: .88, inset: 2 },  // Braids
      { crown: .38, sides: .40, inset: 2 },  // Pixie cut
    ],
  };

  // Cut hair out of the head mask and tint it. Working on pixels rather than
  // drawing shapes means the hairline follows the skull in every frame and
  // facing, including the walk cycle's head bob.
  function drawHair(ctx, img, gd, heads, ramp, gender, styleIdx, cell) {
    const styles = HAIR_STYLES[gender] || HAIR_STYLES.male;
    const st = styles[Math.min(styleIdx, styles.length - 1)];
    if (!st) return;   // bald

    const w = img.naturalWidth, h = img.naturalHeight;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const oc = off.getContext('2d');
    oc.imageSmoothingEnabled = false;
    oc.drawImage(img, 0, 0);
    const id = oc.getImageData(0, 0, w, h);
    const px = id.data;

    // Per-frame row extents of the head, so "the outer edge" means the edge of
    // the skull on that row rather than of the bounding box.
    for (const [dir, row] of Object.entries(gd.dirRows)) {
      const boxes = heads[dir] || [];
      // Facing away: the whole head is hair, no face to leave clear.
      const back = (dir === 'up');
      for (let f = 0; f < boxes.length; f++) {
        const bx = boxes[f];
        if (!bx) continue;
        const ox = f * cell, oy = row * cell;
        const hh = bx[3] - bx[1];
        const crownY = bx[1] + hh * (back ? 0.97 : st.crown);
        const sideY  = bx[1] + hh * (back ? 0.97 : st.sides);

        for (let y = oy; y < oy + cell; y++) {
          // Row extents
          let minX = 1e9, maxX = -1;
          for (let x = ox; x < ox + cell; x++) {
            if (px[(y * w + x) * 4 + 3] > 0) { if (x < minX) minX = x; maxX = x; }
          }
          for (let x = ox; x < ox + cell; x++) {
            const i = (y * w + x) * 4;
            if (px[i + 3] === 0) continue;
            const localY = y - oy;
            const isSide = maxX >= 0 &&
                           (x - minX < st.inset || maxX - x < st.inset);
            const limit = isSide ? sideY : crownY;
            if (localY >= limit) { px[i + 3] = 0; continue; }
            const c = ramp[Math.min(px[i], 5)];
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
          }
        }
      }
    }
    oc.putImageData(id, 0, 0);
    ctx.drawImage(off, 0, 0);
  }

  // Shirt styles, in the order the creation screen lists them. Each is a rule
  // applied to the torso mask rather than separate art: which pixels the
  // garment covers, and where it darkens or lightens within its own ramp so
  // accents stay in palette whatever colour the player picked.
  const SHIRT_STYLES = {
    male:   ['suspenders', 'full', 'vest', 'rolled', 'jacket'],
    female: ['blouse', 'dress', 'vest', 'tied', 'jacket'],
  };

  // Per-cell torso extent, measured from the mask itself so it tracks the
  // walk cycle rather than assuming a fixed band.
  function cellBounds(px, w, ox, oy, cell) {
    let top = -1, bot = -1;
    for (let y = oy; y < oy + cell; y++) {
      let any = false;
      for (let x = ox; x < ox + cell; x++) {
        if (px[(y * w + x) * 4 + 3] > 0) { any = true; break; }
      }
      if (any) { if (top < 0) top = y; bot = y; }
    }
    return { top, bot };
  }

  function drawTorso(ctx, img, gd, ramp, style, cell) {
    if (!img || !img.naturalWidth) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const oc = off.getContext('2d');
    oc.imageSmoothingEnabled = false;
    oc.drawImage(img, 0, 0);
    const id = oc.getImageData(0, 0, w, h);
    const px = id.data;

    const frames = Math.floor(w / cell);
    for (const row of Object.values(gd.dirRows)) {
      for (let f = 0; f < frames; f++) {
        const ox = f * cell, oy = row * cell;
        const b = cellBounds(px, w, ox, oy, cell);
        if (b.top < 0) continue;
        const th = b.bot - b.top + 1;

        for (let y = b.top; y <= b.bot; y++) {
          let minX = 1e9, maxX = -1;
          for (let x = ox; x < ox + cell; x++) {
            if (px[(y * w + x) * 4 + 3] > 0) { if (x < minX) minX = x; maxX = x; }
          }
          if (maxX < 0) continue;
          const cx = (minX + maxX) / 2;
          const ly = y - b.top;             // row within the torso
          const frac = th > 1 ? ly / (th - 1) : 0;

          for (let x = minX; x <= maxX; x++) {
            const i = (y * w + x) * 4;
            if (px[i + 3] === 0) continue;
            // Sleeves: the outer columns, below the shoulder line.
            const isArm = ly >= 2 && (x - minX < 2 || maxX - x < 2);
            let drop = false, shade = 0;

            switch (style) {
              case 'vest':                       // open at the shoulders
                drop = isArm; break;
              case 'rolled':                     // sleeves stop at the elbow
                drop = isArm && frac > 0.5; break;
              case 'tied':                       // cropped above the waist
                drop = frac > 0.72; break;
              case 'jacket':                     // heavy collar and lapels
                shade = (frac < 0.18 || isArm) ? -1 : 0; break;
              case 'blouse':                     // soft, lighter at the collar
                shade = frac < 0.22 ? 1 : 0; break;
              case 'suspenders': {
                // A work shirt with braces over it. Bare shoulders with only
                // the straps covered was tried first and turned to mush: the
                // torso is ~11px wide, so a 2px strap against bare skin does
                // not read. Dark straps over full cover is legible at 26px and
                // still obviously not the plain work shirt.
                const strap = Math.abs(x - cx) >= 1.5 && Math.abs(x - cx) <= 2.6;
                shade = strap ? -2 : 0;
                break;
              }
              default: break;                    // 'full' and 'dress'
            }

            if (drop) { px[i + 3] = 0; continue; }
            const lvl = Math.max(0, Math.min(5, px[i] + shade));
            const c = ramp[lvl];
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
          }
        }
      }
    }
    oc.putImageData(id, 0, 0);
    ctx.drawImage(off, 0, 0);
  }

  function cfgKey(cfg, clip) {
    return [cfg.gender || 'male', clip, cfg.skinTone | 0, cfg.hairStyle | 0,
            cfg.hairColor | 0, cfg.shirtStyle | 0, cfg.shirtColor | 0,
            cfg.pantsColor | 0, cfg.hatColor | 0].join('|');
  }

  // Compose one clip's whole sheet for this look. Cached — this runs on a
  // customization change, not per frame.
  function buildSheet(cfg, clip) {
    const gender = (cfg.gender === 'female') ? 'female' : 'male';
    const gd = info(gender);
    if (!gd || !gd.clips[clip]) return null;

    const base = state.imgs[gender + '/' + clip];
    if (!base || !base.naturalWidth) return null;

    const cv = document.createElement('canvas');
    cv.width = base.naturalWidth; cv.height = base.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const SKIN  = ramp6(CC_SKIN_TONES[Math.min(cfg.skinTone | 0, CC_SKIN_TONES.length - 1)]);
    const SHIRT = ramp6(CC_SHIRT_COLORS[Math.min(cfg.shirtColor | 0, CC_SHIRT_COLORS.length - 1)]);
    const PANTS = ramp6(CC_PANTS_COLORS[Math.min(cfg.pantsColor | 0, CC_PANTS_COLORS.length - 1)]);

    const ss = cfg.shirtStyle | 0;
    const style = (SHIRT_STYLES[gender] || SHIRT_STYLES.male)[
      Math.min(ss, (SHIRT_STYLES[gender] || SHIRT_STYLES.male).length - 1)] || 'full';

    tintLayer(ctx, base, SKIN);
    drawTorso(ctx, state.imgs[gender + '/' + clip + '_torso'], gd, SHIRT, style, gd.cell);
    // A prairie dress runs past the waist, so the leg region takes the shirt
    // colour rather than the trousers.
    tintLayer(ctx, state.imgs[gender + '/' + clip + '_legs'],
              style === 'dress' ? SHIRT : PANTS);

    // Hair, cut from the head's own silhouette so it follows the skull instead
    // of sitting on it as a rectangular cap. Each style is a rule about how far
    // down the head to keep, and whether the sides hang lower than the crown.
    const HAIR = CC_HAIR_COLORS[Math.min(cfg.hairColor | 0, CC_HAIR_COLORS.length - 1)];
    const HAT  = CC_HAT_COLORS[Math.min(cfg.hatColor | 0, CC_HAT_COLORS.length - 1)];
    const hs = cfg.hairStyle | 0;
    const heads = state.manifest.genders[gender].heads[clip] || {};
    const cell = gd.cell;
    const hairImg = state.imgs[gender + '/' + clip + '_head'];
    if (hairImg && hairImg.naturalWidth) {
      drawHair(ctx, hairImg, gd, heads, ramp6(HAIR), gender, hs, cell);
    }

    // Eyes and mouth last and untinted, so the face stays readable at 30px
    // whatever the hair style does. The back-facing rows have no face pixels,
    // so nothing appears there.
    const detImg = state.imgs[gender + '/' + clip + '_detail'];
    if (detImg && detImg.naturalWidth) ctx.drawImage(detImg, 0, 0);

    if (HAT && typeof _drawHat === 'function') {
      for (const [dir, row] of Object.entries(gd.dirRows)) {
        const boxes = heads[dir] || [];
        for (let f = 0; f < boxes.length; f++) {
          const bx = boxes[f];
          if (!bx) continue;
          ctx.save();
          ctx.beginPath(); ctx.rect(f * cell, row * cell, cell, cell); ctx.clip();
          ctx.translate(f * cell, row * cell);
          try {
            // _drawHat is written against the old character's baseline: it puts
            // the crown at by-39 and the brim at by-33. Anchor that so the brim
            // lands just below this head's crown rather than floating above it.
            const hh = bx[3] - bx[1];
            _drawHat(ctx, (bx[0] + bx[2]) / 2, bx[1] + 33 + hh * 0.28,
                     HAT, '#100808', dir);
          } catch (e) { /* one bad frame must not kill the sheet */ }
          ctx.restore();
        }
      }
    }
    return cv;
  }

  function sheetFor(cfg, clip) {
    const key = cfgKey(cfg, clip);
    let s = state.sheets.get(key);
    if (s !== undefined) return s;
    s = buildSheet(cfg, clip);
    // Cache misses too, so a broken clip is not retried every frame.
    state.sheets.set(key, s);
    // A look change invalidates everything; keep the map from growing forever.
    if (state.sheets.size > 24) {
      const first = state.sheets.keys().next().value;
      state.sheets.delete(first);
    }
    return s;
  }

  function invalidate() { state.sheets.clear(); }

  // Draw the player. (sx, sy) is the same anchor the hand-drawn character used;
  // `size` is the drawn height of the sprite's content.
  function draw(ctx, sx, sy, facing, clip, frame, cfg, opts) {
    if (!isReady()) return false;
    const gender = (cfg.gender === 'female') ? 'female' : 'male';
    const gd = info(gender);
    if (!gd) return false;
    const cdef = gd.clips[clip] || gd.clips.idle;
    if (!cdef) return false;
    const sheet = sheetFor(cfg, gd.clips[clip] ? clip : 'idle');
    if (!sheet) return false;

    const o = opts || {};
    const cell = gd.cell;
    const row = gd.dirRows[facing] != null ? gd.dirRows[facing] : 0;
    const f = ((frame % cdef.frames) + cdef.frames) % cdef.frames;

    // The content sits in the middle of a 64px cell; scale so its height
    // matches the requested size and stand it on (sx, sy).
    const k = (o.size || 34) / (o.contentH || 26);
    const dw = cell * k, dh = cell * k;
    const dx = sx - dw / 2;
    const dy = sy + (o.footY || 0) - dh * ((o.footFrac != null) ? o.footFrac : 0.6875);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.drawImage(sheet, f * cell, row * cell, cell, cell,
                  Math.round(dx), Math.round(dy), Math.ceil(dw), Math.ceil(dh));
    ctx.restore();
    return true;
  }

  return { init, isReady, draw, invalidate, info, _state: state };
})();

DHPlayer.init();
