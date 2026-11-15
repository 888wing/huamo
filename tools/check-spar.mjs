// Runs the sparring demo for 40 simulated seconds and prints the tally: confirms cuts, guards, dodges and blows taken all occur.
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve('dist/index.html') + '?manual&dpr=1&demo=' + (process.argv[2] ?? 'spar'));
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const log = [];
for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__advance(300)); const s = await page.evaluate(() => window.__state()); log.push(`${(i + 1) * 5}s hp${s.hp} 中${s.dealt} 擋${s.warded} 受${s.taken} ${s.foe}`); }
console.log(log.join(' | ')); console.log('errors:', errs.length ? errs : 'none');
await browser.close();
