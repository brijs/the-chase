import { chromium } from 'playwright-core';

/**
 * Controller support with a simulated Stadia pad (standard mapping), since a
 * real one cannot be plugged into headless Chromium. Exit 1 on failure.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// A fake pad the page sees through navigator.getGamepads().
await context.addInitScript(() => {
  const pad = { id: 'Stadia Controller rev. A (STANDARD GAMEPAD Vendor: 18d1 Product: 9400)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 19 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
  window.__padSet = (btns = {}, axes = null) => {
    for (const [i, on] of Object.entries(btns)) pad.buttons[i] = { pressed: on, value: on ? 1 : 0 };
    if (axes) pad.axes = [...axes, 0, 0];
    pad.timestamp = performance.now();
  };
  window.__padConnect = () => { const e = new Event('gamepadconnected'); Object.defineProperty(e, 'gamepad', { value: pad }); window.dispatchEvent(e); };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
await page.goto(`${BASE}?mode=game&cards=0&manual=1&seed=4&ump=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
await page.evaluate(() => localStorage.removeItem('chase-gamepad-v1'));
// Each poll happens on a frame: step a frame after every change.
const press = async (btns, axes = null) => {
  await page.evaluate(({ btns, axes }) => { window.__padSet(btns, axes); window.__game.pad.poll(); }, { btns, axes });
};
const release = async () => press(Object.fromEntries([...Array(19).keys()].map((i) => [i, false])), [0, 0]);

await page.evaluate(() => window.__padConnect());
const toast = await page.evaluate(() => [...document.querySelectorAll('#hud .panel')].map((e) => e.textContent).find((t) => t.includes('connected')));
check(!!toast && toast.includes('Stadia'), `connect toast: "${toast?.trim()}"`);

// A on the intro card opens the toss; D-pad right calls tails; then straight into a chase.
await press({ 0: true }); await release();
await press({ 15: true, 0: true }); await release();
const tossed = await page.evaluate(() => ({ stage: window.__game.flow.stage, text: document.querySelector('#flow')?.innerText ?? '' }));
check(['flip', 'choose', 'aiChose'].includes(tossed.stage) && /tails/i.test(tossed.text), `A opens the toss, right + A calls tails (${tossed.stage})`);
await page.evaluate(() => { window.__game.flow.close(); window.__game.start(); });
check(await page.evaluate(() => window.__game.ctl.phase === 'live'), 'the match starts');

// A ball: D-pad down + left, then A -> cover drive, timed from the pad's timestamp.
const shot = async (btns, axes, mk) => {
  await page.evaluate(() => window.__game.until((c) => c.cur && !c.cur.resolved && c.t > c.cur.tR + 0.25, 30));
  await press(btns, axes);
  await press({ ...btns, [mk]: true }, axes);
  const inp = await page.evaluate(() => window.__game.ctl.cur.input);
  await release();
  await page.evaluate(() => window.__game.until((c) => c.cur.resolved && c.t > (c.nextT0 ?? 0), 40));
  return inp;
};
let inp = await shot({ 13: true, 14: true }, null, 0);
check(inp?.shotKey === 'cover' && inp.dirKey === 'DL', `D-pad ↓← + A -> ${inp?.shotKey}`);
inp = await shot({}, [-0.7, -0.7], 3);
check(inp?.dirKey === 'UL' && inp.lofted, `stick up-left + Y -> ${inp?.shotKey}, lofted ${inp?.lofted}`);
inp = await shot({}, [-0.9, 0.05], 2);
check(inp?.shotKey === 'reverseSweep', `stick left + X -> ${inp?.shotKey}`);
inp = await shot({}, [0.2, 0.2], 0);
check(inp?.dirKey === '', `stick inside the dead zone counts as no direction (${inp?.shotKey})`);

// Panel: Stadia button opens it; rebind "lofted" to R2.
await press({ 16: true }); await release();
check(await page.evaluate(() => window.__game.padPanel.isOpen && window.__game.ctl.phase === 'tuning'), 'Stadia button opens the Controller panel (game paused)');
await press({ 7: true });
const lit = await page.evaluate(() => document.querySelectorAll('#padp .live span.on').length);
check(lit === 1, 'live view lights the pressed button');
await release();
await page.click('#padp [data-rebind=lofted]');
await press({ 7: true }); await release();
const map = await page.evaluate(() => JSON.parse(localStorage.getItem('chase-gamepad-v1')).map);
check(map.lofted === 7, `rebind: lofted -> button ${map.lofted} (R2), saved`);
await page.screenshot({ path: 'qa/game/controller-panel.png' });
await press({ 16: true }); await release();
check(await page.evaluate(() => !window.__game.padPanel.isOpen), 'Stadia button closes it again');

// The mapping survives a reload.
await page.goto(`${BASE}?mode=game&cards=0&manual=1&seed=4&ump=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
check(await page.evaluate(() => window.__game.pad.settings.map.lofted === 7), 'mapping persists across a reload');
await page.evaluate(() => localStorage.removeItem('chase-gamepad-v1'));
check(errors.length === 0, errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
process.exit(fail ? 1 : 0);
