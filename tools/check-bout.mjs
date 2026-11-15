// Fights the giant from the curtain to the end card and reports the shape of the bout: when it woke, when it turned
// (half its health gone), when it was beaten, which beast ended it and how long that took, and what the player had left.
// usage: node tools/check-bout.mjs [bout|fin|stand] [seconds] [tiger|crane|carp]     (fin: the giant starts one cut from
// beaten; stand: a player who does not defend, to see the swordsman cut down and the bout begin again)
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const demo = process.argv[2] ?? 'bout', secs = +(process.argv[3] ?? 120), finish = process.argv[4];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } });
const page = await browser.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + resolve(process.env.PAGE ?? 'dist/smoke-procedural.html') + '?manual&dpr=1&boss&demo=' + demo + (finish ? '&finish=' + finish : ''));
await page.waitForFunction('window.__done === true', { timeout: 60000 });
const S = await page.evaluate(async n => { const out = []; for (let i = 0; i < n; i++) { await window.__advance(2); const s = window.__state();
  out.push({ boss: s.boss, hp: s.bossHp, max: s.bossMax, phase: s.phase, fin: s.fin, ride: s.ride, form: s.form, me: s.hp, band: s.band, cine: s.cine, ended: s.ended, taken: s.taken, dealt: s.dealt });
  if (s.ended && out.length > 120 && out.at(-120).ended) break; } return out; }, secs * 30);
const at = f => { const i = S.findIndex(f); return i < 0 ? null : i / 30; }, show = (name, v) => v == null ? null : `${name} ${v.toFixed(1)} s`;
const T = { wake: at(s => s.boss !== 'sleep'), 'bout begins': at(s => s.boss !== 'sleep' && s.boss !== 'rise'), 'first blood': at(s => s.hp < s.max), turns: at(s => s.boss === 'rage'), beaten: at(s => s.hp <= 0),
  stab: at(s => s.boss === 'dying'), dead: at(s => s.boss === 'dead'), 'band (won)': at(s => s.band === 'won'), ended: at(s => s.ended) };
console.log(Object.entries(T).map(([k, v]) => show(k, v)).filter(Boolean).join(' | '));
const modes = {}; for (const s of S) modes[s.boss] = (modes[s.boss] ?? 0) + 1;
console.log('time in each mode (s):', Object.entries(modes).map(([k, v]) => `${k} ${(v / 30).toFixed(1)}`).join(', '));
const tookIn = {}; S.forEach((s, i) => { if (i && s.taken > S[i - 1].taken) { const k = `${S[i - 1].boss} (phase ${S[i - 1].phase})`; tookIn[k] = (tookIn[k] ?? 0) + 1; } });
console.log('blows taken during:', Object.entries(tookIn).map(([k, v]) => `${k} x${v}`).join(', ') || 'none');
const deaths = S.filter((s, i) => s.band === 'dead' && S[i - 1]?.band !== 'dead').length, resets = S.filter((s, i) => i && s.hp > S[i - 1].hp).length;
if (T.beaten != null) {
  const i0 = Math.round(T.beaten * 30), used = [...new Set(S.slice(i0).map(s => s.form).filter(f => f))].map(f => ['', 'tiger', 'crane', 'carp'][f]);
  console.log(`BEATEN after ${(T.beaten - T['bout begins']).toFixed(1)} s of fighting (it turned ${T.turns == null ? "never" : (T.turns - T["bout begins"]).toFixed(1) + " s in"}); the end was the ${S[i0 + 2]?.fin ?? S[i0]?.fin}'s (beasts seen in it: ${used.join(', ') || 'none'}); `
    + (T.stab != null ? `beaten to the sword in its head ${(T.stab - T.beaten).toFixed(1)} s` : 'THE END WAS NOT REACHED') + `; player's health left ${S.at(-1).me}, blows taken ${S.at(-1).taken}, cut down ${deaths} time(s)`);
} else console.log(`NOT beaten in ${secs} s: giant ${S.at(-1).hp}/${S.at(-1).max} in ${S.at(-1).boss}; player's health ${S.at(-1).me}, blows taken ${S.at(-1).taken}, cut down ${deaths} time(s), giant made whole again ${resets} time(s)`);
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
