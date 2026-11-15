// 化墨 — fog-as-ink slice. Boots the device, the fog simulation, the three.js scene, input and the frame loop.
import * as THREE from 'three/webgpu';
import { createDevice, Gpu } from './gpu.js';
import { Sim3D } from './sim3d.js';
import { FOG_TOP, height, terrainTexture, pushOut, DUEL_CLEARING } from './world.js';
import { buildStage, buildTrail, buildSplash, noiseTexture, external, PAPER } from './stage.js';
import { buildGroundInk, HIT_FEEDBACK } from './combat-fx.js';
import { buildBeasts } from './beasts.js';
import { createFog } from './fog.js';
import { Player, Enemy, spar, FORMS, HP } from './player.js';
import { Figure } from './figure.js';
import { Giant } from './boss.js';
import { GiantRig } from './giant.js';
import { Veil, VW, VH } from './veil.js';
import atlasUrl from '../assets/smoke_atlas.jpg';
import { DEMOS } from './demos.js';

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
  const giant = new Giant(), oni = new GiantRig(scene, noise);
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
  const keys = new Set();
  let actHeld = false, guardHeld = false, dodgeNow = false, drawer = false, timing = q.has('timing'), ms = null, probeText = '';
  addEventListener('keydown', e => {
    if (e.code === 'Tab') { e.preventDefault(); drawer = !drawer; }
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'ShiftLeft') dodgeNow = true;
    const f = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (f >= 0) player.setForm(f);
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
  document.body.append(hud, seal);
  let fps = 60, last = performance.now(), frame = 0, shake = 0;

  const demo = DEMOS[q.get('demo')] ?? null, override = { x: 0, z: 0, up: 0, down: 0, act: false, guard: false, dodge: false };
  const DT = sim.par.dt;
  let hold = 0, clock = 0, flash = 0, kick = 0, gcam = 0, heroClearUntil = 0, slowT = 0, wasFallen = false;
  const tgt = new THREE.Vector3(), eye = new THREE.Vector3(), want = new THREE.Vector3();
  const soles = [new THREE.Vector3(), new THREE.Vector3()];
  let camReady = false;

  function tick() {
    // a blow that lands stops time for a few frames: that pause is where the weight is felt
    const dt = hold > 0 ? (hold--, DT * .05) : slowT > 0 ? (slowT -= DT, DT * .35) : DT; sim.par.dt = dt; clock += dt;
    const t = clock;
    if (demo) demo(t, player, cam, override);
    const beforeX = player.p[0], beforeZ = player.p[2];
    player.update(dt, demo ? override : input(), cam, enemy.alive ? enemy.p : giant.aim(player.p));
    pushOut(player.p, .32, giant.solids()); // its feet, and a hand lying on the ground, are in the way
    // what the body did this step that the air should feel: leaving the ground, coming down, the stab from the air, landing on its back
    for (const ev of player.events.splice(0)) {
      const k = Math.min(1, (ev.v ?? 0) / 14);
      if (ev.kind === 'jump') fx.push({ a: ev.at, r: 1.3, ink: 0, div: 9, life: .16, t: 0 });
      else if (ev.kind === 'land') { fx.push({ a: ev.at, r: 1.2 + 1.2 * k, ink: 0, div: 8 + 16 * k, life: .2, t: 0 }); shake = Math.max(shake, .3 * k); }
      else if (ev.kind === 'down') { fx.push({ a: ev.at, r: 1.8, ink: 0, div: 14, life: .2, t: 0 }); shake = Math.max(shake, .5); }
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
      const [sh, fl, kk, hd, r, div, n, size] = { wake: [.9, 0, 0, 0, 3, 16, 0, 1], roar: [1.7, .2, .5, 0, 4.5, 34, 0, 1], step: [.8, 0, .2, 0, 2.6, 16, 20, 1], stomp: [2.8, .3, .9, 8, 5, 55, 90, 1.15], slam: [3.2, .55, 1, 11, 4.5, 60, 100, 1.15], struck: [1.3, .3, .5, 6, 2, 18, 50, 1], cut: [.9, .22, .4, 5, 2, 16, ev.big ? 70 : 34, 1.4] }[ev.kind];
      shake = Math.max(shake, sh); flash = Math.max(flash, fl); kick = Math.max(kick, kk); hold = Math.max(hold, hd);
      fx.push({ a: ev.at, r, ink: 0, div, life: .3, t: 0 });
      if (n) splash.burst(ev.at, ev.dir ?? [0, 0], n, size);
      if (sh > 1.5) blasts.push({ p: [ev.at[0], ev.at[1] + (ev.kind === 'roar' ? 0 : 1.2), ev.at[2]], r: ev.kind === 'roar' ? 8 : 11, split: 300, den: ev.kind === 'roar' ? -12 : -40, life: .7, t: 0 });
      if (ev.kind === 'wake') player.home = [-1, -6];
      if (ev.kind === 'struck') taken++; else if (ev.kind === 'cut') dealt++;
    }
    for (const ev of spar(player, enemy)) {
      if (ev.kind === 'dodge') { warded++; continue; }
      const profile = HIT_FEEDBACK[ev.kind], force = Math.sqrt(ev.impact ?? 1);
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
    hero.visible = f === 0; shade.visible = enemy.present;
    beasts.forEach((b, i) => { b.visible = i === f - 1; });
    const pose = player.pose(t, fade);
    if (f === 0) hero.update(dt, pose, camera.position); else beasts[f - 1].update(dt, pose, camera.position);
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

    // ---- camera: follows with a little lag, and shakes when something big happens
    shake = Math.max(player.shake, shake * Math.exp(-9 * DT)); player.shake = 0;
    gcam += ((giant.awake ? 1 : 0) - gcam) * (1 - Math.exp(-1.4 * dt)); // facing the giant the camera drops back and looks up
    want.set(player.p[0], player.p[1] + (f < 2 ? 1.5 : .3) + 1.1 * gcam, player.p[2]);
    if (!camReady) tgt.copy(want); else tgt.lerp(want, 1 - Math.exp(-14 * dt));
    if (cam.fixed) { eye.set(...cam.fixed.pos); tgt.set(...cam.fixed.look); }
    else {
      const pitch = Math.min(.9, cam.pitch + .36 * gcam), cp = Math.cos(pitch), dist = cam.dist * [1, 1.2, 1.5, 1.15][f] * (1 + .7 * gcam);
      want.set(tgt.x - Math.sin(cam.yaw) * cp * dist, tgt.y - Math.sin(pitch) * dist, tgt.z - Math.cos(cam.yaw) * cp * dist);
      const cq = [want.x, 0, want.z]; pushOut(cq, .45); want.x = cq[0]; want.z = cq[2]; // the camera does not sit inside a trunk
      want.y = Math.max(want.y, height(want.x, want.z) + .6);
      if (!camReady) eye.copy(want); else eye.lerp(want, 1 - Math.exp(-9 * dt));
    }
    camReady = true;
    camera.position.copy(eye);
    camera.lookAt(tgt);
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
    const giantShown = giant.awake ? .5 + .5 * Math.max(giant.lift, giant.wind, giant.roar, giant.planted ? 1 : 0) : .22;
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
        s += `\n\nWASD 移動 · 滑鼠 視角（點一下畫面鎖定）· 空白 跳／升\n1 人 2 虎 3 鶴 4 鯉 · 左鍵／F 出招（連按接三刀）· 右鍵／Q 格擋（抓準時機＝彈開）· Shift 閃避（不按方向＝後跳，按方向＝翻滾；鶴鯉為下降）\n空中按出招＝下突刺 · 閃避尾段按出招＝衝斬 · 被擊飛時按空白＝受身\n巨相撲鬼：四股的震波要跳過或閃過 · 巨掌落下前走開 · 手掌貼地時可以斬\nV 俯視切面 · T 量時 · P 驗算 · R 重置 · Tab 收起\n\n模擬盒 ${sim.n.join('×')} 格 · 每格 ${h} 米`;
        if (ms) s += '\n\n' + Object.entries(ms).map(([k, v]) => `${k.padEnd(18)}${v.toFixed(2)} ms`).join('\n');
        if (probeText) s += '\n\n' + probeText;
      }
      hud.textContent = s;
    }
  }

  // hooks for scripted captures: advance exactly n frames, then wait for the GPU
  window.__advance = async k => { for (let i = 0; i < k; i++) tick(); await device.queue.onSubmittedWorkDone(); return frame; };
  window.__probe = () => sim.probe();
  // wall time per frame with the GPU drained each frame: sim + render, no vsync
  window.__bench = async k => { const t0 = performance.now(); for (let i = 0; i < k; i++) { tick(); await device.queue.onSubmittedWorkDone(); } return (performance.now() - t0) / k; };
  window.__state = () => ({ frame, ms, clock, hold, p: player.p, form: player.form, hp: player.hp, combo: player.combo,
    attack: player.actT, dealt, taken, warded, foe: enemy.mode, enemyHp: enemy.hp, enemyIndex: enemy.n, fall: enemy.fallT, melt: enemy.meltT,
    step: player.demoStep, vy: player.v[1], ground: player.ground, dodge: player.dodge, invuln: player.invuln, ko: player.ko, plunge: player.plunge, fallen: player.fallen,
    hero: { ik: hero.ikW, feet: hero.feet.map(f => { const b = hero.B['foot' + f.k].getWorldPosition(tv); return { planted: f.t >= 1, x: b.x, y: b.y, z: b.z }; }) },
    boss: giant.mode, parts: giant.parts, target: giant.target, planted: giant.planted && giant.fall >= 1 && giant.ik >= 1, side: giant.side,
    foot: giant.parts ? ['footL', 'footR'].map(k => giant.parts[k][1] - height(giant.parts[k][0], giant.parts[k][2])) : null });
  window.__set = o => { if (o.view) { view = o.view; fog.use(view); } if (o.slice != null) fog.u.slice.value = o.slice; if (o.sliceV != null) fog.u.sliceV.value = o.sliceV; if (o.form != null) player.setForm(o.form); if (o.timing != null) timing = o.timing; if (o.hud === false) { hud.style.display = 'none'; } if (o.clear != null) { fog.u.smoke.value = o.clear ? 0 : 1; fog.u.kFog.value = o.clear ? 0 : .13; fog.u.wisp.value = o.clear ? 0 : .85; } };
  if (q.has('manual')) { tick(); window.__done = true; return; }
  renderer.setAnimationLoop(tick);
  window.__done = true;
}

boot().catch(e => { console.error(e); msg.textContent = String(e.message || e); window.__report = { error: String(e.stack || e) }; window.__done = true; });
