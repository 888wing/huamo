// Opens a built page in system Chrome (headless, real GPU) and reports console output, window.__report and screenshots.
// usage: node tools/run.mjs dist/index.html "?query" [--shot=out.png] [--wait=ms] [--size=1280x720] [--headed]
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const [file, query = ''] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const [w, h] = (opt('size') ?? '1280x720').split('x').map(Number);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: !process.argv.includes('--headed'),
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist',
    '--enable-webgpu-developer-features', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--window-size=${w},${h}`, '--allow-file-access-from-files'],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', m => console.log(`[${m.type()}] ${m.text()}`.slice(0, 1500)));
page.on('pageerror', e => console.log('[pageerror] ' + (e.stack || e.message || e)));
await page.goto('file://' + resolve(file) + query);
const wait = Number(opt('wait') ?? 4000);
try { await page.waitForFunction('window.__done === true', { timeout: wait }); } catch { console.log('(no __done within ' + wait + ' ms)'); }
const rep = await page.evaluate(() => window.__report ?? null);
if (rep) { console.log('REPORT ' + JSON.stringify(rep, null, 1)); if (opt('json')) writeFileSync(opt('json'), JSON.stringify(rep, null, 1)); }
if (opt('shot')) await page.screenshot({ path: opt('shot') });
await browser.close();
