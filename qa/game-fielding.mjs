import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Fielding variety: plays forced balls and shots across seeds until it has one
 * of each effort (set gather, long barrier, run pick-up, slide, stretch catch,
 * set catch, dive), then shoots the fielder close up before, at and after the
 * take. Tiles qa/game/fielding/<effort>.png and prints the mix it saw.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/fielding';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  ['DL', false, { type: 'outswinger', lenM: 2.8, lineZ: 0.3, hStumps: 0.42 }],
  ['D', false, { type: 'straight', lenM: 3.0, lineZ: 0.02, hStumps: 0.42 }],
  ['R', false, { type: 'bouncer', lenM: 8.5, lineZ: 0.0, hStumps: 1.2 }],
  ['L', false, { type: 'legcutter', lenM: 8.0, lineZ: 0.5, hStumps: 1.05 }],
  ['DL', true, { type: 'outswinger', lenM: 2.8, lineZ: 0.3, hStumps: 0.42 }],
  ['U', false, { type: 'offcutter', lenM: 6.5, lineZ: 0.1, hStumps: 0.9 }],
];
const WANT = ['field:set', 'field:barrier', 'field:run', 'field:slide', 'field:dive', 'catch:set', 'catch:run', 'catch:stretch', 'catch:dive'];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 520, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
const seen = {};
const got = new Set();
for (let seed = 1; seed < 160 && got.size < WANT.length; seed++) {
  await page.goto(`${BASE}?mode=game&cards=0&manual=1&seed=${seed}&hud=0`);
  await page.waitForFunction(() => window.__dioramaReady === true);
  const [dir, lofted, force] = SHOTS[seed % SHOTS.length];
  const r = await page.evaluate(({ dir, lofted, force, seed }) => {
    const g = window.__game;
    g.start();
    g.ctl.forceNext = { swing: 0, seam: 0, ...force };
    g.until((c) => c.cur && c.cur.T0 <= c.t, 10);
    const cur = g.ctl.cur;
    const key = g.shotFor(dir, false, cur.del);
    const sh = g.SHOTS[key];
    const jit = (((seed * 37) % 11) - 5) * 0.012;
    const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + (sh.bias ?? 0) + jit;
    g.until((c) => c.t >= tp - 0.01, 10);
    g.ctl.press(dir, lofted, tp);
    const o = cur.outcome;
    const f = o.fielding;
    if (!f || f.type === 'boundary' || !cur.tContact) return null;
    const barrier = f.effort === 'set' && f.type !== 'catch' && f.type !== 'drop' && (f.speedAt ?? 0) > 11;
    const kind = `${f.type === 'drop' ? 'catch' : f.type}:${barrier ? 'barrier' : f.effort}`;
    return { kind, by: f.by, tI: cur.tContact + f.t, at: f.at, call: o.call };
  }, { dir, lofted, force, seed });
  if (!r) continue;
  seen[r.kind] = (seen[r.kind] ?? 0) + 1;
  if (got.has(r.kind) || !WANT.includes(r.kind)) continue;
  got.add(r.kind);
  const files = [];
  for (const [i, dt] of [-0.35, -0.12, 0.0, 0.25, 0.7].entries()) {
    await page.evaluate(({ t, at, by }) => {
      const g = window.__game;
      g.until((c) => c.t >= t, 10, 1 / 240);
      g.director.set('manual');
      const st = g.ctl.stateOf(by, g.ctl.t);
      const cx = (st.x + at.x) / 2, cz = (st.z + at.z) / 2;
      // From the side of his line to the ball, a little above.
      const dx = at.x - st.x, dz = at.z - st.z;
      const L = Math.hypot(dx, dz) || 1;
      g.camera.position.set(cx - (dz / L) * 6, 2.6, cz + (dx / L) * 6);
      g.camera.fov = 30;
      g.camera.lookAt(cx, 0.6, cz);
      g.camera.updateProjectionMatrix();
      g.renderFrame();
    }, { t: r.tI + dt, at: r.at, by: r.by });
    const f = `${OUT}/${r.kind.replace(':', '-')}-${i}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  execFileSync('python3', ['qa/tile.py', `${OUT}/${r.kind.replace(':', '-')}.png`, ...files]);
  console.log(`${r.kind.padEnd(14)} seed ${seed} · ${r.by} · ${r.call}`);
}
console.log('mix seen:', JSON.stringify(seen));
console.log('missing:', WANT.filter((w) => !got.has(w)).join(', ') || 'none');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
