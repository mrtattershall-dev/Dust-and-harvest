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
    /* How much of the source pack's head to keep. 1 = the art as drawn.

       0.85 and not lower, for a measured reason. The hair styles differ from
       one another by a single row of coverage on a 13px head, so once the
       downscale quantises hard enough those rows land on the same output
       pixel and separate styles become the same picture. At 0.80 that merges
       male "Short crop" with "Slicked back" and "Wavy" with "Shaggy", and
       female "Bun" with "Pixie cut" — six choices collapsing to four. At 0.85
       and 0.90 all twelve stay distinct. Anything below 0.85 needs re-checking
       against that test before it ships. */
    headScale: 0.85,
  };

  function setHeadScale(k) {
    state.headScale = k;
    state.sheets.clear();
  }

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

  /* Hair styles as coverage rules over the head silhouette.

       crown  how far down the head the hair reaches, as a fraction of head height
       sides  how far down the outer edges hang
       inset  how many px in from the edge still counts as "side"

     The fractions are written as thirteenths because the head is thirteen
     pixels tall, and the depth is rounded to whole rows. That is not
     decoration: two styles a few hundredths apart round to the same row and
     become the same picture, which is how "Short crop" and "Side part" ended up
     identical. Spelling each one as a row count makes the spacing checkable by
     reading it — 3/13 and 4/13 are visibly one row apart, .42 and .46 are not.

     Crowns stay at or below 6/13 because the eyes begin at 7/13, so a fringe
     never has to be clipped off the face; the eye guard in drawHair is a safety
     net for odd frames, not the thing doing the shaping. Length is carried by
     `sides`, which is what actually distinguishes a crop from a shag.

     Index matches CC_HAIR_STYLES_MALE / _FEMALE. */
  const R = 1 / 13;
  const HAIR_STYLES = {
    male: [
      { crown: 3*R, sides:  3*R, inset: 2 },  // Short crop
      { crown: 4*R, sides:  6*R, inset: 2 },  // Side part
      { crown: 5*R, sides:  8*R, inset: 3 },  // Wavy
      { crown: 2*R, sides:  2*R, inset: 2 },  // Slicked back
      { crown: 6*R, sides: 10*R, inset: 3 },  // Shaggy
      null,                                    // Bald
    ],
    female: [
      { crown: 4*R, sides:  7*R, inset: 2 },  // Ponytail
      { crown: 3*R, sides:  4*R, inset: 2 },  // Bun
      { crown: 6*R, sides: 12*R, inset: 3 },  // Long & loose
      { crown: 5*R, sides:  9*R, inset: 3 },  // Bob
      { crown: 6*R, sides: 11*R, inset: 2 },  // Braids
      { crown: 2*R, sides:  3*R, inset: 2 },  // Pixie cut
    ],
  };

  /* Cut hair out of the head mask and tint it.

     Two things this has to get right, and the first version got neither.

     The hairline follows the skull. Depth is measured down from the topmost
     head pixel *in that column*, not from a single y for the whole head. The
     old code picked one crownY per cell and erased everything at or below it,
     which is a straight horizontal line: every style came out as a flat-bottomed
     bowl with square corners, sitting on the head rather than growing from it.
     Measuring per column makes the fringe curve with the crown for free, in
     every frame and facing, including the walk cycle's bob.

     The fringe stops above the eyes. The detail layer is the eyes and mouth, so
     its topmost pixel in a cell is the eye line; interior columns are clamped
     to it. Note this is not about the eyes being hidden — buildSheet draws the
     detail layer after the hair, so the eyes always survive. It is about the
     brow: the deeper styles came down to the eye row and left no skin between
     hairline and eye, which is what made every style read as a helmet with a
     face painted under it rather than hair growing on a head. The side columns
     are deliberately not clamped, because hair hanging past the eyes at the
     temples is what framing the face means, and it is most of what
     distinguishes the long styles from the short ones.

     Working on pixels rather than drawing shapes is what lets both rules track
     the art instead of assuming a fixed head position. */
  function drawHair(ctx, img, gd, heads, ramp, gender, styleIdx, cell, detImg) {
    const styles = HAIR_STYLES[gender] || HAIR_STYLES.male;
    const st = styles[Math.min(styleIdx, styles.length - 1)];
    if (!st) return;   // bald

    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w) return;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const oc = off.getContext('2d');
    oc.imageSmoothingEnabled = false;
    oc.drawImage(img, 0, 0);
    const id = oc.getImageData(0, 0, w, h);
    const px = id.data;

    // The face, read once, so the fringe knows where the eyes are.
    let det = null;
    if (detImg && detImg.naturalWidth === w && detImg.naturalHeight === h) {
      const dcv = document.createElement('canvas');
      dcv.width = w; dcv.height = h;
      const dcx = dcv.getContext('2d');
      dcx.imageSmoothingEnabled = false;
      dcx.drawImage(detImg, 0, 0);
      det = dcx.getImageData(0, 0, w, h).data;
    }

    const rowMin = new Int32Array(cell), rowMax = new Int32Array(cell);
    const colTop = new Int32Array(cell);

    for (const [dir, row] of Object.entries(gd.dirRows)) {
      const boxes = heads[dir] || [];
      // Facing away: the whole head is hair, no face to leave clear.
      const back = (dir === 'up');
      for (let f = 0; f < boxes.length; f++) {
        const bx = boxes[f];
        if (!bx) continue;
        const ox = f * cell, oy = row * cell;
        const hh = bx[3] - bx[1];
        if (hh <= 0) continue;

        rowMin.fill(1e9); rowMax.fill(-1); colTop.fill(-1);
        for (let ly = 0; ly < cell; ly++) {
          const base = (oy + ly) * w + ox;
          for (let lx = 0; lx < cell; lx++) {
            if (px[(base + lx) * 4 + 3] === 0) continue;
            if (lx < rowMin[ly]) rowMin[ly] = lx;
            if (lx > rowMax[ly]) rowMax[ly] = lx;
            if (colTop[lx] < 0) colTop[lx] = ly;
          }
        }

        let eyeTop = -1;
        if (det && !back) {
          scan: for (let ly = 0; ly < cell; ly++) {
            const base = (oy + ly) * w + ox;
            for (let lx = 0; lx < cell; lx++)
              if (det[(base + lx) * 4 + 3] > 0) { eyeTop = ly; break scan; }
          }
        }

        // 1.2 rather than 1.0 for the back of the head so the depth clears the
        // skull from every column, including the ones that start lowest.
        // Whole rows: a hairline lands on a pixel boundary or it is a
        // different style that happens to look the same.
        const crownD = back ? hh * 1.2 : Math.round(hh * st.crown);
        const sideD  = back ? hh * 1.2 : Math.round(hh * st.sides);

        for (let ly = 0; ly < cell; ly++) {
          if (rowMax[ly] < 0) continue;
          const base = (oy + ly) * w + ox;
          for (let lx = 0; lx < cell; lx++) {
            const i = (base + lx) * 4;
            if (px[i + 3] === 0) continue;
            if (colTop[lx] < 0) continue;
            const isSide = (lx - rowMin[ly] < st.inset) || (rowMax[ly] - lx < st.inset);
            let limit = colTop[lx] + (isSide ? sideD : crownD);
            if (!back && eyeTop >= 0 && !isSide) limit = Math.min(limit, eyeTop);
            if (ly >= limit) { px[i + 3] = 0; continue; }
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
      drawHair(ctx, hairImg, gd, heads, ramp6(HAIR), gender, hs, cell,
               state.imgs[gender + '/' + clip + '_detail']);
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

    shrinkHeads(ctx, cv, gd, heads, cell);
    return cv;
  }

  /* Re-cut the head.

     The source pack is drawn big-headed: measured on the idle down frame, the
     head occupies 13px of a 22px character — 59% of its height — where the
     game's townsfolk sit nearer 40%. Standing the player next to a citizen made
     that obvious even after the overall height was matched.

     This shrinks everything above the neck toward the neck itself, so the head,
     the hair cut from its silhouette and the hat all scale together and the
     join stays put. It runs last, on the composed cell, which is why the hair
     and hat passes above can keep working in the original art's coordinates and
     need no adjustment — whatever they drew gets carried along.

     Nearest-neighbour, because this is pixel art and a smoothed 13px head turns
     to soup. The cut line is the head box's own bottom edge rather than a fixed
     row, so it tracks the head through the walk cycle's bob. */
  function shrinkHeads(ctx, cv, gd, heads, cell) {
    const k = state.headScale;
    if (!(k > 0) || k >= 1) return;
    const src = document.createElement('canvas');
    src.width = cv.width; src.height = cv.height;
    const sc = src.getContext('2d');
    sc.imageSmoothingEnabled = false;
    sc.drawImage(cv, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const [dir, row] of Object.entries(gd.dirRows)) {
      const boxes = heads[dir] || [];
      for (let f = 0; f < boxes.length; f++) {
        const bx = boxes[f];
        if (!bx) continue;
        const ox = f * cell, oy = row * cell;
        const neckY = bx[3];              // cell-local bottom of the head
        const cx = (bx[0] + bx[2]) / 2;   // cell-local centre of the head
        if (neckY <= 0) continue;
        ctx.clearRect(ox, oy, cell, neckY);
        ctx.save();
        ctx.beginPath(); ctx.rect(ox, oy, cell, neckY); ctx.clip();
        ctx.translate(ox + cx, oy + neckY);
        ctx.scale(k, k);
        ctx.translate(-(ox + cx), -(oy + neckY));
        ctx.drawImage(src, ox, oy, cell, neckY, ox, oy, cell, neckY);
        ctx.restore();
      }
    }
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
    /* Rows are not all the same length. The source packs pad a short row with
       blank cells rather than trimming the sheet, so a clip's frame count is
       only the count of its longest row — the player's back-facing idle is 4
       frames against 12. Cycling all 12 stepped into empty cells for two
       thirds of the loop, which is why standing still facing away made the
       player disappear. sprite-engine.js already learned this from the market
       citizens; this renderer hadn't. */
    const nFrames = (cdef.rowFrames && cdef.rowFrames[row]) || cdef.frames;
    const f = ((frame % nFrames) + nFrames) % nFrames;

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

  return { init, isReady, draw, invalidate, info, setHeadScale, _state: state };
})();

DHPlayer.init();
