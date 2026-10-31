import { chromium } from 'playwright-core';

/**
 * Conditions and announcement timing, in the browser:
 *   1. the intro card shows the day's conditions; O opens the panel; picking
 *      Overcast + Green top changes the light and the strip, and is saved
 *   2. a match starts in those conditions (m.cond) with the corner chip shown
 *   3. bot matches: OUT (caught), DROPPED, FOUR and SIX never show before the
 *      catch is taken or put down, or the ball reaches the rope
 * Screenshots in qa/game/conditions/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const shot = (n) => page.screenshot({ path: `qa/game/conditions/${n}.png` });
await import('node:fs').then((fs) => fs.mkdirSync('qa/game/conditions', { recursive: true }));

await page.goto(`${BASE}?mode=game&seed=5&manual=1&cards=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.evaluate(() => localStorage.removeItem('chase-conditions-v1'));
await page.reload();
await page.waitForFunction(() => window.__dioramaReady === true);
await page.waitForSelector('#hud-card .cond', { timeout: 10000 }).catch(() => {});
await page.waitForSelector('#hud-card .cond', { timeout: 10000 }).catch(() => {});
check(await page.locator('#hud-card .cond').isVisible(), `intro shows conditions: "${(await page.locator('#hud-card .cond').innerText()).replace(/\n/g, ' / ')}"`);
await page.evaluate(() => window.__game.renderFrame());
await shot('1-intro');
const before = await page.evaluate(() => { const g = window.__game; return { sun: g.scene.children.find((o) => o.isDirectionalLight && o.castShadow).intensity }; });
await page.click('#hud-card h1'); // focus the page
await page.keyboard.press('o');
check(await page.waitForSelector('#condp.on', { timeout: 5000 }).then(() => true, () => false), 'O opens the conditions panel');
await page.click('#condp [data-g=sky][data-k=overcast]');
await page.click('#condp [data-g=pitch][data-k=green]');
await page.click('#condp [data-g=wind][data-k=strong]');
await page.click('#condp [data-g=windDir][data-k=atBowler]');
const what = await page.locator('#condp').innerText();
check(/Swing \+40%/.test(what) && /seam \+70%/.test(what), 'the panel says what each choice does');
await shot('2-panel');
await page.keyboard.press('o');
const after = await page.evaluate(() => { const g = window.__game; return { sun: g.scene.children.find((o) => o.isDirectionalLight && o.castShadow).intensity, saved: JSON.parse(localStorage.getItem('chase-conditions-v1')) }; });
check(after.sun < before.sun * 0.75, `overcast dims the sun (${before.sun.toFixed(2)} -> ${after.sun.toFixed(2)})`);
check(after.saved?.sel?.sky === 'overcast' && after.saved.sel.pitch === 'green', 'the choice is saved in this browser');
await page.evaluate(() => window.__game.renderFrame());
await shot('3-overcast-green');

await page.keyboard.press('Enter');
await page.evaluate(() => window.__game.advance(0.5));
const cond = await page.evaluate(() => ({ ...window.__game.ctl.m.cond, chip: document.querySelector('#hud-cond').innerText }));
check(cond.swing === 1.4 && cond.seam === 1.7 && cond.wind.x === 7, `the match plays in them (swing x${cond.swing}, seam x${cond.seam}, wind ${cond.wind.x} m/s behind the batter)`);
check(/Overcast/.test(cond.chip) && /↓/.test(cond.chip), `corner chip: "${cond.chip.replace(/\n/g, ' / ')}"`);
await page.keyboard.press('o');
check(await page.locator('#condp button[data-g=sky][disabled]').count() > 0 && (await page.evaluate(() => window.__game.ctl.phase)) === 'tuning', 'mid-match the panel is read-only and play waits');
await page.keyboard.press('o');
await page.evaluate(() => window.__game.advance(4));
await shot('4-match');

// Announcements wait for the moment (the bot bats).
await page.goto(`${BASE}?mode=game&seed=40&manual=1&cards=0&bot=1`);
await page.waitForFunction(() => window.__dioramaReady === true);
const res = await page.evaluate(() => {
  const g = window.__game;
  const call = document.querySelector('#hud-call');
  const seen = { catch: 0, drop: 0, boundary: 0 };
  const early = [];
  for (let game = 0; game < 2; game++) {
    g.ctl.startMatch('medium', 40 + game, { conditions: { sky: 'cloudy', wind: 'calm', pitch: 'standard', outfield: 'fast' } });
    let lastBall = null;
    for (let s = 0; s < 30 * 260 && g.ctl.phase !== 'result'; s++) {
      g.advance(1 / 30, 1 / 30);
      const c = g.ctl.cur;
      const o = c?.outcome;
      if (!o || o.kind !== 'hit' || c.tContact == null) continue;
      const f = o.fielding;
      const tAt = f.type === 'catch' || f.type === 'drop' ? c.tContact + f.t : f.type === 'boundary' ? c.tContact + (o.sim.tRope ?? 1) : null;
      if (tAt == null) continue;
      if (lastBall !== c) { lastBall = c; seen[f.type]++; }
      const showing = call.classList.contains('on') && /OUT|DROPPED|FOUR|SIX/.test(call.textContent);
      if (showing && g.ctl.t < tAt - 1e-6) early.push(`${call.textContent} at ${(g.ctl.t - tAt).toFixed(2)} s`);
    }
  }
  return { seen, early: [...new Set(early)].slice(0, 6) };
}, null);
console.log('       seen:', JSON.stringify(res.seen));
check(res.seen.catch + res.seen.drop > 0 && res.seen.boundary > 0, 'bot matches included catches/drops and boundaries');
check(res.early.length === 0, res.early.length ? `announced early: ${res.early.join('; ')}` : 'nothing announced before the catch, drop or rope');
check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
