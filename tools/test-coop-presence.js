#!/usr/bin/env node
/**
 * test-coop-presence.js — the half of co-op that test-coop.js does not cover.
 *
 * test-coop.js proves the shared economy: the purse, the ledger, roles,
 * teamwork, and what happens to the money when someone leaves. None of that
 * involves seeing the other person. This covers the part you actually look at —
 * whether your partner is there, where they are, what they look like, whether
 * they are in the same place as you, and whether any of it survives them
 * dropping out and coming back.
 *
 * Needs the same two servers as test-coop.js:
 *   python3 -m http.server 8877
 *   node tools/broker.js          (PeerServer on :9000)
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
  await page.addScriptTag({ url: 'assets/js/vendor/peerjs.min.js' });
  await page.evaluate((local) => {
    const Real = window.Peer;
    window.Peer = function (a, b) {
      if (a && typeof a === 'object') return new Real(Object.assign({}, a, local));
      return new Real(a, Object.assign({}, b || {}, local));
    };
  }, BROKER);
}

async function preflight() {
  const probes = [
    ['game server', GAME],
    ['peer broker', `http://${BROKER.host}:${BROKER.port}/peerjs/id`],
  ];
  for (const [what, url] of probes) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      console.error(`  cannot reach the ${what} at ${url} — ${e.message}`);
      console.error('\n  Start them first (see the header of this file), then re-run.');
      process.exit(2);
    }
  }
}

const settle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await preflight();
  const errs = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await boot(host, 'host', errs);
  await boot(guest, 'guest', errs);

  // ── Connect ────────────────────────────────────────────────────────────────
  // Same entry points the UI uses, so this exercises the real host/join path.
  const code = 'PRESENCE';
  await host.evaluate((c) => {
    player.name = 'Hostie'; player.gender = 'male';
    window._dhMpToggle();
    document.getElementById('dhMpCustomCode').value = c;
    window._dhMpDoHostInGame();
  }, code);
  await settle(2500);
  await guest.evaluate((c) => {
    player.name = 'Guesty'; player.gender = 'female';
    window._dhMpToggle();
    document.getElementById('dhMpPanelCode').value = c;
    window._dhMpDoJoinInGame();
  }, code);
  await settle(5000);

  const connected = await host.evaluate(() => window.dhMp.isActive() && window.dhMp.guestCount() >= 1);
  check('two clients connect', connected, `room ${code}`);
  if (!connected) { await browser.close(); process.exit(1); }

  // ── Each side can see the other ────────────────────────────────────────────
  const seen = async (page) => page.evaluate(() => {
    const rp = Object.values(window.dhMp.remotePlayers);
    return { count: rp.length, names: rp.map(p => p.name), genders: rp.map(p => p.gender) };
  });
  await settle(1200);
  const hSees = await seen(host), gSees = await seen(guest);
  check('each side sees the other in remotePlayers',
    hSees.count === 1 && gSees.count === 1,
    `host sees ${JSON.stringify(hSees.names)}, guest sees ${JSON.stringify(gSees.names)}`);

  check('the partner arrives with a name, not a placeholder',
    hSees.names[0] === 'Guesty' && gSees.names[0] === 'Hostie',
    `${hSees.names[0]} / ${gSees.names[0]}`);

  // ── Movement reaches the other side ────────────────────────────────────────
  const before = await host.evaluate(() => {
    const p = Object.values(window.dhMp.remotePlayers)[0];
    return { x: p.x, y: p.y };
  });
  await guest.evaluate(async () => {
    player.x += 220; player.y += 160; player.facing = 'left';
    for (let i = 0; i < 40; i++) { update(1 / 60); await new Promise(r => setTimeout(r, 8)); }
  });
  await settle(1500);
  const after = await host.evaluate(() => {
    const p = Object.values(window.dhMp.remotePlayers)[0];
    return { x: p.x, y: p.y, facing: p.facing };
  });
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  check('the partner\'s movement reaches the other screen', moved > 100,
    `moved ${moved.toFixed(0)}px, facing ${after.facing}`);

  // ── The partner is drawn, as their own character ───────────────────────────
  const drawn = await host.evaluate(() => {
    const p = Object.values(window.dhMp.remotePlayers)[0];
    // Put the partner right next to us so they are on screen, then draw one
    // frame onto a scratch canvas through the real remote-player renderer.
    player.x = p.x - 40; player.y = p.y;
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    const cfg = { gender: p.gender, skinTone: p.skinTone, hairStyle: p.hairStyle,
                  hairColor: p.hairColor, shirtStyle: p.shirtStyle,
                  shirtColor: p.shirtColor, pantsColor: p.pantsColor, hatColor: p.hatColor };
    window._dhCharClip = 'idle';
    drawCharacterInWorld(c, 100, 150, p.facing || 'down', 0, false, cfg);
    const d = c.getImageData(0, 0, 200, 200).data;
    let px = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 16) px++;
    return { px, gender: p.gender, actor: playerActorId(cfg) };
  });
  check('the partner draws as their own character, not yours',
    drawn.px > 50 && drawn.actor === 'citizen5',
    `${drawn.px}px drawn, gender ${drawn.gender} -> ${drawn.actor}`);

  // ── Zone is carried, so "where are you?" has an answer ─────────────────────
  await guest.evaluate(async () => {
    enterBadlands();
    for (let i = 0; i < 30; i++) { update(1 / 60); await new Promise(r => setTimeout(r, 8)); }
  });
  await settle(1500);
  const zone = await host.evaluate(() => Object.values(window.dhMp.remotePlayers)[0].zone);
  check('the partner\'s zone travels with them', !!zone && /badland/i.test(String(zone)),
    `host sees zone "${zone}"`);

  // ── Chat ───────────────────────────────────────────────────────────────────
  const chatSeen = await (async () => {
    await host.evaluate(() => {
      window.__chat = [];
      const orig = window.showMsg;
      window.showMsg = function (m) { window.__chat.push(String(m)); return orig.apply(this, arguments); };
    });
    await guest.evaluate(() => window.dhMp.broadcast(
      { type: 'chat', senderName: player.name || 'Guesty', text: 'meet me at the barn' }));
    await settle(1200);
    return host.evaluate(() => window.__chat.filter(m => /barn/.test(m)));
  })();
  check('a message typed by one player shows on the other',
    chatSeen.length > 0, chatSeen[0] || 'nothing arrived');

  // ── Leaving, and coming back ───────────────────────────────────────────────
  await guest.evaluate(() => window._dhMpDoDisconnect());
  await settle(1800);
  const afterLeave = await host.evaluate(() => Object.keys(window.dhMp.remotePlayers).length);
  check('a partner who leaves stops being drawn', afterLeave === 0,
    `${afterLeave} remote player(s) still listed`);

  await guest.evaluate((c) => {
    player.name = 'Guesty'; player.gender = 'female';
    if (!document.getElementById('dhMpPanelCode')) window._dhMpToggle();
    document.getElementById('dhMpPanelCode').value = c;
    window._dhMpDoJoinInGame();
  }, code);
  await settle(5000);
  const rejoined = await host.evaluate(() => {
    const rp = Object.values(window.dhMp.remotePlayers);
    return { n: rp.length, name: rp[0] && rp[0].name };
  });
  check('they can rejoin the same room', rejoined.n === 1 && rejoined.name === 'Guesty',
    `${rejoined.n} back as ${rejoined.name}`);

  // ── No duplicate ghosts after the round trip ───────────────────────────────
  const ghosts = await host.evaluate(() => {
    const ids = Object.keys(window.dhMp.remotePlayers);
    return { ids: ids.length, guests: window.dhMp.guestCount() };
  });
  check('rejoining leaves no ghost of the old session',
    ghosts.ids === 1 && ghosts.guests === 1,
    `${ghosts.ids} remote, ${ghosts.guests} guest(s)`);

  const pageErrs = [...new Set(errs)].filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
  const passed = checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${checks.length} checks passed, ${pageErrs.length} page error(s)`);
  pageErrs.slice(0, 6).forEach(e => console.log('  !', e));
  await browser.close();
  process.exit(passed === checks.length && pageErrs.length === 0 ? 0 : 1);
})();
