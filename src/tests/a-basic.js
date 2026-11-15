// Numeric check of solver A without any renderer: resting fog must stay at rest, a stirred box must stay divergence-free.
import { createDevice, Gpu } from '../gpu.js';
import { Sim3D } from '../sim3d.js';
import { terrainTexture, FOG_TOP } from '../world.js';
(async () => {
  const q = new URLSearchParams(location.search);
  const { device } = await createDevice();
  const gpu = new Gpu(device);
  const n = (q.get('n') ?? '128,48,128').split(',').map(Number), h = +(q.get('h') ?? 0.25);
  const sim = await Sim3D.create(gpu, { n, h, org: [-n[0] * h / 2, -2, -n[2] * h / 2 + 12], f32: q.get('f32') !== '0', levels: +(q.get('levels') ?? 4), relax: +(q.get('relax') ?? 1.15), damp: +(q.get('damp') ?? 0.85), terrain: terrainTexture(gpu) });
  sim.par.fogTop = FOG_TOP; sim.reset();
  for (const k of ['cycles', 'pre', 'post', 'coarse']) if (q.has(k)) sim.par[k] = +q.get(k);
  if (q.has('mc')) sim.par.maccormack = q.get('mc') !== '0';
  if (q.has('rk2')) sim.par.rk2 = q.get('rk2') === '1';
  if (q.has('vort')) sim.par.vort = +q.get('vort');
  sim.par.heal = 0; sim.par.inkFade = 0;
  const rep = { fmt: sim.fmt, n, h, mb: +(sim.bytes / 2 ** 20).toFixed(1) };
  // 1. two seconds of nothing: hydrostatic balance
  for (let i = 0; i < 120; i++) sim.step();
  rep.rest = await sim.probe();
  // 2. one second of a strong sideways push plus a sink of divergence, then let it evolve
  sim.emitters = [{ a: [0, 2, 10], b: [0, 2, 14], r: 1.5, v: [10, 0, 0], drag: 20, ink: 2 }, { a: [-6, 2.5, 16], r: 2, div: 4 }];
  
  for (let i = 0; i < 60; i++) sim.step();
  rep.pushed = await sim.probe();
  sim.emitters = [];
  for (let i = 0; i < 120; i++) sim.step();
  rep.after2s = await sim.probe();
  if (q.has('mgtest')) {
    // freeze the right-hand side and watch the restricted residual fall, one V-cycle at a time
    sim.emitters = [{ a: [0, 2, 10], b: [0, 2, 14], r: 1.5, v: [10, 0, 0], drag: 20 }];
    sim.step();
    const lv = sim.lv, mg = sim.mg, rms = a => Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length);
    const resid = async () => { const f = gpu.begin(); f.stage('r'); f.run(mg.coarsen, { 0: lv[0].P, 1: lv[0].R, 2: lv[0].M, 3: lv[1].P, 4: lv[1].R }, ...lv[1].d); f.end(); return rms(await gpu.read(lv[1].R)); };
    rep.mg = [await resid()];
    const save = sim.par.cycles; sim.par.cycles = 1;
    for (let i = 0; i < 6; i++) { const f = gpu.begin(); f.stage('s'); sim.solve(f); f.end(); rep.mg.push(await resid()); }
    sim.par.cycles = save;
    rep.mg = rep.mg.map(v => +v.toExponential(3));
    window.__report = rep; window.__done = true; return;
  }
  // 3. timing over 60 steps
  const acc = {}; let cnt = 0;
  for (let i = 0; i < 60; i++) { const t = await sim.step(true); if (t) { cnt++; for (const k in t) acc[k] = (acc[k] ?? 0) + t[k]; } await device.queue.onSubmittedWorkDone(); }
  rep.ms = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +(v / cnt).toFixed(3)]));
  rep.msTotal = +Object.values(rep.ms).reduce((a, b) => a + b, 0).toFixed(3);
  window.__report = rep; window.__done = true;
})().catch(e => { window.__report = { error: String(e.stack || e) }; window.__done = true; });
