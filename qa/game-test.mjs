import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';

/**
 * End-to-end checks for the Chase in a real browser. Exit 1 on any failure.
 *   1. real keyboard: Enter starts; held ↓+← then D commits a cover drive
 *   2. frame rate while a ball is live (1280x800, real-time loop)
 *   3. determinism: same seed + the bot's inputs -> identical scorecard twice
 *   4. a whole match reaches the result card; no page errors anywhere
 *   5. phone viewport frame (qa/game/phone.png)
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const errors = [];
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
async function open(q, vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}?mode=game&cards=0&${q}`);
  await page.waitForFunction(() => window.__dioramaReady === true);
  return page;
}

// 1 + 2. Real time, real keys.
{
  const page = await open('seed=11');
  // Enter tosses; Enter again through the call, the choice (or theirs) and, if they bat first, their innings.
  for (let i = 0; i < 12 && !(await page.evaluate(() => window.__game.ctl.phase === 'live')); i++) {
    await page.keyboard.press(await page.evaluate(() => window.__game.flow.stage === 'innings') ? ' ' : 'Enter');
    await page.waitForTimeout(await page.evaluate(() => window.__game.flow.stage === 'flip') ? 1900 : 250);
  }
  await page.waitForFunction(() => window.__game.ctl.phase === 'live');
  await page.waitForFunction(() => { const c = window.__game.ctl; return c.cur && c.t > c.cur.tR + 0.05; }, null, { timeout: 15000 });
  const fps = page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.press('d');
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowDown');
  const inp = await page.evaluate(() => window.__game.ctl.cur.input);
  check(inp && inp.dirKey === 'DL' && inp.shotKey === 'cover' && !inp.lofted, `keyboard ↓+← D commits a cover drive (${JSON.stringify(inp && { dir: inp.dirKey, shot: inp.shotKey })})`);
  const f = await fps;
  check(f >= 30, `frame rate during a live ball: ${f.toFixed(0)} fps (headless, software-ish GPU)`);
  // Next ball: S with ← held is a reverse sweep.
  await page.waitForFunction(() => { const c = window.__game.ctl; return c.cur && !c.cur.resolved && c.t > c.cur.tR + 0.05; }, null, { timeout: 30000 });
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.press('s');
  await page.keyboard.up('ArrowLeft');
  const sp = await page.evaluate(() => window.__game.ctl.cur.input);
  check(sp && sp.shotKey === 'reverseSweep', `keyboard ← S commits a reverse sweep (${sp && sp.shotKey})`);
  const draws = await page.evaluate(() => window.__game.renderer.info.render.calls);
  console.log(`       draw calls per frame: ${draws}`);
  await page.close();
}

// 3 + 4. Determinism and a whole match.
const runMatch = async () => {
  const page = await open('seed=9&bot=1&manual=1');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.until((c) => c.phase === 'result', 900, 1 / 30);
    const m = g.ctl.m;
    return { phase: g.ctl.phase, card: document.querySelector('#hud-card').classList.contains('on'), log: JSON.stringify(m.log), score: `${m.runs}/${m.wkts} (${m.overText()}) target ${m.target} ${m.result}` };
  });
  await page.close();
  return r;
};
const a = await runMatch();
const b = await runMatch();
check(a.phase === 'result' && a.card, `bot plays a whole match to the result card: ${a.score}`);
const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
check(a.log === b.log, `same seed + same inputs -> identical scorecard (${h(a.log)} / ${h(b.log)})`);

// 5. Phone.
{
  const page = await open('seed=4&bot=1&manual=1', { width: 390, height: 844 });
  await page.evaluate(() => window.__game.advance(4.4));
  await page.screenshot({ path: 'qa/game/phone.png' });
  await page.close();
}
check(errors.length === 0, errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
