import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * The calibration flow in a real browser. Exit 1 on failure.
 *   nets + picker -> 5 cover drives pressed 40 ms late, answered "2 Right" ->
 *   the offset rises; the tuning panel edits live and undoes; Save (confirmed)
 *   persists across a reload into a regular match; Export / Reset / Import.
 * Screenshots in qa/game/calibration/.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = 'qa/game/calibration';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE}?mode=game&cards=0&nets=1&manual=1&seed=5`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.evaluate(() => localStorage.removeItem('chase-calibration-v1'));

// Picker: full outswingers outside off.
for (const [g, k] of [['type', 'outswinger'], ['length', 'full'], ['line', 'off']]) await page.click(`#nets-pick [data-g=${g}][data-k=${k}]`);
const off0 = await page.evaluate(() => window.__game.tuning.get('timing.offsetMs'));
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => {
    const g = window.__game;
    g.until((c) => c.cur && !c.cur.resolved && c.t >= c.cur.T0 && c.phase === 'live', 40);
    const cur = g.ctl.cur;
    const sh = g.SHOTS.cover;
    const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + 0.04; // 40 ms late, raw
    g.until((c) => c.t >= tp - 0.01, 10);
    g.ctl.press('DL', false, tp);
  });
  // No popup any more: F asks for feedback; pressed mid-ball, it opens once the ball is decided.
  const auto = await page.evaluate(() => { window.__game.advance(3); return window.__game.calib.cardOpen; });
  if (i === 0) check(!auto, 'no feedback popup unless asked');
  await page.keyboard.press('f');
  await page.evaluate(() => window.__game.until((c) => window.__game.calib.cardOpen, 20));
  await page.keyboard.press('2');
  await page.keyboard.press('8');
  if (i === 0) {
    // Mark cover ideal (↓← + D once) and straight drive OK (↓ + D twice).
    await page.keyboard.down('ArrowDown'); await page.keyboard.down('ArrowLeft'); await page.keyboard.press('d'); await page.keyboard.up('ArrowLeft');
    await page.keyboard.press('d'); await page.keyboard.press('d'); await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(150);
    const marks = await page.evaluate(() => [...document.querySelectorAll('#nets-card .grid button')].filter((b) => /ideal|ok/.test(b.className)).map((b) => `${b.textContent}:${b.classList.contains('ideal') ? 'ideal' : 'ok'}`));
    check(marks.includes('Cover drive:ideal') && marks.includes('Straight drive:ok'), `marked shots on the card: ${marks.join(', ')}`);
    // Power and trajectory keys.
    await page.keyboard.press('4');
    await page.keyboard.press('q');
    const pt = await page.evaluate(() => [...document.querySelectorAll('#nets-card [data-q=power].on, #nets-card [data-q=height].on')].map((b) => b.textContent.trim()));
    check(pt.length === 2 && /More power/.test(pt[0]) && /Higher/.test(pt[1]), `power and trajectory answers: ${pt.join(', ')}`);
    // Spread: wedges drawn on the map, Z = too wide.
    await page.keyboard.press('z');
    const sp = await page.evaluate(() => ({ wedges: document.querySelectorAll('#nets-card svg.field polygon').length, on: [...document.querySelectorAll('#nets-card [data-q=spread].on')].map((b) => b.textContent.trim()) }));
    check(sp.wedges === 2 && sp.on[0]?.includes('Narrower'), `spread wedges on the map (${sp.wedges}) and the Z answer (${sp.on.join(', ')})`);
    // Should have gone: click straight down the ground on the field map.
    const box = await page.locator('#nets-card svg.field').boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
      const dir = await page.evaluate(() => document.querySelector('#nets-card').textContent.includes('teal: yours'));
      check(dir, 'clicking the field map sets the direction answer');
    } else check(false, 'field map shown for a clean hit');
    await page.screenshot({ path: `${OUT}/feedback-card.png` });
  }
  await page.keyboard.press('Enter');
  if (i === 0) await page.screenshot({ path: `${OUT}/feedback-tuned.png` });
  await page.keyboard.press('Enter');
}
// An edge: force a big late drive at an outswinger until one comes off the edge,
// then the card offers direction / spread / power / trajectory for that edge kind.
let edged = null;
for (let i = 0; i < 12 && !edged; i++) {
  edged = await page.evaluate(() => {
    const g = window.__game;
    g.ctl.forceNext = { type: 'outswinger', lenM: 5.0, lineZ: 0.28, hStumps: 0.7, swing: 0.3, seam: 0 };
    g.until((c) => c.cur && !c.cur.resolved && c.t >= c.cur.T0 && c.phase === 'live' && c.cur.spec.swing === 0.3, 60);
    const cur = g.ctl.cur;
    const sh = g.SHOTS.cover;
    const tp = cur.tR + cur.del.contactTime(g.shotFoot(sh, cur.del)) - sh.swing + 0.09;
    g.until((c) => c.t >= tp - 0.01, 10);
    g.ctl.press('DL', false, tp);
    const e = cur.outcome.shot?.edge;
    g.until((c) => c.t > (c.nextT0 ?? 0) - 1, 30);
    return e && cur.outcome.kind === 'hit' ? e : null;
  });
}
if (!edged) check(false, 'got an edge to give feedback on');
else {
  await page.keyboard.press('f');
  await page.evaluate(() => window.__game.until(() => window.__game.calib.cardOpen, 20));
  const before = await page.evaluate((k) => window.__game.tuning.get(`edge.${k}.speed`), edged);
  const card = await page.evaluate(() => ({ text: document.querySelector('#nets-card').textContent, map: !!document.querySelector('#nets-card svg.field'), wedges: document.querySelectorAll('#nets-card svg.field polygon').length }));
  check(card.map && card.wedges >= 1 && /edge/i.test(card.text) && /Power/.test(card.text) && /Spread/.test(card.text), `${edged} edge: card shows the map, its range wedge, power / trajectory / spread`);
  await page.screenshot({ path: `${OUT}/feedback-edge.png` });
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  const after = await page.evaluate((k) => window.__game.tuning.get(`edge.${k}.speed`), edged);
  check(after > before, `"More power" on the ${edged} edge raises its speed (${before.toFixed(3)} -> ${after.toFixed(3)})`);
  await page.keyboard.press('Enter');
}
const spec = await page.evaluate(() => window.__game.ctl.m.log.map((l) => `${l.spec.type}/${l.spec.length}/${l.spec.line}`));
check(spec.slice(0, 5).every((s) => s.startsWith('outswinger/full/')), `picker forced the deliveries: ${[...new Set(spec)].join(', ')}`);
const off1 = await page.evaluate(() => window.__game.tuning.get('timing.offsetMs'));
check(off1 > off0 + 15, `5 x "right" at +40 ms raw: offset ${off0} -> ${off1.toFixed(1)} ms`);
const logN = await page.evaluate(() => window.__game.tuning.state.log.length);
check(logN >= 5, `feedback log has ${logN} entries`);
await page.screenshot({ path: `${OUT}/nets.png` });

