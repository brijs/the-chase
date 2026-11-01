import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

/**
 * Round the wicket and the fielding circle, in the browser:
 *   - a forced round-the-wicket ball: the bowler's hand is at the release point
 *     the delivery is solved from, the umpire has stepped across, nobody walks
 *     through anybody (closest approaches of bowler to umpire / non-striker /
 *     stumps), the read says ROUND THE WICKET and its marker is where it pitches
 *   - back over the wicket next ball: the bowler sidesteps at his mark, no jumps
 *   - the circle is drawn; the over panel shows the powerplay and who is out
 * Screenshots in qa/game/round/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync('qa/game/round', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
await page.goto(`${BASE}?mode=game&seed=6&manual=1&cards=0&ump=0&overs=20`);
await page.waitForFunction(() => window.__dioramaReady === true);

const r = await page.evaluate(() => {
  const g = window.__game;
  g.start();
  g.ctl.forceNext = { side: 'round', type: 'inswinger', lenM: 5.5, lineZ: 0.05, aimLenM: 5.5, aimLineZ: 0.05, hStumps: 0.5, kph: 136, swing: -0.2, seam: 0 };
  g.until((c) => c.cur && c.cur.dz != null, 20, 1 / 30);
  const c = g.ctl.cur;
  // Closest approaches during the run-up and follow-through.
  let dU = 9, dN = 9, dS = 9, maxStep = 0, prev = null;
  for (let t = c.T0; t < c.tR + 1.6; t += 1 / 60) {
    const b = g.ctl.stateOf('bowler', t), u = g.ctl.stateOf('umpire', t), n = g.ctl.stateOf(g.ctl.roles.nonStriker, t);
    dU = Math.min(dU, Math.hypot(b.x - u.x, b.z - u.z));
    dN = Math.min(dN, Math.hypot(b.x - n.x, b.z - n.z));
    if (Math.abs(b.x - 11.12) < 0.6) dS = Math.min(dS, Math.abs(b.z));
    if (prev) maxStep = Math.max(maxStep, Math.hypot(b.x - prev.x, b.z - prev.z) * 60);
    prev = b;
  }
  const hand = g.ctl.palmAt('bowler', 'L', c.tR);
  const rel = c.del.pos(0);
  // The non-striker: across to the off side in front of the stumps, then backing up.
  const N = g.ctl.roles.nonStriker;
  let nsStep = 0, nsStumps = 9, pn = null;
  for (let t = c.T0 - 0.5; t < c.tR + 0.5; t += 1 / 60) {
    const n = g.ctl.stateOf(N, t);
    if (pn) nsStep = Math.max(nsStep, Math.hypot(n.x - pn.x, n.z - pn.z) * 60);
    nsStumps = Math.min(nsStumps, Math.hypot(n.x - 11.12, n.z));
    pn = n;
  }
  const nsAt = g.ctl.stateOf(N, c.tR);
  g.until((c2) => c2.t > c.tR - 0.9, 20, 1 / 30);
  const read = document.querySelector('#hud-next').innerText;
  const plan = document.querySelector('#hud-plan').innerText;
  return { mark: c.preview.z - c.del.bounce.z, markR: c.preview.rz, nsZ: nsAt.z, nsStep, nsStumps, dz: c.dz, side: c.spec.side, angle: c.del.angle, dU, dN, dS, maxStep, handGap: Math.hypot(hand.x - rel.x, hand.y - rel.y, hand.z - rel.z), ump: g.ctl.stateOf('umpire', c.tR), read, plan };
});
await page.screenshot({ path: 'qa/game/round/runup.png' });
check(r.side === 'round' && r.angle > 0.5, `round the wicket: angle across ${r.angle.toFixed(2)} m`);
check(Math.abs(r.mark) < r.markR * 0.6, `the read's marker is on the bounce (${(r.mark * 100).toFixed(0)} cm across, zone ±${(r.markR * 100).toFixed(0)} cm)`);
check(/ROUND THE WICKET/.test(r.read), `the read says so: "${r.read.replace(/\n/g, ' ')}"`);
check(r.handGap < 0.35, `the ball leaves the hand (hand to release point ${r.handGap.toFixed(2)} m)`);
check(r.ump.z > 0.3, `the umpire has stepped across (z ${r.ump.z.toFixed(2)})`);
check(r.dU > 0.6 && r.dN > 0.6 && r.dS > 0.25, `no collisions: bowler to umpire ${r.dU.toFixed(2)} m, to non-striker ${r.dN.toFixed(2)} m, to the stumps' line ${r.dS.toFixed(2)} m`);
check(r.maxStep < 9.5, `the bowler never jumps (top speed ${r.maxStep.toFixed(1)} m/s)`);
check(r.nsZ > 0.9, `the non-striker has switched to the off side (z ${r.nsZ.toFixed(2)})`);
check(r.nsStep < 4.5 && r.nsStumps > 0.6, `he walks across in front of the stumps, then backs up (top speed ${r.nsStep.toFixed(1)} m/s, ${r.nsStumps.toFixed(2)} m from them at the closest)`);
check(/POWERPLAY/.test(r.plan) && /\(MAX 2\)/.test(r.plan), `over panel: "${r.plan.replace(/\n/g, ' · ')}"`);

// Back over the wicket: a sidestep at the mark.
const o = await page.evaluate(() => {
  const g = window.__game;
  const prev = g.ctl.cur;
  g.until((c) => c.phase === 'live' && c.cur.resolved && c.t > c.cur.tR + 3, 30, 1 / 30);
  g.ctl.forceNext = { side: 'over' };
  g.until((c) => c.cur !== prev && c.cur.dz != null, 30, 1 / 30);
  const c = g.ctl.cur;
  let maxStep = 0, pb = null;
  for (let t = c.T0 - 0.5; t < c.tR + 1.4; t += 1 / 60) {
    const b = g.ctl.stateOf('bowler', t);
    if (pb) maxStep = Math.max(maxStep, Math.hypot(b.x - pb.x, b.z - pb.z) * 60);
    pb = b;
  }
  const hand = g.ctl.palmAt('bowler', 'L', c.tR);
  const rel = c.del.pos(0);
  return { dz: c.dz, maxStep, handGap: Math.hypot(hand.x - rel.x, hand.y - rel.y, hand.z - rel.z), ump: g.ctl.stateOf('umpire', c.tR).z, nsZ: g.ctl.stateOf(g.ctl.roles.nonStriker, c.tR).z };
});
check(o.dz === 0 && o.handGap < 0.35 && o.ump < 0, `back over the wicket: hand at release (${o.handGap.toFixed(2)} m), umpire back (z ${o.ump.toFixed(2)})`);
check(o.nsZ < -0.9, `and the non-striker is back on the leg side (z ${o.nsZ.toFixed(2)})`);
check(o.maxStep < 9.5, `switching sides is a sidestep, not a jump (top speed ${o.maxStep.toFixed(1)} m/s)`);
// The circle, from the three-quarter camera.
const dots = await page.evaluate(() => { const g = window.__game; g.director.toggle(); g.advance(1.5, 1 / 30); return g.scene.getObjectByName('fielding-circle')?.count ?? 0; });
await page.screenshot({ path: 'qa/game/round/circle.png' });
check(dots > 40, `the fielding circle is drawn (${dots} markers)`);
check(errors.length === 0, errors.length ? errors.slice(0, 3).join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
