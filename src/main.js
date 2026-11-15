// 化墨 — fog-as-ink slice. Boots the device, the fog simulation, the three.js scene, input and the frame loop.
import * as THREE from 'three/webgpu';
import { createDevice, Gpu } from './gpu.js';
import { Sim3D } from './sim3d.js';
import { FOG_TOP, height, terrainTexture } from './world.js';
import { buildStage, buildTrail, buildSplash, noiseTexture, external, PAPER } from './stage.js';
import { buildBeasts } from './beasts.js';
import { createFog } from './fog.js';
import { Player, Enemy, spar, FORMS, HP } from './player.js';
import { Figure } from './figure.js';
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
  buildStage(scene, noise);
  const beasts = buildBeasts(scene, noise), trail = buildTrail(noise), trail2 = buildTrail(noise, trail.scene);
  const hero = new Figure(scene, noise, { robe: .76, cloak: .1, legs: .22, hat: .46, skin: .8, wraps: .74 });
  const shade = new Figure(scene, noise, { robe: .2, cloak: .02, legs: .06, hat: .1, skin: .3, wraps: .16 });
  const enemy = new Enemy(), fx = [], splash = buildSplash(trail.scene);
  let dealt = 0, taken = 0, warded = 0;
  const fog = createFog(renderer, scene, camera, noise, external(sim.D0), trail.scene, external(sim.V0));
  fog.u.boxSize.value.set(n[0] * h, n[1] * h, n[2] * h); fog.u.top.value = sim.org[1] + n[1] * h;
  let view = q.get('view') ?? 'fog';
  fog.use(view);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  // ---- input
  const player = new Player(); player.foe = enemy;
  const cam = { yaw: Math.PI, pitch: -0.36, dist: 6.2 };
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
  let hold = 0, clock = 0;
  const tgt = new THREE.Vector3(), eye = new THREE.Vector3(), want = new THREE.Vector3();
  let camReady = false;

  function tick() {
    // a blow that lands stops time for a few frames: that pause is where the weight is felt
    const dt = hold > 0 ? (hold--, DT * .05) : DT; sim.par.dt = dt; clock += dt;
    const t = clock;
    if (demo) demo(t, player, cam, override);
    player.update(dt, demo ? override : input(), cam, enemy.alive ? enemy.p : null);
    enemy.update(dt, player.p);
    for (const ev of spar(player, enemy)) { // every blow lands as a burst of ink and air
      const big = ev.kind === 'kill' || ev.kind === 'clash' || ev.kind === 'parry' || ev.kind === 'down';
      if (ev.kind === 'dodge') { warded++; continue; }
      const away = ev.kind === 'taken' || ev.kind === 'down' ? [player.p[0] - enemy.p[0], player.p[2] - enemy.p[2]] : [enemy.p[0] - player.p[0], enemy.p[2] - player.p[2]], al = Math.hypot(away[0], away[1]) || 1;
      splash.burst(ev.at, [away[0] / al, away[1] / al], big ? 60 : 34); hold = big ? 8 : 5;
      fx.push({ a: ev.at, r: big ? 2.6 : 1.9, ink: 0, div: big ? 26 : 16, life: .2, t: 0 }); // a shock that blows the fog open around the blow
      player.shake = Math.max(player.shake, big ? 1.3 : .8);
      if (ev.kind === 'taken' || ev.kind === 'down') taken++; else if (ev.kind === 'cut' || ev.kind === 'kill' || ev.kind === 'push') dealt++; else if (ev.kind === 'parry' || ev.kind === 'block') warded++;
    }
    for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].t += dt) > fx[i].life) fx.splice(i, 1);
    sim.emitters = [...player.emitters(), ...enemy.emitters(), ...fx.map(e => ({ a: e.a, r: e.r, ink: e.ink, div: e.div * Math.sin(Math.PI * e.t / e.life) }))];
    sim.follow(player.p[0], player.p[2]); fog.u.boxMin.value.set(...sim.org);
    const timed = timing && frame % 20 === 0 ? sim.step(true) : (sim.step(), null);
    timed?.then(r => { if (r) ms = r; });

    // ---- bodies: skeletons posed in code on top of the simulation-driven position
    const f = player.form, sp = Math.hypot(player.v[0], player.v[2]), run = Math.min(1, sp / [5.5, 12, 11, 7.5][f]);
    const act = player.actT, down = player.fallen > 0 ? Math.min(1, (1.8 - player.fallen) / .5) : 0, fade = Math.max(.6 * player.burstT ** 2, down);
    hero.visible = f === 0; shade.visible = enemy.mode !== 'gone';
    beasts.forEach((b, i) => { b.visible = i === f - 1; });
    const pose = { p: player.p, yaw: player.yaw, phase: player.phase, run, act, side: player.side, windup: 0, stagger: player.stagger / .45, fade, guard: player.guard, vy: player.v[1], time: t };
    if (f === 0) hero.update(dt, pose, camera.position); else beasts[f - 1].update(dt, pose, camera.position);
    if (shade.group.visible) shade.update(dt, { p: enemy.p, yaw: enemy.yaw, phase: enemy.phase, run: Math.min(1, Math.hypot(enemy.v[0], enemy.v[2]) / 3.6), act: enemy.actT, side: enemy.side, windup: enemy.windup, stagger: enemy.stagger / .5, fade: enemy.fade, fall: enemy.fallT, melt: enemy.meltT, eyes: true, time: t }, camera.position);
    const bl = player.blade();
    trail.update(dt, bl && bl.b, bl ? .05 + .24 * Math.sin(Math.PI * act) ** .7 : 0);
    splash.update(dt);
    const eb = enemy.blade(); trail2.update(dt, eb && eb.b, eb ? .05 + .24 * Math.sin(Math.PI * enemy.actT) ** .7 : 0);

    // ---- camera: follows with a little lag, and shakes when something big happens
    shake = Math.max(player.shake, shake * Math.exp(-7 * dt)); player.shake = 0;
    want.set(player.p[0], player.p[1] + (f < 2 ? 1.5 : .3), player.p[2]);
    if (!camReady) tgt.copy(want); else tgt.lerp(want, 1 - Math.exp(-14 * dt));
    if (cam.fixed) { eye.set(...cam.fixed.pos); tgt.set(...cam.fixed.look); }
    else {
      const cp = Math.cos(cam.pitch), dist = cam.dist * [1, 1.2, 1.5, 1.15][f];
      want.set(tgt.x - Math.sin(cam.yaw) * cp * dist, tgt.y - Math.sin(cam.pitch) * dist, tgt.z - Math.cos(cam.yaw) * cp * dist);
      want.y = Math.max(want.y, height(want.x, want.z) + .6);
      if (!camReady) eye.copy(want); else eye.lerp(want, 1 - Math.exp(-9 * dt));
    }
    camReady = true;
    camera.position.copy(eye);
    camera.position.x += Math.sin(t * 61) * shake * .12; camera.position.y += Math.sin(t * 47 + 1) * shake * .12;
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
    fog.u.time.value = t;
    fog.u.hero.value.set(player.p[0], player.p[1] + (f < 2 ? .95 : 0), player.p[2]); fog.u.heroR.value = [1.4, 1.6, 2.4, 1.6][f];
    fog.u.hero2.value.set(enemy.p[0], enemy.mode === 'gone' ? -99 : enemy.p[1] + .95, enemy.p[2]);
    fog.render();
    frame++;

    const now = performance.now(); fps += (1000 / Math.max(now - last, 1) - fps) * .05; last = now;
    if (frame % 10 === 0) {
      const tot = ms ? Object.values(ms).reduce((a, b) => a + b, 0) : 0;
      const pips = (n, of) => '●'.repeat(Math.max(0, n)) + '○'.repeat(of - Math.max(0, n));
      let s = `${FORMS[f]}  我 ${pips(player.hp, HP)}  敵 ${pips(enemy.alive ? enemy.hp : 0, 3)}  中 ${dealt} 擋 ${warded} 受 ${taken} · ${fps.toFixed(0)} fps${ms ? ` · sim ${tot.toFixed(2)} ms` : ''}`;
      if (drawer) {
        s += `\n\nWASD 移動 · 滑鼠 視角（點一下畫面鎖定）· 空白 跳／升\n1 人 2 虎 3 鶴 4 鯉 · 左鍵／F 出招 · 右鍵／Q 格擋（抓準時機＝彈開）· Shift 閃避（鶴鯉為下降）\nV 俯視切面 · T 量時 · P 驗算 · R 重置 · Tab 收起\n\n模擬盒 ${sim.n.join('×')} 格 · 每格 ${h} 米`;
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
  window.__state = () => ({ frame, ms, p: player.p, form: player.form, hp: player.hp, dealt, taken, warded, foe: enemy.mode });
  window.__set = o => { if (o.view) { view = o.view; fog.use(view); } if (o.slice != null) fog.u.slice.value = o.slice; if (o.sliceV != null) fog.u.sliceV.value = o.sliceV; if (o.form != null) player.setForm(o.form); if (o.timing != null) timing = o.timing; if (o.hud === false) { hud.style.display = 'none'; } };
  if (q.has('manual')) { tick(); window.__done = true; return; }
  renderer.setAnimationLoop(tick);
  window.__done = true;
}

boot().catch(e => { console.error(e); msg.textContent = String(e.message || e); window.__report = { error: String(e.stack || e) }; window.__done = true; });
