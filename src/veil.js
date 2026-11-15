// Driver for the smoke layers: each Veil is one camera-facing plane with its own 2D fluid simulation.
import src from './veil.wgsl';

export const VW = 384, VH = 216;
const MAXS = 10;
let pipes = null;

export class Veil {
  // opt: d (distance from the camera, m), k (opacity), tone, amount (how much smoke), heal, top (altitude smoke gathers below), turb, lift
  static async create(gpu, i, opt) {
    if (!pipes) {
      const m = await gpu.module(src, 'veil'), names = ['advect', 'diverg', 'jacobi', 'project'];
      const ps = await Promise.all(names.map(n => gpu.pipeline(m, n)));
      pipes = Object.fromEntries(names.map((n, k) => [n, ps[k]]));
    }
    const v = Object.assign(new Veil(), { heal: .5, top: 4.4, turb: 36, lift: 3 }, opt);
    v.gpu = gpu; v.seed = i * 7.3;
    const mk = () => gpu.tex([VW, VH], 'rgba16float');
    v.A = mk(); v.B = mk(); v.D = mk(); v.P0 = mk(); v.P1 = mk(); v.E0 = mk(); v.E1 = mk();
    v.ubuf = gpu.device.createBuffer({ size: 96 + MAXS * 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    v.u = new Float32Array(24 + MAXS * 12); v.off = [0, 0];
    return v;
  }
  // f: an open compute stage; scroll: [x, y] texels; cam: { y, tanY, aspect, fy, uy, ry }; splats: [{ x, y, r, w, vx, vy, den, drag }]
  step(f, dt, time, scroll, cam, splats) {
    const u = this.u, n = Math.min(splats.length, MAXS);
    u.set([VW, VH, dt, time, scroll[0], scroll[1], this.amount, this.heal, cam.y, this.d, cam.tanY, cam.aspect, cam.fy, cam.uy, cam.ry, this.top, this.turb, this.lift, n, this.seed, (this.off[0] += scroll[0]), (this.off[1] += scroll[1]), 0, 0]);
    for (let k = 0; k < n; k++) { const s = splats[k]; u.set([s.x, s.y, s.r, s.w, s.vx, s.vy, s.den, s.drag, s.x2 ?? s.x, s.y2 ?? s.y, s.split ?? 0, 0], 24 + k * 12); }
    this.gpu.device.queue.writeBuffer(this.ubuf, 0, u);
    const { A, B, D, P0, P1, E0, E1, ubuf: U } = this, L = this.gpu.linear, x = VW / 8, y = VH / 8;
    f.run(pipes.advect, { 0: U, 1: L, 2: A, 5: B, 7: E0, 8: E1 }, x, y);
    f.run(pipes.diverg, { 2: B, 6: D }, x, y);
    for (let i = 0; i < 8; i++) { f.run(pipes.jacobi, { 3: P0, 4: D, 6: P1 }, x, y); f.run(pipes.jacobi, { 3: P1, 4: D, 6: P0 }, x, y); }
    f.run(pipes.project, { 2: B, 3: P0, 5: A, 7: E1, 8: E0 }, x, y);
  }
}
