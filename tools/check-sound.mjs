// Renders every voice of src/sound.js offline in the page and prints how loud and how long each is.
// A voice that is silent, or whose raw peak is far over 1 (it would lean on the limiter), is flagged. It cannot say how they sound.
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1');
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const names = await page.evaluate(() => window.__voices); let bad = 0;
for (const n of names) { const r = await page.evaluate(k => window.__sound(k), n), flag = r.peak < .02 ? '  SILENT' : r.peak > 1.25 ? '  TOO LOUD' : ''; if (flag) bad++; console.log(`${n.padEnd(8)} peak ${r.peak.toFixed(2)}  rms ${r.rms.toFixed(3)}  ${r.seconds.toFixed(2)} s${flag}`); }
console.log(`${names.length} voices, ${bad} flagged`);
// and live: a key press starts the audio, then the kill by the arm is played through with every sound it sets off
const live = await browser.newPage(); live.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); }); live.on('pageerror', e => errs.push(e.message));
await live.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1&boss&demo=fin&finish=tiger');
await live.waitForFunction('window.__done === true', { timeout: 60000 }); await live.keyboard.press('KeyZ');
await live.evaluate(() => window.__advance(60 * 26)); const st = await live.evaluate(() => window.__state());
console.log(`live: audio running ${st.sound}, the kill played through to "${st.boss}"${st.ended ? ', end card up' : ''}`); console.log('errors:', errs.length ? errs : 'none');
await browser.close();
