import { chromium } from 'playwright-core';

/**
 * The world round the oval: full-window canvas, the stands and sky (no paper
 * showing), a six landing in the crowd with the camera keeping it in frame,
 * the ball-size slider, and the title screen. Screenshots in qa/game/world/.
 * Exit 1 on failure.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const OUT = 'qa/game/world';
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&manual=1&seed=7&cards=0&title=0`);
await page.waitForFunction(() => window.__dioramaReady === true);

// Full window, and nothing of the white page left round the ground.
const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
check(box[0] === 0 && box[1] === 0 && box[2] === 1280 && box[3] === 760, `canvas fills the window (${box.join(', ')})`);
await page.evaluate(() => { window.__game.flow.close?.(); window.__game.hud.hideCard(); window.__game.renderFrame(); });
const whites = await page.evaluate(() => {
  const c = document.getElementById('stage');
  const g = document.createElement('canvas');
  g.width = c.width; g.height = c.height;
  const x = g.getContext('2d');
  x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data;
  let w = 0, n = 0;
  // The top and side margins, where the paper used to show.
  for (let y = 0; y < g.height; y += 4) for (let xx = 0; xx < g.width; xx += 4) {
    if (y > g.height * 0.25 && xx > g.width * 0.08 && xx < g.width * 0.92) continue;
    const i = (y * g.width + xx) * 4;
    n++;
    if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) w++;
  }
  return w / n;
});
check(whites < 0.03, `no paper round the ground (${(whites * 100).toFixed(1)}% white in the margins)`);
await page.screenshot({ path: `${OUT}/wide.png` });
await page.evaluate(() => { window.__game.director.set('diorama'); window.__game.renderFrame(); });
await page.screenshot({ path: `${OUT}/overview.png` });
await page.evaluate(() => window.__game.director.set('broadcast'));

// A six: forced half-volley, lofted straight and perfectly timed, until it lands.
await page.evaluate(() => window.__game.start());
const six = await page.evaluate(async () => {
  const g = window.__game;
  const { ctl } = g;
  for (let tries = 0; tries < 16; tries++) {
    ctl.forceNext = { type: 'straight', kph: 132, lenM: 3.4, lineZ: 0.04, hStumps: 0.5, swing: 0, seam: 0, side: 'over' };
    g.until((c) => c.cur && !c.cur.resolved && c.t > c.cur.T0 + 0.05, 30);
    const cur = ctl.cur;
    const sh = g.SHOTS.straight;
    const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + (sh.bias ?? 0) + g.SCALES.offsetMs / 1000;
    g.until((c) => c.t >= tp - 1 / 120, 10);
    ctl.press('D', true, tp);
    g.until((c) => c.cur.resolved, 10);
    const o = ctl.cur.outcome;
    window.__sixLog = (window.__sixLog ?? []).concat([[o?.kind, o?.shot?.timing, o?.shot?.shotKey, o?.runs, o?.fielding?.type]]);
    if (o?.sim?.six) {
      const tc = ctl.cur.tContact;
      const land = o.sim.tLand;
      const out = [];
      const v = new g.THREE.Vector3();
      window.__sixT = { tc, land };
      for (let t = ctl.t; t < tc + land * 0.55; t = ctl.t) {
        g.advance(1 / 30);
        if (!g.fx.ball.visible) continue;
        v.copy(g.fx.ball.position).project(g.camera);
        out.push([+(ctl.t - tc).toFixed(2), +v.x.toFixed(2), +v.y.toFixed(2)]);
      }
      const last = o.sim.samples[o.sim.samples.length - 1];
      return { tries, land, tStop: o.sim.tStop, last, out };
    }
    g.until((c) => c.cur.resolved && c.t > (c.nextT0 ?? 0), 40);
    if (ctl.m.result) g.start();
  }
  return null;
});
check(!!six, `a lofted straight drive went for six${six ? ` (try ${six.tries + 1})` : `: ${JSON.stringify(await page.evaluate(() => window.__sixLog))}`}`);
if (six) {
  const { standHeight } = await import('../src/game/rules.js');
  const h = standHeight(six.last.x, six.last.z);
  check(Math.abs(six.last.y - (h + 0.09)) < 0.05 && h > 0, `it comes to rest in the stands (y ${six.last.y.toFixed(2)} on ground ${h.toFixed(2)}, landed ${six.land.toFixed(2)} s after contact)`);
  const off = six.out.filter(([, x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1);
  await page.screenshot({ path: `${OUT}/six-flight.png` });
  // On to the landing, still in frame.
  const rest = await page.evaluate(() => {
    const g = window.__game;
    const { tc, land } = window.__sixT;
    const v = new g.THREE.Vector3();
    const out = [];
    while (g.ctl.t < tc + land + 0.05) {
      g.advance(1 / 30);
      if (!g.fx.ball.visible) continue;
      v.copy(g.fx.ball.position).project(g.camera);
      out.push([+(g.ctl.t - tc).toFixed(2), +v.x.toFixed(2), +v.y.toFixed(2)]);
    }
    return out;
  });
  six.out.push(...rest);
  check(off.length === 0 && rest.every(([, x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1), `the camera keeps the ball in frame until it lands (${six.out.length} frames${off.length ? `; off at ${off.slice(0, 4).map((o) => o[0]).join(', ')}` : ''})`);
  await page.screenshot({ path: `${OUT}/six-landed.png` });
}

// Ball size: the slider sets the drawn radius and it is remembered.
await page.keyboard.press('o');
await page.waitForSelector('#condp.on');
await page.$eval('#condp [data-ball]', (e) => { e.value = '0.045'; e.dispatchEvent(new Event('input', { bubbles: true })); });
const size = await page.evaluate(() => ({ r: window.__game.ctl.ballSize, saved: localStorage.getItem('chase-ball-size') }));
check(Math.abs(size.r - 0.045) < 1e-9 && size.saved === '0.045', `ball size slider: radius ${size.r}, saved ${size.saved}`);
await page.evaluate(() => { localStorage.removeItem('chase-ball-size'); window.__game.condPanel.close(); });

// The title screen, then Enter to the intro card.
await page.goto(`${BASE}?mode=game&manual=1&seed=7&title=1`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.waitForTimeout(300);
const t1 = await page.evaluate(() => ({ title: !!document.querySelector('#title.on'), intro: window.__game.ctl.phase }));
check(t1.title, 'the title screen shows on load');
await page.evaluate(() => window.__game.advance(2));
await page.screenshot({ path: `${OUT}/title.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(900); // the card's fade is real time
await page.evaluate(() => window.__game.advance(1.5));
const t2 = await page.evaluate(() => ({ title: !!document.querySelector('#title.on'), card: !!document.querySelector('#hud .card, #hud .intro'), phase: window.__game.ctl.phase }));
check(!t2.title && t2.phase === 'intro', `Enter leaves it for the intro card (${t2.phase})`);
await page.screenshot({ path: `${OUT}/intro.png` });

check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
