#!/usr/bin/env python3
"""Is Verdant Debt Slice 18 playable, repeatable-safe and reload-safe?

    ./tools/test_slice18.py            # this repo
    ./tools/test_slice18.py <dir|file> # or another build, or the standalone

test_play.py asks whether the game still boots, draws and survives a walk.
Nothing asked whether a QUEST still works, and a quest is where the defects
that matter to a player live: a stage that can't be reached, a reward that
pays twice, an item consumed by a step that then fails to record itself.

This drives Slice 18 through the real code path — the real Malu dialogue
button, the real deep-jungle movement tick, the real [E] handler — and then
saves and reloads at four checkpoints and checks the state came back.

The checkpoints are the point of it. Runtime state that looks right is not
evidence: Slice 17 shipped a deep jungle whose zone flag was never saved, so
every one of its states looked correct until the reload.

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

# Everything Slice 17 leaves behind, reached through the game's own functions
# rather than by writing gameState directly — so that if a later slice changes
# how the Hollowed alliance is recorded, this test fails instead of lying.
POST_17 = """() => {
  enterJungle();
  gameState._jgDebtStartDay = 1; gameState.day = 80;   // weeks settled
  _onHollowedDocumentFound();
  _onHollowedAllied();
  return { hollowed: getHollowedState(), stage: gameState._hollowedQuestStage };
}"""

# Stand in the Court chamber and take one real movement step, which is what
# drives the proximity tick.
STEP_IN_CHAMBER = """(tiles) => {
  if (!gameState.inDeepJungle) enterDeepJungle();
  player.x = (COURT_EMIS_TX + tiles) * DJ_T + DJ_T/2;
  player.y = COURT_EMIS_TY * DJ_T + DJ_T/2;
  updateJungleMovement(0, 0.001, 0.016, 1);
  return { stage: gameState._courtStage, x: player.x, y: player.y };
}"""

TALK_TO_MALU = """() => {
  openJGTalk('jg_malu');
  const ov = document.getElementById('hcTalkOverlay');
  const btns = [...ov.querySelectorAll('button')];
  const ask = btns.find(b => (b.getAttribute('onclick')||'').includes('_maluGrantCourtToken'));
  if (!ask) return { offered: false, stage: gameState._courtStage };
  ask.click();
  return { offered: true, stage: gameState._courtStage, token: countItem('courtToken') };
}"""

SNAPSHOT = """() => ({
  stage:    gameState._courtStage,
  allied:   gameState._courtAllied,
  claim:    isThreeWayClaimOpen(),
  token:    countItem('courtToken'),
  mark:     countItem('courtMark'),
  salvage:  countItem('altaverdeSalvage'),
  inDeep:   !!gameState.inDeepJungle,
  inJungle: !!gameState.inJungle,
  px: Math.round(player.x), py: Math.round(player.y),
  rep: REPUTATION.jungle,
})"""

# One save/reload round trip in slot 1, returning the state on the far side.
RELOAD = "() => { saveGame(true); loadGame(1); return null; }"


def serve(directory, port):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(directory), **k)
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("", port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    arg = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO
    root, page = (arg.parent, arg.name) if arg.suffix == ".html" else (arg, "index.html")
    port = int(os.environ.get("PORT", 8791))
    serve(root, port)
    fails = []

    def check(cond, msg):
        if not cond:
            fails.append(msg)
        return cond

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROMIUM)
        ctx = await b.new_context(viewport={"width": 900, "height": 600})
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:110]))
        pg.on("console", lambda m: errs.append("console: " + m.text[:110])
              if m.type == "error" and "net::ERR" not in m.text else None)
        await pg.route("**fonts.g**", lambda r: r.abort())
        await pg.goto(f"http://localhost:{port}/{page}?v={time.time()}")
        await pg.wait_for_timeout(4500)
        await pg.evaluate(BOOT)
        await pg.wait_for_timeout(400)

        async def snap():
            return await pg.evaluate(SNAPSHOT)

        async def reload_round():
            await pg.evaluate(RELOAD)
            await pg.wait_for_timeout(150)
            return await snap()

        # ── 1. Prerequisites gate the start ───────────────────────────────
        await pg.evaluate("() => enterJungle()")
        pre = await pg.evaluate(TALK_TO_MALU)
        check(not pre["offered"],
              "Malu offers the Court before the Hollowed are allied — "
              "an earlier save bypasses the prerequisite")
        await pg.evaluate("() => closeJGTalk()")

        # Standing in the chamber with no quest must not start one.
        early = await pg.evaluate(STEP_IN_CHAMBER, 2)
        check(early["stage"] == 0,
              f"the Court chamber starts the quest on its own (stage {early['stage']})")
        await pg.evaluate("() => { exitDeepJungle(); }")
        print("  prerequisites hold: no Malu offer, no emissary at stage 0")

        # ── 2. Reload at the checkpoint immediately before the slice ──────
        post17 = await pg.evaluate(POST_17)
        check(post17["hollowed"] == "allied", f"Slice 16 setup failed: {post17}")
        before = await reload_round()
        check(before["stage"] == 0 and not before["allied"],
              f"checkpoint 'before slice 18' did not survive reload: {before}")
        print("  checkpoint before-18 survives reload")

        # ── 3. Start: Malu hands over the token ──────────────────────────
        await pg.evaluate("() => { if(!gameState.inJungle) enterJungle(); }")
        start = await pg.evaluate(TALK_TO_MALU)
        check(start["offered"], "Malu offers no way to the Court after the Hollowed alliance")
        check(start["stage"] == 1 and start["token"] == 1,
              f"the token did not arrive: {start}")

        # Talking again must not hand out a second token.
        again = await pg.evaluate(TALK_TO_MALU)
        check(not again["offered"], "Malu re-offers the token while the player is carrying one")
        await pg.evaluate("() => closeJGTalk()")
        s = await snap()
        check(s["token"] == 1, f"a second token was issued: {s}")
        print("  start: token issued once, not twice")

        # ── 4. Mid-objective: the Court states its terms ─────────────────
        await pg.evaluate(STEP_IN_CHAMBER, 3)
        await pg.wait_for_timeout(200)
        mid = await snap()
        check(mid["stage"] == 2, f"the emissary did not state its terms: {mid}")

        # Leaving and coming back must not restate or reset.
        await pg.evaluate("() => exitDeepJungle()")
        await pg.evaluate(STEP_IN_CHAMBER, 3)
        back = await snap()
        check(back["stage"] == 2, f"re-entering the chamber changed the stage: {back}")

        mid_r = await reload_round()
        check(mid_r["stage"] == 2 and mid_r["token"] == 1 and mid_r["inDeep"],
              f"checkpoint 'mid-objective' did not survive reload: {mid_r}")
        check(not mid_r["inJungle"],
              f"both jungle flags set after reloading in the deep jungle: {mid_r}")
        print("  mid-objective: terms stated once, survives reload in the deep jungle")

        # ── 5. The objective without the goods ───────────────────────────
        await pg.evaluate(STEP_IN_CHAMBER, 1)
        await pg.evaluate("() => { player.actionCooldown = 0; useTool(player.x, player.y); }")
        short = await snap()
        check(short["stage"] == 2 and short["mark"] == 0 and short["token"] == 1,
              f"handing over nothing advanced the quest: {short}")

        await pg.evaluate("() => addItem('altaverdeSalvage', 5)")
        await pg.evaluate("() => { player.actionCooldown = 0; useTool(player.x, player.y); }")
        short2 = await snap()
        check(short2["stage"] == 2 and short2["salvage"] == 5 and short2["mark"] == 0,
              f"five of six was accepted, or consumed the salvage anyway: {short2}")
        print("  partial delivery: nothing consumed, nothing granted")

        # ── 6. Resolve + reward ──────────────────────────────────────────
        rep_before = (await snap())["rep"]
        await pg.evaluate("() => addItem('altaverdeSalvage', 1)")
        await pg.evaluate("() => { player.actionCooldown = 0; useTool(player.x, player.y); }")
        done = await snap()
        check(done["stage"] == 3 and done["allied"], f"the hand-over did not complete: {done}")
        check(done["salvage"] == 0, f"the salvage was not consumed: {done}")
        check(done["mark"] == 1, f"the Court's Mark was not granted: {done}")
        check(done["claim"], f"the three-way claim did not open: {done}")
        check(done["rep"] > rep_before, f"no reputation reward: {rep_before} -> {done['rep']}")
        print("  resolve: consumed 6, granted the mark, opened the claim")

        # ── 7. Repeat safety on a completed quest ────────────────────────
        await pg.evaluate("() => addItem('altaverdeSalvage', 6)")
        for _ in range(3):
            await pg.evaluate("() => { player.actionCooldown = 0; useTool(player.x, player.y); }")
            await pg.evaluate("() => closeJGTalk()")
        # Also call the hand-over directly. The dialogue router sends a
        # completed quest to the terminal line and never reaches it, so the
        # loop above exercises the OUTER guard only; a later slice that adds
        # another way to reach the hand-over would find the inner one gone
        # and this test still green.
        await pg.evaluate("() => _courtDeliverSalvage()")
        rep = await snap()
        check(rep["mark"] == 1, f"a second Court's Mark was granted: {rep}")
        check(rep["salvage"] == 6, f"salvage was consumed again after completion: {rep}")
        check(rep["stage"] == 3 and rep["allied"], f"completion was undone by re-talking: {rep}")
        print("  repeat safety: re-talking pays nothing and undoes nothing")

        # ── 8. Reload after the reward ───────────────────────────────────
        after = await reload_round()
        check(after["stage"] == 3 and after["allied"] and after["claim"],
              f"checkpoint 'after reward' did not survive reload: {after}")
        check(after["mark"] == 1, f"the mark did not survive reload: {after}")
        print("  checkpoint after-reward survives reload")

        # ── 9. Loading a non-deep save while standing in the deep jungle ──
        await pg.evaluate("() => { exitDeepJungle(); exitJungle && exitJungle(); saveGame(true); }")
        await pg.evaluate("() => { enterJungle(); enterDeepJungle(); }")
        out = await pg.evaluate("() => { loadGame(1); return null; }")
        await pg.wait_for_timeout(150)
        esc = await snap()
        check(not esc["inDeep"],
              f"loading a surface save left the player flagged in the deep jungle: {esc}")
        print("  loading a surface save clears the deep-jungle flag")

        # ── 10. A new game clears it all ─────────────────────────────────
        await pg.evaluate(BOOT)
        await pg.wait_for_timeout(200)
        fresh = await snap()
        # Quest state only. startNewGame() does not clear inventory.slots — a
        # real new game arrives through a page load and character creation, not
        # through calling it mid-session — so the bag is not Slice 18's to
        # assert on, and asserting on it here would test the engine, not this.
        check(fresh["stage"] == 0 and not fresh["allied"] and not fresh["claim"]
              and not fresh["inDeep"],
              f"a new game inherited Slice 18 quest state: {fresh}")
        print("  a new game starts clean")

        await pg.wait_for_timeout(300)
        for e in errs:
            if "fonts.g" in e or "net::ERR" in e:
                continue
            fails.append(e)
        await b.close()

    if fails:
        print("\nFAIL")
        for f in fails:
            print("  " + f)
        sys.exit(1)
    print("\nslice 18 plays clean")


asyncio.run(main())
