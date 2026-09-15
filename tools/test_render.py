#!/usr/bin/env python3
"""Regression tests for the world render. Exits non-zero on failure.

    ./tools/test_render.py            # serves the repo and tests it
    ./tools/test_render.py <dir>      # test a different build directory

Two checks, both written against real bugs that shipped:

1. COLD-START ORDERING. `drawTile`'s painted branches are not pure drawing
   code — the dirt branch also builds the dirt, fence and fence-gate tile
   variants in one lazy block, and TL.FENCE and TL.FENCE_GATE depend on that
   side effect. Wiring dirt to the baked ground put an early `return` in front
   of that block, so the caches stayed empty and the first fence tile on screen
   threw out of `drawImage` — which aborts `render()` for the whole frame and
   blanks the screen.

   The test clears the caches and draws each dependent tile type FIRST, which
   is what a viewport showing a fence before any dirt does on a real device.

2. EVERY ZONE RENDERS. The game has eight zones behind the overworld — mine,
   badlands, badlands mine, hobo camp, ocean, jungle, deep jungle, ruins —
   each with its own draw code. A crash in any of them is a black screen for
   whoever walks in. The test enters each, renders a frame, and checks that
   something was actually painted rather than the frame throwing.

3. EVERY TILE TYPE, FOUR VIEWPORT SHAPES. The bug above only appeared on a
   phone, because whether a fence is on screen depends on the SHAPE of the
   viewport and not its size. Testing 1280x800 and calling it covered is how it
   reached a user.

Needs Playwright and the Chromium at PLAYWRIGHT_BROWSERS_PATH.
"""
import asyncio
import http.server
import os
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parent.parent
CHROMIUM = os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium")
SHAPES = [(1280, 800, "wide"), (428, 926, "tall"),
          (926, 428, "short"), (360, 780, "narrow")]

BOOT = """() => { startNewGame();
  const t=document.getElementById('titleScreen'); t.classList.remove('show'); t.style.display='none';
  const i=document.getElementById('introScreen'); if(i){i.classList.remove('show');i.style.display='none';} }"""

COLD_START = """() => {
  const out = {};
  // The invariant itself, checked at the cause rather than at the symptom.
  //
  // Drawing a dirt tile is what BUILDS the lazy variant caches other tile
  // types index. The shipped bug was an early `return` for the baked ground
  // placed in front of that block, which left the caches empty; the black
  // screen was only the symptom, by way of an unguarded consumer indexing an
  // empty array and throwing out of drawImage. Every consumer is guarded now,
  // so the symptom no longer appears — which is exactly why this has to test
  // that drawing dirt still fills the caches, or the check passes for free
  // and the next unguarded consumer ships the same black screen.
  {
    let dx = -1, dy = -1;
    for (let y = 0; y < MAP_H && dy < 0; y++) for (let x = 0; x < MAP_W; x++)
      if (tileMap[y*MAP_W+x] === TL.DIRT) { dx = x; dy = y; break; }
    if (dx < 0) out['dirt builds caches'] = 'FAIL: no dirt on the map';
    else {
      delete drawTile._dirtV;
      try { drawTile(dx, dy, 0, 0); } catch (e) {}
      out['dirt builds caches'] =
        (drawTile._dirtV && drawTile._dirtV.length)
          ? 'ok' : 'FAIL: _dirtV still empty after drawing dirt';
    }
  }
  for (const type of ['FENCE','FENCE_GATE','SPRINKLER']) {
    if (TL[type] === undefined) { out[type] = 'skip: no such tile'; continue; }
    let fx = -1, fy = -1;
    for (let y=0; y<MAP_H && fy<0; y++) for (let x=0; x<MAP_W; x++)
      if (tileMap[y*MAP_W+x] === TL[type]) { fx=x; fy=y; break; }
    // If the map does not happen to carry one, put one down. Skipping was
    // hiding the only tile type that still depends on the lazy cache: the
    // fence and gate were rewritten to draw themselves, so without this the
    // ordering check had no live subject left and passed for free.
    let placed = -1;
    if (fx < 0) {
      placed = 4 * MAP_W + 4; fx = 4; fy = 4;
      var _was = tileMap[placed]; tileMap[placed] = TL[type];
    }
    delete drawTile._dirtV; delete drawTile._fenceV;
    delete drawTile._fenceHV; delete drawTile._fenceGateV;
    // Measured off the canvas, not by counting drawImage calls. Counting blits
    // was a proxy for "the tile painted something", and it stopped being one
    // the moment a tile type went back to being drawn rather than blitted —
    // it then reported a perfectly good fence as drawing nothing. Clear the
    // cell to a colour nothing uses and check the tile covered it.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, T, T);
    let err = null;
    try { drawTile(fx, fy, 0, 0); } catch (e) { err = e.message.slice(0, 60); }
    let left = 0;
    const d = ctx.getImageData(0, 0, T, T).data;
    for (let i = 0; i < d.length; i += 4)
      if (d[i] > 240 && d[i+1] < 40 && d[i+2] > 240) left++;
    ctx.restore();
    if (placed >= 0) tileMap[placed] = _was;
    out[type] = err ? 'FAIL: threw ' + err
              : left > T * T * 0.02 ? 'FAIL: left ' + left + '/' + (T*T) + ' px unpainted'
              : 'ok';
  }
  return out;
}"""

