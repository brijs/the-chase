import { chromium } from 'playwright-core';

/**
 * How fast do the fielders and the keeper actually move? Plays bot matches and
 * samples every fielder's root at 30 Hz; reports the fastest 0.2 s stretch per
 * actor. Exit 1 if anyone exceeds MAX (default 8 m/s, a sprinting fielder;
 * the difficulty's fielder speed is 5-6 m/s).
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const MAX = +(process.env.MAX || 8);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
let worst = {};
for (const seed of [3, 8, 13, 21]) {
  await page.goto(`${BASE}?mode=game&cards=0&manual=1&bot=1&seed=${seed}&hud=0`);
  await page.waitForFunction(() => window.__dioramaReady === true);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const names = ['keeper', 'slip1', 'slip2', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
    const hist = Object.fromEntries(names.map((n) => [n, []]));
    const out = {};
    for (let i = 0; i < 30 * 400 && g.ctl.phase !== 'result'; i++) {
      g.ctl.update(1 / 30);
      for (const n of names) {
        const s = g.ctl.stateOf(n, g.ctl.t);
        const h = hist[n];
        h.push([g.ctl.t, s.x, s.z]);
        if (h.length > 7) h.shift();
        if (h.length === 7) {
          const [a, b] = [h[0], h[6]];
          const v = Math.hypot(b[1] - a[1], b[2] - a[2]) / (b[0] - a[0]);
          if (!out[n] || v > out[n].v) out[n] = { v, t: +g.ctl.t.toFixed(1), ball: g.ctl.m.log.length, call: g.ctl.m.log.at(-1)?.call };
        }
      }
    }
    return out;
  });
  for (const [n, x] of Object.entries(r)) if (!worst[n] || x.v > worst[n].v) worst[n] = { ...x, seed };
}
let fail = 0;
for (const [n, x] of Object.entries(worst).sort((a, b) => b[1].v - a[1].v)) {
  const bad = x.v > MAX;
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${n.padEnd(7)} top speed ${x.v.toFixed(1)} m/s (seed ${x.seed}, ball ${x.ball}, ${x.call ?? ''})`);
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
