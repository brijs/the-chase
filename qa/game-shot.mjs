import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * Game-mode screenshots and a console-error check. Loads ?mode=game&manual=1,
 * runs a script of steps against window.__game, and writes PNGs.
 *
 *   OUT     output dir (default qa/game)
 *   QUERY   extra query string (default "seed=7")
 *   STEPS   JSON list: [["start"], ["advance", 3.1], ["shot", "name"], ["eval", "js"], ["cam", "diorama"]]
 *   VIEW    "1280x800"
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = process.env.OUT || 'qa/game';
const QUERY = process.env.QUERY || 'seed=7';
const [W, H] = (process.env.VIEW || '1280x800').split('x').map(Number);
const STEPS = JSON.parse(process.env.STEPS || '[["shot","intro"],["start"],["advance",3.0],["shot","runup"],["advance",0.9],["shot","release"]]');
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${BASE}?mode=game&manual=1&${QUERY}`);
await page.waitForFunction(() => window.__dioramaReady === true, null, { timeout: 30000 });
for (const [op, arg, arg2] of STEPS) {
  if (op === 'start') await page.evaluate(() => window.__game.start());
  else if (op === 'advance') await page.evaluate((s) => window.__game.advance(s), arg);
  else if (op === 'cam') await page.evaluate((m) => window.__game.director.set(m), arg);
  else if (op === 'eval') console.log(op, JSON.stringify(await page.evaluate(arg)));
  else if (op === 'shot') {
    await page.evaluate(() => window.__game.renderFrame());
    await page.screenshot({ path: `${OUT}/${arg}.png` });
    console.log('shot', `${OUT}/${arg}.png`);
  }
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