ALL_TILES = """() => {
  const NAME = {}; for (const k in TL) NAME[TL[k]] = k;
  const fails = {};
  for (let y=0; y<MAP_H; y++) for (let x=0; x<MAP_W; x++) {
    try { drawTile(x, y, 0, 0); }
    catch (e) {
      const k = (NAME[tileMap[y*MAP_W+x]] || '?') + ': ' + e.message.slice(0, 50);
      fails[k] = (fails[k] || 0) + 1;
    }
  }
  return fails;
}"""


ZONES = [
    ("overworld",   None),
    ("mine",        "enterMine()"),
    ("badlands",    "enterBadlands()"),
    ("badlands mine", "enterBadlands(); enterBLMine()"),
    ("hobo camp",   "enterHoboCamp()"),
    ("ocean",       "enterOcean()"),
    ("jungle",      "enterJungle()"),
    ("deep jungle", "enterJungle(); enterDeepJungle()"),
    ("ruins",       "enterRuins()"),
]

# Render one frame and report whether it painted anything. A zone whose draw
# code throws leaves the canvas as it was, so "more than one distinct colour
# across a grid of samples" is the cheapest honest test that a frame happened.
ZONE_FRAME = """(js) => {
  const out = {};
  try { eval(js); } catch (e) { return {enter: 'FAIL: ' + e.message.slice(0, 60)}; }
  try { render(); } catch (e) { return {draw: 'FAIL: ' + e.message.slice(0, 60)}; }
  const seen = new Set();
  for (let i = 1; i < 5; i++) for (let j = 1; j < 5; j++) {
    const d = ctx.getImageData((canvas.width * i / 5) | 0, (canvas.height * j / 5) | 0, 1, 1).data;
    seen.add(d[0] + ',' + d[1] + ',' + d[2]);
  }
  out.colours = seen.size;
  return out;
}"""


def serve(directory, port):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(directory), **k)
        def log_message(self, *a): pass
    httpd = socketserver.TCPServer(("", port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    # Accepts a directory, or a single .html file — the standalone build is
    # dist/dust-and-harvest.html, not dist/index.html, and testing the thing
    # that actually ships matters more than testing a convenient filename.
    arg = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO
    root, page = (arg.parent, arg.name) if arg.suffix == ".html" else (arg, "index.html")
    port = int(os.environ.get("PORT", 8765))
    serve(root, port)
    failures = []

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        for w, h, label in SHAPES:
            ctx = await b.new_context(viewport={"width": w, "height": h})
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:80]))
            await pg.route("**fonts.g**", lambda r: r.abort())
            await pg.goto(f"http://localhost:{port}/{page}?v={time.time()}")
            await pg.wait_for_timeout(4500)
            await pg.evaluate(BOOT)
            await pg.wait_for_timeout(1200)

            # Zones first: entering one changes global state, so this runs
            # on its own page load per shape and the tile checks follow on a
            # fresh one. Cheaper here is wrong — a half-entered jungle would
            # make the tile census meaningless.
            for zname, js in ZONES:
                if js is None:
                    continue
                z = await pg.evaluate(ZONE_FRAME, js)
                bad = z.get("enter") or z.get("draw")
                if bad:
                    print(f"         zone {zname}: {bad}")
                    failures.append(f"{label}/{zname}")
                elif z.get("colours", 0) < 2:
                    print(f"         zone {zname}: FAIL drew a blank frame")
                    failures.append(f"{label}/{zname}")
                else:
                    print(f"         zone {zname}: ok ({z['colours']} colours)")
            await pg.reload()
            await pg.wait_for_timeout(4000)
            await pg.evaluate(BOOT)
            await pg.wait_for_timeout(1000)

            cold = await pg.evaluate(COLD_START)
            bad = {k: v for k, v in cold.items() if v.startswith("FAIL")}
            tiles = await pg.evaluate(ALL_TILES)

            ok = not bad and not tiles and not errs
            print(f"{'PASS' if ok else 'FAIL'}  {label:7s} {w}x{h}")
            for k, v in cold.items():
                print(f"         cold-start {k}: {v}")
            if tiles:
                print(f"         tile draws threw: {tiles}")
            if errs:
                print(f"         page errors: {errs[:3]}")
            if not ok:
                failures.append(label)
            await ctx.close()
        await b.close()

    if failures:
        print(f"\n{len(failures)} shape(s) failed: {', '.join(failures)}")
        return 1
    print("\nall shapes pass")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
