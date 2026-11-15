// Geometric multigrid for the pressure equation  sum(p over fluid neighbours) - count * p = rhs.
// Every level has the same layout: p (two textures, alternating), rhs, and a mask per cell:
// bits 0-5 which neighbours are fluid, bits 6-8 how many neighbours are not solid, bits 9-10 kind (0 fluid, 1 solid, 2 open).
// Sizes come from the bound textures, so one set of pipelines serves all levels.
@group(0) @binding(0) var pI: texture_3d<f32>;
@group(0) @binding(1) var rI: texture_3d<f32>;
@group(0) @binding(2) var mI: texture_3d<u32>;
@group(0) @binding(3) var pO: texture_storage_3d<r32float, write>;
@group(0) @binding(4) var rO: texture_storage_3d<r32float, write>;
@group(0) @binding(5) var mO: texture_storage_3d<r32uint, write>;
@group(0) @binding(6) var pC: texture_3d<f32>;
@group(0) @binding(7) var mC: texture_3d<u32>;

const RELAX = RELAX_;
const DAMP = DAMP_; // share of the coarse correction that is applied
fn nb(i: i32) -> vec3i {
  let a = i >> 1; let s = (i & 1) * 2 - 1;
  return vec3i(i32(a == 0), i32(a == 1), i32(a == 2)) * s;
}
fn around(id: vec3i, m: u32) -> f32 {
  var sum = 0.;
  for (var i = 0; i < 6; i++) { if ((m & (1u << u32(i))) != 0u) { sum += textureLoad(pI, id + nb(i), 0).x; } }
  return sum;
}

// red-black Gauss-Seidel: relax one colour, copy the other
fn relax(g: vec3u, colour: u32) {
  if (any(g >= textureDimensions(pI))) { return; }
  let id = vec3i(g);
  let old = textureLoad(pI, id, 0).x;
  if (((g.x + g.y + g.z) & 1u) != colour) { textureStore(pO, id, vec4f(old)); return; }
  let m = textureLoad(mI, id, 0).x;
  let cnt = f32((m >> 6u) & 7u);
  if ((m >> 9u) != 0u || cnt < .5) { textureStore(pO, id, vec4f(0.)); return; }
  textureStore(pO, id, vec4f(mix(old, (around(id, m) - textureLoad(rI, id, 0).x) / cnt, RELAX)));
}
@compute @workgroup_size(4, 4, 4) fn smoothR(@builtin(global_invocation_id) g: vec3u) { relax(g, 0u); }
@compute @workgroup_size(4, 4, 4) fn smoothB(@builtin(global_invocation_id) g: vec3u) { relax(g, 1u); }

// what is left of the equation on the fine grid becomes the right-hand side of the coarse grid; coarse p starts at zero
@compute @workgroup_size(4, 4, 4) fn coarsen(@builtin(global_invocation_id) g: vec3u) {
  if (any(g * 2u >= textureDimensions(pI))) { return; }
  var acc = 0.;
  for (var k = 0; k < 8; k++) {
    let c = vec3i(g) * 2 + vec3i(k & 1, (k >> 1) & 1, k >> 2);
    let m = textureLoad(mI, c, 0).x;
    let cnt = f32((m >> 6u) & 7u);
    if ((m >> 9u) != 0u || cnt < .5) { continue; }
    acc += textureLoad(rI, c, 0).x - (around(c, m) - cnt * textureLoad(pI, c, 0).x);
  }
  textureStore(rO, g, vec4f(acc * .5)); // cells are twice as wide: 4 x the mean of 8
  textureStore(pO, g, vec4f(0.));
}

// a coarse cell is fluid if any of its 8 children is, else open if any child is open, else solid
fn coarseKind(c: vec3i) -> u32 {
  let n = vec3i(textureDimensions(mI)) / 2;
  if (any(c < vec3i(0)) || any(c >= n)) { return 2u; }
  var open = false;
  for (var k = 0; k < 8; k++) {
    let kind = textureLoad(mI, c * 2 + vec3i(k & 1, (k >> 1) & 1, k >> 2), 0).x >> 9u;
    if (kind == 0u) { return 0u; }
    if (kind == 2u) { open = true; }
  }
  return select(1u, 2u, open);
}
@compute @workgroup_size(4, 4, 4) fn mask(@builtin(global_invocation_id) g: vec3u) {
  if (any(g * 2u >= textureDimensions(mI))) { return; }
  let own = coarseKind(vec3i(g));
  var cnt = 0u; var bits = 0u;
  if (own == 0u) {
    for (var i = 0; i < 6; i++) {
      let k = coarseKind(vec3i(g) + nb(i));
      if (k != 1u) { cnt += 1u; }
      if (k == 0u) { bits |= 1u << u32(i); }
    }
  }
  textureStore(mO, g, vec4u(bits | (cnt << 6u) | (own << 9u)));
}

// add the coarse correction back, interpolated trilinearly from the coarse cells that are not solid
@compute @workgroup_size(4, 4, 4) fn prolong(@builtin(global_invocation_id) g: vec3u) {
  if (any(g >= textureDimensions(pI))) { return; }
  if ((textureLoad(mI, g, 0).x >> 9u) != 0u) { textureStore(pO, g, vec4f(0.)); return; }
  let x = (vec3f(g) + .5) * .5 - .5; let b = vec3i(floor(x)); let f = x - floor(x);
  let n = vec3i(textureDimensions(pC));
  var e = 0.; var ws = 0.;
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, k >> 2); let q = b + o;
    let wv = mix(1. - f, f, vec3f(o)); let w = wv.x * wv.y * wv.z;
    if (any(q < vec3i(0)) || any(q >= n)) { ws += w; continue; }
    if ((textureLoad(mC, q, 0).x >> 9u) == 1u) { continue; }
    e += w * textureLoad(pC, q, 0).x; ws += w;
  }
  textureStore(pO, g, vec4f(textureLoad(pI, g, 0).x + DAMP * e / max(ws, 1e-4)));
}
