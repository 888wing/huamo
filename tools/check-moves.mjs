// Runs the moves demo frame by frame and measures the motion: how far a planted foot slides, how far and how long each
// dodge goes, how high the two jumps reach, how long a throw keeps the player down. usage: node tools/check-moves.mjs
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1&demo=moves');
await page.waitForFunction('window.__done === true', { timeout: 60000 });
// one state per frame, gathered in the page so the run is not thousands of round trips
const S = await page.evaluate(async n => { const out = []; for (let i = 0; i < n; i++) { await window.__advance(1); const s = window.__state(); out.push({ step: s.step, p: [...s.p], vy: s.vy, ground: s.ground, dodge: s.dodge, invuln: s.invuln, ko: s.ko, plunge: s.plunge, fallen: s.fallen, ik: s.hero.ik, feet: s.hero.feet }); } return out; }, 42 * 60);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
// a planted foot should not move: the worst and the mean slide per stance, while the legs are fully on their planted points
const slides = []; let worst = 0, where = '';
for (const i of [0, 1]) { let start = null, travelled = 0;
  for (let k = 30; k < S.length; k++) { // (the first half second is the figure settling where it was put)
    const a = S[k - 1], b = S[k], on = a.ik > .97 && b.ik > .97 && a.feet[i].planted && b.feet[i].planted && !b.fallen;
    if (on) { travelled += Math.hypot(b.feet[i].x - a.feet[i].x, b.feet[i].z - a.feet[i].z); start ??= k; }
    else if (start !== null) { if (k - start > 3) { slides.push(travelled); if (travelled > worst) { worst = travelled; where = `${S[start].step} at ${(start / 60).toFixed(2)} s`; } } start = null; travelled = 0; }
  } }
const mean = slides.reduce((a, b) => a + b, 0) / Math.max(1, slides.length);
console.log(`planted feet: ${slides.length} stances, mean slide ${(mean * 100).toFixed(1)} cm, worst ${(worst * 100).toFixed(1)} cm (${where}); stances over 3 cm: ${slides.filter(x => x > .03).length}`);
// dodges: distance and time from the first frame of the dodge to its last, and for how many frames a blow would have missed
let k = 0; const runs = [];
while (k < S.length) { if (S[k].dodge > 0) { const a = k; while (k < S.length && S[k].dodge > 0) k++; runs.push({ step: S[a].step === '-' ? S[a - 1]?.step : S[a].step, d: dist(S[a - 1].p, S[k].p), t: (k - a) / 60, safe: S.slice(a, k).filter(s => s.invuln).length / 60 }); } else k++; }
for (const r of runs) console.log(`dodge (${r.step}): ${r.d.toFixed(2)} m in ${r.t.toFixed(2)} s, untouchable for ${r.safe.toFixed(2)} s`);
// jumps: the highest the feet got above where they left the ground
const air = []; k = 0;
while (k < S.length) { if (!S[k].ground && !S[k].ko && !S[k].fallen) { const a = k, y0 = S[Math.max(0, k - 1)].p[1]; let top = 0, stab = false; while (k < S.length && !S[k].ground) { top = Math.max(top, S[k].p[1] - y0); stab ||= S[k].plunge > 0; k++; } if (top > .2) air.push(`${top.toFixed(2)} m, ${((k - a) / 60).toFixed(2)} s in the air${stab ? ' (ends in the stab)' : ''}`); } else k++; }
console.log('jumps: ' + air.join(' | '));
// throws: how long from the blow until the player is back in control
k = 0; const kos = [];
while (k < S.length) { if (S[k].ko) { const a = k; while (k < S.length && S[k].ko) k++; kos.push(((k - a) / 60).toFixed(2) + ' s'); } else k++; }
console.log('thrown, time out of control: ' + kos.join(' | '));
const dead = S.findIndex(s => s.fallen > 0), back = S.findIndex((s, i) => i > dead && !(s.fallen > 0));
console.log(`death to standing again: ${((back - dead) / 60).toFixed(2)} s`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
