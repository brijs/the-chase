import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * Super overs, in the browser (the bot bats):
 *   1. a tied chase (forced) offers a super over; you batted second, so you bat
 *      first: one over, two wickets, no target; then their super over is
 *      played out against yours and a winner named (or another super over)
 *   2. their super over first (they batted second): it plays out, then you
 *      chase it over one over with two wickets
 * Screenshots in qa/game/superover/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync('qa/game/superover', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const shot = (n) => page.screenshot({ path: `qa/game/superover/${n}.png` });

await page.goto(`${BASE}?mode=game&seed=12&manual=1&cards=0&bot=1&overs=5&ump=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
// 1. A tie: the chase ends level (forced), and the result card offers a super over.
const tie = await page.evaluate(() => {
  const g = window.__game;
  g.until((c) => c.phase === 'result', 900, 1 / 30);
  g.ctl.m.result = 'tied';
  g.hud.final(g.ctl.m, g.ctl.t, {});
  g.advance(0.1, 1 / 30);
  return document.querySelector('#hud-card').innerText;
});
check(/Tied/.test(tie) && /Super over \(Enter\)/.test(tie), 'a tie: the result card offers a super over');
await page.keyboard.press('Enter');
const ann = await page.evaluate(() => ({ stage: window.__game.flow.stage, text: document.querySelector('#flow').innerText }));
await shot('1-announce');
check(ann.stage === 'announce' && /SUPER OVER/.test(ann.text) && /\(you\)\s*bat first/.test(ann.text), 'you batted second, so you bat first');
await page.keyboard.press('Enter');
const mine = await page.evaluate(() => {
  const g = window.__game;
  g.advance(0.5, 1 / 30);
  const m0 = { overs: g.ctl.m.overs, wickets: g.ctl.m.wickets, target: g.ctl.m.target, superOver: g.ctl.m.superOver, top: document.querySelector('#hud-top').innerText };
  g.until((c) => c.phase === 'result', 300, 1 / 30);
  return { ...m0, runs: g.ctl.m.runs, wkts: g.ctl.m.wkts, balls: g.ctl.m.balls, result: g.ctl.m.result, card: document.querySelector('#hud-card').innerText };
});
check(mine.superOver && mine.overs === 1 && mine.wickets === 2 && mine.target === null && /SUPER OVER/.test(mine.top), `your super over: 1 over, 2 wickets, no target (${mine.top.replace(/\n/g, ' ')})`);
check(mine.result === 'innings' && (mine.balls >= 6 || mine.wkts === 2) && /Super over done/.test(mine.card), `it ends at ${mine.runs}/${mine.wkts} off ${mine.balls} balls`);
await shot('2-mine');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press(' ');
const theirs = await page.evaluate(() => ({ stage: window.__game.flow.stage, text: document.querySelector('#flow').innerText, m: window.__game.game.ai.sim.m }));
await shot('3-theirs');
check(theirs.m.superOver && theirs.m.target === mine.runs + 1 && /super over/i.test(theirs.text), `their super over chases ${theirs.m.target}: ${theirs.m.runs}/${theirs.m.wkts} -> "${theirs.text.split('\n').find((l) => /super over/i.test(l) && /win|tied/.test(l))}"`);

// 2. They batted second: their super over first, then you chase it.
await page.evaluate(() => { const g = window.__game; g.flow.close(); g.superOverNext('ai'); });
const ann2 = await page.evaluate(() => document.querySelector('#flow').innerText);
check(/SUPER OVER/.test(ann2) && !/\(you\)\s*bat first/.test(ann2), 'they batted second: they bat first');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press(' ');
const first = await page.evaluate(() => window.__game.game.ai.sim.m);
check(first.superOver && first.target === null && (first.balls >= 6 || first.wkts === 2), `their super over: ${first.runs}/${first.wkts}`);
await page.keyboard.press('Enter');
const chase = await page.evaluate(() => { const g = window.__game; g.advance(0.5, 1 / 30); return { target: g.ctl.m.target, overs: g.ctl.m.overs, wickets: g.ctl.m.wickets, phase: g.ctl.phase }; });
check(chase.target === first.runs + 1 && chase.overs === 1 && chase.wickets === 2 && chase.phase === 'live', `you chase ${chase.target} off one over`);
await page.evaluate(() => window.__game.advance(4, 1 / 30));
await shot('4-chase');
check(errors.length === 0, errors.length ? errors.slice(0, 3).join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
