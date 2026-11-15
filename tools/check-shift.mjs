// Runs the shift demo frame by frame and measures the changes of form: which form when, how long a full gauge lasts,
// how fast it comes back, whether speed carries across a change, and that a change is refused when the ink is low.
// usage: node tools/check-shift.mjs
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { SHIFT_SEQ } from '../src/demos.js';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1&demo=shift');
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const total = SHIFT_SEQ.reduce((a, [, d]) => a + d, 0);
const S = await page.evaluate(async n => { const out = []; for (let i = 0; i < n; i++) { await window.__advance(1); const s = window.__state(); out.push({ step: s.step, form: s.form, ink: s.ink, v: s.v, p: [...s.p], ground: s.ground, plunge: s.plunge, combo: s.combo, attack: s.attack }); } return out; }, Math.round(total * 60));
const names = ['swordsman', 'tiger', 'crane', 'carp'], sp = s => Math.hypot(s.v[0], s.v[2]);
// every stretch as a beast: how long, how much ink it took, and what came out of it
let k = 1; const runs = [];
while (k < S.length) {
  if (S[k].form !== 0 && S[k - 1].form === 0) {
    const a = k, inkIn = S[k - 1].ink, v0 = sp(S[k - 1]), v1 = sp(S[k]); while (k < S.length && S[k].form !== 0) k++;
    const out = S[Math.min(S.length - 1, k + 2)], move = out.plunge ? 'the stab' : out.attack >= 0 ? ['the cut', 'the rising cut', 'the overhead cut'][out.combo] : 'nothing (ink ran out)';
    runs.push({ form: names[S[a].form], t: (k - a) / 60, inkIn, inkOut: S[Math.min(S.length - 1, k)].ink, carry: v0 > .5 ? v1 / v0 : 1, move });
  } else k++;
}
for (const r of runs) console.log(`${r.form}: ${r.t.toFixed(2)} s, ink ${r.inkIn.toFixed(2)} -> ${r.inkOut.toFixed(2)}, speed carried over the change ${(r.carry * 100).toFixed(0)} %, came out with ${r.move}`);
const full = runs.find(r => r.inkIn > .999 && r.inkOut < .01);
console.log(full ? `a full gauge lasts ${full.t.toFixed(3)} s as a beast (${Math.round(full.t * 60)} frames; 5 s is 300)` : 'no run from a full gauge to empty');
// the gauge coming back: ink per second over a stretch as the swordsman with no cuts landing
let best = 0, from = 0; for (let i = 1, a = 0; i < S.length; i++) { if (S[i].form !== 0 || S[i].ink >= 1 || S[i].ink < S[i - 1].ink) a = i; else if (i - a > best) { best = i - a; from = a; } }
console.log(`ink comes back at ${((S[from + best].ink - S[from].ink) / (best / 60)).toFixed(4)} per second (1/8 = 0.1250), measured over ${(best / 60).toFixed(1)} s`);
// the last two jumps in the list are pressed with too little ink: the form must stay the swordsman's
const lastOut = S.findLastIndex(s => s.form !== 0), after = S.slice(lastOut + 1), presses = after.filter((s, i) => i > 0 && s.step === 'jump' && after[i - 1].step !== 'jump');
console.log(`after the ink ran out: jump pressed again in the air with ink at ${presses.at(-1)?.ink.toFixed(2)} (a change needs 0.33), changed form: ${after.some(s => s.form !== 0) ? 'YES (wrong)' : 'no'}`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
