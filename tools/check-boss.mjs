// Runs the giant demo for 60 simulated seconds: prints what the giant did, how far its planted hand lands from where
// it aimed, how low its feet sit, and the tally. usage: node tools/check-boss.mjs [seconds]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/index.html') + '?manual&dpr=1&boss&demo=' + (process.argv[3] ?? 'boss'));
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const secs = +(process.argv[2] ?? 60), modes = {}, log = []; let worst = 0, n = 0, prev = '', lowFoot = 1e9, highFoot = -1e9;
for (let i = 0; i < secs * 12; i++) {
  await page.evaluate(() => window.__advance(5));
  const s = await page.evaluate(() => window.__state());
  modes[s.boss] = (modes[s.boss] ?? 0) + 1;
  if (s.boss !== prev) { log.push(`${(i / 12).toFixed(1)}s ${s.boss}`); prev = s.boss; }
  if (s.planted && s.parts) { const h = s.parts[s.side > 0 ? 'handL' : 'handR'], d = Math.hypot(h[0] - s.target[0], h[1] - s.target[1], h[2] - s.target[2]); worst = Math.max(worst, d); n++; }
  if (s.parts && s.foot) { lowFoot = Math.min(lowFoot, ...s.foot); highFoot = Math.max(highFoot, Math.min(...s.foot)); }
  if (i === secs * 12 - 1) console.log(`end: hp${s.hp} 中${s.dealt} 受${s.taken} boss=${s.boss} player=${s.p.map(v => v.toFixed(1))}`);
}
console.log(log.join(' | '));
console.log('time in each mode (1/12 s):', JSON.stringify(modes));
console.log(`planted hand: ${n} samples, furthest from its aim ${worst.toFixed(2)} m (the palm centre rides ~0.4 m above the ground point)`);
console.log(`sole height above ground: lowest foot between ${lowFoot.toFixed(2)} and ${highFoot.toFixed(2)} m`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
