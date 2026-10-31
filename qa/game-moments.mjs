import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * Key moments in the broadcast view: bowled (bails), keeper take, an aerial
 * catch (searches seeds for one with a lofted mistime), a dive, the walk-off
 * and the new batter. Writes qa/game/moments/*.png and prints what happened.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/moments';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('  shot', name); };

async function scenario(seed, force, input) {
  await page.goto(`${BASE}?mode=game&manual=1&seed=${seed}`);
  await page.waitForFunction(() => window.__dioramaReady === true);
  return page.evaluate(({ force, input }) => {
    const g = window.__game;
    g.start();
    g.ctl.forceNext = force;
    g.until((c) => c.cur && c.cur.T0 <= c.t, 10);
    const cur = g.ctl.cur;
    if (input) {
      const sh = g.SHOTS[g.SHOT_KEYS[input.dir]];
      const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + (sh.bias ?? 0) + (input.err ?? 0);
      g.until((c) => c.t >= tp - 0.02, 10);
      g.ctl.press(input.dir, !!input.lofted, tp);
    } else g.until((c) => c.cur.resolved, 10);
    const o = cur.outcome;
    return { call: o.call, tR: cur.tR, tc: cur.tContact ?? null, fld: o.fielding ? { type: o.fielding.type, by: o.fielding.by, t: o.fielding.t, dive: o.fielding.dive } : null, tStumps: cur.tR + cur.del.tStumps, tKeeper: cur.tR + cur.del.tKeeper, now: g.ctl.t };
  }, { force, input });
}
const goTo = (t) => page.evaluate((t) => window.__game.until((c) => c.t >= t, 60), t);

// Bowled: straight full ball, left alone.
let r = await scenario(5, { type: 'inswinger', lenM: 3.0, lineZ: 0.06, hStumps: 0.4, swing: -0.1, seam: 0 }, null);
console.log('bowled:', r.call);
await goTo(r.tStumps + 0.12); await shot('bowled-bails');
await goTo(r.tStumps + 2.5); await shot('bowled-celebrate');
await goTo(r.tStumps + 9); await shot('walk-off');
await goTo(r.tStumps + 16); await shot('new-batter');

// Keeper take: wide one, left.
r = await scenario(6, { type: 'outswinger', lenM: 5.4, lineZ: 0.55, hStumps: 0.8, swing: 0.25, seam: 0 }, null);
console.log('keeper:', r.call);
await goTo(r.tKeeper); await shot('keeper-take');

// Catches: lofted, mistimed early, over several seeds.
let found = 0;
for (let seed = 1; seed < 40 && found < 2; seed++) {
  r = await scenario(seed, { type: 'outswinger', lenM: 3.0, lineZ: 0.2, hStumps: 0.45, swing: 0.05, seam: 0 }, { dir: 'DL', lofted: true, err: -0.075 });
  if (r.fld && r.fld.type === 'catch') {
    console.log(`catch (seed ${seed}):`, r.call, r.fld);
    await goTo(r.tc + r.fld.t - 0.25); await shot(`catch${found}-approach`);
    await goTo(r.tc + r.fld.t + 0.02); await shot(`catch${found}-take`);
    found++;
  }
}
// A diving stop or catch.
for (let seed = 1; seed < 80; seed++) {
  r = await scenario(seed, { type: 'outswinger', lenM: 3.2, lineZ: 0.25, hStumps: 0.45, swing: 0.05, seam: 0 }, { dir: 'DL', err: -0.03 });
  if (r.fld && r.fld.dive) {
    console.log(`dive (seed ${seed}):`, r.call, r.fld);
    await goTo(r.tc + r.fld.t - 0.15); await shot('dive-in');
    await goTo(r.tc + r.fld.t + 0.05); await shot('dive-take');
    break;
  }
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
