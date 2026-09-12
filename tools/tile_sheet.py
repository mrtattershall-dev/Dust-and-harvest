#!/usr/bin/env python3
"""Render every tile type of a zone side by side, so placeholder art shows up.

    ./tools/tile_sheet.py                 # every zone, into dist/tiles-<zone>.png
    ./tools/tile_sheet.py mine badlands   # just these

Walking the map to find art that still looks like a prototype does not work:
you see what you happen to walk past, and you stop seeing the things you have
walked past often. This draws each tile type as a 3x3 patch OF ITSELF, at 2x,
labelled, in one image. The first run of it found six placeholders on the
overworld in one look, four of which I had walked past repeatedly — a building
made of six outlined boxes, a workbench with an emoji on it, a forge in a dark
square, and a campfire with no ground under it.

A 3x3 patch rather than a single tile, because the commonest defect is a tile
that looks fine alone and outlines itself when tiled.

Tiles that are not on the map are listed rather than drawn; a tile type with no
instance has no neighbours to draw it against.

Needs Playwright and the Chromium at PLAYWRIGHT_BROWSERS_PATH.
"""
import asyncio, base64, http.server, io, os, random, socketserver, sys, threading, time
from pathlib import Path

from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
CHROMIUM = os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium")
OUT = REPO / "dist"

BOOT = """() => { startNewGame();
  const t=document.getElementById('titleScreen'); t.classList.remove('show'); t.style.display='none';
  const i=document.getElementById('introScreen'); if(i){i.classList.remove('show');i.style.display='none';} }"""

# zone -> (enter js, tile enum, width, height, getter, draw-one-tile expression)
ZONES = {
  "overworld": ("0", "TL", "MAP_W", "MAP_H", "getT", "drawTile(TX,TY,SX,SY)"),
  "mine": ("enterMine()", "TL", "MINE_W", "MINE_H",
           "(x,y)=>getMineT(gameState.mineFloor,x,y)", "drawMineTile(V,SX,SY,TX,TY)"),
  "badlands": ("enterBadlands()", "BL", "BL_W", "BL_H", "getBLT", "drawBLTile(TX,TY,SX,SY)"),
  "hobo": ("enterHoboCamp()", "TL", "HC_W", "HC_H", "getHCT", "drawHCTile(V,TX,TY,SX,SY)"),
  "ocean": ("enterOcean()", "OC", "OC_W", "OC_H", "getOCT", "drawOCTile(V,TX,TY,SX,SY)"),
  "jungle": ("enterJungle()", "JG", "JG_W", "JG_H", "getJGT", "drawJGTile(V,SX,SY,TX,TY)"),
  "ruins": ("enterRuins()", "JG", "RU_W", "RU_H", "getRUT", "drawJGTile(V,SX,SY,TX,TY)"),
}

DRAW = """(cfg) => {
  eval(cfg.enter);
  const get = eval('(' + cfg.get + ')');
  const W = eval(cfg.w), H = eval(cfg.h), E = eval(cfg.enum);
  const names = Object.keys(E).sort();
  const out = [];
  const c = ctx; c.save(); c.setTransform(1,0,0,1,0,0);
  for (const n of names) {
    const v = E[n];
    let fx=-1, fy=-1;
    for (let y=2; y<H-2 && fy<0; y++) for (let x=2; x<W-2; x++)
      if (get(x,y)===v) { fx=x; fy=y; break; }
    if (fx < 0) { out.push([n, null, 'none on map']); continue; }
    c.clearRect(0,0,96,96); c.fillStyle='#101010'; c.fillRect(0,0,96,96);
    let err = null;
    try {
      for (let j=0;j<3;j++) for (let i=0;i<3;i++) {
        const TX=fx-1+i, TY=fy-1+j, SX=i*32, SY=j*32, V=get(TX,TY);
        eval(cfg.draw);
      }
    } catch(e) { err = e.message.slice(0,40); }
    out.push([n, c.canvas.toDataURL(), err]);
  }
  c.restore(); return out;
}"""


def serve(directory, port):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(directory), **k)
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    threading.Thread(target=socketserver.TCPServer(("", port), H).serve_forever,
                     daemon=True).start()


def sheet(cells, path):
    COLS, CW, CH = 8, 200, 216
    im = Image.new("RGB", (COLS * CW, max(1, (len(cells) + COLS - 1) // COLS) * CH), (24, 24, 26))
    dr = ImageDraw.Draw(im)
    for k, (n, d, e) in enumerate(cells):
        t = Image.open(io.BytesIO(base64.b64decode(d.split(",")[1]))).convert("RGB")
        t = t.crop((0, 0, 96, 96)).resize((192, 192), Image.NEAREST)
        col, row = k % COLS, k // COLS
        im.paste(t, (col * CW + 4, row * CH + 20))
        dr.text((col * CW + 6, row * CH + 5), n + (" !" + e if e else ""), fill=(230, 220, 205))
    im.save(path)


async def main():
    want = sys.argv[1:] or list(ZONES)
    bad = [z for z in want if z not in ZONES]
    if bad:
        sys.exit("unknown zone(s): " + ", ".join(bad) + "\nknown: " + ", ".join(ZONES))
    port = int(os.environ.get("PORT", random.randint(9000, 9900)))
    serve(REPO, port)
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        for z in want:
            enter, enum, w, h, get, draw = ZONES[z]
            pg = await (await b.new_context(viewport={"width": 900, "height": 600})).new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:90]))
            await pg.route("**fonts.g**", lambda r: r.abort())
            await pg.goto(f"http://localhost:{port}/index.html?v={time.time()}")
            await pg.wait_for_timeout(5000)
            await pg.evaluate(BOOT)
            await pg.wait_for_timeout(600)
            rows = await pg.evaluate(DRAW, {"enter": enter, "enum": enum, "w": w,
                                            "h": h, "get": get, "draw": draw})
            cells = [(n, d, e) for n, d, e in rows if d]
            missing = [n for n, d, e in rows if not d]
            threw = [n for n, d, e in rows if d and e]
            sheet(cells, OUT / f"tiles-{z}.png")
            print(f"{z:10s} {len(cells):3d} drawn -> dist/tiles-{z}.png"
                  + (f" | THREW: {', '.join(threw)}" if threw else "")
                  + (f" | not on the map: {len(missing)}" if missing else ""))
            if errs:
                print("   pageerrors:", errs[:2])
            await pg.close()
        await b.close()


asyncio.run(main())
