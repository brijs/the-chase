import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Standalone gate: open the inlined HTML over file:// (no server), require zero
 * console/page errors, prove the loop is alive (two frames 1.5 s apart differ)
 * and the camera is locked (identical position in both).
 */
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const file = pathToFileURL(resolve(process.argv[2] || 'short-ball.html')).href;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(file);
await page.waitForFunction(() => window.__dioramaReady === true, null, { timeout: 30000 });
const a = await page.evaluate(() => { window.__diorama.freeze(10.0); return window.__diorama.camera.position.toArray(); });
const shotA = await page.locator('#stage').screenshot({ path: 'shots/final/standalone-10.0.png' });
const b = await page.evaluate(() => { window.__diorama.freeze(11.5); return window.__diorama.camera.position.toArray(); });
const shotB = await page.locator('#stage').screenshot({ path: 'shots/final/standalone-11.5.png' });
let diff = 0;
for (let i = 0; i < Math.min(shotA.length, shotB.length); i++) if (shotA[i] !== shotB[i]) diff++;
const camSame = a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
console.log(`file:// ${file}`);
console.log(`camera ${a.map((v) => v.toFixed(3)).join(',')} vs ${b.map((v) => v.toFixed(3)).join(',')} -> ${camSame ? 'locked' : 'MOVED'}`);
console.log(`frames 10.0 vs 11.5 differ in ${diff} PNG bytes -> ${diff > 0 ? 'alive' : 'FROZEN'}`);
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
process.exit(errors.length || !camSame || diff === 0 ? 1 : 0);
