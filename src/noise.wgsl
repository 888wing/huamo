// Tiling 3D value noise, baked once into a small texture. r, g: soft cloud noise at two scales; b: fine grain; a: one more octave band.
@group(0) @binding(0) var o: texture_storage_3d<rgba8unorm, write>;
const N = 64.;
fn h3(p: vec3u) -> f32 {
  var x = p.x * 1664525u + p.y * 1013904223u + p.z * 2654435761u;
  x ^= x >> 15u; x *= 2246822519u; x ^= x >> 13u; x *= 3266489917u; x ^= x >> 16u;
  return f32(x) / 4294967295.;
}
fn vn(p: vec3f, per: u32, seed: u32) -> f32 {
  let i = vec3u(floor(p)); let f = fract(p); let u = f * f * (3. - 2. * f);
  var c: array<f32, 8>;
  for (var k = 0u; k < 8u; k++) {
    let q = (i + vec3u(k & 1u, (k >> 1u) & 1u, k >> 2u)) % per;
    c[k] = h3(q + vec3u(seed * 131u, seed * 71u, seed * 17u));
  }
  return mix(mix(mix(c[0], c[1], u.x), mix(c[2], c[3], u.x), u.y), mix(mix(c[4], c[5], u.x), mix(c[6], c[7], u.x), u.y), u.z);
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let q = (vec3f(id) + .5) / N;
  let r = (vn(q * 4., 4u, 1u) + .5 * vn(q * 8., 8u, 2u) + .25 * vn(q * 16., 16u, 3u)) / 1.75;
  let g = (vn(q * 8., 8u, 4u) + .5 * vn(q * 16., 16u, 5u) + .25 * vn(q * 32., 32u, 6u)) / 1.75;
  let b = (vn(q * 16., 16u, 7u) + .5 * vn(q * 32., 32u, 8u)) / 1.5;
  let a = vn(q * 2., 2u, 9u);
  textureStore(o, id, vec4f(r, g, b, a));
}
