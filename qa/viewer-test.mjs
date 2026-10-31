import { chromium } from 'playwright-core';

/**
 * Viewer-mode test: drives the real controls the way a person would and checks
 * the numbers.
 *   - the bar is shown to a person (webdriver spoofed off) and hidden by default
 *     under automation, so the other QA scripts stay clean
 *   - drag rotates, wheel zooms (camera moves; the target stays on the slab;
 *     the camera stays above the deck)
 *   - 2x speed advances the playhead about twice as fast as 1x; pause stops it
 *   - the scrubber seeks; Reset returns to the locked camera exactly
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const OUT = process.env.OUT || 'shots/viewer';
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};

// 1. Under automation the bar is hidden.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => window.__dioramaReady === true);
  check((await page.locator('#viewer').count()) === 0, 'bar hidden under automation (QA frames stay clean)');
  await page.close();
}

// 2. As a person sees it.
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(BASE_URL + '?from=2.2');
await page.waitForFunction(() => window.__dioramaReady === true);
check((await page.locator('#viewer').count()) === 1, 'bar shown to a person');

const cam = () =>
  page.evaluate(() => {
    const d = window.__diorama;
    return { p: d.camera.position.toArray(), t: d.viewer.controls.target.toArray(), clock: d.playback && null };
  });
const clock = () => page.evaluate(() => parseFloat(document.querySelector('#viewer .time').textContent));
const locked = await cam();
await page.screenshot({ path: `${OUT}/0-locked.png` });

// Speed: measure playhead advance over ~1 s at 1x and at 2x.
const rate = async () => {
  const a = await clock();
  await page.waitForTimeout(1000);
  const b = await clock();
  return (b - a + 46) % 46;
};
const r1 = await rate();
await page.click('#viewer [data-speed="2"]');
const r2 = await rate();
check(r2 / r1 > 1.7 && r2 / r1 < 2.3, `2x speed: ${r1.toFixed(2)} s/s at 1x, ${r2.toFixed(2)} s/s at 2x`);
await page.click('#viewer [data-speed="0.25"]');
const rq = await rate();
check(rq / r1 > 0.18 && rq / r1 < 0.33, `0.25x speed: ${rq.toFixed(2)} s/s`);
await page.keyboard.press('Space');
const p0 = await clock();
await page.waitForTimeout(600);
check(Math.abs((await clock()) - p0) < 0.02, 'Space pauses the playhead');

// Scrub to the helmet hit.
await page.locator('#viewer input[type=range]').fill('16.12');
await page.waitForTimeout(150);
check(Math.abs((await clock()) - 16.12) < 0.02, 'scrubber seeks to 16.12 s');

// Rotate: drag across the canvas.
const box = await page.locator('#stage').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(cx - i * 22, cy - i * 4);
await page.mouse.up();
await page.waitForTimeout(500);
const rotated = await cam();
const moved = Math.hypot(...rotated.p.map((v, i) => v - locked.p[i]));
check(moved > 5, `drag rotates the camera (moved ${moved.toFixed(1)} m)`);
check(rotated.p[1] > 0.5, `camera stays above the deck (y ${rotated.p[1].toFixed(2)})`);
await page.screenshot({ path: `${OUT}/1-rotated.png` });

// Zoom: wheel in toward the batter.
await page.mouse.move(cx, cy);
const dBefore = await page.evaluate(() => window.__diorama.camera.position.distanceTo(window.__diorama.viewer.controls.target));
for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -240);
await page.waitForTimeout(600);
const dAfter = await page.evaluate(() => window.__diorama.camera.position.distanceTo(window.__diorama.viewer.controls.target));
check(dAfter < dBefore * 0.7, `wheel zooms in (${dBefore.toFixed(1)} m -> ${dAfter.toFixed(1)} m)`);
check(dAfter >= 4.99, `zoom respects the minimum distance (${dAfter.toFixed(2)} m)`);
await page.screenshot({ path: `${OUT}/2-zoomed.png` });

// Pan: right-drag, then make sure the orbit point is still on the slab.
await page.mouse.move(cx, cy);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 20; i++) await page.mouse.move(cx + i * 40, cy + i * 20);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(400);
const panned = await cam();
check(Math.abs(panned.t[0]) <= 20.001 && Math.abs(panned.t[2]) <= 7.001, `pan keeps the target on the slab (${panned.t.map((v) => v.toFixed(2)).join(', ')})`);

// Reset with R: back to the locked camera exactly.
await page.keyboard.press('r');
await page.waitForTimeout(700);
const back = await cam();
const err = Math.hypot(...back.p.map((v, i) => v - locked.p[i]));
check(err < 1e-3, `R resets to the locked view (residual ${err.toExponential(1)} m)`);
await page.screenshot({ path: `${OUT}/3-reset.png` });

// A close, low view of the contact for the record.
await page.evaluate(() => window.__diorama.playback.seek(30.0));
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 18, cy - i * 9);
await page.mouse.up();
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/4-catch-orbit.png` });

check(errors.length === 0, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
console.log(fails.length ? `viewer test failed (${fails.length})` : 'viewer test passed');
process.exit(fails.length ? 1 : 0);
