#!/usr/bin/env python3
"""Does a zone show its own tile grid?

    ./tools/audit_seams.py            # this repo
    ./tools/audit_seams.py <dir>      # some other build

A SCREENING tool, not a pass/fail test: it prints candidates to look at, and
judging them is still yours. It has a known false-positive class (see below),
so it does not exit non-zero.

WHAT IT LOOKS FOR. The commonest way a painted zone ends up looking like a
prototype is a tile type that fills one colour and then draws a light strip
along its top edge and a dark strip along its bottom. Every tile of that type
is then outlined, and the zone reads as a grid. The hobo camp did this to all
2457 of its tiles and the beach did it as well as picking one of five flat
tones per tile.

HOW. For each zone it takes pairs of ADJACENT TILES OF THE SAME TYPE, in both
axes, draws them side by side at 1:1, and compares the pixel difference across
their shared edge with the difference one line further in. Same-type only,
because a grass/dirt edge is supposed to be visible; both axes, because a strip
along the top and bottom edges makes a horizontal seam and no vertical one at
all.

FALSE POSITIVES. Anything deliberately banded — masonry courses, the gaps
between deck boards, a shoreline — scores as a seam, because the baseline is
sampled at fixed points that can miss the other bands. A stricter baseline (the
strongest band anywhere inside the tile) was tried and is worse: it silences
the exact defect this exists to find, because a bright top strip is itself a
strong interior band. So the loose baseline stays and the list gets read.

THINGS IT HAS ACTUALLY CAUGHT, none of which were visible in a screenshot:
  - the mine's rock face lit and shadowed on every tile rather than only where
    the rock mass ends (written while fixing the same defect in the camp)
  - the jungle and ocean decking seeded per tile, breaking the boards at every
    tile edge
  - a darker "depth" strip along the bottom of every water tile
  - the mesa lightening the top half of every tile

TWO WAYS I GOT THIS WRONG BEFORE IT WORKED, both of which reported everything
clean:
  - measuring EVERY tile boundary, which is mostly genuine terrain edges. It
    scored the jungle 13.9 while the jungle was visibly seamless.
  - drawing into an offscreen canvas assigned to window.ctx. `ctx` is a const
    in the page scope, so the draw functions kept drawing to the screen and
    five zones out of six measured a blank canvas and reported a clean zero.
    Only the jungle worked, because drawJGTile alone reads window.ctx.
Verify any change to this against a copy with a known defect put back, in both
directions, before believing a clean run.

Needs Playwright and the Chromium at PLAYWRIGHT_BROWSERS_PATH.
"""
import asyncio, time, http.server, socketserver, threading, random, json, sys
from pathlib import Path
from playwright.async_api import async_playwright
def serve(d, port):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self,*a,**k): super().__init__(*a, directory=str(d), **k)
        def log_message(self,*a): pass
    socketserver.TCPServer.allow_reuse_address = True
    threading.Thread(target=socketserver.TCPServer(("", port), H).serve_forever, daemon=True).start()
BOOT = """() => { startNewGame();
  const t=document.getElementById('titleScreen'); t.classList.remove('show'); t.style.display='none';
  const i=document.getElementById('introScreen'); if(i){i.classList.remove('show');i.style.display='none';} }"""

