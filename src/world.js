// The test valley: a closed basin so fog pools in it, a plateau above the fog, a pond, and rock pillars.
// Pure math, shared by the terrain mesh, character collision and both simulations.

export const SIZE = 64;          // metres across, centred on the origin
export const FOG_TOP = 3.1;      // altitude of the resting fog surface

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// x, z, radius, height
export const PILLARS = [[-9, -6, 1.6, 9], [-4, 9, 1.2, 7], [7, 4, 2.0, 11], [12, -10, 1.4, 8], [-15, 4, 1.1, 6.5], [9.5, -16, 1.7, 9.5]]; // the last one stands at the edge of the giant's clearing

export function height(x, z) {
  const r = Math.hypot(x, z) / (SIZE / 2);
  let h = 1.2 * noise(x * .09 + 3, z * .09 + 7) + .5 * noise(x * .23, z * .23) + .18 * noise(x * .7, z * .7);
  h += 10 * sstep(.68, 1, r);                                                 // rim that holds the fog in
  h -= 1.6 * Math.exp(-((x - 6) ** 2 + (z + 3) ** 2) / 90);                    // pond
  const pl = sstep(13, 17, -x + .35 * z + 2 * noise(x * .15, z * .15));       // plateau on the west side
  h = h + (6.4 - h) * pl * .92;
  for (const [px, pz, pr, ph] of PILLARS) {
    const d = Math.hypot(x - px, z - pz) + .25 * noise(x * 1.3, z * 1.3);
    h = Math.max(h, ph * (1 - sstep(pr - .45, pr, d)));
  }
  return h;
}

// n x n heights at texel centres over the square
export function bake(n) {
  const out = new Float32Array(n * n), s = SIZE / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = height(-SIZE / 2 + (i + .5) * s, -SIZE / 2 + (j + .5) * s);
  return out;
}

export function toHalf(f32) {
  const out = new Uint16Array(f32.length), fv = new Float32Array(1), iv = new Int32Array(fv.buffer);
  for (let i = 0; i < f32.length; i++) {
    fv[0] = f32[i];
    const x = iv[0], s = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
    out[i] = e <= 0 ? s : e >= 31 ? s | 0x7c00 : s | (e << 10) | ((m + 0x1000) >> 13);
  }
  return out;
}

// terrain as a filterable GPU texture for the sims
export function terrainTexture(gpu, n = 256) {
  const tex = gpu.tex([n, n], 'r16float', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
  gpu.device.queue.writeTexture({ texture: tex }, toHalf(bake(n)), { bytesPerRow: n * 2 }, [n, n]);
  return { tex, x0: -SIZE / 2, z0: -SIZE / 2, size: SIZE };
}

// The path through the forest, south to north, as a line of points (x, z).
export const PATH = [[0, 24], [3, 15], [-4, 6], [5, -2], [-2, -11], [1, -22]];
export const START = [.4, 22.5]; // where the player begins, at the path's south end
export function pathDist(x, z) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// a point on the path at a share f (0..1) of its length
export function pathPoint(f) {
  const seg = PATH.slice(1).map((b, i) => Math.hypot(b[0] - PATH[i][0], b[1] - PATH[i][1])), total = seg.reduce((a, b) => a + b, 0);
  let d = f * total;
  for (let i = 0; i < seg.length; i++) { if (d <= seg[i] || i === seg.length - 1) { const t = Math.min(1, d / seg[i]); return [PATH[i][0] + (PATH[i + 1][0] - PATH[i][0]) * t, PATH[i][1] + (PATH[i + 1][1] - PATH[i][1]) * t]; } d -= seg[i]; }
}
export const FIGHT_STATIONS = [.22, .38, .54, .7].map(pathPoint);
// The forest path widens into a clearing for the first encounter.
export const DUEL_CLEARING = { center: FIGHT_STATIONS[0], entry: pathPoint(.15), radius: 4.6 };
export function duelDist(x, z) {
  const [cx, cz] = DUEL_CLEARING.center;
  return Math.hypot(x - cx, z - cz);
}
// The clearing at the path's end where the giant waits: it squats at `home` and never goes far from it.
export const ARENA = { home: [.6, -20.5], gate: [-.6, -13] };
export function arenaDist(x, z) {
  const [ax, az] = ARENA.home, [bx, bz] = ARENA.gate, dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// The bout is fought inside a curtain of fog that runs round the clearing this far from the line home-gate. Walking in
// through it wakes the giant; after that it does not let anyone out.
export const SEAL = 8.5;
// pulls a point back inside the curtain; true if it was outside
export function arenaKeep(p, r = SEAL - .6) {
  const [ax, az] = ARENA.home, [bx, bz] = ARENA.gate, dx = bx - ax, dz = bz - az, t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[2] - az) * dz) / (dx * dx + dz * dz)));
  const cx = ax + dx * t, cz = az + dz * t, ex = p[0] - cx, ez = p[2] - cz, d = Math.hypot(ex, ez);
  if (d <= r) return false; p[0] = cx + ex / d * r; p[2] = cz + ez / d * r; return true;
}
// the curtain's line on the ground, as a closed loop of points [x, z]
export function arenaEdge(n = 72, r = SEAL) {
  const [ax, az] = ARENA.home, [bx, bz] = ARENA.gate, ux = bx - ax, uz = bz - az, out = [];
  for (let i = 0; i <= n; i++) { const a = i / n * 6.2832, cx = Math.sin(a), cz = Math.cos(a), g = cx * ux + cz * uz > 0; out.push([(g ? bx : ax) + cx * r, (g ? bz : az) + cz * r]); }
  return out;
}
// tree trunks: [x, z, radius], filled in by the stage. pushOut keeps a body (or the camera) outside them.
export const OBSTACLES = [];
export function pushOut(p, pad, list = OBSTACLES) {
  for (const [x, z, r] of list) { const dx = p[0] - x, dz = p[2] - z, d = Math.hypot(dx, dz), m = r + pad; if (d < m && d > 1e-4) { p[0] = x + dx / d * m; p[2] = z + dz / d * m; } }
}
