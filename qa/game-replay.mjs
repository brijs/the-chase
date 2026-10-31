import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Replays: play a forced cover drive, then R. Checks the replay freezes the
 * game, that scrubbing back to a moment reproduces it exactly (camera, ball and
 * a fielder), that a fielder's pose in the replay matches what was live, the
 * auto slow motion, the three views, and that exiting resumes play. Strips of
 * each view go to qa/game/replay/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/replay';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&cards=0&manual=1&seed=5`);
await page.waitForFunction(() => window.__dioramaReady === true);

const live = await page.evaluate(() => {
  const g = window.__game;
  g.start();
  g.ctl.forceNext = { type: 'outswinger', lenM: 2.8, lineZ: 0.3, hStumps: 0.42, swing: 0.05, seam: 0 };
  g.until((c) => c.cur && c.cur.T0 <= c.t, 10);
  const cur = g.ctl.cur;
  const sh = g.SHOTS.cover;
  const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing;
  g.until((c) => c.t >= tp - 0.01, 10);
  g.ctl.press('DL', false, tp);
  const f = cur.outcome.fielding;
  // Remember a fielder's live state just after the take.
  const tX = cur.tContact + f.t + 0.1;
  g.until((c) => c.t >= tX, 10, 1 / 240);
  const st = g.ctl.stateOf(f.by, tX);
  g.until((c) => c.t >= cur.tContact + 4, 20);
  return { tX, by: f.by, x: st.x, z: st.z, call: cur.outcome.call, tC: cur.tContact };
});
console.log('ball:', live.call);
await page.keyboard.press('r');
const st0 = await page.evaluate(() => ({ active: window.__game.replay.active, phase: window.__game.ctl.phase, t: window.__game.ctl.t }));
check(st0.active && st0.phase === 'replay', 'R starts the replay and freezes the game');

// Determinism: the same replay time gives the same camera, ball and fielder.
const snap = (t) => page.evaluate((t) => {
  const g = window.__game;
  g.replay.seek(t);
  g.renderFrame();
  const b = g.fx.ball.position;
  return { cam: g.camera.position.toArray().map((v) => +v.toFixed(4)), ball: [b.x, b.y, b.z].map((v) => +v.toFixed(4)), fx: +g.ctl.stateOf(window.__by, t).x.toFixed(4) };
}, t);
await page.evaluate((by) => (window.__by = by), live.by);
const a = await snap(live.tC + 0.6);
const other = await snap(live.tC + 2.0);
await snap(live.tC - 1.0);
const b = await snap(live.tC + 0.6);
check(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(other), 'scrubbing back to a moment reproduces it exactly (and another moment differs)');
const fx = await page.evaluate(({ by, t }) => { const s = window.__game.ctl.stateOf(by, t); return [s.x, s.z]; }, { by: live.by, t: live.tX });
check(Math.abs(fx[0] - live.x) < 1e-9 && Math.abs(fx[1] - live.z) < 1e-9, `the fielder (${live.by}) is where he was live`);
const gameT = await page.evaluate(() => window.__game.ctl.t);
check(Math.abs(gameT - st0.t) < 1e-9, 'game clock stays frozen while replaying');

// Slow motion around contact.
const rates = await page.evaluate((tC) => {
  const g = window.__game;
  const R = g.replay.state;
  const meas = (t0) => { g.replay.seek(t0); R.playing = true; const a = R.t; g.replay.update(0.1); return (R.t - a) / 0.1; };
  return { atContact: meas(tC - 0.05), away: meas(tC - 1.5) };
}, live.tC);
check(rates.atContact < 0.5 && rates.away > 0.9, `auto slow-mo: ${rates.atContact.toFixed(2)}× at contact, ${rates.away.toFixed(2)}× away from it`);

// No trail in slow motion (at contact), a trail at full speed away from it.
const trails = await page.evaluate((tC) => {
  const g = window.__game;
  const vis = () => g.fx.trail.filter((m) => m.visible).length;
  g.replay.setView('ball');
  g.replay.state.slowmo = true;
  g.replay.seek(tC + 0.05); g.renderFrame(); const slow = vis();
  g.replay.state.slowmo = false; g.replay.state.speed = 1;
  g.replay.seek(tC + 0.2); g.renderFrame(); const fast = vis(); const rateFast = g.replay.rate(); const ff = g.ctl.ff; const view = g.replay.state.view;
  g.replay.state.slowmo = true;
  return { slow, fast, rateFast, ff, view, t: g.replay.state.t - tC, active: g.replay.active, tag: g.ctl.ballPlan.seg(tC + 0.2)?.tag, flying: g.ctl.ballAt(tC + 0.2).flying };
}, live.tC);
check(trails.slow === 0 && trails.fast > 0, `ball trail: ${trails.slow} ghosts in slow motion, ${trails.fast} at full speed (same flight)`);

// Free camera: a drag on the field switches to it and rotates; Follow ball keeps the ball centred.
await page.evaluate((tC) => { const g = window.__game; g.replay.setView('broadcast'); g.replay.seek(tC + 0.4); g.renderFrame(); }, live.tC);
const camBefore = await page.evaluate(() => window.__game.camera.position.toArray());
await page.mouse.move(480, 300);
await page.mouse.down();
await page.mouse.move(600, 260, { steps: 8 });
await page.mouse.up();
await page.evaluate(() => window.__game.advance(0.2));
const free = await page.evaluate((before) => {
  const g = window.__game;
  return { view: g.replay.state.view, moved: g.camera.position.distanceTo(new g.THREE.Vector3(...before)) };
}, camBefore);
check(free.view === 'free' && free.moved > 0.5, `drag on the field -> free camera, rotated (${free.moved.toFixed(1)} m)`);
const centred = await page.evaluate((tC) => {
  const g = window.__game;
  g.replay.state.follow = true;
  g.replay.seek(tC + 1.2); g.renderFrame();
  g.replay.seek(tC + 1.6); g.renderFrame();
  const v = g.fx.ball.position.clone().project(g.camera);
  return Math.hypot(v.x, v.y);
}, live.tC);
check(centred < 0.35, `Follow ball keeps the ball near the centre (${centred.toFixed(2)} of the half-screen)`);
await page.screenshot({ path: `${OUT}/free.png` });

// Strips per view.
for (const view of ['ball', 'side', 'broadcast']) {
  const files = [];
  for (const [i, dt] of [-1.2, -0.05, 0.25, 0.8, 1.6, 2.6].entries()) {
    await page.evaluate(({ view, t }) => { const g = window.__game; g.replay.setView(view); g.replay.seek(t); g.renderFrame(); }, { view, t: live.tC + dt });
    const f = `${OUT}/${view}-${i}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  execFileSync('python3', ['qa/tile.py', `${OUT}/${view}.png`, ...files]);
}
await page.screenshot({ path: `${OUT}/bar.png` });

await page.keyboard.press('Escape');
const after = await page.evaluate(() => { const g = window.__game; const t0 = g.ctl.t; g.advance(0.5); return { active: g.replay.active, phase: g.ctl.phase, moved: g.ctl.t - t0 }; });
check(!after.active && after.phase === 'live' && after.moved > 0.4, 'Esc exits and the game carries on');
check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
