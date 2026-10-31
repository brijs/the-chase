import { chromium } from 'playwright-core';

/**
 * Sound and the read, in real time: Enter starts (the gesture that unlocks
 * audio), the bot bats for ~40 s. Checks that the read shows before release
 * and is gone at release, that sounds fire for the key moments, and that the
 * output is actually non-silent. Writes qa/game/read.png.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&seed=21&bot=1`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.keyboard.press('m'); await page.keyboard.press('m'); // gesture; mute toggles twice -> on
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
await page.waitForFunction(() => { const c = window.__game.ctl; return c.cur && c.cur.preview && c.t > c.cur.preview.t0 + 0.6; }, null, { timeout: 20000 });
const during = await page.evaluate(() => ({ next: document.querySelector('#hud-next').classList.contains('on'), txt: document.querySelector('#hud-next').textContent, lead: +(window.__game.ctl.cur.tR - window.__game.ctl.cur.preview.t0).toFixed(2), hide: +(window.__game.ctl.cur.tR - window.__game.ctl.cur.preview.t1).toFixed(2) }));
await page.screenshot({ path: 'qa/game/read.png' });
check(during.next, `read shows during the run-up: "${during.txt}" (from ${during.lead}s before release, hidden ${during.hide}s before)`);
await page.waitForFunction(() => { const c = window.__game.ctl; return c.t > c.cur.tR + 0.02; });
const at = await page.evaluate(() => document.querySelector('#hud-next').classList.contains('on'));
check(!at, 'read is gone by release');
let peak = 0;
for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); peak = Math.max(peak, await page.evaluate(() => window.__game.audio.level())); }
const played = await page.evaluate(() => window.__game.audio.played);
console.log('       played:', JSON.stringify(played));
check(['step', 'grunt', 'bounce'].every((k) => played[k] > 0) && (played.bat || played.edge), 'run-up, grunt, bounce and bat sounds fired');
check(peak > 0.01, `output is audible (peak RMS ${peak.toFixed(3)})`);
check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
