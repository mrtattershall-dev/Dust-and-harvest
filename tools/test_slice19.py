#!/usr/bin/env python3
"""Is Verdant Debt Slice 19 playable, reachable, repeat-safe and reload-safe?

    ./tools/test_slice19.py            # this repo
    ./tools/test_slice19.py <dir|file> # or another build, or the standalone

Same shape as test_slice18.py, with one addition that earned its place: this
one GATHERS the quest items through the real node loop instead of calling
addItem. Slice 19 asks for eight Altaverde Documents, and before this slice
that item was defined, priced, listed as sellable, and dropped by nothing
anywhere in the game. A test that grants the goods it needs cannot see that.

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

# Everything Slices 16 and 18 leave behind, through the game's own entry points.
POST_18 = """() => {
  enterJungle();
  gameState._jgDebtStartDay = 1; gameState.day = 80;
  initJGDebt();
  _onHollowedDocumentFound();
  _onHollowedAllied();
  gameState._courtStage = 3; gameState._courtAllied = true;
  return { claim: isThreeWayClaimOpen(), debt: getJGTotalDebt() };
}"""

# Walk the Archive and gather every document node the real way: stand on it,
# press [E], let the action timer finish. Returns how many documents the ruins
# actually yielded.
GATHER_ARCHIVE = """async () => {
  if (!gameState.inRuins) { enterRuins(); }
  const spots = RU_NODE_SPOTS.filter(s => s.loot === 'altaverdeDocument');
  for (const s of spots) {
    player.x = s.tx * RU_T + RU_T/2;
    player.y = s.ty * RU_T + RU_T/2;
    player.actionCooldown = 0;
    player.stamina = 100;
    useTool(player.x, player.y);
    await new Promise(r => setTimeout(r, 1700));
  }
  return { docs: countItem('altaverdeDocument'), spots: spots.length };
}"""

OPEN_FILING_TAB = """() => {
  window._jgPanelTab = 'filing';
  openTobiasPanel();
  const ov = document.getElementById('hcTalkOverlay');
  const tab = ov.querySelector("button[onclick*=\\"_jgPanelTab='filing'\\"]");
  const btn = ov.querySelector('#fileContestBtn');
  return { tabPresent: !!tab, filePresent: !!btn, fileEnabled: btn ? !btn.disabled : false,
           body: ov.textContent.slice(0, 400) };
}"""

SNAPSHOT = """() => ({
  stage:   gameState._filingStage,
  filed:   gameState._filingFiledDay,
  weekSeen:gameState._filingWeekSeen,
  weeks:   getFilingWeeksElapsed(),
  contested: isBondContested(),
  ruling:  isRulingDelivered(),
  docs:    countItem('altaverdeDocument'),
  debt:    getJGTotalDebt(),
  gold:    player.gold,
  day:     gameState.day,
  rep:     REPUTATION.jungle,
})"""

RELOAD = "() => { saveGame(true); loadGame(1); return null; }"

# Advance N days through the real dawn path.
ADVANCE = """(n) => { for (let i = 0; i < n; i++) { gameState.day++; onNewDay(); } return gameState.day; }"""


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
    port = int(os.environ.get("PORT", 8792))
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

        # ── 1. The tab is gated on the three-way claim ───────────────────
        await pg.evaluate("() => { enterJungle(); initJGDebt(); }")
        early = await pg.evaluate(OPEN_FILING_TAB)
        check(not early["tabPresent"],
              "the FILING tab is offered before the three-way claim exists")
        await pg.evaluate("() => closeTobiasPanel()")
        print("  prerequisite holds: no filing tab before the claim")

        # ── 2. The paper is obtainable through the real gather loop ──────
        setup = await pg.evaluate(POST_18)
        check(setup["claim"], f"Slice 18 setup failed: {setup}")
        got = await pg.evaluate(GATHER_ARCHIVE)
        check(got["docs"] > 0,
              "the ruins Archive yields no Altaverde Documents — the filing's "
              "requirement cannot be met by playing")
        print(f"  archive gathering works: {got['docs']} documents from {got['spots']} nodes")

        # ── 3. Depleted nodes survive a reload (no farm-by-load) ─────────
        depleted = await pg.evaluate(
            "() => Object.values(JG_RUINS_NODES).filter(n => n.depleted).length")
        check(depleted > 0, "gathering depleted no nodes at all")
        await pg.evaluate(RELOAD)
        await pg.wait_for_timeout(200)
        after_reload = await pg.evaluate(
            "() => Object.values(JG_RUINS_NODES).filter(n => n.depleted).length")
        check(after_reload == depleted,
              f"ruins nodes refilled on reload ({depleted} -> {after_reload}): "
              "the requirement can be farmed by pressing load")
        print(f"  depleted nodes persist across reload ({after_reload} still depleted)")

        # ── 4. Filing refuses on short exhibits, and consumes nothing ────
        await pg.evaluate("() => { while (countItem('altaverdeDocument')) removeItem('altaverdeDocument', 1); }")
        await pg.evaluate("() => { addItem('altaverdeDocument', 7); player.gold = 50000; }")
        await pg.evaluate("() => fileBondContest()")
        short = await snap()
        check(short["stage"] == 0 and short["docs"] == 7,
              f"seven of eight was accepted, or consumed the documents anyway: {short}")

        await pg.evaluate("() => { addItem('altaverdeDocument', 1); player.gold = 100; }")
        await pg.evaluate("() => fileBondContest()")
        poor = await snap()
        check(poor["stage"] == 0 and poor["docs"] == 8,
              f"filed without the fee, or consumed the documents anyway: {poor}")
        print("  filing refuses short exhibits and a short fee, consuming neither")

        # ── 5. File it ───────────────────────────────────────────────────
        await pg.evaluate("() => { player.gold = 20000; }")
        tab = await pg.evaluate(OPEN_FILING_TAB)
        check(tab["tabPresent"], "no FILING tab on Tobias's panel once the claim is open")
        check(tab["filePresent"] and tab["fileEnabled"],
              f"the FILE THE CONTEST button is missing or disabled when ready: {tab}")
        await pg.evaluate("() => fileBondContest()")
        filed = await snap()
        check(filed["stage"] == 1 and filed["contested"], f"filing did not take: {filed}")
        check(filed["docs"] == 0, f"the exhibits were not consumed: {filed}")
        check(filed["gold"] == 14000, f"the filing fee was wrong: {filed}")

        # Filing twice must not charge twice.
        await pg.evaluate("() => { addItem('altaverdeDocument', 8); }")
        await pg.evaluate("() => fileBondContest()")
        twice = await snap()
        check(twice["docs"] == 8 and twice["gold"] == 14000,
              f"filing a second time charged again: {twice}")
        print("  filed once; a second filing charges nothing")

        # ── 6. The stay of enforcement ───────────────────────────────────
        debt_at_filing = filed["debt"]
        await pg.evaluate(ADVANCE, 20)
        stayed = await snap()
        check(stayed["debt"] <= debt_at_filing,
              f"the bond compounded while under contest: {debt_at_filing} -> {stayed['debt']}")
        check(stayed["stage"] == 1, f"the contest resolved early: {stayed}")
        print(f"  stay of enforcement holds: bond {debt_at_filing:,} -> {stayed['debt']:,} over 20 days")

        # ── 7. Reload mid-review: the clock is derived, not accumulated ──
        mid = await snap()
        mid_r = await pg.evaluate(RELOAD) or await snap()
        await pg.wait_for_timeout(150)
        mid_r = await snap()
        check(mid_r["stage"] == 1 and mid_r["weeks"] == mid["weeks"],
              f"the review clock moved across a reload: {mid} -> {mid_r}")
        check(mid_r["filed"] == mid["filed"],
              f"the filing day did not survive reload: {mid_r}")
        # Reloading repeatedly must not replay or skip the weekly beats.
        for _ in range(3):
            await pg.evaluate(RELOAD)
            await pg.wait_for_timeout(120)
        stable = await snap()
        check(stable["weekSeen"] == mid_r["weekSeen"] and stable["stage"] == 1,
              f"repeated reloads drifted the review: {mid_r} -> {stable}")
        print("  mid-review survives reload; the clock is derived, not accumulated")

        # ── 8. The ruling ────────────────────────────────────────────────
        await pg.evaluate(ADVANCE, 30)
        ruled = await snap()
        check(ruled["stage"] == 2 and ruled["ruling"], f"no ruling after six weeks: {ruled}")
        check(ruled["debt"] < debt_at_filing,
              f"the ruling did not reduce the bond: {debt_at_filing} -> {ruled['debt']}")
        check(ruled["debt"] > 0,
              f"the ruling cleared the bond outright, which is not the design: {ruled}")
        check(ruled["rep"] > stable["rep"], f"no reputation from the ruling: {ruled}")
        print(f"  ruling delivered: bond {debt_at_filing:,} -> {ruled['debt']:,}, still payable")

        # ── 9. The ruling fires once ─────────────────────────────────────
        gold_after = ruled["gold"]
        await pg.evaluate(ADVANCE, 21)
        await pg.evaluate("() => _deliverBondRuling()")
        once = await snap()
        check(once["debt"] == ruled["debt"] and once["gold"] == gold_after,
              f"the ruling paid out a second time: {ruled} -> {once}")
        check(once["stage"] == 2, f"the ruling stage was disturbed: {once}")
        print("  the ruling pays once, on the clock and on a direct call")

        # ── 10. Reload after the ruling ──────────────────────────────────
        await pg.evaluate(RELOAD)
        await pg.wait_for_timeout(150)
        post = await snap()
        check(post["stage"] == 2 and post["ruling"] and post["debt"] == once["debt"],
              f"checkpoint 'after ruling' did not survive reload: {post}")
        print("  checkpoint after-ruling survives reload")

        # ── 11. A new game clears it ─────────────────────────────────────
        await pg.evaluate(BOOT)
        await pg.wait_for_timeout(200)
        fresh = await snap()
        check(fresh["stage"] == 0 and not fresh["contested"] and not fresh["ruling"],
              f"a new game inherited Slice 19 state: {fresh}")
        refilled = await pg.evaluate(
            "() => Object.values(JG_RUINS_NODES).filter(n => n.depleted).length")
        check(refilled == 0, f"a new game kept {refilled} depleted ruins nodes")
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
    print("\nslice 19 plays clean")


asyncio.run(main())
