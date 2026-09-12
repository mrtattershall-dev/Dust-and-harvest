#!/usr/bin/env python3
"""Does the game still play? Exits non-zero on failure.

    ./tools/test_play.py            # this repo
    ./tools/test_play.py <dir>      # some other build

test_render.py covers drawing: every tile, every zone, four viewport shapes.
Nothing covered the rest — a session of art work touches drawTile, the zone
renderers and the overlay helpers, and none of that is caught by a test that
only asks whether a frame was painted.

This boots a new game and then:
  - runs the real frame loop for a while with movement keys held, so update()
    and render() run together over changing ground rather than one frame at a
    rest position, and CHECKS THE LOOP IS STILL ALIVE afterwards;
  - walks the player through every zone and back;
  - opens and closes each modal panel;
  - fails on ANY uncaught page error or console error at any point.

The last is the point of it: a throw inside render() aborts the frame and
blanks the screen, which is how the black screen shipped, and a throw inside a
panel handler leaves the player stuck in a menu.

The liveness check is not redundant with the error check, and the first version
of this test needed it. gameLoop() ends with its own requestAnimationFrame, so
an uncaught throw does not merely skip a frame — it stops the loop dead. Only
ONE pageerror is ever emitted, on the first frame, which is during boot. That
version cleared the error list after boot to drop font-load noise, and so threw
away the only report of the fault; it passed clean with drawImage(undefined)
wired into every dirt tile.

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

BOOT = """() => { startNewGame();
  const t=document.getElementById('titleScreen'); t.classList.remove('show'); t.style.display='none';
  const i=document.getElementById('introScreen'); if(i){i.classList.remove('show');i.style.display='none';} }"""

# Zones, entered in sequence and left again. The deep jungle and the badlands
# mine are only reachable through another zone, so the order matters.
ZONE_TRIP = """() => {
  const steps = [
    ['mine',          'enterMine()'],
    ['badlands',      'enterBadlands()'],
    ['badlands mine', 'enterBLMine()'],
    ['hobo camp',     'enterHoboCamp()'],
    ['ocean',         'enterOcean()'],
    ['jungle',        'enterJungle()'],
    ['deep jungle',   'enterDeepJungle()'],
    ['ruins',         'enterRuins()'],
  ];
  const out = {};
  for (const [name, js] of steps) {
    try { eval(js); } catch (e) { out[name] = 'enter threw: ' + e.message.slice(0, 60); continue; }
    try { for (let i = 0; i < 3; i++) render(); out[name] = 'ok'; }
    catch (e) { out[name] = 'render threw: ' + e.message.slice(0, 60); }
  }
  return out;
}"""

# Every overlay that is a modal panel. Opened by making it visible the way the
# game does, then closed again; a panel that throws on open is the failure.
PANELS = """() => {
  const ids = ['invOverlay','marketOverlay','settingsOverlay','chestOverlay',
               'farmhandOverlay','npcTalkOverlay','encounterPanel','statsOverlay',
               'smeltOverlay','minerOverlay','hcTalkOverlay','blBountyOverlay',
               'blVendorOverlay','merchantShop','trapperPost'];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = 'missing'; continue; }
    try {
      const was = el.style.display;
      el.style.display = 'block'; el.classList.add('show');
      void el.offsetHeight;                       // force layout
      const r = el.getBoundingClientRect();
      out[id] = (r.width > 0 && r.height > 0) ? 'ok' : 'zero size';
      el.classList.remove('show'); el.style.display = was;
    } catch (e) { out[id] = 'threw: ' + e.message.slice(0, 50); }
  }
  return out;
}"""


# Wraps whatever window.render is by now — several later slices reassign it —
# so the counter sees the same function the game loop calls.
COUNT_FRAMES = """() => {
  window.__rc = 0;
  const r = window.render;
  window.render = function () { window.__rc++; return r.apply(this, arguments); };
}"""


def serve(directory, port):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(directory), **k)
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO
    port = int(os.environ.get("PORT", 8790))
    serve(root, port)
    failures = []

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        ctx = await b.new_context(viewport={"width": 900, "height": 600})
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:110]))
        pg.on("console", lambda m: errs.append("console: " + m.text[:110])
              if m.type == "error" and "net::ERR" not in m.text else None)
        await pg.route("**fonts.g**", lambda r: r.abort())
        await pg.goto(f"http://localhost:{port}/index.html?v={time.time()}")
        await pg.wait_for_timeout(4500)
        await pg.evaluate(BOOT)
        await pg.wait_for_timeout(400)

        # Count frames through whatever window.render is at this point, so a
        # loop that has stopped is visible even if its one error was missed.
        await pg.evaluate(COUNT_FRAMES)

        # Walk about with the real loop running.
        for key in ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]:
            await pg.keyboard.down(key)
            await pg.wait_for_timeout(700)
            await pg.keyboard.up(key)
        frames = await pg.evaluate("() => window.__rc")
        if frames < 30:
            failures.append(f"the frame loop stopped: {frames} frames in 2.8s "
                            f"(an uncaught throw in gameLoop kills it outright)")
        print(f"  moved through 4 directions; {frames} frames ran")

        panels = await pg.evaluate(PANELS)
        for k, v in panels.items():
            if v != "ok":
                failures.append(f"panel {k}: {v}")
        print(f"  panels: {sum(1 for v in panels.values() if v == 'ok')}/{len(panels)} ok")

        zones = await pg.evaluate(ZONE_TRIP)
        for k, v in zones.items():
            if v != "ok":
                failures.append(f"zone {k}: {v}")
        print(f"  zones: {sum(1 for v in zones.values() if v == 'ok')}/{len(zones)} ok")

        await pg.wait_for_timeout(500)
        # Not cleared after boot — see the note above. Filtered instead, and
        # only for noise this environment creates rather than the page.
        for e in errs:
            if "fonts.g" in e or "net::ERR" in e:
                continue
            failures.append(e)
        await b.close()

    if failures:
        print("\nFAIL")
        for f in failures:
            print("  " + f)
        sys.exit(1)
    print("\nplays clean")


asyncio.run(main())
