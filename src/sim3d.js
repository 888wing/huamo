// Solver A driver: owns the 3D textures and runs the compute stages in sim3d.wgsl once per step.
import src from './sim3d.wgsl';
import mgSrc from './mg.wgsl';
import { half } from './gpu.js';

export const MAX_EM = 12;

export class Sim3D {
  // cfg: { n:[nx,ny,nz], h, org:[x,y,z], f32, terrain: { tex, x0, z0, size } }
  static async create(gpu, cfg) {
    const s = new Sim3D();
    const d = gpu.device;
    s.gpu = gpu; s.cfg = cfg;
    s.n = cfg.n; s.h = cfg.h; s.org = cfg.org;
    s.fmt = cfg.f32 && d.features.has('float32-filterable') ? 'rgba32float' : 'rgba16float';
    s.par = { dt: 1 / 60, vort: 0.25, g: 0.5, cycles: 1, pre: 2, post: 1, coarse: 8, fogTop: 4.5, heal: 0.02, inkFade: 0.08, maccormack: true, rk2: false };
    s.emitters = [];
    s.time = 0;
    const mk = f => gpu.tex(s.n, f);
    s.V0 = mk(s.fmt); s.V1 = mk(s.fmt); s.D0 = mk(s.fmt); s.D1 = mk(s.fmt); s.T = mk(s.fmt);
    s.S = mk('rgba16float'); s.W = mk('rgba16float'); s.R = mk('r32float'); s.M = mk('r32uint'); s.P = mk('r32float'); s.P1 = mk('r32float');
    s.ubuf = d.createBuffer({ size: 96 + MAX_EM * 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    s.udata = new ArrayBuffer(96 + MAX_EM * 64);
    s.uf = new Float32Array(s.udata); s.uu = new Uint32Array(s.udata); s.ui = new Int32Array(s.udata); s.sh = [0, 0, 0];
    const mod = await gpu.module(src.replaceAll('FMT', s.fmt), 'sim3d');
    const names = ['solid', 'init', 'shift', 'advDenF', 'advDenC', 'advVelF', 'advVelC', 'denSrc', 'curl', 'force', 'diverg', 'project'];
    const pipes = await Promise.all(names.map(nm => gpu.pipeline(mod, nm)));
    s.p = Object.fromEntries(names.map((nm, i) => [nm, pipes[i]]));
    s.disp = s.n.map(v => Math.ceil(v / 4));
    // multigrid levels: halve while every side stays even and the grid is still worth a level
    const mg = await gpu.module(mgSrc.replace('RELAX_', (cfg.relax ?? 1.15).toFixed(3)).replace('DAMP_', (cfg.damp ?? 0.85).toFixed(3)), 'mg'), mgNames = ['smoothR', 'smoothB', 'coarsen', 'mask', 'prolong'];
    const mgPipes = await Promise.all(mgNames.map(nm => gpu.pipeline(mg, nm)));
    s.mg = Object.fromEntries(mgNames.map((nm, i) => [nm, mgPipes[i]]));
    s.lv = [{ n: s.n, P: s.P, P1: s.P1, R: s.R, M: s.M }];
    for (let n = s.n; s.lv.length < (cfg.levels ?? 4) && n.every(v => v % 2 === 0 && v >= 8);) {
      n = n.map(v => v / 2);
      s.lv.push({ n, P: gpu.tex(n, 'r32float'), P1: gpu.tex(n, 'r32float'), R: gpu.tex(n, 'r32float'), M: gpu.tex(n, 'r32uint') });
    }
    for (const l of s.lv) l.d = l.n.map(v => Math.ceil(v / 4));
    s.reset();
    return s;
  }

  get cells() { return this.n[0] * this.n[1] * this.n[2]; }
  get bytes() { return this.cells * ((this.fmt === 'rgba32float' ? 16 : 8) * 5 + 8 + 8 + 4 * 4); }

  upload() {
    const { uf, uu, ui, par, n, org, h, cfg } = this;
    ui.set([this.sh[0], this.sh[1], this.sh[2], 0], 20);
    const em = this.emitters.slice(0, MAX_EM);
    uu.set([n[0], n[1], n[2], em.length], 0);
    uf.set([org[0], org[1], org[2], h], 4);
    uf.set([par.dt, par.vort, par.g, 0], 8);
    uf.set([par.fogTop, par.heal, par.inkFade, par.rk2 ? 1 : 0], 12);
    uf.set([cfg.terrain.x0, cfg.terrain.z0, 1 / cfg.terrain.size, par.maccormack ? 1 : 0], 16);
    em.forEach((e, i) => {
      const o = 24 + i * 16, b = e.b ?? e.a, v = e.v ?? [0, 0, 0];
      uf.set([e.a[0], e.a[1], e.a[2], e.r, b[0], b[1], b[2], e.solid ? 1 : 0, v[0], v[1], v[2], e.drag ?? 0, e.fog ?? 0, e.ink ?? 0, e.div ?? 0, 0], o);
    });
    this.gpu.device.queue.writeBuffer(this.ubuf, 0, this.udata);
  }

  reset() {
    this.time = 0;
    this.upload();
    const f = this.gpu.begin(), { p, ubuf: U } = this, [x, y, z] = this.disp;
    f.stage('init');
    f.run(p.init, { 0: U, 6: this.lv[0].P, 9: this.V0, 10: this.D0 }, x, y, z);
    f.end();
  }

  // Keeps the box centred on (x, z): moves it in blocks of `snap` cells and slides the fields to match.
  follow(x, z, snap = 8) {
    const { n, h, org, gpu } = this, s = snap * h;
    const nx = Math.round((x - n[0] * h / 2) / s) * s, nz = Math.round((z - n[2] * h / 2) / s) * s;
    const sx = Math.round((nx - org[0]) / h), sz = Math.round((nz - org[2]) / h);
    if (!sx && !sz) return false;
    this.org = [nx, org[1], nz]; this.sh = [sx, 0, sz];
    this.upload();
    const { p, ubuf: U, V0, V1, D0, D1 } = this, [dx, dy, dz] = this.disp, l = this.lv[0];
    const f = gpu.begin(); f.stage('shift');
    f.run(p.shift, { 0: U, 2: V0, 3: D0, 14: l.P, 9: V1, 10: D1, 6: l.P1 }, dx, dy, dz);
    f.copy(V1, V0); f.copy(D1, D0); f.copy(l.P1, l.P);
    f.end();
    return true;
  }

  // Advances one step. With timed = true resolves to per-stage GPU milliseconds.
  step(timed = false) {
    this.upload();
    const { p, ubuf: U, V0, V1, D0, D1, T, S, R, M, W, gpu, par } = this, [x, y, z] = this.disp;
    const L = gpu.linear, H = this.cfg.terrain.tex;
    const f = gpu.begin(timed);
    f.stage('solids');
    f.run(p.solid, { 0: U, 1: L, 12: S, 13: H }, x, y, z);
    f.stage('advect fog+ink');
    f.run(p.advDenF, { 0: U, 1: L, 2: V0, 3: D0, 11: T }, x, y, z);
    f.run(p.advDenC, { 0: U, 1: L, 2: V0, 3: D0, 4: T, 10: D1 }, x, y, z);
    f.run(p.denSrc, { 0: U, 3: D1, 5: S, 10: D0 }, x, y, z);
    f.stage('advect velocity');
    f.run(p.advVelF, { 0: U, 1: L, 2: V0, 11: T }, x, y, z);
    f.run(p.advVelC, { 0: U, 1: L, 2: V0, 4: T, 9: V1 }, x, y, z);
    f.stage('forces');
    f.run(p.curl, { 0: U, 1: L, 2: V1, 15: W }, x, y, z);
    f.run(p.force, { 0: U, 1: L, 2: V1, 3: D0, 4: W, 5: S, 9: D1 }, x, y, z); // D1 is free here and holds the forced velocity
    f.stage('pressure');
    f.run(p.diverg, { 0: U, 2: D1, 5: S, 8: R, 17: M }, x, y, z);
    this.solve(f);
    f.stage('project');
    f.run(p.project, { 0: U, 2: D1, 5: S, 14: this.lv[0].P, 9: V0 }, x, y, z);
    this.time += par.dt;
    return f.end();
  }

  // Pressure: V-cycles of multigrid, warm-started from the last step's pressure.
  solve(f) {
    const { mg, lv, par } = this, L = lv.length;
    const smooth = (l, k) => { for (let i = 0; i < k; i++) { f.run(mg.smoothR, { 0: l.P, 1: l.R, 2: l.M, 3: l.P1 }, ...l.d); f.run(mg.smoothB, { 0: l.P1, 1: l.R, 2: l.M, 3: l.P }, ...l.d); } };
    for (let i = 1; i < L; i++) f.run(mg.mask, { 2: lv[i - 1].M, 5: lv[i].M }, ...lv[i].d);
    for (let c = 0; c < par.cycles; c++) {
      for (let i = 0; i < L - 1; i++) { smooth(lv[i], par.pre); f.run(mg.coarsen, { 0: lv[i].P, 1: lv[i].R, 2: lv[i].M, 3: lv[i + 1].P, 4: lv[i + 1].R }, ...lv[i + 1].d); }
      smooth(lv[L - 1], L > 1 ? par.coarse : par.pre + par.post);
      for (let i = L - 2; i >= 0; i--) {
        // the correction lands in P1; one black sweep brings it back to P, then whole red+black pairs follow
        const l = lv[i];
        f.run(mg.prolong, { 0: l.P, 2: l.M, 3: l.P1, 6: lv[i + 1].P, 7: lv[i + 1].M }, ...l.d);
        f.run(mg.smoothB, { 0: l.P1, 1: l.R, 2: l.M, 3: l.P }, ...l.d);
        smooth(l, par.post);
      }
    }
  }

  // Slow, for validation only: reads fields back and returns numbers that say how correct the step was.
  async probe() {
    const { gpu, p, ubuf: U, V0, S, R, D0, n } = this, [x, y, z] = this.disp;
    const mask = await gpu.read(this.M);
    const stat = a => {
      let s2 = 0, mx = 0, cnt = 0;
      for (let i = 0; i < a.length; i++) if (mask[i] >> 9 === 0) { const v = Math.abs(a[i]); s2 += v * v; if (v > mx) mx = v; cnt++; }
      return { rms: Math.sqrt(s2 / Math.max(cnt, 1)), max: mx, fluidCells: cnt };
    };
    const before = stat(await gpu.read(R)); // R still holds the divergence the last step had to remove
    const f = gpu.begin(); f.stage('probe');
    f.run(p.diverg, { 0: U, 2: V0, 5: S, 8: R, 17: this.M }, x, y, z);
    f.end();
    const after = stat(await gpu.read(R));
    const den = await gpu.read(D0), vel = await gpu.read(V0), sol = await gpu.read(S);
    const get = this.fmt === 'rgba32float' ? (a, i) => a[i] : (a, i) => half(a[i]);
    let fog = 0, ink = 0, ke = 0, vmax = 0;
    for (let i = 0; i < den.length; i += 4) {
      if (half(sol[i + 3]) === 1) continue;
      fog += get(den, i); ink += get(den, i + 2);
      const u = get(vel, i), v = get(vel, i + 1), w = get(vel, i + 2), q = u * u + v * v + w * w;
      ke += q; if (q > vmax) vmax = q;
    }
    const vol = this.h ** 3;
    return {
      divBefore: before.rms / this.h, divAfter: after.rms / this.h, divMaxAfter: after.max / this.h,
      residual: after.rms / Math.max(before.rms, 1e-12), fluidCells: after.fluidCells,
      fog: fog * vol, ink: ink * vol, kinetic: 0.5 * ke * vol, vmax: Math.sqrt(vmax), cells: n[0] * n[1] * n[2],
    };
  }
}
