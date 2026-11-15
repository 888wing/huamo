// Plays the page in real time (not stepped) with real key presses, at the size of a real window, and reports how
// evenly frames arrive: the checks that step the page by hand cannot see hitches, slow frames or a display that is
// not 60 Hz. Also says whether walking in through the curtain woke the giant.
// usage: node tools/realtime.mjs [width=1512] [height=860] [device pixel ratio=2] [seconds of fighting=30] [query="?boss"]
// FAST=1: the display's rate limit off, as a stand-in for a display faster than 60 Hz. WALK=9: seconds to hold W at the start.
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const [w, h, dpr, secs] = [1512, 860, 2, 30].map((d, i) => +(process.argv[2 + i] ?? d)), query = process.argv[6] ?? '?boss';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`, ...(process.env.FAST ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])], defaultViewport: { width: w, height: h, deviceScaleFactor: dpr } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(e.message));
await page.evaluateOnNewDocument(() => { window.__ft = []; let last = 0; const loop = t => { if (last) window.__ft.push([t, t - last]); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const t0 = Date.now();
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + query);
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const boot = Date.now() - t0, wait = ms => new Promise(r => setTimeout(r, ms)), state = () => page.evaluate(() => { const s = window.__state(); return { boss: s.boss, hp: s.bossHp, me: s.hp, p: s.p.map(x => +x.toFixed(1)), cine: s.cine, frame: s.frame, clock: +s.clock.toFixed(2) }; });
const info = await page.evaluate(() => ({ css: [innerWidth, innerHeight], dpr: devicePixelRatio, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height] }));
console.log(`window ${info.css.join('x')} CSS px at pixel ratio ${info.dpr}: the picture is drawn at ${info.canvas.join('x')} (${(info.canvas[0] * info.canvas[1] / 1e6).toFixed(2)} million pixels); page ready after ${(boot / 1000).toFixed(1)} s`);
await wait(1500); await page.evaluate(() => { window.__ft.length = 0; });
const marks = [], mark = async name => marks.push([name, await page.evaluate(() => performance.now())]);
// walk in through the curtain
await mark('walk in'); const before = await state(); const walk = +(process.env.WALK ?? 2.5); await page.keyboard.down('KeyW'); await wait(walk * 1000); await page.keyboard.up('KeyW'); const after = await state();
console.log(`walking forward ${walk} s with W: from ${before.p[0]},${before.p[2]} (giant ${before.boss}) to ${after.p[0]},${after.p[2]} (giant ${after.boss}${after.cine ? ', staged: ' + after.cine : ''})  =>  the curtain ${after.boss !== 'sleep' ? 'WOKE it' : 'did NOT wake it'}`);
await mark('entrance'); await wait(6000);
// a bout by rote: cuts, jumps, rolls, moving about
await mark('bout'); const end = Date.now() + secs * 1000; let i = 0;
while (Date.now() < end) {
  const k = ['KeyF', 'KeyF', 'KeyF', 'Space', 'KeyF', 'KeyF', 'ShiftLeft', 'KeyF'][i % 8], mv = ['KeyW', 'KeyA', 'KeyW', 'KeyD', 'KeyS'][Math.floor(i / 5) % 5];
  await page.keyboard.down(mv); await page.keyboard.down(k); await wait(70); await page.keyboard.up(k); await wait(260); await page.keyboard.up(mv); i++;
}
await mark('end'); const last = await state();
const ft = await page.evaluate(() => window.__ft);
const report = (name, a, b) => {
  const d = ft.filter(([t]) => t >= a && t < b).map(f => f[1]).sort((x, y) => x - y); if (!d.length) return;
  const q = p => d[Math.min(d.length - 1, Math.floor(d.length * p))], sum = d.reduce((x, y) => x + y, 0), over = ms => d.filter(x => x > ms).length;
  console.log(`${name.padEnd(9)} ${(d.length / sum * 1000).toFixed(1)} fps | frame time median ${q(.5).toFixed(1)} ms, 95 % under ${q(.95).toFixed(1)}, 99 % under ${q(.99).toFixed(1)}, worst ${d.at(-1).toFixed(0)} ms | frames over 20 ms: ${over(20)} of ${d.length} (${(over(20) / d.length * 100).toFixed(1)} %), over 34 ms: ${over(34)}, over 50 ms: ${over(50)}`);
};
for (let j = 0; j < marks.length - 1; j++) report(marks[j][0], marks[j][1], marks[j + 1][1]);
const worst = ft.filter(f => f[1] > 34).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, d]) => `${d.toFixed(0)} ms at ${((t - marks[0][1]) / 1000).toFixed(1)} s (${marks.filter(m => m[1] <= t).at(-1)?.[0] ?? 'before'})`);
console.log('longest hitches:', worst.join('; ') || 'none over 34 ms');
const real = (marks.at(-1)[1] - marks[0][1]) / 1000;
console.log(`picture ratio at the end: ${(await page.evaluate(() => window.__state().ratio))}`);
console.log(`game clock advanced ${(last.clock - before.clock).toFixed(1)} s in ${real.toFixed(1)} s of real time (${((last.clock - before.clock) / real * 100).toFixed(0)} % speed; hit pauses and slow motion account for some of the difference); giant ${last.boss} ${last.hp}, player health ${last.me}`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
