import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * The broadcast director, frame by frame (1280x800, HUD off). For each case a
 * forced ball and a perfect shot, then frames at the given times (relative to
 * release, or to contact with 'c+'). Prints which shot is on air and whether
 * the ball is inside the frame; tiles qa/game/camera/<case>.png.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/camera';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
const FULL = { type: 'straight', lenM: 2.6, lineZ: 0.03, hStumps: 0.42, swing: 0, seam: 0 };
const CASES = [
  ['runup', null, false, FULL, ['r-3.0', 'r-2.2', 'r-1.4', 'r-0.7', 'r-0.2', 'r+0.3']],
  ['straight-drive', 'D', false, FULL, ['c+0.2', 'c+0.5', 'c+1.0', 'c+1.6', 'c+2.4', 'c+3.2']],
  ['straight-six', 'D', true, FULL, ['c+0.2', 'c+0.6', 'c+1.2', 'c+1.8', 'c+2.6', 'c+3.4']],
  ['cover-drive', 'DL', false, { ...FULL, lineZ: 0.3 }, ['c+0.3', 'c+0.6', 'c+1.2', 'c+2.0', 'c+3.0', 'c+5.5']],
  ['pull', 'R', false, { type: 'bouncer', lenM: 8.5, lineZ: 0.0, hStumps: 1.2, swing: 0, seam: 0 }, ['c+0.2', 'c+0.6', 'c+1.2', 'c+2.0', 'c+3.0', 'c+5.5']],
];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&cards=0&manual=1&seed=9&hud=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
// Continuity: record the largest frame-to-frame camera move (position and aim).
await page.evaluate(() => {
  const g = window.__game;
  const up = g.director.update;
  let prev = null;
  window.__jump = { pos: 0, deg: 0 };
  const dir = new g.THREE.Vector3();
  g.director.update = (dt, ctx) => {
    up(dt, ctx);
    g.camera.getWorldDirection(dir);
    const cur = { p: g.camera.position.clone(), d: dir.clone() };
    if (prev && dt > 0) {
      window.__jump.pos = Math.max(window.__jump.pos, cur.p.distanceTo(prev.p) * (1 / 60) / dt);
      window.__jump.deg = Math.max(window.__jump.deg, (cur.d.angleTo(prev.d) * 180) / Math.PI * (1 / 60) / dt);
    }
    prev = cur;
  };
});
let lost = 0;
for (const [name, dir, lofted, force, times] of CASES) {
  const info = await page.evaluate(({ dir, lofted, force }) => {
    const g = window.__game;
    g.start();
    g.ctl.forceNext = force;
    g.until((c) => c.cur && c.cur.T0 <= c.t, 10);
    const cur = g.ctl.cur;
    if (dir) {
      const key = g.shotFor(dir, false, cur.del);
      const sh = g.SHOTS[key];
      const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + (sh.bias ?? 0);
      g.ctl.events.push({ t: tp, fn: () => g.ctl.press(dir, lofted, tp) });
      g.ctl.events.sort((a, b) => a.t - b.t);
    }
    g.until((c) => c.t >= cur.tR - 3.05, 10);
    return { tR: cur.tR };
  }, { dir, lofted, force });
  const files = [];
  for (const [i, spec] of times.entries()) {
    const r = await page.evaluate(({ spec, tR }) => {
      const g = window.__game;
      const cur = g.ctl.cur;
      const base = spec.startsWith('c') ? () => cur.tContact : () => tR;
      const dt = parseFloat(spec.slice(1));
      g.until((c) => (spec.startsWith('c') ? cur.tContact != null : true) && c.t >= base() + dt, 15, 1 / 60);
      const v = g.fx.ball.position.clone().project(g.camera);
      return { shot: g.director.shot, inFrame: g.fx.ball.visible ? Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 : null, call: cur.outcome?.call ?? '' };
    }, { spec, tR: info.tR });
    const f = `${OUT}/${name}-${i}.png`;
    await page.screenshot({ path: f });
    files.push(f);
    if (r.inFrame === false && spec.startsWith('c')) lost++;
    console.log(name.padEnd(15), spec.padEnd(6), r.shot.padEnd(7), r.inFrame === null ? 'ball hidden' : r.inFrame ? 'ball in frame' : 'BALL OUT OF FRAME', r.call);
  }
  execFileSync('python3', ['qa/tile.py', `${OUT}/${name}.png`, ...files]);
  await page.evaluate(() => (window.__game.ctl.phase = 'result'));
}
console.log(lost ? `${lost} frame(s) after contact lost the ball` : 'ball in frame on every frame after contact');
const jump = await page.evaluate(() => window.__jump);
console.log(`largest camera move in one 60 Hz frame: ${jump.pos.toFixed(2)} m, ${jump.deg.toFixed(1)} deg ${jump.pos < 1.5 && jump.deg < 8 ? '(continuous: no cuts)' : '(JUMP)'}`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
