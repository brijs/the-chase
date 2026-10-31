import { chromium } from 'playwright-core';

/**
 * Baked calibration vs the browser's save (needs a build WITH calibration.json):
 *   1. an older browser save (made before this file was baked) gives way to the file,
 *      and is kept under a backup key
 *   2. a save made on top of the baked file wins on the next load
 *   3. "Forget browser save" goes back to the baked file
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await (await browser.newContext()).newPage();
page.on('dialog', (d) => d.accept());
const load = async () => { await page.goto(`${BASE}?mode=game&manual=1&seed=2`); await page.waitForFunction(() => window.__dioramaReady === true); };
const state = () => page.evaluate(() => ({ src: window.__game.tuning.state.source, off: window.__game.tuning.get('timing.offsetMs'), baked: window.__game.tuning.baked }));
await load();
const baked = (await state()).baked;
if (!baked) { console.log('build has no calibration.json baked in: nothing to test'); process.exit(1); }
const bakedOff = baked.params['timing.offsetMs'] ?? 0;

// 1. An old save, from before the file was baked (no bakedHash).
await page.evaluate(() => localStorage.setItem('chase-calibration-v1', JSON.stringify({ version: 1, params: { 'timing.offsetMs': 77 }, savedAt: '2026-01-01T00:00:00Z', log: [] })));
await load();
let s = await state();
check(s.src === 'baked calibration.json' && Math.abs(s.off - bakedOff) < 1e-6, `older browser save gives way to the newly baked file (${s.src}, offset ${s.off})`);
const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('chase-calibration-v1-superseded') ?? 'null'));
check(backup?.params?.['timing.offsetMs'] === 77, 'the older save is kept under a backup key');

// 2. A save on top of the baked file wins next time.
await page.evaluate(() => { window.__game.tuning.set('timing.offsetMs', 33); window.__game.tuning.save(); });
await load();
s = await state();
check(s.src === 'saved in this browser' && s.off === 33, `a save made on this baked file wins on reload (${s.src}, offset ${s.off})`);

// 3. Forget browser save -> the baked file again.
await page.keyboard.press('t');
await page.click('#tune [data-act=forget]');
s = await state();
check(s.src === 'baked calibration.json' && Math.abs(s.off - bakedOff) < 1e-6, `"Forget browser save" goes back to the baked file (offset ${s.off})`);
await page.evaluate(() => { localStorage.removeItem('chase-calibration-v1'); localStorage.removeItem('chase-calibration-v1-superseded'); });
await browser.close();
process.exit(fail ? 1 : 0);
