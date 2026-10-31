import { chromium } from 'playwright-core';

/**
 * The scorecard: appears (with the camera on the ground's scoreboard) after an
 * over and after a wicket, its figures add up (batters' runs + extras = total,
 * bowlers' runs = total, bowlers' wickets = wickets), it closes on Enter and
 * the game resumes; B shows it any time; the end of the innings shows it; the
 * nets never do. Screenshots in qa/game/scorecard-*.png.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&manual=1&bot=1&seed=17`);
await page.waitForFunction(() => window.__dioramaReady === true);

const upTo = (pred) => page.evaluate((p) => window.__game.until(new Function('c', `return ${p}`), 300, 1 / 30), pred);
const figures = () => page.evaluate(() => {
  const g = window.__game, b = g.scorecard.book, m = g.ctl.m;
  return { total: m.runs, wkts: m.wkts, bat: b.batters.reduce((a, x) => a + x.runs, 0), wides: b.wides, bowlRuns: b.bowlers.reduce((a, x) => a + x.runs, 0), bowlW: b.bowlers.reduce((a, x) => a + x.wkts, 0), bowlBalls: b.bowlers.reduce((a, x) => a + x.balls, 0), balls: m.balls, reason: document.querySelector('#scard h2')?.textContent };
});
const sumsOk = (f) => f.bat + f.wides === f.total && f.bowlRuns === f.total && f.bowlW === f.wkts && f.bowlBalls === f.balls;

await upTo("c.phase === 'scorecard'");
await page.evaluate(() => window.__game.advance(1.2)); // camera to the board
await page.waitForTimeout(1100); // the card's zoom (real time)
let f = await figures();
const cam = await page.evaluate(() => window.__game.camera.position.toArray().map((v) => +v.toFixed(1)));
check(f.reason && (f.reason.startsWith('END OF OVER') || f.reason === 'WICKET'), `scorecard shown: "${f.reason}", camera at the board (${cam.join(', ')})`);
check(sumsOk(f), `figures add up: batters ${f.bat} + extras ${f.wides} = ${f.total}; bowlers ${f.bowlRuns} runs, ${f.bowlW} wkts, ${f.bowlBalls} balls`);
await page.screenshot({ path: 'qa/game/scorecard-over.png' });
const tFrozen = await page.evaluate(() => { const t = window.__game.ctl.t; window.__game.advance(1); return window.__game.ctl.t - t; });
check(tFrozen === 0, 'the game waits while the scorecard is up');
await page.keyboard.press('Enter');
check(await page.evaluate(() => !window.__game.scorecard.isOpen && window.__game.ctl.phase !== 'scorecard'), 'Enter closes it and play resumes');

// A wicket card, if one comes.
const gotW = await page.evaluate(() => window.__game.until((c) => c.phase === 'scorecard' && document.querySelector('#scard h2')?.textContent === 'WICKET' || c.phase === 'result', 400, 1 / 30) && window.__game.ctl.phase === 'scorecard');
if (gotW) {
  await page.waitForTimeout(1100);
  f = await figures();
  check(sumsOk(f), `after a wicket: figures still add up (${f.total}/${f.wkts})`);
  await page.screenshot({ path: 'qa/game/scorecard-wicket.png' });
  await page.keyboard.press('Escape');
}
// B any time.
await page.evaluate(() => window.__game.until((c) => c.phase === 'live', 60, 1 / 30));
await page.keyboard.press('b');
check(await page.evaluate(() => window.__game.scorecard.isOpen), 'B shows the scorecard');
await page.keyboard.press('b');
// End of the innings.
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 2000 && g.ctl.phase !== 'result'; i++) { if (g.scorecard.isOpen && g.ctl.phase === 'scorecard') g.scorecard.close(); g.advance(1 / 2, 1 / 30); }
});
await page.waitForTimeout(1100);
f = await figures();
check(await page.evaluate(() => window.__game.scorecard.isOpen) && /won|tied/.test(f.reason ?? ''), `end of the innings: "${f.reason}"`);
check(sumsOk(f), `final figures add up (${f.total}/${f.wkts} in ${f.balls} balls)`);
await page.screenshot({ path: 'qa/game/scorecard-end.png' });

// Nets: never.
await page.goto(`${BASE}?mode=game&manual=1&nets=1&seed=3`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.keyboard.press('b');
check(await page.evaluate(() => !window.__game.scorecard.isOpen), 'no scorecard in the nets');
check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
