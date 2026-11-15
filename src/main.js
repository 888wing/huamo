// 化墨 — fog-as-ink slice. Boots the device, the fog simulation, the three.js scene, input and the frame loop.
import * as THREE from 'three/webgpu';
import { createDevice, Gpu } from './gpu.js';
import { Sim3D } from './sim3d.js';
import { FOG_TOP, height, terrainTexture, pushOut, DUEL_CLEARING } from './world.js';
import { buildStage, buildTrail, buildSplash, noiseTexture, external, PAPER } from './stage.js';
import { buildGroundInk, buildBlot, HIT_FEEDBACK } from './combat-fx.js';
import { buildBeasts } from './beasts.js';
import { createFog } from './fog.js';
import { Player, Enemy, spar, FORMS, HP, MORPH, SHIFT_MIN, INK_PER_CUT } from './player.js';
import { Figure } from './figure.js';
import { Giant } from './boss.js';
import { GiantRig } from './giant.js';
import { Veil, VW, VH } from './veil.js';
import atlasUrl from '../assets/smoke_atlas.jpg';
import { DEMOS } from './demos.js';
import { createSound, renderVoice, VOICES } from './sound.js';

const q = new URLSearchParams(location.search);
const msg = document.getElementById('msg');

async function boot() {
  const { device } = await createDevice();
  const gpu = new Gpu(device);
  const n = (q.get('n') ?? '128,48,128').split(',').map(Number), h = +(q.get('h') ?? 0.25);
  const sim = await Sim3D.create(gpu, { n, h, org: [-n[0] * h / 2, -2, -n[2] * h / 2], f32: q.get('f32') === '1', terrain: terrainTexture(gpu) });
  sim.par.fogTop = FOG_TOP; sim.par.inkFade = 0.25; sim.par.vort = 0.6; sim.reset();
  for (const k of ['cycles', 'pre', 'post', 'vort', 'g', 'heal', 'inkFade']) if (q.has(k)) sim.par[k] = +q.get(k);
  if (q.has('mc')) sim.par.maccormack = q.get('mc') !== '0';

  const renderer = new THREE.WebGPURenderer({ device, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, +(q.get('dpr') ?? 1.5)));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.2, 600);
  const noise = await noiseTexture(gpu);
  const stage = buildStage(scene, noise);
  for (const k of (q.get('hide') ?? '').split(',')) if (stage.parts[k]) stage.parts[k].visible = false; // for measuring what each part costs
  const beasts = buildBeasts(scene, noise), trail = buildTrail(noise), trail2 = buildTrail(noise, trail.scene);
  const hero = new Figure(scene, noise, { robe: .76, cloak: .1, legs: .22, hat: .46, skin: .8, wraps: .74 }, { detailed: true });
  const shade = new Figure(scene, noise, { robe: .2, cloak: .02, legs: .06, hat: .1, skin: .3, wraps: .16 });
  const enemy = new Enemy(), fx = [], blasts = [], splash = buildSplash(trail.scene);
  const groundInk = buildGroundInk(scene, noise);
  const giant = new Giant(), oni = new GiantRig(scene, noise), blot = buildBlot(scene, noise);
  if (q.get('hide')?.includes('giant')) { oni.group.visible = false; oni.cloth.mesh.visible = false; }
  // only what reaches into the simulated box is worth sending to it
  const inBox = e => { const b = e.b ?? e.a, m = e.r + 1; return [0, 2].every(i => Math.max(e.a[i], b[i]) > sim.org[i] - m && Math.min(e.a[i], b[i]) < sim.org[i] + n[i] * h + m); };
  let dealt = 0, taken = 0, warded = 0;
  // five layers of smoke between 2.6 and 18 m from the camera; the first two lie between the camera and the figure
  const veils = await Promise.all([[1.3, 2.2, 1, .55, 80, 7], [2.0, 2.6, 1, .68, 75, 7], [2.7, 3.0, 1, .8, 70, 6.5], [3.4, 3.2, 1, .9, 65, 6], [4.2, 3.4, 1, 1.0, 60, 5.5], [5.2, 3.6, 1, 1.1, 55, 5], [7.4, 3.4, .98, 1.1], [10, 3.8, .96, 1.2], [14, 4.2, .94, 1.25], [19, 4.6, .9, 1.25]]
    .map(([d, k, tone, amount, turb = 36, top = 4.4], i) => Veil.create(gpu, i, { d, k, tone, amount, turb, top }))); // the near layers reach higher, so smoke can hide part of the figure // the nearest is thin, restless wisps right in front of the lens
  veils.forEach(v => { v.tex = external(v.A); v.disp = external(v.E0); });
  // Both atlases provide the density shapes and fine edges for the simulated layers.
  let atlasTex, smokeSeed = 0;
  if (PROCEDURAL_SMOKE) {
    const { createProceduralSmokeAtlas, readSmokeOptions } = await import('./smoke-procedural.js');
    const smokeOptions = readSmokeOptions(q);
    smokeSeed = smokeOptions.seed;
    atlasTex = await createProceduralSmokeAtlas(gpu, noise.sourceTexture, smokeOptions);
  } else {
    const bmp = await createImageBitmap(await (await fetch(atlasUrl)).blob());
    atlasTex = gpu.tex([bmp.width, bmp.height], 'rgba8unorm', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT);
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: atlasTex }, [bmp.width, bmp.height]);
  }
  const requestedDensity = Number.parseFloat(q.get('fogDensity'));
  const foregroundDensity = Number.isFinite(requestedDensity) ? THREE.MathUtils.clamp(requestedDensity, .65, 3) : undefined;
  const fog = createFog(renderer, scene, camera, noise, external(sim.D0), trail.scene, external(sim.V0), veils, external(atlasTex),
    { procedural: PROCEDURAL_SMOKE, seed: smokeSeed, foregroundDensity, hero, shade, giant: oni });
  const prevPos = new THREE.Vector3(), prevFwd = new THREE.Vector3(0, 0, -1), tv = new THREE.Vector3(), fwd = new THREE.Vector3();
  // world point -> [x, y] in layer texels and distance along the view
  const toLayer = (x, y, z) => { tv.set(x, y, z).applyMatrix4(camera.matrixWorldInverse); const dist = -tv.z; tv.applyMatrix4(camera.projectionMatrix); return [(tv.x * .5 + .5) * VW, (1 - (tv.y * .5 + .5)) * VH, dist]; };
  const bladeStrip = (blade, phase) => {
    if (!blade || phase < .29 || phase > .72) return null;
    const force = blade.combo === 2 ? 1.24 : blade.combo === 1 ? .92 : 1;
    return { a: toLayer(...blade.a), b: toLayer(...blade.b), snap: blade.snap, force };
  };
  const cutAtDepth = ({ a, b, snap, force }, depth, focal) => {
    if (Math.min(a[2], b[2]) < .4) return null;
    const nearest = THREE.MathUtils.clamp(depth, Math.min(a[2], b[2]), Math.max(a[2], b[2]));
    const weight = Math.exp(-(((depth - nearest) / 2.8) ** 2));
    if (weight < .035) return null;
    // Clip the segment to the depth near this veil. Perspective-correct interpolation keeps the cut on the blade.
    const dz = b[2] - a[2];
    const at = (z, fallback) => {
      const t = Math.abs(dz) > .001 ? THREE.MathUtils.clamp((z - a[2]) / dz, 0, 1) : fallback;
      const u = t * b[2] / (a[2] + t * dz);
      return [THREE.MathUtils.lerp(a[0], b[0], u), THREE.MathUtils.lerp(a[1], b[1], u)];
    };
    const [x, y] = at(nearest - 1.25, 0), [x2, y2] = at(nearest + 1.25, 1);
    const scale = focal / nearest;
    return { x, y, x2, y2, r: (snap ? 1.10 : .63) * scale, w: weight,
      vx: 0, vy: 0, den: 0, drag: 0, split: (snap ? 23 : 3.8) * scale * force };
  };
  fog.u.boxSize.value.set(n[0] * h, n[1] * h, n[2] * h); fog.u.top.value = sim.org[1] + n[1] * h;
  let view = q.get('view') ?? 'fog';
  fog.use(view);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  // ---- input
  const player = new Player(); player.foe = enemy; player.boss = giant;
  if (q.has('boss')) { enemy.n = enemy.total; enemy.spawn(); player.p[0] = -1; player.p[2] = -4; player.p[1] = height(-1, -4); player.home = [-1, -4]; } // straight to the giant
  const cam = { yaw: Math.PI, pitch: -0.36, dist: 6.2 };
  if (q.has('arena') && !q.has('boss')) {
    const [x, z] = DUEL_CLEARING.entry, [cx, cz] = DUEL_CLEARING.center;
    player.p = [x, height(x, z), z];
    player.home = [x, z];
    cam.yaw = player.yaw = Math.atan2(cx - x, cz - z);
  }
  const sound = createSound(q.has('mute')); // made in code; starts with the first key or click, M mutes
  const keys = new Set();
  let anyKey = false, ended = false, actHeld = false, guardHeld = false, dodgeNow = false, drawer = false, timing = q.has('timing'), ms = null, probeText = '';
  addEventListener('keydown', e => {
    if (e.code === 'Tab') { e.preventDefault(); drawer = !drawer; }
    if (e.repeat) return;
    anyKey = true; if (e.code === 'KeyR' && ended) location.reload();
    if (e.code === 'KeyM') sound.toggle();
    keys.add(e.code);
    if (e.code === 'ShiftLeft') dodgeNow = true;
    const f = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (f >= 0 && q.has('debug')) player.setForm(f); // forms on the number keys are for debugging: in play a form comes from pressing a move's key again
    if (e.code === 'KeyR') sim.reset();
    if (e.code === 'KeyV') { view = view === 'fog' ? 'slice' : 'fog'; fog.use(view); }
    if (e.code === 'KeyT') timing = !timing;
    if (e.code === 'KeyP') sim.probe().then(r => { probeText = JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toPrecision(4) : v, 1); drawer = true; });
  });
  addEventListener('keyup', e => keys.delete(e.code));
  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock?.());
  addEventListener('mousedown', e => { if (e.button === 0) actHeld = true; if (e.button === 2) guardHeld = true; });
  addEventListener('mouseup', e => { if (e.button === 0) actHeld = false; if (e.button === 2) guardHeld = false; });
  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== renderer.domElement) return;
    cam.yaw -= e.movementX * 0.0026; cam.pitch = Math.max(-1.35, Math.min(0.9, cam.pitch - e.movementY * 0.0022));
  });
  addEventListener('contextmenu', e => e.preventDefault());
  const input = () => { const d = dodgeNow; dodgeNow = false; return {
    guard: guardHeld || keys.has('KeyQ'), dodge: d,
    x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), z: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    up: keys.has('Space') ? 1 : 0, down: keys.has('ShiftLeft') || keys.has('KeyC') ? 1 : 0, act: actHeld || keys.has('KeyF'),
  }; };

  // ---- HUD: one quiet line in the corner, Tab opens the rest; a seal in the other corner
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:12px;top:9px;white-space:pre;pointer-events:none;opacity:.6;font-size:12px';
  const seal = document.createElement('div');
  seal.textContent = '化墨';
  seal.style.cssText = 'position:fixed;right:22px;bottom:20px;width:34px;padding:5px 0;background:#b3301f;color:#f1e9da;font:600 15px/1.15 "Songti TC","Noto Serif TC",serif;text-align:center;writing-mode:vertical-rl;border-radius:3px;opacity:.86;pointer-events:none';
  // the ink gauge: one brush stroke at the foot of the picture, shared by all three beasts. It shortens and runs dry as a
  // beast spends it, and wets again while the swordsman waits. The character beside it names the beast.
  const gauge = document.createElement('div'), STROKE = 'M8 16 C 70 9, 190 22, 272 13';
  gauge.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;pointer-events:none;opacity:0;transition:opacity .45s';
  gauge.innerHTML = `<span style="font:600 23px/1 'Songti TC','Noto Serif TC',serif;color:#121419;width:26px;text-align:center"></span>`
    + `<svg width="280" height="30" viewBox="0 0 280 30"><defs><filter id="ib" x="-5%" y="-80%" width="110%" height="260%"><feTurbulence type="fractalNoise" baseFrequency=".03 .7" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>`
    + `<mask id="im"><path d="${STROKE}" pathLength="1" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/></mask></defs><g filter="url(#ib)">`
    + `<path d="${STROKE}" fill="none" stroke="#121419" stroke-opacity=".12" stroke-width="12" stroke-linecap="round"/>`
    + `<path d="${STROKE}" pathLength="1" fill="none" stroke="#121419" stroke-width="12" stroke-linecap="round"/>`
    + `<g mask="url(#im)" stroke="#ece6d8" fill="none">${[[-3.4, 1.6, '.09 .04 .16 .03'], [.4, 1.1, '.05 .07 .2 .05'], [3.3, 1.8, '.13 .03 .07 .06']].map(([y, w, d]) => `<path d="${STROKE}" pathLength="1" transform="translate(0 ${y})" stroke-width="${w}" stroke-dasharray="${d}"/>`).join('')}</g></g></svg>`;
  const gGlyph = gauge.firstChild, gInk = gauge.querySelectorAll('g > path')[1], gMask = gauge.querySelector('mask path'), gDry = gauge.querySelector('g[mask]'), gRough = gauge.querySelector('feDisplacementMap');
  document.body.append(hud, seal, gauge);
  // staged moments: black bars, the giant's name, the end card; and brush characters stamped on the picture at heavy blows
  const SERIF = "'Songti TC','Noto Serif TC','Songti SC',serif"; // single quotes: it also goes inside style="" attributes
  const mk = (css, html = '') => { const el = document.createElement('div'); el.style.cssText = css; el.innerHTML = html; document.body.append(el); return el; };
  const bars = [0, 1].map(i => mk(`position:fixed;left:-2%;right:-2%;${i ? 'bottom' : 'top'}:-1vh;height:0;background:#121419;pointer-events:none;filter:url(#ib)`));
  const title = mk(`position:fixed;right:11%;top:14%;writing-mode:vertical-rl;font:900 11vh/1.05 ${SERIF};color:#121419;filter:url(#ib);pointer-events:none;opacity:0`,
    `巨相撲鬼<span style="writing-mode:horizontal-tb;display:inline-block;margin-top:1.4vh;padding:.5vh .9vh;background:#b3301f;color:#f1e9da;font:700 2.6vh/1.1 ui-serif,Georgia,serif;border-radius:.4vh">Boss</span>`);
  const endCard = mk('position:fixed;inset:0;display:grid;place-items:center;background:rgba(236,230,216,0);pointer-events:none;opacity:0',
    `<div style="text-align:center;font:600 3vh/1.9 ${SERIF};color:#121419"><div style="display:inline-block;padding:1.2vh 1.4vh;background:#b3301f;color:#f1e9da;font:700 9vh/1.1 ${SERIF};writing-mode:vertical-rl;border-radius:.6vh">化墨</div><br>巨相撲鬼 伏誅<br><span style="opacity:.6;font-size:2vh">按 R 再來一次</span></div>`);
  // the ways onto its head: one line for each beast at the foot of the left edge. The line of the beast in use says what comes next
  const ROUTES = [['虎', 'Shift ×2', '巨掌拍落地面時　衝上手臂'], ['鶴', '空白 ×2', '按住空白飛過頭頂　按出招刺下'], ['鯉', 'Q ×2', '潛到腳邊等它踏地　拋到高處按出招']];
  const hint = mk(`position:fixed;left:18px;bottom:14px;pointer-events:none;font:600 15px/1.75 ${SERIF};color:#121419;opacity:0;text-shadow:0 0 5px #ece6d8,0 0 2px #ece6d8`, ROUTES.map(() => '<div style="white-space:nowrap"></div>').join(''));
  let hintK = 0, hintKey = '';
  const stamps = [];
  const stamp = (text, at, size = 1, red = false) => {
    const el = mk(`position:fixed;left:0;top:0;pointer-events:none;white-space:nowrap;font:900 ${Math.round(innerHeight * .17 * size)}px/1 ${SERIF};color:${red ? '#b3301f' : '#121419'};filter:url(#ib);will-change:transform,opacity`);
    el.textContent = text; stamps.push({ el, at: [...at], t: 0, rot: ((stamps.length * 37 + frame) % 9 - 4) * .06 });
  };
  const heard = { snap: false, esnap: false, beat: 0, act: -1 };
  let cine = null, burstK = 0, burstAt = null, slashK = 0, invertN = 0, geyser = 0, tcam = 0, endT = -1, fovNow = 50;
  const lastHand = new THREE.Vector2(), nowHand = new THREE.Vector2(), sm = (x, a, b) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  // these are moved a step every frame rather than left to CSS timing, so a capture stepped by hand shows them exactly as play does
  let barsOn = false, barK = 0, titleOn = false, titleK = 0, titleT = 0;
  const show = on => { barsOn = on; if (!on) titleOn = false; };
  let fps = 60, last = performance.now(), frame = 0, shake = 0;

  const demo = DEMOS[q.get('demo')] ?? null, override = { x: 0, z: 0, up: 0, down: 0, act: false, guard: false, dodge: false };
  const DT = sim.par.dt;
  let hold = 0, clock = 0, flash = 0, kick = 0, gcam = 0, heroClearUntil = 0, slowT = 0, wasFallen = false;
  const tgt = new THREE.Vector3(), eye = new THREE.Vector3(), want = new THREE.Vector3();
  const soles = [new THREE.Vector3(), new THREE.Vector3()];
  let camReady = false, rideWas = false, rideSet = false, rideAz = 0, rideTo = 0;

  function tick() {
    // a blow that lands stops time for a few frames: that pause is where the weight is felt
    const dt = hold > 0 ? (hold--, DT * .05) : slowT > 0 ? (slowT -= DT, DT * .35) : DT; sim.par.dt = dt; clock += dt;
    const t = clock;
    if (demo) demo(t, player, cam, override);
    const beforeX = player.p[0], beforeZ = player.p[2];
    // a staged moment (the giant's entrance, the kill) runs on real time; the entrance can be skipped with any key
    if (cine) { cine.t += DT; if (cine.t >= cine.dur || (anyKey && cine.kind === 'entrance' && cine.t > .5)) { if (cine.kind === 'kill') cam.yaw = Math.atan2(tgt.x - eye.x, tgt.z - eye.z); cine = null; show(false); } }
    anyKey = false; player.staged = cine?.kind === 'entrance';
    const held = player.staged ? { x: 0, z: 0, up: 0, down: 0, act: false, guard: false, dodge: false } : demo ? override : input();
    player.update(dt, held, cam, enemy.alive ? enemy.p : giant.aim(player.p));
    // the giant's bulk: a body in the air cannot pass through it
    if (!player.ride && player.plunge !== 1) for (const [x, y, z, r] of giant.volumes()) {
      const dx = player.p[0] - x, dy = player.p[1] + .8 - y, dz = player.p[2] - z, d = Math.hypot(dx, dy, dz);
      if (d < r && d > .01) { const k = (r - d) / d; player.p[0] += dx * k; player.p[2] += dz * k; player.p[1] = Math.max(height(player.p[0], player.p[2]), player.p[1] + dy * k); }
    }
    pushOut(player.p, .32, giant.solids()); // its feet, and a hand lying on the ground, are in the way
    // what the body did this step that the air should feel: leaving the ground, coming down, the stab from the air, landing on its back
    for (const ev of player.events.splice(0)) {
      const k = Math.min(1, (ev.v ?? 0) / 14);
      sound.play({ jump: 'jump', land: 'land', down: 'land', dodge: 'roll', shift: 'shift', breach: 'splash', mount: 'step', onhead: 'land', plunge: 'land', headstab: 'stab' }[ev.kind], { v: ev.kind === 'land' ? k : 1, back: ev.to === 0 });
      if (ev.kind === 'jump') fx.push({ a: ev.at, r: 1.3, ink: 0, div: 9, life: .16, t: 0 });
      else if (ev.kind === 'land') { fx.push({ a: ev.at, r: 1.2 + 1.2 * k, ink: 0, div: 8 + 16 * k, life: .2, t: 0 }); shake = Math.max(shake, .3 * k); }
      else if (ev.kind === 'down') { fx.push({ a: ev.at, r: 1.8, ink: 0, div: 14, life: .2, t: 0 }); shake = Math.max(shake, .5); }
      else if (ev.kind === 'shift') { // the change of form: a breath of ink where the body was, and the smoke stirred
        fx.push({ a: [ev.at[0], ev.at[1] + (ev.to === 3 || ev.from === 3 ? .4 : 1), ev.at[2]], r: 1.4, ink: .3, div: 8, life: .22, t: 0 });
        blasts.push({ p: [ev.at[0], ev.at[1] + 1, ev.at[2]], r: 3.2, split: 130, den: -9, life: .35, t: 0 }); flash = Math.max(flash, .08); shake = Math.max(shake, .3);
      }
      else if (ev.kind === 'mount') shake = Math.max(shake, .4);
      else if (ev.kind === 'onhead') { shake = Math.max(shake, .8); fx.push({ a: ev.at, r: 1.6, ink: .25, div: 12, life: .2, t: 0 }); }
      else if (ev.kind === 'breach') { fx.push({ a: ev.at, r: 1.6, ink: 0, div: 16, life: .2, t: 0 }); blasts.push({ p: ev.at, r: 3, split: 160, den: -8, life: .35, t: 0 }); }
      else if (ev.kind === 'headstab') { // the sword goes into the giant's head: everything stops for it
        cine = { kind: 'kill', t: 0, dur: 3.6, a0: Math.atan2(eye.x - ev.at[0], eye.z - ev.at[2]) }; show(true);
        slowT = 1.5; hold = 14; flash = 1; kick = 1; shake = 2.4; invertN = 3; burstK = 1; burstAt = ev.at; geyser = 1.1; tv.setFromMatrixColumn(camera.matrixWorld, 0); stamp('斬', [ev.at[0] + tv.x * 3, ev.at[1] + 1.2, ev.at[2] + tv.z * 3], 1.5, true);   // (beside the head, not over the blow itself)
        fx.push({ a: ev.at, r: 3, ink: 2, div: 40, life: .4, t: 0 }); blasts.push({ p: ev.at, r: 9, split: 320, den: -40, life: .8, t: 0 });
      }
      else if (ev.kind === 'plunge') {
        fx.push({ a: ev.at, r: 2.6, ink: 0, div: 34, life: .25, t: 0 }); blasts.push({ p: [ev.at[0], ev.at[1] + .6, ev.at[2]], r: 5, split: 220, den: -22, life: .5, t: 0 });
        splash.burst(ev.at, [0, 0], 30, .8); shake = Math.max(shake, 1.1); kick = Math.max(kick, .5); hold = Math.max(hold, 5);
      }
    }
    // the last blow: the world slows for a moment as the swordsman goes down
    if (player.fallen > 0 && !wasFallen) slowT = .45;
    wasFallen = player.fallen > 0;
    const enemyWasFalling = enemy.mode === 'fall' && enemy.fallT < 1;
    enemy.update(dt, player.p);
    if (enemyWasFalling && enemy.fallT === 1) {
      const back = [-Math.sin(enemy.yaw), -Math.cos(enemy.yaw)];
      const landing = [enemy.p[0] + back[0] * .76, enemy.p[1] + .12, enemy.p[2] + back[1] * .76];
      groundInk.land(enemy.p, enemy.yaw);
      splash.burst(landing, back, 24, .43);
      shake = Math.max(shake, .31);
    }
    // the giant: every stamp and blow shakes the picture, throws ink up and blows the fog and the smoke open
    const gev = giant.update(dt, player, enemy.mode === 'done'), cut = giant.struck(player); if (cut) gev.push(cut);
    for (const ev of gev) {
      const [sh, fl, kk, hd, r, div, n, size] = { sweep: [1.2, .1, .4, 0, 3, 20, 0, 1], charge: [1.6, .12, .5, 0, 4, 26, 0, 1], gate: [.6, .1, .3, 0, 3, 30, 0, 1], topple: [3.6, .5, 1, 10, 6, 70, 150, 1.3], dead: [0, 0, 0, 0, 1, 0, 0, 1], wake: [.9, 0, 0, 0, 3, 16, 0, 1], roar: [1.7, .2, .5, 0, 4.5, 34, 0, 1], step: [.8, 0, .2, 0, 2.6, 16, 20, 1], stomp: [2.8, .3, .9, 8, 5, 55, 90, 1.15], slam: [3.2, .55, 1, 11, 4.5, 60, 100, 1.15], struck: [1.3, .3, .5, 6, 2, 18, 50, 1], cut: [.9, .22, .4, 5, 2, 16, ev.big ? 70 : 34, 1.4] }[ev.kind];
      shake = Math.max(shake, sh); flash = Math.max(flash, fl); kick = Math.max(kick, kk); hold = Math.max(hold, hd);
      sound.play({ wake: 'rumble', roar: 'groar', step: 'gstep', stomp: 'stomp', slam: 'slam', sweep: 'sweep', charge: 'sweep', struck: 'hurt', cut: 'cut', topple: 'slam', dead: 'end', gate: 'splash' }[ev.kind]);
      fx.push({ a: ev.at, r, ink: 0, div, life: .3, t: 0 });
      if (n) splash.burst(ev.at, ev.dir ?? [0, 0], n, size);
      if (sh > 1.5) blasts.push({ p: [ev.at[0], ev.at[1] + (ev.kind === 'roar' ? 0 : 1.2), ev.at[2]], r: ev.kind === 'roar' ? 8 : 11, split: 300, den: ev.kind === 'roar' ? -12 : -40, life: .7, t: 0 });
      if (ev.kind === 'wake') { player.home = [-1, -6]; if (!q.has('nocine') && !cam.fixed) { cine = { kind: 'entrance', t: 0, dur: 5.6, eye0: eye.clone(), tgt0: tgt.clone(), named: false }; show(true); } }
      // heavy blows are drawn as well as felt: lines thrown out from where they land, a frame turned inside out, a character stamped on the picture
      if (ev.kind === 'stomp' || ev.kind === 'slam' || ev.kind === 'topple') { burstK = 1; burstAt = ev.at; invertN = 2; stamp(ev.kind === 'slam' ? '砰' : '轟', [ev.at[0], ev.at[1] + 1.2, ev.at[2]], ev.kind === 'topple' ? 1.3 : 1); }
      if (ev.kind === 'sweep' || ev.kind === 'charge') { burstK = .7; burstAt = ev.at; }
      if (ev.kind === 'roar') stamp('吼', ev.at, 1.1);
      if (ev.kind === 'dead') endT = 0;
      if (ev.kind === 'struck') taken++; else if (ev.kind === 'cut') { dealt++; player.ink = Math.min(1, player.ink + INK_PER_CUT); }
    }
    for (const ev of spar(player, enemy)) {
      if (ev.kind === 'dodge') { warded++; continue; }
      const profile = HIT_FEEDBACK[ev.kind], force = Math.sqrt(ev.impact ?? 1);
      sound.play({ cut: 'cut', kill: 'kill', taken: 'hurt', down: 'hurt', block: 'block', parry: 'steel', clash: 'steel', push: 'cut' }[ev.kind], { k: force });
      const received = ev.kind === 'taken' || ev.kind === 'down';
      const toward = received ? -1 : 1;
      const x = (enemy.p[0] - player.p[0]) * toward, z = (enemy.p[2] - player.p[2]) * toward;
      const d = Math.hypot(x, z) || 1, dir = ev.dir ?? [x / d, z / d];
      splash.burst(ev.at, dir, Math.round(profile.ink * force), profile.size * force, profile.light);
      hold = Math.max(hold, Math.round(profile.stop * force));
      flash = Math.max(flash, profile.flash); kick = Math.max(kick, profile.kick * force);
      // A sword already moves air along its sweep. Only roars and steel contacts add a separate pulse.
      if (profile.air) fx.push({ a: ev.at, r: profile.radius * force, ink: 0, div: profile.air * force, life: .2, t: 0 });
      player.shake = Math.max(player.shake, profile.shake * force);
      if (ev.kind === 'kill') player.home = [enemy.p[0], enemy.p[2]]; // fall after this and you come back here
      if (ev.kind === 'parry') stamp('鏘', ev.at, .6); else if (ev.kind === 'kill') stamp('斬', ev.at, .7);
      if (received) {
        taken++;
        heroClearUntil = Math.max(heroClearUntil, t + .32);
      } else if (ev.kind === 'cut' || ev.kind === 'kill' || ev.kind === 'push') dealt++;
      else if (ev.kind === 'parry' || ev.kind === 'block') warded++;
    }
    for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].t += dt) > fx[i].life) fx.splice(i, 1);
    for (let i = blasts.length - 1; i >= 0; i--) if ((blasts[i].t += dt) > blasts[i].life) blasts.splice(i, 1);
    const pe = player.emitters(); // the two slow gusts come last: they are the first to go if there are too many
    sim.emitters = [...pe.slice(0, -2), ...enemy.emitters(), ...giant.emitters().filter(inBox), ...fx.map(e => ({ a: e.a, r: e.r, ink: e.ink, div: e.div * Math.sin(Math.PI * e.t / e.life) })), ...pe.slice(-2)];
    sim.follow(player.p[0], player.p[2]); fog.u.boxMin.value.set(...sim.org);
    const timed = timing && frame % 20 === 0 ? sim.step(true) : (sim.step(), null);
    timed?.then(r => { if (r) ms = r; });

    // ---- bodies: skeletons posed in code on top of the simulation-driven position
    const f = player.form, sp = Math.hypot(player.v[0], player.v[2]), run = Math.min(1, sp / [5.5, 12, 11, 7.5][f]);
    const act = player.actT, fade = .6 * player.burstT ** 2;
    // while the form changes, the body leaving and the body arriving are both there for a moment
    const morph = player.morphT > 0 ? 1 - player.morphT / MORPH : 1, from = player.morphT > 0 ? player.morphFrom : f;
    hero.visible = f === 0 || from === 0; shade.visible = enemy.present;
    beasts.forEach((b, i) => { b.visible = i === f - 1 || i === from - 1; });
    const pose = player.pose(t, fade);
    pose.grow = morph;
    if (f === 0) hero.update(dt, pose, camera.position); else beasts[f - 1].update(dt, pose, camera.position);
    if (from !== f) (from === 0 ? hero : beasts[from - 1]).update(dt, { ...pose, grow: 1, streak: morph, act: -1, plunge: 0, dodgeKind: 0 }, camera.position);
    oni.update(dt, giant, camera.position);
    if (shade.group.visible) shade.update(dt, { p: enemy.p, v: enemy.v, yaw: enemy.yaw, phase: enemy.phase, run: Math.min(1, Math.hypot(enemy.v[0], enemy.v[2]) / 3.6), act: enemy.actT, side: enemy.side, windup: enemy.windup, stagger: enemy.stagger / .5, fade: enemy.fade, fall: enemy.fallT, melt: enemy.meltT, eyes: enemy.mode !== 'fall', time: t }, camera.position);
    const bl = player.blade();
    const bladePhase = bl?.trailPhase ?? act;
    trail.update(dt, bl, bladePhase, hero.tip);
    // Ink and glints begin moving during hit stop, while bodies and the liquid field nearly pause.
    splash.update(Math.max(dt, DT * .38));
    groundInk.update(dt);
    const eb = enemy.blade();
    trail2.update(dt, eb, enemy.actT, shade.tip);
    // what can be heard of all this: the blade as it snaps through, feet as they land, wings, the tiger's voice, and the air
    if (bl?.snap && !heard.snap) sound.play('swish', { heavy: player.combo === 2 ? 1 : 0 }); heard.snap = !!bl?.snap;
    if (eb?.snap && !heard.esnap) sound.play('swish', { heavy: .3 }); heard.esnap = !!eb?.snap;
    for (const ft of hero.feet) if (ft.landed) { ft.landed = false; if (f === 0 && player.ground && !player.ride) sound.play('step', { v: .5 + .5 * run }); }
    const beat = Math.floor(player.phase * (f === 1 ? 2.2 / Math.PI : 1.25 / 6.2832));
    if (beat !== heard.beat && f === 1 && (player.ground || player.ride) && run > .2) sound.play('step', { v: 1 }); if (beat !== heard.beat && f === 2) sound.play('flap'); heard.beat = beat;
    if (f === 1 && act >= 0 && !(heard.act >= 0)) sound.play('roar'); heard.act = act;
    sound.frame(DT, run, giant.awake && giant.alive);

    // ---- camera: follows with a little lag, and shakes when something big happens
    shake = Math.max(player.shake, shake * Math.exp(-9 * DT)); player.shake = 0;
    gcam += ((giant.awake ? 1 : 0) - gcam) * (1 - Math.exp(-1.4 * dt)); // facing the giant the camera drops back and looks up
    // Carried up the giant, the view is taken out of the player's hands for those few seconds. It stands well off to the
    // arm's open side, where the whole arm and the head are in the picture, and only tilts up as the tiger climbs; with
    // the tiger on the head it comes in level with the crown. It is handed back looking the way it was left.
    // (the drop back and the look upwards are for someone on the ground at its feet: high in the air beside it the view stays close)
    const low = 1 - .85 * sm(player.p[1] - height(player.p[0], player.p[2]), 2.5, 7);
    const rideCam = !!player.ride && player.ride.kind !== 'rock' && !!giant.parts && giant.alive && !cam.fixed;
    if (rideCam && !rideWas) { rideAz = Math.atan2(eye.x - giant.p[0], eye.z - giant.p[2]); rideTo = rideAz; }
    if (!rideCam && rideWas && !cine) cam.yaw = Math.atan2(tgt.x - eye.x, tgt.z - eye.z);
    rideWas = rideCam;
    if (rideCam) {
      const P = giant.parts, c = P.crown, G = giant.p, on = player.ride.kind === 'head', ramp = giant.ramp;
      if (ramp && player.ride.kind === 'arm') { // side-on to the arm, on the side away from the body; never swung more than a third of the way round
        const ux = ramp[2][0] - ramp[0][0], uz = ramp[2][2] - ramp[0][2], sgn = uz * (ramp[1][0] - G[0]) - ux * (ramp[1][2] - G[2]) > 0 ? 1 : -1;
        const mx = (ramp[0][0] + ramp[2][0]) / 2 + sgn * uz * 3, mz = (ramp[0][2] + ramp[2][2]) / 2 - sgn * ux * 3, d = Math.atan2(Math.sin(Math.atan2(mx - G[0], mz - G[2]) - rideAz), Math.cos(Math.atan2(mx - G[0], mz - G[2]) - rideAz));
        if (!rideSet) { rideSet = true; rideTo = rideAz + Math.max(-1.1, Math.min(1.1, d)); }
      }
      rideAz += Math.atan2(Math.sin(rideTo - rideAz), Math.cos(rideTo - rideAz)) * (1 - Math.exp(-2.6 * dt));
      const near = on && player.ride.stab >= 0, R = near ? 5 : on ? 6.8 : 10.5, hx = on ? c[0] : G[0], hz = on ? c[2] : G[2], w = .62;   // (w: how much of the look goes to the tiger, the rest to the head it is making for)
      want.set(on ? c[0] : player.p[0] * w + P.head[0] * (1 - w), on ? c[1] + .8 : (player.p[1] + .6) * w + P.head[1] * (1 - w), on ? c[2] : player.p[2] * w + P.head[2] * (1 - w));
      tgt.lerp(want, 1 - Math.exp(-5 * dt));
      want.set(hx + Math.sin(rideAz) * R, on ? c[1] + (near ? 1.1 : 1.5) : G[1] + 2.2 + .4 * (player.p[1] - G[1]), hz + Math.cos(rideAz) * R);
      want.y = Math.max(want.y, height(want.x, want.z) + .6);
      eye.lerp(want, 1 - Math.exp(-(near ? 6 : 3.4) * dt));
    } else {
      rideSet = false;
      want.set(player.p[0], player.p[1] + (f < 2 ? 1.5 : .3) + 1.1 * gcam * low, player.p[2]);
      if (!camReady) tgt.copy(want); else tgt.lerp(want, 1 - Math.exp(-14 * dt));
    }
    if (cam.fixed) { eye.set(...cam.fixed.pos); tgt.set(...cam.fixed.look); }
    else if (!rideCam) {
      // while the giant raises a leg or an arm the camera sinks and looks up a little more; riding it, it closes in
      tcam += ((giant.alive && giant.awake ? Math.max(giant.lift, giant.wind) : 0) - tcam) * (1 - Math.exp(-5 * dt));
      const pitch = Math.min(.9, cam.pitch + (.36 * gcam + .1 * tcam) * low), cp = Math.cos(pitch), dist = cam.dist * [1, 1.2, 1.5 - .3 * gcam, 1.15][f] * (1 + (.7 * gcam + .1 * tcam) * low) * (player.ride ? .75 : 1);
      want.set(tgt.x - Math.sin(cam.yaw) * cp * dist, tgt.y - Math.sin(pitch) * dist, tgt.z - Math.cos(cam.yaw) * cp * dist);
      const cq = [want.x, 0, want.z]; pushOut(cq, .45); want.x = cq[0]; want.z = cq[2]; // the camera does not sit inside a trunk
      want.y = Math.max(want.y, height(want.x, want.z) + .6);
      if (!camReady) eye.copy(want); else eye.lerp(want, 1 - Math.exp(-9 * dt));
    }
    camReady = true;
    let roll = 0, fov = 50;
    if (cine && !cam.fixed) {
      const u = cine.t, G = giant.p, P = giant.parts;
      if (cine.kind === 'entrance') { // low on the ground before it as it rises, sliding aside; then back behind the swordsman's shoulder
        const dx = player.p[0] - G[0], dz = player.p[2] - G[2], dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl, a = sm(u, 0, 1.5), b = sm(u, 1.4, 4.0), c = sm(u, 4.5, cine.dur), hd = P?.head ?? [G[0], G[1] + 4, G[2]];
        want.copy(eye); eye.copy(cine.eye0).lerp(tv.set(G[0] + ux * 7.6 - uz * 1.6 * b, G[1] + .7 + .5 * b, G[2] + uz * 7.6 + ux * 1.6 * b), a).lerp(want, c);
        want.copy(tgt); tgt.copy(cine.tgt0).lerp(tv.set(hd[0], hd[1] - 1.5 * (1 - b), hd[2]), a).lerp(want, c);
        fov = 50 + 12 * a * (1 - c); roll = .07 * b * (1 - c);
        if (u > 3.0 && !cine.named) { cine.named = true; titleOn = true; titleT = 0; flash = Math.max(flash, .6); }
        if (u > 4.6) show(false);
      } else if (P) { // the kill: round the head, close
        const c = P.crown, ang = cine.a0 + 1.9 * sm(u, 0, cine.dur), R = 6.5 - 1.5 * sm(u, 0, 1.2);
        eye.set(c[0] + Math.sin(ang) * R, c[1] + 1.4 + .25 * u, c[2] + Math.cos(ang) * R); tgt.set(c[0], c[1] - .3, c[2]); fov = 46;
      }
    }
    camera.position.copy(eye);
    camera.lookAt(tgt); if (roll) camera.rotateZ(roll);
    if (Math.abs(fov - fovNow) > .01) { fovNow += (fov - fovNow) * Math.min(1, 12 * DT); camera.fov = fovNow; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    // ---- smoke layers: what moved this frame pushes each layer, more the closer its depth is to that layer's
    const cuts = [bladeStrip(bl, bladePhase), bladeStrip(eb, enemy.actT)].filter(Boolean);
    const dx = player.p[0] - beforeX, dz = player.p[2] - beforeZ, moved = Math.hypot(dx, dz);
    const walking = f === 0 && player.ground && act < 0 && player.dodge <= 0 && player.fallen <= 0
      && player.stagger <= 0 && moved > .36 * dt && moved < .5;
    let wake = null;
    if (walking) {
      const [x, y, z] = player.p, ux = dx / moved, uz = dz / moved;
      const a = toLayer(x - .70 * ux, y + .63, z - .70 * uz);
      const b = toLayer(x + .22 * ux, y + .67, z + .22 * uz);
      const depth = (a[2] + b[2]) * .5;
      if (depth > .55) wake = { a, b, depth, speed: Math.min(5.5, moved / dt) };
    }
    const stir = [{ p: [player.p[0], player.p[1] + 1, player.p[2]], v: player.v, r: 1.7, drag: 30, gain: 1.2 }];
    if (enemy.present) {
      const falling = enemy.mode === 'fall', recoiling = falling || enemy.mode === 'reel';
      stir.push({ p: [enemy.p[0], enemy.p[1] + (falling ? .43 : 1), enemy.p[2]], v: enemy.v,
        r: recoiling ? 1.05 : 1.7, drag: recoiling ? 12 : 30, gain: recoiling ? .55 : 1.2,
        depthFalloff: recoiling ? 2.0 : 4.2 });
    }
    stir.push(...giant.stir());
    for (const b of blasts) { const k = b.t / b.life; stir.push({ p: b.p, v: [0, 0, 0], r: 2 + (b.r - 2) * k, drag: 0, reach: 12, split: b.split * (1 - k), den: b.den * (1 - k) }); }
    const e = camera.matrixWorld.elements, tanY = Math.tan(camera.fov * Math.PI / 360), focal = VH / (2 * tanY);
    camera.getWorldDirection(fwd);
    const camInfo = { y: camera.position.y, tanY, aspect: camera.aspect, fy: fwd.y, uy: e[5], ry: e[1] };
    if (frame === 0) { prevPos.copy(camera.position); prevFwd.copy(fwd); }
    const vf = gpu.begin(); vf.stage('veils');
    for (const v of veils) {
      const c = toLayer(prevPos.x + prevFwd.x * v.d, prevPos.y + prevFwd.y * v.d, prevPos.z + prevFwd.z * v.d); // where last frame's centre is now
      const splats = cuts.map(cut => cutAtDepth(cut, v.d, focal)).filter(Boolean);
      if (wake) {
        const weight = Math.exp(-(((wake.depth - v.d) / 4.3) ** 2));
        if (weight > .035) {
          const scale = focal / wake.depth;
          splats.push({ x: wake.a[0], y: wake.a[1], x2: wake.b[0], y2: wake.b[1], r: 1.32 * scale,
            w: weight, vx: 0, vy: 0, den: 0, drag: 0, split: 1.65 * wake.speed * scale, wake: true });
        }
      }
      const transportCount = splats.length;
      for (const s of stir) {
        const a = toLayer(s.p[0], s.p[1], s.p[2]), gn = s.gain ?? 1,
          w = s.reach ? Math.min(1, Math.max(0, 1.4 - Math.abs(a[2] - v.d) / s.reach)) : Math.exp(-(((a[2] - v.d) / (s.depthFalloff ?? 4.2)) ** 2));
        if (a[2] < .4 || w < .03) continue;
        const b = toLayer(s.p[0] + s.v[0] * .05, s.p[1] + s.v[1] * .05, s.p[2] + s.v[2] * .05);
        const vx = (b[0] - a[0]) / .05 * gn, vy = (b[1] - a[1]) / .05 * gn;
        splats.push({ x: a[0], y: a[1], r: s.r / a[2] * focal, w, vx, vy, den: s.den ?? 0, drag: s.drag, split: (s.split ?? 0) / a[2] * focal });
      }
      v.step(vf, dt, t, [c[0] - VW / 2, c[1] - VH / 2], camInfo, splats, transportCount);
    }
    vf.end(); prevPos.copy(camera.position); prevFwd.copy(fwd);
    // The landscape and fog use the same stable projection. Impact motion affects the finished picture.
    flash *= Math.exp(-16 * DT); kick *= Math.exp(-9 * DT); fog.u.flash.value = flash * .55;
    const canvasStyle = renderer.domElement.style;
    if (kick > .008 || shake > .012) {
      const amplitude = Math.min(innerWidth, innerHeight) * .009 * shake;
      const hitX = amplitude * Math.sin(frame * DT * 61);
      const hitY = amplitude * .72 * Math.sin(frame * DT * 47 + 1);
      const cover = 1 + 2 * Math.max(Math.abs(hitX) / innerWidth, Math.abs(hitY) / innerHeight);
      canvasStyle.transform = `translate(${hitX}px, ${hitY}px) scale(${Math.max(1 + .074 * kick, cover)})`;
    } else if (canvasStyle.transform) {
      canvasStyle.transform = '';
    }
    stage.reeds.time.value = t; stage.reeds.a.value.set(...player.p); stage.reeds.b.value.set(enemy.p[0], enemy.present ? enemy.p[1] : -99, enemy.p[2]);
    if (f === 0 && player.ground && player.fallen <= 0) {
      hero.B.footL.localToWorld(soles[0].set(0, -.025, .06));
      hero.B.footR.localToWorld(soles[1].set(0, -.025, .06));
      stage.reeds.tread(t, soles, player.v[0], player.v[2]);
    }
    // the reeds give way under the giant's feet and its hands, and a stamp sends a wave through the whole field
    const gp = giant.parts, press = stage.reeds.press, hand = gp && (giant.planted || giant.crouch > .5) ? gp[giant.side > 0 ? 'handL' : 'handR'] : null;
    if (gp) { press[0].value.set(...gp.footL, 2.6); press[1].value.set(...gp.footR, 2.6); press[2].value.set(hand ? hand[0] : 0, hand ? hand[1] - .4 : -99, hand ? hand[2] : 0, 2.8); }
    const rg = giant.ring; stage.reeds.ring.value.set(rg ? rg.at[0] : 0, rg ? rg.at[2] : 0, rg ? rg.r : 0, rg ? 1.5 * Math.max(0, 1 - rg.r / 15) : 0);
    fog.u.time.value = t;
    { // the drawn lines: closing in on a raised limb, thrown out from a blow, streaked along a falling hand
      const P = giant.parts, U = fog.u, side = giant.side > 0 ? 'L' : 'R', onScreen = (q, out) => { tv.set(q[0], q[1], q[2]).project(camera); out.set(tv.x * .5 + .5, .5 - tv.y * .5); };
      let focus = 0, slashing = false;
      if (P && giant.alive && giant.awake && !cine) {
        if (giant.mode === 'stomp' && giant.lift > .05) { focus = giant.lift; onScreen(P['foot' + side], U.mangaC.value); }
        else if ((giant.mode === 'slam' || giant.mode === 'sweep' || giant.mode === 'charge') && giant.wind > .05) { focus = giant.wind; onScreen(giant.mode === 'charge' ? P.chest : P['hand' + side], U.mangaC.value); }
        slashing = giant.fast && (giant.mode === 'slam' ? giant.fall < 1 : giant.mode === 'sweep' || giant.mode === 'charge');
        onScreen(giant.mode === 'charge' ? P.chest : P['hand' + side], nowHand);
        if (slashing) { const dx = (nowHand.x - lastHand.x) * camera.aspect, dy = nowHand.y - lastHand.y, l = Math.hypot(dx, dy); if (l > 1e-4) U.slashDir.value.set(dx / l, dy / l); }
        lastHand.copy(nowHand);
      }
      U.focus.value += (focus * .8 - U.focus.value) * Math.min(1, 10 * DT);
      burstK *= Math.exp(-10 * DT); U.burst.value = burstK; if (burstK > .03 && burstAt) onScreen(burstAt, U.mangaC.value);
      slashK += ((slashing ? 1 : 0) - slashK) * Math.min(1, (slashing ? 30 : 9) * DT); U.slash.value = slashK;
      U.invert.value = invertN-- > 0 ? 1 : 0;
      // brush characters: slammed on big, settling, then gone
      for (let i = stamps.length - 1; i >= 0; i--) {
        const k = stamps[i]; k.t += DT; tv.set(...k.at).project(camera);
        const x = Math.min(.88, Math.max(.12, tv.x * .5 + .5)) * innerWidth, y = Math.min(.82, Math.max(.16, .5 - tv.y * .5)) * innerHeight, sc = 1 + 1.1 * Math.exp(-k.t * 16);
        k.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${k.rot}rad) scale(${sc})`; k.el.style.opacity = tv.z < 1 ? 1 - sm(k.t, .5, .85) : 0;
        if (k.t > .85) { k.el.remove(); stamps.splice(i, 1); }
      }
      barK += ((barsOn ? 1 : 0) - barK) * Math.min(1, 7 * DT); bars.forEach(b => { b.style.height = `${11 * barK}vh`; });
      titleK += ((titleOn ? 1 : 0) - titleK) * Math.min(1, (titleOn ? 16 : 7) * DT); titleT += DT; title.style.opacity = titleK; title.style.transform = `scale(${1 + .7 * Math.exp(-titleT * 14)})`;
      // where the hand will come down
      blot.set(giant.target, 2.7, giant.mode === 'slam' && giant.fall < 1 ? giant.wind : 0);
      // ink out of the wound
      if (geyser > 0 && P) { geyser -= DT; if (frame % 3 === 0) splash.burst(P.crown, [0, 0], 12, 1.3); }
      // the giant is gone: the fog lifts, and the slice closes on its seal
      if (endT >= 0) {
        endT += DT; const k = sm(endT, 0, 5); fog.u.kFog.value = .13 - .08 * k; veils.forEach(v => { v.amount0 ??= v.amount; v.amount = v.amount0 * (1 - .65 * k); });
        const e = sm(endT, 2.2, 4.6); ended = endT > 2.2; endCard.style.opacity = e; endCard.style.background = `rgba(236,230,216,${.82 * e})`;
      }
    }
    fog.u.hero.value.set(player.p[0], player.p[1] + (f < 2 ? .95 : 0), player.p[2]); fog.u.heroR.value = [1.4, 1.6, 2.4, 1.6][f];
    fog.u.hero2.value.set(enemy.p[0], !enemy.present ? -99 : enemy.p[1] + .95, enemy.p[2]);
    const heroClear = fog.u.heroClear;
    if (f === 0 && player.fallen <= 0) {
      if (bladePhase >= .48 && bladePhase <= .78) heroClearUntil = t + .64;
      const revealing = t < heroClearUntil;
      heroClear.value += ((revealing ? 1 : 0) - heroClear.value)
        * (1 - Math.exp(-(revealing ? 17 : 4.2) * dt));
    } else {
      heroClearUntil = heroClear.value = 0;
    }
    const enemyClear = fog.u.enemyClear;
    const nearOpponent = Math.hypot(enemy.p[0] - player.p[0], enemy.p[2] - player.p[2]) < 5.8;
    // The giant is always partly legible once it is awake, and fully while it raises a leg or an arm or lies on its hand:
    // the foreground veils are heavy, and its tells are what the player has to read.
    fog.u.giantY.value = giant.p[1];
    const giantShown = giant.awake ? .5 + .5 * Math.max(giant.lift, giant.wind, giant.roar, giant.planted || rideCam ? 1 : 0) : .22;
    const showOpponent = enemy.mode === 'done' ? giantShown : enemy.mode === 'fall' || enemy.mode === 'gone' || enemy.mode === 'reel'
      ? 1 : enemy.alive && nearOpponent ? .35 : 0;
    enemyClear.value += (showOpponent - enemyClear.value) * (1 - Math.exp(-(showOpponent > enemyClear.value ? 18 : 4) * dt));
    fog.render();
    frame++;

    const now = performance.now(); fps += (1000 / Math.max(now - last, 1) - fps) * .05; last = now;
    if (frame % 10 === 0) {
      const tot = ms ? Object.values(ms).reduce((a, b) => a + b, 0) : 0;
      const pips = (n, of) => '●'.repeat(Math.max(0, n)) + '○'.repeat(of - Math.max(0, n));
      const move = f === 0 && act >= 0 ? `  ${['橫斬', '挑斬', '下劈'][player.combo ?? 0]}` : '';
      let s = `${FORMS[f]}${move}  我 ${pips(player.hp, HP)}  敵 ${pips(enemy.alive ? Math.ceil(enemy.hp) : 0, enemy.maxHp ?? 6)} ${Math.min(enemy.n + 1, enemy.total)}/${enemy.total}${giant.awake ? '  巨相撲鬼' : ''}  中 ${dealt} 擋 ${warded} 受 ${taken} · ${fps.toFixed(0)} fps${ms ? ` · sim ${tot.toFixed(2)} ms` : ''}`;
      if (drawer) {
        s += `\n\nWASD 移動 · 滑鼠 視角（點一下畫面鎖定）· 空白 跳／升\n左鍵／F 出招（連按接三刀）· 右鍵／Q 格擋（抓準時機＝彈開）· Shift 閃避（不按方向＝後跳，按方向＝翻滾；鶴鯉為下降）\n空中按出招＝下突刺 · 閃避尾段按出招＝衝斬 · 被擊飛時按空白＝受身\n化獸（共用下方的墨）：跳躍中再按空白＝鶴 · 閃避中再按 Shift＝虎 · 連按兩下格擋＝鯉 · 化獸時按出招＝變回並出招，格擋鍵＝獸的本招\n巨相撲鬼：四股的震波要跳過或閃過 · 巨掌落下前走開 · 手掌貼地時可以斬\nM 靜音 · V 俯視切面 · T 量時 · P 驗算 · R 重置 · Tab 收起\n\n模擬盒 ${sim.n.join('×')} 格 · 每格 ${h} 米`;
        if (ms) s += '\n\n' + Object.entries(ms).map(([k, v]) => `${k.padEnd(18)}${v.toFixed(2)} ms`).join('\n');
        if (probeText) s += '\n\n' + probeText;
      }
      hud.textContent = s;
    }
    { // the ways up show while the giant is there to be climbed
      const on = giant.awake && giant.alive && giant.mode !== 'rise' && !cine && !ended;
      hintK += ((on ? 1 : 0) - hintK) * Math.min(1, 4 * DT); hint.style.opacity = hintK.toFixed(3);
      if (on) {
        const c = giant.parts?.crown, above = !!c && player.p[1] > c[1] - .5, R = player.ride?.kind, stab = '按出招　刺向頭頂！';
        const now = f === 1 ? (R === 'head' ? '按出招　刺下！' : R === 'arm' || R === 'leap' ? '沿手臂直上頭頂' : giant.ramp ? '衝向地上的手掌' : '等巨掌拍落地面')
          : f === 2 ? (above ? stab : '按住空白升高　飛到頭頂上方') : f === 3 ? (player.p[1] > FOG_TOP + 1 ? (above ? stab : '還不夠高') : '游到腳邊　等它踏地') : '';
        const down = !!giant.ramp;
        if (f + now + down !== hintKey) {
          hintKey = f + now + down;
          ROUTES.forEach(([g, k, how], i) => { // (with the hand lying there and no beast taken yet, the tiger's line speaks up)
            const el = hint.children[i], act = f === i + 1, call = f === 0 && i === 0 && down;
            el.textContent = act ? `${g}　${now}` : call ? `${g}　${k}　巨掌已落地　衝上手臂！` : `${g}　${k}　${how}`; el.style.opacity = act || call ? 1 : f === 0 ? (down ? .3 : .66) : .2; el.style.fontSize = act ? '19px' : '';
          });
        }
      }
    }
    { // the gauge shows whenever it is not simply full
      const ink = player.ink, beast = f !== 0 && !player.free, low = !beast && ink < SHIFT_MIN, dry = 1 - ink;
      gauge.style.opacity = beast || ink < .995 ? (beast && ink < .2 ? .55 + .45 * Math.sin(frame * .9) : 1) : 0;
      gGlyph.textContent = beast ? FORMS[f][0] : ''; gInk.setAttribute('stroke-dasharray', `${Math.max(ink, .0001)} 1`); gMask.setAttribute('stroke-dasharray', `${Math.max(ink, .0001)} 1`);
      gInk.setAttribute('stroke-opacity', ink < .01 ? 0 : low ? .4 : .92 - .25 * dry); gDry.setAttribute('opacity', Math.min(1, dry * 1.5)); gRough.setAttribute('scale', 9 + 12 * dry);
    }
  }

  // hooks for scripted captures: advance exactly n frames, then wait for the GPU
  window.__advance = async k => { for (let i = 0; i < k; i++) tick(); await device.queue.onSubmittedWorkDone(); return frame; };
  window.__probe = () => sim.probe();
  window.__sound = name => renderVoice(name); window.__voices = Object.keys(VOICES);
  // wall time per frame with the GPU drained each frame: sim + render, no vsync
  window.__bench = async k => { const t0 = performance.now(); for (let i = 0; i < k; i++) { tick(); await device.queue.onSubmittedWorkDone(); } return (performance.now() - t0) / k; };
  window.__state = () => ({ frame, ms, clock, hold, p: player.p, form: player.form, hp: player.hp, combo: player.combo,
    attack: player.actT, dealt, taken, warded, foe: enemy.mode, enemyHp: enemy.hp, enemyIndex: enemy.n, fall: enemy.fallT, melt: enemy.meltT,
    sound: sound.on, step: player.demoStep, pinned: !!giant.pinned, ride: player.ride?.kind ?? null, stab: player.ride?.stab ?? null, raise: player.raise, hint: hintKey, bossDeath: giant.death, cine: cine?.kind ?? null, ended, ink: player.ink, morph: player.morphT, v: [...player.v], vy: player.v[1], ground: player.ground, dodge: player.dodge, invuln: player.invuln, ko: player.ko, plunge: player.plunge, fallen: player.fallen,
    hero: { ik: hero.ikW, feet: hero.feet.map(f => { const b = hero.B['foot' + f.k].getWorldPosition(tv); return { planted: f.t >= 1, x: b.x, y: b.y, z: b.z }; }) },
    boss: giant.mode, parts: giant.parts, target: giant.target, planted: giant.planted && giant.fall >= 1 && giant.ik >= 1, side: giant.side,
    foot: giant.parts ? ['footL', 'footR'].map(k => giant.parts[k][1] - height(giant.parts[k][0], giant.parts[k][2])) : null });
  window.__set = o => { if (o.view) { view = o.view; fog.use(view); } if (o.slice != null) fog.u.slice.value = o.slice; if (o.sliceV != null) fog.u.sliceV.value = o.sliceV; if (o.form != null) player.setForm(o.form); if (o.timing != null) timing = o.timing; if (o.hud === false) { hud.style.display = 'none'; hint.style.display = 'none'; } if (o.clear != null) { fog.u.smoke.value = o.clear ? 0 : 1; fog.u.kFog.value = o.clear ? 0 : .13; fog.u.wisp.value = o.clear ? 0 : .85; } };
  if (q.has('manual')) { tick(); window.__done = true; return; }
  renderer.setAnimationLoop(tick);
  window.__done = true;
}

boot().catch(e => { console.error(e); msg.textContent = String(e.message || e); window.__report = { error: String(e.stack || e) }; window.__done = true; });