# (label, enter js, getter, width, height, draw-one-tile js)
ZONES = [
 ("overworld","", "getT","MAP_W","MAP_H","drawTile(TX,TY,SX,SY)"),
 ("mine","enterMine()","(x,y)=>getMineT(gameState.mineFloor,x,y)","MINE_W","MINE_H","drawMineTile(V,SX,SY,TX,TY)"),
 ("badlands","enterBadlands()","getBLT","BL_W","BL_H","drawBLTile(TX,TY,SX,SY)"),
 ("hobo camp","enterHoboCamp()","getHCT","HC_W","HC_H","drawHCTile(V,TX,TY,SX,SY)"),
 ("ocean","enterOcean()","getOCT","OC_W","OC_H","drawOCTile(V,TX,TY,SX,SY)"),
 ("jungle","enterJungle()","getJGT","JG_W","JG_H","drawJGTile(V,SX,SY,TX,TY)"),
]
TPL = """(cfg) => {
  eval(cfg.enter);
  const get = eval('(' + cfg.get + ')');
  const W = eval(cfg.w), H = eval(cfg.h);
  // Draw into the REAL ctx, not an offscreen one.
  //
  // The first version set window.ctx to an offscreen context and put it back
  // afterwards. `ctx` is a const in the page's script scope, so assigning
  // window.ctx does not change what these functions draw into — they kept
  // drawing to the screen and every zone measured a blank canvas and reported
  // a clean 0. Only drawJGTile worked, because it alone reads window.ctx.
  // Five zones out of six were reporting on nothing at all.
  const c = ctx;
  const out = {};
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  try {
   for (const axis of ['x', 'y']) {
    const byType = {};
    for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 2; x++) {
      const v = get(x, y);
      if (get(axis === 'x' ? x + 1 : x, axis === 'x' ? y : y + 1) !== v) continue;
      byType[v] = byType[v] || [];
      if (byType[v].length < 12) byType[v].push([x, y]);
    }
    for (const v in byType) {
      let cross = 0, inner = 0, n = 0;
      for (const [x, y] of byType[v]) {
        c.clearRect(0, 0, 64, 64);
        c.fillStyle = '#000'; c.fillRect(0, 0, 64, 64);
        for (let k = 0; k < 2; k++) {
          const tx2 = axis === 'x' ? x + k : x, ty2 = axis === 'x' ? y : y + k;
          const V = get(tx2, ty2), TX = tx2, TY = ty2;
          const SX = axis === 'x' ? k * 32 : 0, SY = axis === 'x' ? 0 : k * 32;
          try { eval(cfg.draw); } catch (e) { out['THREW:' + v] = [999, 0, 0]; }
        }
        const d = c.getImageData(0, 0, 64, 64).data;
        const line = (at) => { const s2 = [];
          for (let t = 0; t < 32; t++) {
            const px = axis === 'x' ? at : t, py = axis === 'x' ? t : at;
            const i = (py * 64 + px) * 4; s2.push([d[i], d[i+1], d[i+2]]);
          } return s2; };
        const diff = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++)
          t += Math.abs(a[i][0]-b[i][0]) + Math.abs(a[i][1]-b[i][1]) + Math.abs(a[i][2]-b[i][2]);
          return t / a.length; };
        cross += diff(line(31), line(32));
        inner += (diff(line(28), line(29)) + diff(line(34), line(35))) / 2;
        n++;
      }
      if (n) out[axis + ':' + v] = [ +(cross / n).toFixed(1), +(inner / n).toFixed(1), n ];
    }
   }
  } finally { c.restore(); }
  return out;
}"""
async def main():
    port=random.randint(9000,9900); serve(Path(sys.argv[1] if len(sys.argv)>1 else "/home/user/Dust-and-harvest"), port)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        for label, enter, get, w, h, draw in ZONES:
            pg = await (await b.new_context(viewport={"width":900,"height":600})).new_page()
            errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)[:90]))
            await pg.route("**fonts.g**", lambda r: r.abort())
            await pg.goto(f"http://localhost:{port}/index.html?v={time.time()}")
            await pg.wait_for_timeout(4500); await pg.evaluate(BOOT); await pg.wait_for_timeout(500)
            try:
                r = await pg.evaluate(TPL, {"enter":enter or "0","get":get,"w":w,"h":h,"draw":draw})
            except Exception as e:
                print(f"{label}: ERROR {str(e)[:100]}"); await pg.close(); continue
            bad = {k:v for k,v in r.items() if v[0] > max(8, v[1]*2.0 + 4)}
            print(f"{label}: {len(r)} tile types with same-type neighbours; "
                  f"{len(bad)} showing a seam")
            for k,v in sorted(bad.items(), key=lambda kv:-kv[1][0])[:6]:
                print(f"    type {k:>4}  cross={v[0]:7.1f}  inner={v[1]:6.1f}  n={v[2]}")
            if errs: print("   pageerrors:", errs[:2])
            await pg.close()
        await b.close()
asyncio.run(main())
