import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';

/**
 * Pixel fingerprint of the diorama at fixed clock times. Run before and after a
 * refactor: identical hashes prove the loop is untouched.
 *   BASE_URL  default http://127.0.0.1:4180/index.html
 *   TIMES     default "0,3,16.12,29.56,30,37"
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const TIMES = (process.env.TIMES || '0,3,16.12,29.56,30,37').split(',').map(Number);
const CHROME =
  process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(BASE_URL);
await page.waitForFunction(() => window.__dioramaReady === true, null, { timeout: 30000 });
for (const t of TIMES) {
  const url = await page.evaluate((t) => {
    window.__diorama.freeze(t);
    return document.getElementById('stage').toDataURL('image/png');
  }, t);
  console.log(`t=${t}`.padEnd(9), createHash('sha1').update(url).digest('hex').slice(0, 16));
}
await browser.close();
