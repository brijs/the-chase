import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

/**
 * Records what the crowd sounds like, from the game's own mix, into
 * qa/game/crowd-preview.wav: 5 s of the bed, then a cheer, an ooh, applause and
 * a roar. Also reports how long the voices take to render.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4180/index.html';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(`${BASE}?mode=game&seed=3&manual=1&cards=0`);
await page.waitForFunction(() => window.__dioramaReady === true);
const ms = await page.evaluate(() => { const t = performance.now(); window.__game.audio.ensure(); return performance.now() - t; });
console.log(`voices render on first key: ${ms.toFixed(0)} ms`);
const data = await page.evaluate(async () => {
  const a = window.__game.audio;
  await new Promise((r) => setTimeout(r, 600)); // the shout buffer renders just after
  const { ctx, out } = a.tap;
  const L = [], R = [];
  const sp = ctx.createScriptProcessor(4096, 2, 2);
  sp.onaudioprocess = (e) => { L.push(...e.inputBuffer.getChannelData(0)); R.push(...e.inputBuffer.getChannelData(1)); };
  out.connect(sp); sp.connect(ctx.destination);
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  await wait(5); a.play('cheer', { size: 0.7 }); await wait(4.5); a.play('ooh', { size: 0.7 }); await wait(3);
  a.play('applause', { size: 0.4 }); await wait(4); a.play('roar'); await wait(5.5);
  out.disconnect(sp);
  // A spectrogram (0-5 kHz) to eyeball: voices show as harmonic stacks and syllables, noise as a smear.
  const N = 1024, hop = 512, bins = 240, W = Math.floor((L.length - N) / hop);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = bins;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, bins);
  for (let x = 0; x < W; x++) {
    for (let k = 0; k < bins; k++) {
      const f = (k / bins) * 5000, w = (2 * Math.PI * f) / ctx.sampleRate;
      let re = 0, im = 0;
      for (let j = 0; j < N; j += 2) { const v = L[x * hop + j] * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N)); re += v * Math.cos(w * j); im -= v * Math.sin(w * j); }
      const db = 20 * Math.log10(Math.hypot(re, im) + 1e-6);
      const c = Math.max(0, Math.min(255, (db + 30) * 5));
      const o = ((bins - 1 - k) * W + x) * 4;
      img.data[o] = c; img.data[o + 1] = c * 0.8; img.data[o + 2] = 255 - c * 0.6; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  document.body.innerHTML = '';
  document.body.appendChild(cv);
  cv.id = 'spec';
  return { sr: ctx.sampleRate, L, R };
});
await page.locator('#spec').screenshot({ path: 'qa/game/crowd-spectrogram.png' });
await browser.close();
const n = data.L.length;
const buf = Buffer.alloc(44 + n * 4);
const w = (o, s) => buf.write(s, o);
w(0, 'RIFF'); buf.writeUInt32LE(36 + n * 4, 4); w(8, 'WAVE'); w(12, 'fmt ');
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(data.sr, 24);
buf.writeUInt32LE(data.sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); w(36, 'data'); buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data.L[i])) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data.R[i])) * 32767), 46 + i * 4);
}
await writeFile('qa/game/crowd-preview.wav', buf);
const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += data.L[i] ** 2; return Math.sqrt(s / (b - a)); };
const sec = (x) => Math.floor(x * data.sr);
console.log(`wrote qa/game/crowd-preview.wav (${(n / data.sr).toFixed(1)} s)`);
console.log(`RMS  bed ${rms(sec(1), sec(5)).toFixed(3)}  cheer ${rms(sec(5.5), sec(8)).toFixed(3)}  roar ${rms(sec(17), sec(20)).toFixed(3)}`);
