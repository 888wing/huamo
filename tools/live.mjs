import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push('pageerror ' + e.message));
await page.goto('file://' + resolve('dist/index.html'));
await page.waitForFunction('window.__done === true', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
const f0 = (await page.evaluate(() => window.__state())).frame;
// drive it like a person: walk, switch forms, act, switch solver, open the drawer
await page.keyboard.down('KeyW'); await new Promise(r => setTimeout(r, 800));
await page.keyboard.press('Digit2'); await page.keyboard.down('KeyF'); await new Promise(r => setTimeout(r, 500)); await page.keyboard.up('KeyF');
await page.keyboard.press('Digit3'); await page.keyboard.down('Space'); await new Promise(r => setTimeout(r, 600)); await page.keyboard.up('Space');
await page.keyboard.press('Digit4'); await page.keyboard.press('KeyB'); await page.keyboard.press('Tab'); await page.keyboard.press('KeyT');
await new Promise(r => setTimeout(r, 1200)); await page.keyboard.up('KeyW');
const st = await page.evaluate(() => window.__state());
const hud = await page.evaluate(() => document.body.innerText.slice(0, 400));
console.log(JSON.stringify({ framesBefore: f0, framesAfter: st.frame, which: st.which, form: st.form, pos: st.p.map(v => +v.toFixed(1)), errs }));
console.log(hud);
await browser.close();
