// Runs one of the three ways onto the giant's head and reports when each stage was reached and whether it died.
// usage: node tools/check-climb.mjs [climb|pillar|gate] [seconds]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const demo = process.argv[2] ?? 'climb', secs = +(process.argv[3] ?? 70);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1&boss&demo=' + demo);
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const S = await page.evaluate(async n => { const out = []; for (let i = 0; i < n; i++) { await window.__advance(2); const s = window.__state(); out.push({ boss: s.boss, ride: s.ride, form: s.form, plunge: s.plunge, pinned: s.pinned, hp: s.hp, y: s.p[1], ink: s.ink, ended: s.ended, cine: s.cine }); } return out; }, secs * 30);
const at = f => { const i = S.findIndex(f); return i < 0 ? null : i / 30; }, show = (name, v) => v == null ? null : `${name} ${v.toFixed(1)} s`;
const T = { wake: at(s => s.boss !== 'sleep'), pinned: at(s => s.pinned), tiger: at(s => s.form === 1), arm: at(s => s.ride === 'arm'), rock: at(s => s.ride === 'rock'), shoulder: at(s => s.ride === 'shoulder'),
  carp: at(s => s.form === 3), thrown: at(s => s.form === 3 && s.y > 5), crane: at(s => s.form === 2), stab: at(s => s.ride === 'head'), dead: at(s => s.boss === 'dead'), ended: at(s => s.ended) };
console.log(Object.entries(T).map(([k, v]) => show(k, v)).filter(Boolean).join(' | '));
const start = T.pinned ?? T.rock ?? T.carp;
console.log(T.stab != null ? `KILLED: from the first step of the way up to the sword in its head ${(T.stab - start).toFixed(1)} s; health left ${S.at(-1).hp}; highest point ${Math.max(...S.map(s => s.y)).toFixed(1)} m` : `NOT killed in ${secs} s (giant: ${S.at(-1).boss}, health ${S.at(-1).hp})`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
