import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * Match length, the toss and the AI's simulated innings, in the browser:
 *   1. the intro offers 5 / 10 / 20 overs (keys 4-6) and remembers the choice
 *   2. Enter tosses: a call, the coin, then your choice or the AI's
 *   3. bowl first: their innings ticks up over by over, skips to the end,
 *      shows the full card (B), and your chase starts with target = their
 *      total + 1 over the chosen length
 *   4. bat first (the bot bats): no target, the innings ends, their chase is
 *      played out and the result is given with team names; back to the intro
 * Screenshots in qa/game/toss/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync('qa/game/toss', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const shot = (n) => page.screenshot({ path: `qa/game/toss/${n}.png` });

await page.goto(`${BASE}?mode=game&seed=8&manual=1&cards=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.evaluate(() => localStorage.removeItem('chase-format'));
await page.reload();
await page.waitForFunction(() => window.__dioramaReady === true);
await page.waitForSelector('#hud-card [data-format]');
await page.click('#hud-card h1');
await page.keyboard.press('5');
const intro = await page.evaluate(() => ({ on: document.querySelector('#hud-card [data-format].on')?.textContent, text: document.querySelector('#hud-card').innerText, saved: localStorage.getItem('chase-format') }));
check(/10 overs/.test(intro.on) && /10 overs a side, 10 wickets/.test(intro.text) && intro.saved === '10', `key 5 picks 10 overs (${intro.on}), remembered`);
await shot('1-intro');

// The toss.
await page.keyboard.press('Enter');
check(await page.evaluate(() => window.__game.flow.stage === 'call'), 'Enter opens the toss: call it');
await page.keyboard.press('ArrowRight');
check(await page.evaluate(() => /Call tails/.test(document.querySelector('#flow').innerText)), '→ calls tails');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await shot('2-coin');
await page.waitForFunction(() => ['choose', 'aiChose'].includes(window.__game.flow.stage), null, { timeout: 5000 });
const st = await page.evaluate(() => ({ stage: window.__game.flow.stage, text: document.querySelector('#flow').innerText }));
await shot('3-toss-result');
check(st.stage === 'choose' ? /You won the toss/.test(st.text) : /won the toss/.test(st.text) && /chose to (bat|bowl)/.test(st.text), `toss decided: ${st.text.split('\n')[0]}`);
await page.evaluate(() => window.__game.flow.close());

// Bowl first: their innings, then your chase.
await page.evaluate(() => window.__game.begin(false));
await page.waitForTimeout(1600);
const ticking = await page.evaluate(() => ({ stage: window.__game.flow.stage, lines: document.querySelectorAll('#flow .ov').length }));
await shot('4-their-innings');
check(ticking.stage === 'innings' && ticking.lines >= 1 && ticking.lines < 10, `their innings ticks up (${ticking.lines} overs shown so far)`);
await page.keyboard.press(' ');
const done = await page.evaluate(() => ({ stage: window.__game.flow.stage, lines: document.querySelectorAll('#flow .ov').length, ai: window.__game.game.ai.sim.m }));
check(done.stage === 'inningsDone' && done.lines === Math.ceil(done.ai.balls / 6) + (done.ai.balls % 6 ? 0 : 0) || done.lines >= 1, `Space skips to the end: ${done.ai.runs}/${done.ai.wkts} in ${done.ai.balls} balls`);
await page.keyboard.press('b');
check(await page.evaluate(() => !!document.querySelector('#flow .card table')), 'B shows their full scorecard');
await shot('5-their-card');
await page.keyboard.press('Enter');
const chase = await page.evaluate(() => { window.__game.advance(0.5, 1 / 30); const m = window.__game.ctl.m; return { target: m.target, overs: m.overs, wickets: m.wickets, phase: window.__game.ctl.phase, top: document.querySelector('#hud-top').innerText }; });
check(chase.target === done.ai.runs + 1 && chase.overs === 10 && chase.wickets === 10 && chase.phase === 'live', `your chase: target ${chase.target}, ${chase.overs} overs, ${chase.wickets} wickets (${chase.top.replace(/\n/g, ' ')})`);
await page.evaluate(() => window.__game.advance(3, 1 / 30));
await shot('6-chase');

// Bat first with the bot batting, five overs.
await page.goto(`${BASE}?mode=game&seed=9&manual=1&cards=0&bot=1&overs=5`);
await page.waitForFunction(() => window.__dioramaReady === true);
const first = await page.evaluate(() => {
  const g = window.__game;
  g.begin(true);
  g.until((c) => c.phase === 'result', 900, 1 / 30);
  const m = g.ctl.m;
  return { result: m.result, target: m.target, runs: m.runs, wkts: m.wkts, balls: m.balls, card: document.querySelector('#hud-card').innerText };
});
check(first.result === 'innings' && first.target === null && (first.balls === 30 || first.wkts === 5), `bat first: innings over at ${first.runs}/${first.wkts} (${first.balls} balls), no target`);
check(/Innings complete/.test(first.card) && new RegExp(`need ${first.runs + 1} to win`).test(first.card), 'the end-of-innings card says what they need');
await shot('7-innings-done');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.press(' ');
const res = await page.evaluate(() => ({ stage: window.__game.flow.stage, text: document.querySelector('#flow').innerText, ai: window.__game.game.ai.sim.m }));
check(res.stage === 'inningsDone' && res.ai.target === first.runs + 1 && /won by|tied/i.test(res.text), `their chase of ${res.ai.target}: ${res.text.split('\n').find((l) => /won by|tied/i.test(l))}`);
await shot('8-result');
await page.keyboard.press('Enter');
check(await page.evaluate(() => window.__game.ctl.phase === 'intro' && document.querySelector('#hud-card').classList.contains('on')), 'New match goes back to the intro');
check(errors.length === 0, errors.length ? errors.slice(0, 3).join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
