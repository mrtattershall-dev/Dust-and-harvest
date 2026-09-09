// ═══════════════════════════════════════════════════════════════════════════════
//  SPRITE LAB — dev-only preview overlay.  Toggle with the ` (backtick) key.
//
//  Renders every actor in the manifest, animating, in all four facings, so a new
//  pack can be checked for correct row order and anchoring before any game code
//  is wired to it. Nothing here runs unless the overlay is open.
//
//  What to look for when adding a pack:
//    • The four columns must read DOWN / UP / LEFT / RIGHT. If left and right are
//      swapped, re-run prep_assets.py with --rows DURL.
//    • Every actor's feet should sit on the same red ground line. If one floats
//      or sinks, its anchor box measured wrong — usually a stray pixel in the
//      source sheet.
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let open = false;
  let canvas = null, c = null, raf = 0, last = 0;
  let clipIdx = 0;
  const dummies = {};       // actorId+dir -> entity-like object holding _art

  const DIRS = ['down', 'up', 'left', 'right'];
  const CELL = 78;          // preview cell size in px
  const SPRITE_H = 34;      // drawn content height

  function build() {
    const wrap = document.createElement('div');
    wrap.id = 'spriteLab';
    wrap.style.cssText = [
      'position:absolute', 'inset:0', 'background:#060402', 'z-index:300',
      'display:none', 'overflow:auto', 'padding:12px',
      "font-family:'Special Elite',monospace", 'color:#c8b990',
    ].join(';');

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:14px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
    bar.innerHTML =
      '<b style="color:#e07820;letter-spacing:.1em">SPRITE LAB</b>' +
      '<span id="slStatus" style="font-size:11px"></span>' +
      '<span style="font-size:11px;opacity:.7">' +
      '[`] close &nbsp; [← →] cycle clip</span>' +
      '<span id="slClip" style="font-size:12px;color:#e8dfc8"></span>';
    wrap.appendChild(bar);

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;image-rendering:pixelated;';
    wrap.appendChild(canvas);

    document.body.appendChild(wrap);
    c = canvas.getContext('2d');
    return wrap;
  }

  function allClips() {
    const set = new Set();
    for (const id of DHArt.list()) {
      for (const k of Object.keys(DHArt.info(id).clips)) set.add(k);
    }
    // Stable, useful order
    const order = ['idle', 'walk', 'run', 'attack', 'hurt', 'death'];
    return [...set].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function draw(dt) {
    const ids = DHArt.list().sort();
    const clips = allClips();
    if (!clips.length) return;
    const clipName = clips[clipIdx % clips.length];
    document.getElementById('slClip').textContent = '▶ ' + clipName;

    const p = DHArt.progress();
    document.getElementById('slStatus').textContent =
      `${p.status} · ${ids.length} actors · ${p.loaded} sheets` +
      (p.pending ? ` · ${p.pending} loading` : '') +
      (p.failed.length ? ` · ${p.failed.length} FAILED` : '');

    const labelW = 110;
    const w = labelW + CELL * DIRS.length + 20;
    const h = 26 + ids.length * CELL;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }

    c.clearRect(0, 0, w, h);
    c.imageSmoothingEnabled = false;

    // Column headings
    c.font = '10px monospace';
    c.fillStyle = '#8a7a55';
    c.textAlign = 'center';
    DIRS.forEach((d, i) => c.fillText(d.toUpperCase(), labelW + i * CELL + CELL / 2, 14));

    ids.forEach((id, r) => {
      const def = DHArt.info(id);
      const y = 26 + r * CELL;
      const groundY = y + CELL - 18;

      // Row label
      c.textAlign = 'left';
      c.fillStyle = def.clips[clipName] ? '#c8b990' : '#5a4a35';
      c.font = '11px monospace';
      c.fillText(id, 6, y + CELL / 2);
      c.fillStyle = '#6a5a40';
      c.font = '9px monospace';
      c.fillText(`${def.cell}px`, 6, y + CELL / 2 + 12);

      // Shared ground line — every actor's feet must land here
      c.strokeStyle = 'rgba(200,60,40,.35)';
      c.beginPath();
      c.moveTo(labelW, groundY + 0.5);
      c.lineTo(labelW + CELL * DIRS.length, groundY + 0.5);
      c.stroke();

      if (!def.clips[clipName]) return;

      DIRS.forEach((dir, i) => {
        const key = id + '|' + dir;
        const ent = dummies[key] || (dummies[key] = {});
        DHArt.play(ent, clipName);
        DHArt.face(ent, dir);
        DHArt.step(ent, dt, id);
        // Loop the one-shot clips here so they stay watchable
        if (DHArt.finished(ent)) { ent._art.t = 0; ent._art.done = false; }

        const cx = labelW + i * CELL + CELL / 2;
        DHArt.drawShadow(c, id, cx, groundY, { size: SPRITE_H });
        DHArt.drawActor(c, id, ent, cx, groundY, { size: SPRITE_H });
      });
    });
  }

  function loop(ts) {
    if (!open) return;
    const dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    draw(dt);
    raf = requestAnimationFrame(loop);
  }

  function toggle() {
    const el = document.getElementById('spriteLab') || build();
    open = !open;
    el.style.display = open ? 'block' : 'none';
    if (open) { last = performance.now(); raf = requestAnimationFrame(loop); }
    else cancelAnimationFrame(raf);
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Backquote') { e.preventDefault(); toggle(); return; }
    if (!open) return;
    if (e.code === 'ArrowRight') { clipIdx++; e.preventDefault(); }
    if (e.code === 'ArrowLeft') { clipIdx = (clipIdx + allClips().length - 1); e.preventDefault(); }
    if (e.code === 'Escape') { toggle(); e.preventDefault(); }
  }, true);   // capture, so the game's own handlers do not swallow it

  window.spriteLab = toggle;
})();
