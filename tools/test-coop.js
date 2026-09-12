#!/usr/bin/env node
/*
 * test-coop.js — drive two real browsers through a co-op session.
 *
 * Co-op had never actually run between two clients. Its transport is PeerJS,
 * whose broker is a hosted service, so every earlier check simulated a peer by
 * calling the message handlers directly — which proves the handlers parse a
 * payload and nothing about whether two browsers ever agree.
 *
 * This runs a local broker instead, points both pages at it, and checks what
 * the shared purse is actually for: that income lands on both sides, that two
 * players earning at once MERGE in the ledger rather than overwrite, that
 * personal income stays personal, that roles cross, that spending draws the
 * shared purse everywhere, and that disconnecting does not strand money.
 *
 *   npm install playwright peerjs peer
 *   node tools/broker.js &                 # or: see BROKER below
 *   python3 -m http.server 8877 &          # from the repo root
 *   node tools/test-coop.js
 *
 * BROKER (tools/broker.js):
 *   const { PeerServer } = require('peer');
 *   PeerServer({ port: 9000, path: '/', host: '0.0.0.0' });
 *
 * Exits non-zero if any check fails.
 */
'use strict';
const { chromium } = require('playwright');

const GAME   = process.env.GAME_URL || 'http://127.0.0.1:8877/index.html';
const BROKER = { host: '127.0.0.1', port: 9000, path: '/', secure: false };
const CHROME = process.env.CHROME_PATH || undefined;

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
};

async function boot(page, tag, errs) {
  page.on('pageerror', e => errs.push(`[${tag}] ${e.message}`));
  await page.goto(GAME, { waitUntil: 'load' });
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    try { hideTitleScreen(); } catch (e) {}
    const ts = document.getElementById('titleScreen');
    if (ts) { ts.classList.remove('show'); ts.style.display = 'none'; }
  });
  await page.waitForTimeout(500);
  // Load the vendored client, then point it at the local broker before the
  // game asks for it — _dhLoadPeerJS returns early once Peer exists.
  await page.addScriptTag({ url: 'assets/js/vendor/peerjs.min.js' });
  await page.evaluate((local) => {
    const Real = window.Peer;
    window.Peer = function (a, b) {
      if (a && typeof a === 'object') return new Real(Object.assign({}, a, local));
      return new Real(a, Object.assign({}, b || {}, local));
    };
  }, BROKER);
}

// Preflight. Without this a dead broker or server just looks like "the two
// clients would not connect", which reads as a co-op regression and is not one.
async function preflight() {
  const probes = [
    ['game server', GAME],
    ['peer broker', `http://${BROKER.host}:${BROKER.port}${BROKER.path === '/' ? '' : BROKER.path}/peerjs/id`],
  ];
  let ok = true;
  for (const [what, url] of probes) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      console.error(`  cannot reach the ${what} at ${url} — ${e.message}`);
      ok = false;
    }
  }
  if (!ok) {
    console.error('\nStart them first (see the header of this file), then re-run.');
    process.exit(2);
  }
}

(async () => {
  await preflight();
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const host  = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await boot(host, 'host', errs);
  await boot(guest, 'guest', errs);

  const CODE = 'COOPTEST';
  await host.evaluate((c) => {
    window._dhMpToggle();
    document.getElementById('dhMpCustomCode').value = c;
    window._dhMpDoHostInGame();
  }, CODE);
  await host.waitForTimeout(2500);

  await guest.evaluate((c) => {
    player.name = 'Bo';
    window._dhMpToggle();
    document.getElementById('dhMpPanelCode').value = c;
    window._dhMpDoJoinInGame();
  }, CODE);
  await guest.waitForTimeout(5000);

  const hostUp  = await host.evaluate(() => dhMp.isActive() && Object.keys(dhMp.guests).length === 1);
  const guestUp = await guest.evaluate(() => dhMp.isActive());
  check('two clients connect over WebRTC', hostUp && guestUp);
  if (!(hostUp && guestUp)) { await finish(browser, errs); return; }

  const purse = p => p.evaluate(() => farmFundBalance());

  await host.evaluate(() => { player.gold = 500; addFarmIncome(300); });
  await host.waitForTimeout(1500);
  check('host farm income reaches both purses',
        (await purse(host)) === 300 && (await purse(guest)) === 300,
        `host=${await purse(host)} guest=${await purse(guest)}`);

  await guest.evaluate(() => { player.gold = 500; addFarmIncome(200); });
  await guest.waitForTimeout(1500);
  const merged = await host.evaluate(() => Object.values(farmLedger).map(e => e.earned).sort((a,b)=>a-b));
  check('simultaneous earners merge rather than overwrite',
        (await purse(host)) === 500 && (await purse(guest)) === 500 &&
        merged.length === 2 && merged[0] === 200 && merged[1] === 300,
        `purse=${await purse(host)} ledger=${JSON.stringify(merged)}`);

  const goldBefore = await guest.evaluate(() => player.gold);
  await guest.evaluate(() => addPersonalIncome(400));
  await guest.waitForTimeout(1200);
  check('personal income stays out of the purse',
        (await purse(host)) === 500 &&
        (await guest.evaluate(() => player.gold)) === goldBefore + 400);

  await host.evaluate(() => setCrewRole('grower'));
  await guest.evaluate(() => setCrewRole('trader'));
  await guest.waitForTimeout(1500);
  check('crew roles cross and a complementary crew is recognised',
        await host.evaluate(() => crewIsComplementary()) &&
        await guest.evaluate(() => crewIsComplementary()));

  await host.evaluate(() => spendFarmCost(100));
  await host.waitForTimeout(1500);
  check('spending draws the shared purse on both sides',
        (await purse(host)) === 400 && (await purse(guest)) === 400,
        `host=${await purse(host)} guest=${await purse(guest)}`);

  // A plot worked by both must carry its tending record across the wire, or the
  // team-crop bonus silently never fires.
  const key = await host.evaluate(() => {
    const k = plotKey(17, 22);
    plots[k] = { tilled:true, watered:false, crop:'carrot', growthProgress:0,
                 wateredToday:false, wilted:false, harvestReady:false };
    noteTend(plots[k]);
    dhMp.broadcast({ type:'plot_patch', patches: { [k]: { ...plots[k] } } });
    return k;
  });
  await guest.waitForTimeout(1500);
  check('plot state and its tending record reach the guest',
        await guest.evaluate((k) => !!(plots[k] && plots[k].crop === 'carrot' &&
              Array.isArray(plots[k].tendedBy) && plots[k].tendedBy.length === 1), key));

  check('a plot both players tended counts as a team crop',
        await guest.evaluate((k) => { noteTend(plots[k]); return isTeamCrop(plots[k]); }, key));

  await host.evaluate(() => { player.gold = 0; });
  const strandable = await purse(host);
  await host.evaluate(() => window._dhMpDoDisconnect());
  await host.waitForTimeout(1000);
  check('disconnecting folds the purse into the wallet',
        (await host.evaluate(() => player.gold)) === strandable &&
        (await purse(host)) === 0,
        `recovered ${await host.evaluate(() => player.gold)} of ${strandable}`);

  await finish(browser, errs);
})();

async function finish(browser, errs) {
  await browser.close();
  for (const e of errs.slice(0, 8)) console.log('  page error: ' + e);
  const failed = checks.filter(c => !c.pass).length + errs.length;
  console.log(`\n${checks.length - checks.filter(c=>!c.pass).length}/${checks.length} checks passed, ${errs.length} page error(s)`);
  process.exit(failed ? 1 : 0);
}
