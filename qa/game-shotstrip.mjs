import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Shot strips: each shot through its swing (press, -60 ms, impact, +90 ms,
 * +300 ms, +600 ms) from square on (the off side), tiled per shot into
 * qa/game/strips/<shot>.png. SHOTS=pull,cut picks shots; CAM=behind uses the
 * broadcast end instead.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/strips';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
const BALLS = {
  pull: ['R', false, { type: 'bouncer', lenM: 8.5, lineZ: 0.0, hStumps: 1.2, swing: 0, seam: 0 }],
  cut: ['L', false, { type: 'legcutter', lenM: 8.0, lineZ: 0.5, hStumps: 1.05, swing: 0, seam: 0.05 }],
  lateCut: ['UL', false, { type: 'legcutter', lenM: 7.5, lineZ: 0.35, hStumps: 1.0, swing: 0, seam: 0.05 }],
  sweep: ['', true, { type: 'offcutter', lenM: 4.2, lineZ: -0.05, hStumps: 0.5, swing: 0, seam: 0 }],
  reverseSweep: ['L', true, { type: 'offcutter', lenM: 4.2, lineZ: 0.2, hStumps: 0.5, swing: 0, seam: 0 }],
  scoop: ['U', true, { type: 'yorker', lenM: 2.6, lineZ: 0.02, hStumps: 0.35, swing: 0, seam: 0 }],
  flick: ['R', false, { type: 'inswinger', lenM: 3.2, lineZ: -0.15, hStumps: 0.45, swing: -0.1, seam: 0 }],
  cover: ['DL', false, { type: 'outswinger', lenM: 2.8, lineZ: 0.3, hStumps: 0.42, swing: 0.05, seam: 0 }],
};
const names = (process.env.SHOTS || Object.keys(BALLS).join(',')).split(',');
const DTS = (process.env.DTS || '-0.13,-0.06,0,0.09,0.3,0.6').split(',').map(Number);
const behind = process.env.CAM === 'behind';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 420, height: 460 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&manual=1&seed=3&hud=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
for (const name of names) {
  const [dir, special, force] = BALLS[name];
  const files = [];
  const res = await page.evaluate(({ dir, special, force }) => {
    const g = window.__game;
    g.start();
    g.ctl.forceNext = force;
    g.until((c) => c.cur && c.cur.T0 <= c.t, 10);
    const cur = g.ctl.cur;
    const key = g.shotFor(dir, special, cur.del);
    const sh = g.SHOTS[key];
    const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + (sh.bias ?? 0);
    g.until((c) => c.t >= tp - 0.02, 10);
    g.ctl.press(dir, false, tp, special);
    return { tI: tp + sh.swing, call: cur.outcome.call, shot: key };
  }, { dir, special, force });
  for (const [i, dt] of DTS.entries()) {
    await page.evaluate(({ t, behind }) => {
      const g = window.__game;
      g.until((c) => c.t >= t, 10, 1 / 240);
      g.director.set('manual');
      g.camera.fov = behind ? 9 : 24;
      if (behind) g.camera.position.set(14, 2.2, 0.4); else g.camera.position.set(-6.4, 1.3, 5.2);
      g.camera.lookAt(-7.5, 0.75, -0.15);
      g.camera.updateProjectionMatrix();
      g.renderFrame();
    }, { t: res.tI + dt, behind });
    const f = `${OUT}/${name}-${i}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  execFileSync('python3', ['qa/tile.py', `${OUT}/${name}${behind ? '-behind' : ''}.png`, ...files]);
  console.log(name.padEnd(13), res.shot, '->', res.call);
  await page.evaluate(() => { window.__game.director.set('broadcast'); window.__game.ctl.phase = 'result'; });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
