import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Shot pose sheet: for each shot, force a ball that suits it, press with
 * perfect timing, and grab the batter close up at impact and in the finish
 * (plus a leave and a duck). Writes qa/game/poses/<shot>-{impact,finish}.png.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/poses';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
const CASES = [
  ['straight', 'D', { type: 'outswinger', lenM: 2.8, lineZ: 0.02, hStumps: 0.42, swing: 0.05, seam: 0 }],
  ['cover', 'DL', { type: 'outswinger', lenM: 2.8, lineZ: 0.3, hStumps: 0.42, swing: 0.05, seam: 0 }],
  ['onDrive', 'DR', { type: 'inswinger', lenM: 3.0, lineZ: -0.15, hStumps: 0.42, swing: -0.05, seam: 0 }],
  ['cut', 'L', { type: 'legcutter', lenM: 8.0, lineZ: 0.5, hStumps: 1.05, swing: 0, seam: 0.05 }],
  ['lateCut', 'UL', { type: 'legcutter', lenM: 7.5, lineZ: 0.35, hStumps: 1.0, swing: 0, seam: 0.05 }],
  ['punch', 'U', { type: 'offcutter', lenM: 6.5, lineZ: 0.1, hStumps: 0.9, swing: 0, seam: -0.03 }],
  ['glance', 'UR', { type: 'inswinger', lenM: 4.0, lineZ: -0.25, hStumps: 0.55, swing: -0.1, seam: 0 }],
  ['pull', 'R', { type: 'bouncer', lenM: 8.5, lineZ: 0.0, hStumps: 1.2, swing: 0, seam: 0 }],
  ['defence', '', { type: 'outswinger', lenM: 5.2, lineZ: 0.05, hStumps: 0.7, swing: 0.05, seam: 0 }],
  ['leave', null, { type: 'outswinger', lenM: 5.5, lineZ: 0.55, hStumps: 0.75, swing: 0.2, seam: 0 }],
  ['duck', null, { type: 'bouncer', lenM: 10.5, lineZ: 0.0, hStumps: 1.9, swing: 0, seam: 0 }],
];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 520, height: 520 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&manual=1&seed=3&hud=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
const files = [];
for (const [name, dir, force] of CASES) {
  const r = await page.evaluate(({ dir, force }) => {
    const g = window.__game;
    const { SHOTS } = g;
    g.start();
    g.ctl.forceNext = force;
    g.until((c) => c.cur && c.cur.T0 <= c.t, 10);
    const cur = g.ctl.cur;
    let tI = cur.tR + cur.del.contactTime('front');
    if (dir !== null) {
      const sh = g.SHOTS[g.SHOT_KEYS[dir]];
      const foot = g.shotFoot(sh, cur.del);
      const tp = cur.tR + cur.del.contactTime(foot) - sh.swing + (sh.bias ?? 0);
      g.until((c) => c.t >= tp - 0.02, 10);
      g.ctl.press(dir, false, tp);
      tI = tp + sh.swing;
    }
    g.director.set('manual');
    g.camera.fov = 22;
    g.camera.position.set(-3.2, 1.6, 4.6);
    g.camera.lookAt(-7.6, 0.85, -0.1);
    g.camera.updateProjectionMatrix();
    g.until((c) => c.t >= tI, 10);
    g.renderFrame();
    return { tI, out: g.ctl.cur.outcome?.call };
  }, { dir, force });
  await page.screenshot({ path: `${OUT}/${name}-impact.png` });
  await page.evaluate(() => window.__game.advance(0.4));
  await page.screenshot({ path: `${OUT}/${name}-finish.png` });
  files.push(`${OUT}/${name}-impact.png`, `${OUT}/${name}-finish.png`);
  console.log(name.padEnd(9), r.out);
  await page.evaluate(() => { window.__game.director.set('broadcast'); window.__game.ctl.phase = 'result'; });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