// Panel: open, tabs, a live edit, undo.
await page.keyboard.press('t');
await page.screenshot({ path: `${OUT}/panel-timing.png` });
await page.click('#tune nav [data-tab="Shots"]');
await page.click('#tune td[data-cell="shot.cut.len.good"]');
await page.screenshot({ path: `${OUT}/panel-shots.png` });
const edited = await page.evaluate(() => {
  const r = document.querySelector('#tune .row[data-id="shot.cut.len.good"] input[type=range]');
  r.value = '0.9';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
  return window.__game.tuning.get('shot.cut.len.good');
});
check(Math.abs(edited - 0.9) < 1e-9, `heatmap cell edit applies live (cut x good = ${edited})`);
await page.click('#tune nav [data-tab="History"]');
await page.screenshot({ path: `${OUT}/panel-history.png` });
const before = await page.evaluate(() => JSON.stringify(window.__game.tuning.current()));
await page.click('#tune [data-undo]');
const changed = await page.evaluate((b) => { const a = window.__game.tuning.current(); const o = JSON.parse(b); return Object.keys(a).filter((k) => a[k] !== o[k]); }, before);
check(changed.length >= 1, `undo in History sets a value back (${changed.join(', ')})`);
const after = await page.evaluate(() => window.__game.tuning.get('timing.offsetMs'));
await page.click('#tune nav [data-tab="Outcomes"]');
await page.screenshot({ path: `${OUT}/panel-outcomes.png` });

// Export, then save (confirm dialog accepted).
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tune [data-act=export]')]);
const exported = JSON.parse(readFileSync(await dl.path(), 'utf8'));
check(exported.version === 1 && exported.params['shot.cut.len.good'] === 0.9, `export has ${Object.keys(exported.params).length} values and the log (${exported.log.length})`);
await page.click('#tune [data-act=save]');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chase-calibration-v1')));
check(saved && saved.params['shot.cut.len.good'] === 0.9, 'Save (confirmed) writes the calibration to this browser');

// Reload into a regular match: the calibration is in use.
await page.goto(`${BASE}?mode=game&cards=0&manual=1&seed=5`);
await page.waitForFunction(() => window.__dioramaReady === true);
const persisted = await page.evaluate(() => ({ cell: window.__game.tuning.get('shot.cut.len.good'), off: window.__game.tuning.get('timing.offsetMs'), src: window.__game.tuning.state.source }));
check(persisted.cell === 0.9 && Math.abs(persisted.off - after) < 1e-3, `after reload a regular match uses it (cut x good ${persisted.cell}, offset ${persisted.off.toFixed(1)} ms, ${persisted.src})`);
const usedOffset = await page.evaluate(() => {
  const g = window.__game;
  g.start();
  g.until((c) => c.cur && c.t > c.cur.tR + 0.1, 20);
  g.ctl.press('D', false, g.ctl.t);
  return g.ctl.cur.input.rawPressT - g.ctl.cur.input.pressT;
});
check(Math.abs(usedOffset * 1000 - persisted.off) < 0.01, `presses in a match are corrected by the offset (${(usedOffset * 1000).toFixed(1)} ms)`);
const card = await page.evaluate(() => window.__game.calib.cardOpen);
check(!card, 'regular matches never ask for feedback');

// Reset to defaults, then Import the export back.
await page.keyboard.press('t');
await page.click('#tune [data-act=reset]');
const nOver = await page.evaluate(() => Object.keys(window.__game.tuning.overrides()).length);
check(nOver === 0, 'Reset all to defaults clears every override');
await page.setInputFiles('#hud input[type=file]', { name: 'calibration.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
await page.waitForFunction(() => window.__game.tuning.get('shot.cut.len.good') === 0.9);
check(true, 'Import restores the exported calibration');
await page.evaluate(() => localStorage.removeItem('chase-calibration-v1'));

check(errors.length === 0, errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
