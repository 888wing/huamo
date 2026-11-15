// Prints what the giant and the player are doing, a line every few frames of a demo. For finding out why a scripted run went wrong.
// usage: node tools/trace.mjs [demo=climb] [seconds=30] [from second=0] [frames per line=6] [extra query, e.g. "&nostab"]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const demo = process.argv[2] ?? 'climb', secs = +(process.argv[3] ?? 30), from = +(process.argv[4] ?? 0), every = +(process.argv[5] ?? 6), extra = process.argv[6] ?? '';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); page.on('pageerror', e => console.log('ERR', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 200)); });
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1&boss&demo=' + demo + extra);
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const S = await page.evaluate(async (n, every) => { const out = []; for (let i = 0; i < n; i++) { await window.__advance(every); const s = window.__state(), c = s.parts?.crown;
  out.push([(s.frame / 60).toFixed(2), s.boss, 'form' + s.form, s.ride ?? '-', 'hp' + s.hp, 'ink' + s.ink.toFixed(2), 'dodge' + Math.max(0, s.dodge).toFixed(2), 'ko' + s.ko, 'plunge' + s.plunge, 'y' + s.p[1].toFixed(1),
    c ? 'crown y' + c[1].toFixed(1) + ' away ' + Math.hypot(c[0] - s.p[0], c[2] - s.p[2]).toFixed(1) : '', s.planted ? 'hand down' : '', s.ground ? 'ground' : 'air'].join(' ')); } return out; }, Math.round(secs * 60 / every), every);
console.log(S.filter(l => +l.split(' ')[0] >= from).join('\n'));
await browser.close();
