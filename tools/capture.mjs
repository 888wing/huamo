// Steps the page deterministically and saves frames, a contact sheet and (optionally) an mp4.
// usage: node tools/capture.mjs "?demo=slash" out/slash [--frames=12] [--every=10] [--size=960x540] [--mp4|--video-only] [--set='{"view":"slice"}'] [--probe]
import puppeteer from 'puppeteer-core';
import { dirname, resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
const [query, out] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const [w, h] = opt('size', '960x540').split('x').map(Number);
const frames = +opt('frames', 12), every = +opt('every', 10), file = opt('file', 'dist/index.html');
const videoOnly = process.argv.includes('--video-only');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgpu-developer-features', `--window-size=${w},${h}`],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', m => { if (m.type() !== 'log') console.log(`[${m.type()}] ${m.text()}`.slice(0, 800)); });
page.on('pageerror', e => console.log('[pageerror] ' + (e.stack || e.message || e)));
await page.goto('file://' + resolve(file) + query + (query.includes('?') ? '&' : '?') + 'manual&dpr=1');
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const err = await page.evaluate(() => window.__report?.error);
if (err) { console.log(err); await browser.close(); process.exit(1); }
if (opt('set')) await page.evaluate(o => window.__set(o), JSON.parse(opt('set')));
if (opt('skip')) await page.evaluate(k => window.__advance(k), +opt('skip'));
if (videoOnly) {
  mkdirSync(dirname(out), { recursive: true });
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(60 / every), '-vcodec', 'mjpeg',
    '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', out + '.mp4',
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exited with ' + code)));
  });
  async function* screenshots() {
    for (let i = 0; i < frames; i++) {
      await page.evaluate(k => window.__advance(k), every);
      yield await page.screenshot({ type: 'jpeg', quality: 95 });
      if ((i + 1) % 150 === 0) console.log(`captured ${i + 1}/${frames} frames`);
    }
  }
  try {
    await Promise.all([done, pipeline(screenshots(), ffmpeg.stdin)]);
  } finally {
    ffmpeg.kill();
    await browser.close();
  }
  console.log('wrote ' + out + '.mp4');
  process.exit(0);
}
const dir = out + '_frames'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
for (let i = 0; i < frames; i++) {
  await page.evaluate(k => window.__advance(k), every);
  await page.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.png` });
}
if (process.argv.includes('--probe')) { const r = await page.evaluate(() => window.__probe()); console.log('PROBE ' + JSON.stringify(r)); writeFileSync(out + '.probe.json', JSON.stringify(r)); }
await browser.close();
const cols = Math.min(frames, +opt('cols', 4)), rows = Math.ceil(frames / cols), tw = Math.round(+opt('tile', 480));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${dir}/%04d.png`, '-vf', `scale=${tw}:-1,tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', out + '.png']);
if (process.argv.includes('--mp4')) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(60 / every), '-i', `${dir}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out + '.mp4']);
console.log('wrote ' + out + '.png');
