// Whole-frame cost (simulation + render, GPU drained every frame, no vsync) while the tour demo is running.
// usage: node tools/bench.mjs [dist/index.html] ["&extra=query"]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const file = process.argv[2] ?? 'dist/index.html', extra = process.argv[3] ?? '';
const out = [];
for (const [w, h] of [[1280, 720], [1920, 1080]]) for (const sim of ["A"]) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgpu-developer-features', `--window-size=${w},${h}`],
    defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror] ' + e.message));
  await page.goto('file://' + resolve(file) + `?manual&dpr=1&demo=tour&timing&sim=${sim}${extra}`);
  await page.waitForFunction('window.__done === true', { timeout: 60000 });
  await page.evaluate(() => window.__advance(150));
  const frame = await page.evaluate(() => window.__bench(240));
  const st = await page.evaluate(() => window.__state());
  const simMs = st.ms ? Object.values(st.ms).reduce((a, b) => a + b, 0) : NaN;
  out.push({ size: `${w}x${h}`, sim, frameMs: +frame.toFixed(2), simMs: +simMs.toFixed(2), restMs: +(frame - simMs).toFixed(2), stages: st.ms });
  await browser.close();
}
for (const o of out) console.log(`${o.size} ${o.sim}: frame ${o.frameMs} ms (sim ${o.simMs} + render/other ${o.restMs})  ${JSON.stringify(o.stages)}`);
