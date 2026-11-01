import { chromium } from 'playwright-core';
import { createMatch } from '../src/game/match.js';
import { TYPES, SPIN_TYPES, DISGUISE } from '../src/game/bowlerAI.js';
import { bowlingOrder, attackStyles } from '../src/game/scorebook.js';
import { buildDelivery } from '../src/game/delivery.js';
import { RELEASE_PT, KEEPER_STANDING_UP } from '../src/game/rules.js';

/**
 * Spin bowling: the types (pace, turn direction, bounce), the attack and its
 * order, disguise, then in the browser the short run-up, the keeper up at the
 * stumps and a leg-break and a googly on screen (qa/game/spin/). Exit 1 on failure.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };

// ---- engine
const seen = {};
for (let g = 0; g < 80; g++) {
  const m = createMatch({ seed: 900 + g, format: 10 });
  for (let o = 0; o < 10 && !m.result; o++) {
    m.balls = o * 6;
    m.startOver();
    for (let b = 0; b < 6; b++) {
      const { spec, del } = m.nextDelivery();
      (seen[spec.type] ??= []).push({ spec, del, style: m.style });
    }
  }
}
for (const t of [...SPIN_TYPES.off, ...SPIN_TYPES.leg]) {
  const L = seen[t] ?? [];
  const T = TYPES[t];
  const kphOk = L.every(({ spec }) => spec.kph >= T.kph[0] - 3 && spec.kph <= T.kph[1] + 3);
  const turn = L.reduce((a, { spec }) => a + spec.seam, 0) / Math.max(1, L.length);
  check(L.length > 5 && kphOk && L.every(({ style }) => style === T.style), `${T.name}: ${L.length} bowled by ${T.style}-spin, ${T.kph.join('-')} km/h, mean turn ${turn.toFixed(2)} m`);
}
const mean = (t, f) => (seen[t] ?? []).reduce((a, x) => a + f(x), 0) / Math.max(1, (seen[t] ?? []).length);
check(mean('offbreak', (x) => x.spec.seam) < -0.2 && mean('legbreak', (x) => x.spec.seam) > 0.25, 'off-break turns in, leg-break away');
check(mean('googly', (x) => x.spec.seam) < -0.2 && mean('carrom', (x) => x.spec.seam) > 0.15, 'the googly turns in, the carrom ball away');
check(mean('topspinner', (x) => x.spec.hStumps) > mean('flipper', (x) => x.spec.hStumps) + 0.2, `top-spinner bounces higher than the flipper (${mean('topspinner', (x) => x.spec.hStumps).toFixed(2)} v ${mean('flipper', (x) => x.spec.hStumps).toFixed(2)} m)`);
check(mean('offbreak', (x) => x.del.T1) > mean('outswinger', (x) => x.del.T1) + 0.25, `spin is in the air longer (${mean('offbreak', (x) => x.del.T1).toFixed(2)} s to pitch v ${mean('outswinger', (x) => x.del.T1).toFixed(2)})`);
check(DISGUISE.googly === 'legbreak' && DISGUISE.carrom === 'offbreak', 'the googly reads as a leg-break, the carrom ball as an off-break');
const d = buildDelivery({ type: 'legbreak', spin: true, kph: 85, lenM: 4.5, lineZ: 0.15, hStumps: 0.5, swing: -0.03, seam: 0.45, keep: 0.84 }, 0.8, RELEASE_PT);
check(Math.abs(d.atKeeper.x - (KEEPER_STANDING_UP.x + 0.6)) < 0.05, `taken by a keeper standing up (x ${d.atKeeper.x.toFixed(2)})`);

for (const overs of [5, 10, 20]) {
  for (const seed of [1, 2]) {
    const st = attackStyles(overs, seed);
    const ord = bowlingOrder(overs, st);
    const n = {};
    ord.forEach((i) => (n[i] = (n[i] ?? 0) + 1));
    const cap = overs <= 5 ? 2 : overs <= 10 ? 2 : 4;
    const edge = Math.max(1, Math.round(overs * 0.2));
    const midSpin = ord.slice(edge, overs - edge).filter((i) => st[i] !== 'pace').length;
    const ok = Object.values(n).every((c) => c <= cap) && ord.every((v, i) => v !== ord[i - 1]) && st[ord[0]] === 'pace' && midSpin >= 1;
    if (seed === 1) check(ok, `${overs} overs: ${ord.map((i) => (st[i] === 'pace' ? 'P' : st[i] === 'off' ? 'O' : 'L')).join('')} (caps ${cap}, pace opens, spin in the middle)`);
  }
}
check(attackStyles(5, 1) [2] !== attackStyles(5, 2)[2], `five overs: the one spinner is off or leg by the seed (${attackStyles(5, 1)[2]}, ${attackStyles(5, 2)[2]})`);

// ---- browser
const { mkdirSync } = await import('node:fs');
mkdirSync('qa/game/spin', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&manual=1&seed=5&cards=0&ump=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.evaluate(() => window.__game.start());
for (const [type, seam, swing] of [['legbreak', 0.5, -0.04], ['googly', -0.38, -0.03]]) {
  const r = await page.evaluate(({ type, seam, swing }) => {
    const g = window.__game;
    const { ctl } = g;
    g.until((c) => !c.cur || c.cur.resolved, 30);
    ctl.forceNext = { type, kph: 84, lenM: 4.2, lineZ: 0.12, hStumps: 0.5, swing, seam, side: 'over' };
    g.until((c) => c.cur && !c.cur.resolved && c.cur.spec.type === type, 40);
    const cur = ctl.cur;
    const at = (t) => { g.advance(Math.max(0, t - ctl.t)); return { ...g.cast.bowler.outer.position }; };
    const mark = at(cur.tR - 1.7);
    const keeper = { ...g.cast.keeper.outer.position };
    return { tR: cur.tR, T0: cur.T0, mark, keeper, spin: cur.spec.spin, read: cur.preview.typeName, tB: cur.tBounce };
  }, { type, seam, swing });
  check(r.spin && r.mark.x < 17.2 && r.mark.x > 15.5, `${type}: a short run, at ${r.mark.x.toFixed(1)} m 1.7 s before release (a seamer is at 19.2 then), tR - T0 ${(r.tR - r.T0).toFixed(2)} s`);
  check(Math.abs(r.keeper.x - KEEPER_STANDING_UP.x) < 0.4, `${type}: the keeper is up at the stumps (x ${r.keeper.x.toFixed(2)})`);
  check(/spin ·/.test(r.read), `${type}: the read says "${r.read}"`);
  await page.evaluate((tB) => window.__game.advance(Math.max(0, tB + 0.12 - window.__game.ctl.t)), r.tB);
  await page.screenshot({ path: `qa/game/spin/${type}.png` });
  await page.evaluate(() => window.__game.until((c) => c.cur.resolved && c.t > (c.nextT0 ?? 0), 40));
}
check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
