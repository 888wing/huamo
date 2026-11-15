// Whole-frame cost in the middle of the giant's bout at the size of a real window, for several pixel ratios.
// usage: node tools/cost.mjs [width=1512] [height=860] [ratios=1.5,1.25,1,0.85]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const w = +(process.argv[2] ?? 1512), h = +(process.argv[3] ?? 860), ratios = (process.argv[4] ?? '1.5,1.25,1,0.85').split(',').map(Number);
for (const r of ratios) {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgpu-developer-features', `--window-size=${w},${h}`], defaultViewport: { width: w, height: h, deviceScaleFactor: 2 } });
  const page = await browser.newPage(); page.on('pageerror', e => console.log('[pageerror] ' + e.message));
  await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + `?manual&boss&demo=bout&timing&dpr=${r}`);
  await page.waitForFunction('window.__done === true', { timeout: 60000 });
  await page.evaluate(() => window.__advance(900));           // fifteen seconds in: the bout is on
  const frame = await page.evaluate(() => window.__bench(180)), st = await page.evaluate(() => window.__state()), c = await page.evaluate(() => [document.querySelector('canvas').width, document.querySelector('canvas').height]);
  const simMs = st.ms ? Object.values(st.ms).reduce((a, b) => a + b, 0) : NaN;
  console.log(`ratio ${r}: ${c.join('x')} (${(c[0] * c[1] / 1e6).toFixed(2)} MP)  frame ${frame.toFixed(1)} ms  (simulation ${simMs.toFixed(1)} + picture and the rest ${(frame - simMs).toFixed(1)})  =>  ${frame < 16.7 ? 'fits 60 fps' : frame < 33.3 ? 'misses 60 fps' : 'misses 30 fps'}`);
  await browser.close();
}
