import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * DRS in the browser (?ump=1 so the umpire errs whenever he can):
 *   1. pitched just outside leg, left alone, given out LBW: the offer shows a
 *      10 s countdown; review -> tracking says OUTSIDE LEG -> NOT OUT, no
 *      wicket, the review kept
 *   2. plumb, given out: review -> OUT stands, the wicket falls, a review lost
 *   3. beaten outside off and given caught behind off nothing: UltraEdge finds
 *      no spike -> NOT OUT
 *   4. an offer left to run out: the batter walks
 * Screenshots of each stage in qa/game/drs/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync('qa/game/drs', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
await page.goto(`${BASE}?mode=game&seed=11&manual=1&cards=0&ump=1&cond=wind:calm`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.evaluate(() => { localStorage.removeItem('chase-conditions-v1'); window.__game.start(); });

/** Bowl forced balls until one is given out and offered for review. press: seconds after release (or null to leave). */
const until = (force, press, kind) => page.evaluate(({ force, press, kind }) => {
  const g = window.__game;
  for (let i = 0; i < 25; i++) {
    g.until((c) => c.phase === 'live' && (!c.cur || c.cur.resolved), 40, 1 / 30);
    const prev = g.ctl.cur;
    g.ctl.forceNext = force;
    g.until((c) => c.cur && c.cur !== prev, 40, 1 / 30);
    const cur = g.ctl.cur;
    if (press != null) g.ctl.events.push({ t: cur.tR + press, fn: () => g.ctl.press('DL', false, cur.tR + press) }), g.ctl.events.sort((a, b) => a.t - b.t);
    g.until((c) => c.phase === 'review' || (c.cur.resolved && c.t > c.cur.tR + 4), 40, 1 / 30);
    if (g.ctl.phase === 'review' && cur.review.o.umpire.kind === kind) return { balls: i + 1, wkts: g.ctl.m.wkts, left: g.ctl.m.reviewsLeft, truth: cur.review.o.umpire.truth, offerOn: getComputedStyle(document.querySelector('#drs-offer')).display !== 'none' };
    if (g.ctl.phase === 'review') g.drs.accept();
  }
  return null;
}, { force, press, kind });

/** Run the review to the end, screenshotting each step. */
async function runReview(tag) {
  await page.evaluate(() => window.__game.drs.review());
  const seen = [];
  for (let n = 0; n < 400; n++) {
    const st = await page.evaluate(() => { window.__game.advance(0.25, 1 / 30); return window.__game.drs.state(); });
    if (!st) break;
    const key = `${st.step}`;
    if (!seen.includes(key)) {
      seen.push(key);
      await page.evaluate(() => window.__game.advance(1.6, 1 / 30));
      await page.screenshot({ path: `qa/game/drs/${tag}-${seen.length}.png` });
    }
    if (st.result && !seen.includes('verdict')) {
      seen.push('verdict');
      await page.evaluate(() => window.__game.advance(0.8, 1 / 30));
      await page.screenshot({ path: `qa/game/drs/${tag}-decision.png` });
    }
  }
  return page.evaluate(() => {
    const g = window.__game;
    g.advance(0.5, 1 / 30);
    const c = g.ctl.cur;
    return { result: c.review.result, out: c.outcome.out, phase: g.ctl.phase, wkts: g.ctl.m.wkts, left: g.ctl.m.reviewsLeft, rows: null };
  });
}

// 1. Pitched outside leg, left, given out.
const outsideLeg = { type: 'straight', kph: 134, lenM: 5.2, lineZ: -0.05, hStumps: 0.42, swing: 0, seam: 0.45 };
let off = await until(outsideLeg, null, 'lbw');
check(!!off && off.offerOn && off.truth === 'notOut', `given out LBW pitching outside leg (after ${off?.balls} balls); the offer is up`);
await page.evaluate(() => window.__game.advance(3, 1 / 30));
const secs = await page.evaluate(() => window.__game.drs.state());
await page.screenshot({ path: 'qa/game/drs/0-offer.png' });
check(secs?.offer && secs.left < 7.5 && secs.left > 6, `the countdown runs (${secs?.left?.toFixed(1)} s left after 3 s)`);
const rowsMid = await page.evaluate(() => { window.__game.drs.review(); window.__game.advance(9.2, 1 / 30); return window.__game.drs.state(); });
check(rowsMid?.rows?.some(([id, v]) => id === 'pitching' && v === 'OUTSIDE LEG'), `tracking: ${JSON.stringify(rowsMid?.rows)}`);
let r = await runReview('lbw-leg');
check(r.result?.overturned && r.out === null && r.wkts === off.wkts && r.left === 3 && r.phase !== 'drs', `NOT OUT on review: no wicket (${r.wkts}), review kept (${r.left} left), play on (${r.phase})`);

// 2. Plumb, given out: the decision stands.
const plumbBall = { type: 'straight', kph: 134, lenM: 5.0, lineZ: -0.02, hStumps: 0.42, swing: 0, seam: 0 };
off = await until(plumbBall, null, 'lbw');
check(!!off && off.truth === 'out', `given out LBW, plumb (after ${off?.balls} balls)`);
r = await runReview('lbw-plumb');
check(!r.result?.overturned && r.out === 'lbw' && r.wkts === off.wkts + 1 && r.left === 2, `OUT stands: wicket falls (${off.wkts} -> ${r.wkts}), review lost (${r.left} left)`);

// 3. Beaten outside off, caught behind off nothing.
const wideish = { type: 'outswinger', kph: 136, lenM: 5.0, lineZ: 0.3, hStumps: 0.7, swing: 0.1, seam: 0 };
off = await until(wideish, 0.02, 'caught');
check(!!off && off.truth === 'notOut', `given caught behind off nothing (after ${off?.balls} balls)`);
r = await runReview('caught');
check(r.result?.overturned && r.out === null && r.wkts === off.wkts, `UltraEdge: no spike, NOT OUT (wickets ${r.wkts})`);

// 4. Let the offer run out.
off = await until(plumbBall, null, 'lbw');
const walked = await page.evaluate(() => { const g = window.__game; g.advance(10.6, 1 / 30); g.advance(0.5, 1 / 30); return { phase: g.ctl.phase, out: g.ctl.cur.outcome.out, wkts: g.ctl.m.wkts, offer: g.drs.offering }; });
check(!walked.offer && walked.out === 'lbw' && walked.wkts === off.wkts + 1, `after 10 s without a review the batter walks (wickets ${off.wkts} -> ${walked.wkts})`);

// 5. The replay's review: an analysis of the last ball, nothing changes.
const before = await page.evaluate(() => { const g = window.__game; g.advance(1.5, 1 / 30); return { wkts: g.ctl.m.wkts, left: g.ctl.m.reviewsLeft, runs: g.ctl.m.runs }; });
const rev = await page.evaluate(() => {
  const g = window.__game;
  const started = g.replay.start();
  g.advance(0.5, 1 / 30);
  g.replay.review();
  return { started, active: g.drs.active, head: document.querySelector('#drs-head').innerText };
});
if (process.env.DEBUG) console.log('   ', JSON.stringify(await page.evaluate(() => ({ o: window.__game.ctl.cur.outcome.call, kind: window.__game.ctl.cur.outcome.kind, pad: window.__game.ctl.cur.outcome.pad }))));
check(rev.started && rev.active && /REPLAY REVIEW/.test(rev.head), `replay → Review runs the analysis (${rev.head.replace(/\n/g, ' · ')})`);
const seen = [];
for (let n = 0; n < 200; n++) {
  const st = await page.evaluate(() => { window.__game.advance(0.25, 1 / 30); return window.__game.drs.state(); });
  if (!st) break;
  if (!seen.includes(st.step)) {
    seen.push(st.step);
    if (process.env.DEBUG) console.log('   ', JSON.stringify(st));
    await page.evaluate(() => window.__game.advance(1.6, 1 / 30));
    await page.screenshot({ path: `qa/game/drs/replay-review-${seen.length}.png` });
  }
}
const after = await page.evaluate(() => { const g = window.__game; return { replay: g.replay.active, bar: document.querySelector('#replay').classList.contains('on'), wkts: g.ctl.m.wkts, left: g.ctl.m.reviewsLeft, runs: g.ctl.m.runs }; });
check(seen.length >= 3 && after.replay && after.bar, `the analysis ran ${seen.length} steps and handed back to the replay`);
check(after.wkts === before.wkts && after.left === before.left && after.runs === before.runs, 'nothing changed: wickets, runs and reviews as they were');
await page.evaluate(() => window.__game.replay.stop?.() ?? window.__game.replay.key('pause'));

// 6. The fielding side reviews: a plumb one given not out (a fresh match: the last may be over).
const aiRev = await page.evaluate((plumb) => {
  const g = window.__game;
  g.start();
  for (let i = 0; i < 30; i++) {
    g.until((c) => c.phase === 'live' && (!c.cur || c.cur.resolved), 40, 1 / 30);
    const prev = g.ctl.cur;
    g.ctl.forceNext = plumb;
    g.until((c) => c.cur && c.cur !== prev, 40, 1 / 30);
    const cur = g.ctl.cur;
    g.until((c) => c.phase === 'review' || c.phase === 'drs' || (c.cur.resolved && c.t > c.cur.tR + 4.5), 40, 1 / 30);
    if (g.ctl.phase === 'review') { g.drs.accept(); continue; }
    if (g.drs.active && cur.review?.by === 'ai') return { balls: i + 1, wkts: g.ctl.m.wkts, left: g.ctl.m.aiReviewsLeft, truth: cur.review.o.umpire.truth, head: document.querySelector('#drs-head').innerText };
  }
  return null;
}, plumbBall);
check(!!aiRev && /fielding side/.test(aiRev.head), `the fielding side reviews a not-out (after ${aiRev?.balls} balls; truth ${aiRev?.truth})`);
r = await runReview('ai');
check(aiRev && (aiRev.truth === 'out' ? r.out === 'lbw' && r.wkts === aiRev.wkts + 1 && r.result?.overturned : !r.out), `their review: ${r.result?.overturned ? 'overturned, OUT' : 'stands, not out'} (wickets ${aiRev?.wkts} -> ${r.wkts}, their reviews ${await page.evaluate(() => window.__game.ctl.m.aiReviewsLeft)})`);
const audio = await page.evaluate(() => window.__game.audio.played);
check(errors.length === 0, errors.length ? errors.slice(0, 3).join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
