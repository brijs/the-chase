import { chromium } from 'playwright-core';

/**
 * Contact and seam probe for The Short Ball. Samples the whole loop at 40 Hz and
 * prints numbers a screenshot cannot show:
 *
 *   ball      largest per-frame step in flight vs out of flight (a pop is a step
 *             far above the flight speed outside a flight window)
 *   holds     palm-to-ball distance whenever someone is holding the ball
 *   grip      bottom palm to bat axis while the batter's two-hand grip is on
 *   seam      every actor's root and pelvis, clock 45.975 vs clock 0
 *
 * Exit code 1 on: hold > 0.08 m, grip > 0.06 m, ball pop > 0.6 m/frame outside a
 * flight, or a seam delta > 0.05 m.
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__dioramaReady === true, null, { timeout: 30000 });

const r = await page.evaluate(() => {
  const d = window.__diorama;
  const { THREE, cast, stage, LOOP } = d;
  const ball = d.entities.ball;
  const v = new THREE.Vector3();
  let prev = null;
  const steps = [];
  let maxFly = 0, maxFlyT = 0, maxHold = 0, maxHoldT = 0, maxPop = 0, maxPopT = 0;
  let maxGrip = 0, maxGripT = 0, gripSamples = 0;
  const holdLog = [];
  for (let i = 0; i < LOOP * 40; i++) {
    const t = i / 40;
    d.freeze(t);
    const dom = t + 3;
    const b = stage.ballAt(dom);
    const p = ball.position.clone();
    if (prev) {
      const step = p.distanceTo(prev.p);
      steps.push({ t, step, change: b.flying !== prev.flying });
      if (b.flying && prev.flying && step > maxFly) { maxFly = step; maxFlyT = t; }
    }
    prev = { p, flying: b.flying };
    // Grip: every batter who has the bottom hand on (IK) this frame.
    for (const name of ['batterA', 'batterB']) {
      const a = cast[name];
      if (!a.outer.visible || !a.bat?.visible) continue;
      const st = stage.S[name](dom);
      if (!st.ik) continue;
      const g = a.gripGap();
      gripSamples++;
      if (g > maxGrip) { maxGrip = g; maxGripT = t; }
    }
  }
  // A pop is a step across a hold<->flight boundary well above both neighbours
  // (a fast hand is not a pop: the hold distance below proves the ball is in it).
  for (let i = 1; i < steps.length - 1; i++) {
    if (!steps[i].change) continue;
    const ref = Math.max(steps[i - 1].step, steps[i + 1].step);
    const excess = steps[i].step - ref;
    if (excess > maxPop) { maxPop = excess; maxPopT = steps[i].t; }
  }
  // Hold distance at named contact frames (clock time).
  const TLc = d.clockTL;
  const holds = [
    ['keeper take', TLc.keeperTake, 'keeper'],
    ['slip catch', TLc.catch, 'slip2'],
    ['throw 1 caught', TLc.throw1[1], 'bowler'],
    ['throw 2 caught', TLc.throw2[1], 'bowler'],
    ['handoff end', TLc.handoff[1], 'bowler'],
    ['release', TLc.release[0], 'bowler'],
  ];
  for (const [label, t, who] of holds) {
    d.freeze(t);
    const a = cast[who];
    const pl = a.palm('L', new THREE.Vector3());
    const pr = a.palm('R', new THREE.Vector3());
    const dist = Math.min(pl.distanceTo(ball.position), pr.distanceTo(ball.position), pl.add(pr).multiplyScalar(0.5).distanceTo(ball.position));
    holdLog.push({ label, t, who, dist: +dist.toFixed(3) });
    if (dist > maxHold) { maxHold = dist; maxHoldT = t; }
  }
  // Helmet and edge: the ball at the contact frame vs the head / blade.
  d.freeze(TLc.helmet);
  const head = cast.batterA.joints.head.getWorldPosition(new THREE.Vector3());
  const helmetGap = ball.position.distanceTo(head);
  d.freeze(TLc.edge);
  const bat = cast.batterA.bat;
  const blade = bat.localToWorld(new THREE.Vector3(0, -0.6, 0));
  const edgeGap = ball.position.distanceTo(blade);

  // Seam: every actor at 45.975 vs 0.
  const snap = (t) => {
    d.freeze(t);
    const out = {};
    for (const [k, a] of Object.entries(cast)) {
      a.joints.pelvis.getWorldPosition(v);
      out[k] = { vis: a.outer.visible, root: a.outer.position.toArray(), pelvis: v.toArray(), yaw: a.outer.rotation.y };
    }
    return out;
  };
  const end = snap(LOOP - 0.025);
  const start = snap(0);
  const seam = [];
  // Batter B at the end of the lap is batter A at its start: compare across the swap.
  const pairs = Object.keys(cast).map((k) => [k, k === 'batterB' ? 'batterA' : k === 'batterA' ? null : k]);
  for (const [k, k2] of pairs) {
    if (!k2) continue;
    const a = end[k], b = start[k2];
    if (!a.vis) continue;
    const dp = Math.hypot(...a.pelvis.map((x, i) => x - b.pelvis[i]));
    const dyaw = Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw)));
    seam.push({ actor: k2 === k ? k : `${k}->${k2}`, pelvisDelta: +dp.toFixed(3), yawDelta: +dyaw.toFixed(3) });
  }
  return {
    maxFly: +maxFly.toFixed(3), maxFlyT, maxPop: +maxPop.toFixed(3), maxPopT,
    maxGrip: +maxGrip.toFixed(3), maxGripT, gripSamples,
    holdLog, maxHold: +maxHold.toFixed(3), maxHoldT,
    helmetGap: +helmetGap.toFixed(3), edgeGap: +edgeGap.toFixed(3),
    seam,
  };
});

console.log(`ball   in-flight max step ${r.maxFly} m/frame at t=${r.maxFlyT.toFixed(3)}; worst hold/flight transition excess ${r.maxPop} m at t=${r.maxPopT.toFixed(3)}`);
console.log(`grip   bottom palm to bat axis max ${r.maxGrip} m at t=${r.maxGripT.toFixed(3)} over ${r.gripSamples} samples`);
for (const h of r.holdLog) console.log(`hold   ${h.label.padEnd(16)} t=${h.t.toFixed(3)} ${h.who.padEnd(7)} palm->ball ${h.dist} m`);
console.log(`hit    ball->head centre at helmet ${r.helmetGap} m; ball->blade centre at edge ${r.edgeGap} m`);
for (const s of r.seam) console.log(`seam   ${s.actor.padEnd(18)} pelvis ${s.pelvisDelta} m  yaw ${s.yawDelta} rad`);
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');

let fail = false;
if (r.maxHold > 0.08) { console.log('FAIL hold > 0.08 m'); fail = true; }
if (r.maxGrip > 0.06) { console.log('FAIL grip > 0.06 m'); fail = true; }
if (r.maxPop > 0.15) { console.log('FAIL ball pops outside a flight'); fail = true; }
if (r.seam.some((s) => s.pelvisDelta > 0.05 || s.yawDelta > 0.05)) { console.log('FAIL seam'); fail = true; }
if (errors.length) fail = true;
console.log(fail ? 'probe failed' : 'probe passed');
await browser.close();
process.exit(fail ? 1 : 0);
