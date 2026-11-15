// Runs one way onto the giant's head and reports when each stage was reached, which beasts it took, and whether it died.
// usage: node tools/check-climb.mjs [climb|wing|gate|pillar] [seconds]   (climb: the tiger alone; wing: the crane alone; gate: the carp alone)
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
const S = await page.evaluate(async n => { const out = []; for (let i = 0; i < n; i++) { await window.__advance(2); const s = window.__state(); out.push({ boss: s.boss, ride: s.ride, stab: s.stab, raise: s.raise, hint: s.hint, crown: s.parts?.crown?.[1] ?? 0, form: s.form, plunge: s.plunge, pinned: s.pinned, hp: s.hp, y: s.p[1], ink: s.ink, ended: s.ended, cine: s.cine }); } return out; }, secs * 30);
const at = f => { const i = S.findIndex(f); return i < 0 ? null : i / 30; }, show = (name, v) => v == null ? null : `${name} ${v.toFixed(1)} s`;
const T = { wake: at(s => s.boss !== 'sleep'), pinned: at(s => s.pinned), tiger: at(s => s.form === 1), arm: at(s => s.ride === 'arm'), rock: at(s => s.ride === 'rock'), leap: at(s => s.ride === 'leap'), 'on head': at(s => s.ride === 'head' && s.stab < 0), raise: at(s => s.raise > 0),
  carp: at(s => s.form === 3), thrown: at(s => s.form === 3 && s.y > 5), crane: at(s => s.form === 2), stab: at(s => s.boss === 'dying'), dead: at(s => s.boss === 'dead'), ended: at(s => s.ended) };
console.log(Object.entries(T).map(([k, v]) => show(k, v)).filter(Boolean).join(' | '));
const start = T.tiger ?? T.crane ?? T.carp, end = T.stab == null ? S.length : Math.round(T.stab * 30);
const used = [...new Set(S.slice(0, end + 1).map(s => s.form).filter(f => f))].map(f => ['', 'tiger', 'crane', 'carp'][f]);
console.log('beasts used up to the stab:', used.join(', ') || 'none', '| hints seen:', [...new Set(S.map(s => s.hint).filter(Boolean))].join(' / '));
console.log(T.stab != null ? `KILLED: from the change of form to the sword in its head ${(T.stab - start).toFixed(1)} s; health left ${S.at(-1).hp}; highest point ${Math.max(...S.map(s => s.y)).toFixed(1)} m` : `NOT killed in ${secs} s (giant: ${S.at(-1).boss}, health ${S.at(-1).hp})`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
