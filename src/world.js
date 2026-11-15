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
export const PILLARS = [[-9, -6, 1.6, 9], [-4, 9, 1.2, 7], [7, 4, 2.0, 11], [12, -10, 1.4, 8], [-15, 4, 1.1, 6.5], [2, -14, 1.7, 9.5]];

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
