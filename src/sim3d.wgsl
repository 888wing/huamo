// Solver A: incompressible 3D flow on a staggered (MAC) grid.
// Velocity texel (i,j,k) holds u on the x-face at x=i, v on the y-face at y=j, w on the z-face at z=k (cell units).
// Cell centres sit at id + 0.5. Density texels are cell-centred: r = fog, b = ink.
// FMT is replaced at load time with rgba16float or rgba32float.

struct Em {
  a: vec4f, // capsule start xyz (world), radius
  b: vec4f, // capsule end xyz, kind: 0 = soft push, 1 = solid body
  v: vec4f, // velocity xyz (m/s), drag rate (1/s) for soft emitters
  s: vec4f, // fog per second, ink per second, divergence (1/s), unused
}
struct Params {
  dim: vec4u, // NX NY NZ, emitter count
  org: vec4f, // box min corner (world), cell size h
  a: vec4f,   // dt, vorticity confinement, reduced gravity g', unused
  b: vec4f,   // fog top altitude, fog heal rate, ink fade rate, 1 = midpoint (RK2) back-trace
  c: vec4f,   // terrain map: world x0, z0, 1/size ; advection: 0 semi-Lagrangian, 1 MacCormack
  sh: vec4i,  // cells the box just moved by (for the shift passes)
  em: array<Em, 16>,
}

@group(0) @binding(0) var<uniform> P_: Params;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var vI: texture_3d<f32>;
@group(0) @binding(3) var dI: texture_3d<f32>;
@group(0) @binding(4) var tI: texture_3d<f32>;
@group(0) @binding(5) var sI: texture_3d<f32>;
@group(0) @binding(6) var pO: texture_storage_3d<r32float, write>;
@group(0) @binding(8) var rO: texture_storage_3d<r32float, write>;
@group(0) @binding(9) var vO: texture_storage_3d<FMT, write>;
@group(0) @binding(10) var dO: texture_storage_3d<FMT, write>;
@group(0) @binding(11) var tO: texture_storage_3d<FMT, write>;
@group(0) @binding(12) var sO: texture_storage_3d<rgba16float, write>;
@group(0) @binding(13) var hT: texture_2d<f32>;
@group(0) @binding(14) var pI: texture_3d<f32>;
@group(0) @binding(15) var wO: texture_storage_3d<rgba16float, write>;
@group(0) @binding(17) var mO: texture_storage_3d<r32uint, write>;

const X = vec3f(1., 0., 0.);
const Y = vec3f(0., 1., 0.);
const Z = vec3f(0., 0., 1.);
const FLUID = 0.;
const SOLID = 1.;
const OPEN = 2.;

fn dims() -> vec3f { return vec3f(P_.dim.xyz); }
fn world(c: vec3f) -> vec3f { return P_.org.xyz + c * P_.org.w; }
fn inside(id: vec3u) -> bool { return all(id < P_.dim.xyz); }

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f) -> f32 {
  let pa = p - a; let ba = b - a;
  let t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
  return length(pa - ba * t);
}
fn fall(d: f32, r: f32) -> f32 { return 1. - smoothstep(.5, 1., d / r); }

// velocity at a point given in cell units
fn velAt(p: vec3f) -> vec3f {
  let n = 1. / dims();
  return vec3f(
    textureSampleLevel(vI, smp, (p + .5 * X) * n, 0.).x,
    textureSampleLevel(vI, smp, (p + .5 * Y) * n, 0.).y,
    textureSampleLevel(vI, smp, (p + .5 * Z) * n, 0.).z);
}
// where the fluid now at p was one step ago (s = dt/h, negative s traces forward).
// MacCormack is already second order with single-step traces, so the midpoint rule is optional.
fn trace(p: vec3f, s: f32) -> vec3f {
  let v1 = velAt(p);
  if (P_.b.w < .5) { return p - s * v1; }
  return p - s * velAt(p - .5 * s * v1);
}
fn fogTarget(y: f32) -> f32 { return 1. - smoothstep(-.6, .6, y - P_.b.x); }

// ---------------------------------------------------------------- solids
@compute @workgroup_size(4, 4, 4) fn solid(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let w = world(vec3f(id) + .5);
  var k = FLUID; var vel = vec3f(0.);
  if (any(id == vec3u(0u)) || any(id + 1u == P_.dim.xyz)) { k = OPEN; }
  let ground = textureSampleLevel(hT, smp, (w.xz - P_.c.xy) * P_.c.z, 0.).x;
  if (w.y < ground || id.y == 0u) { k = SOLID; }
  for (var i = 0u; i < P_.dim.w; i++) {
    let e = P_.em[i];
    if (e.b.w > .5 && sdCapsule(w, e.a.xyz, e.b.xyz) < e.a.w) { k = SOLID; vel = e.v.xyz; }
  }
  textureStore(sO, id, vec4f(vel, k));
}

// ---------------------------------------------------------------- start state
@compute @workgroup_size(4, 4, 4) fn init(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let w = world(vec3f(id) + .5);
  textureStore(dO, id, vec4f(fogTarget(w.y), 0., 0., 0.));
  textureStore(vO, id, vec4f(0.));
  textureStore(pO, id, vec4f(0.));
}

// ---------------------------------------------------------------- following the player
// The box moves in whole cells. Fields slide the other way; cells that enter get resting fog and still air.
fn shifted(id: vec3u, ok: ptr<function, bool>) -> vec3i {
  let q = vec3i(id) + P_.sh.xyz;
  *ok = all(q >= vec3i(0)) && all(q < vec3i(P_.dim.xyz));
  return q;
}
@compute @workgroup_size(4, 4, 4) fn shift(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  var ok: bool; let q = shifted(id, &ok);
  var v = vec4f(0.); var d = vec4f(fogTarget(world(vec3f(id) + .5).y), 0., 0., 0.); var pr = 0.;
  if (ok) { v = textureLoad(vI, q, 0); d = textureLoad(dI, q, 0); pr = textureLoad(pI, q, 0).x; }
  textureStore(vO, id, v); textureStore(dO, id, d); textureStore(pO, id, vec4f(pr));
}

// ---------------------------------------------------------------- advection
// 8 texels around a sample point, for the MacCormack limiter
fn boxMinMax(t: texture_3d<f32>, tc: vec3f, mn: ptr<function, vec4f>, mx: ptr<function, vec4f>) {
  let b = vec3i(floor(tc - .5));
  let hi = vec3i(P_.dim.xyz) - 1;
  var lo4 = vec4f(1e9); var hi4 = vec4f(-1e9);
  for (var i = 0; i < 8; i++) {
    let o = vec3i(i & 1, (i >> 1) & 1, i >> 2);
    let v = textureLoad(t, clamp(b + o, vec3i(0), hi), 0);
    lo4 = min(lo4, v); hi4 = max(hi4, v);
  }
  *mn = lo4; *mx = hi4;
}

@compute @workgroup_size(4, 4, 4) fn advDenF(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let p = vec3f(id) + .5;
  let back = trace(p, P_.a.x / P_.org.w);
  textureStore(tO, id, textureSampleLevel(dI, smp, back / dims(), 0.));
}
// MacCormack: undo the forward step, take half the round-trip error back out, keep the result inside local bounds
@compute @workgroup_size(4, 4, 4) fn advDenC(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let p = vec3f(id) + .5; let s = P_.a.x / P_.org.w;
  let hat = textureLoad(tI, id, 0);
  var r = hat;
  if (P_.c.w > .5) {
    let back = trace(p, s);
    let fwd = trace(p, -s);
    let til = textureSampleLevel(tI, smp, fwd / dims(), 0.);
    var mn: vec4f; var mx: vec4f;
    boxMinMax(dI, back, &mn, &mx);
    r = clamp(hat + .5 * (textureLoad(dI, id, 0) - til), mn, mx);
  }
  textureStore(dO, id, r);
}

fn faceOff(c: i32) -> vec3f { return .5 * (vec3f(1.) - vec3f(f32(c == 0), f32(c == 1), f32(c == 2))); }
fn axis(c: i32) -> vec3f { return vec3f(f32(c == 0), f32(c == 1), f32(c == 2)); }

@compute @workgroup_size(4, 4, 4) fn advVelF(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let s = P_.a.x / P_.org.w; let n = 1. / dims();
  var o = vec4f(0.);
  for (var c = 0; c < 3; c++) {
    let back = trace(vec3f(id) + faceOff(c), s);
    o[c] = textureSampleLevel(vI, smp, (back + .5 * axis(c)) * n, 0.)[c];
  }
  textureStore(tO, id, o);
}
@compute @workgroup_size(4, 4, 4) fn advVelC(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let s = P_.a.x / P_.org.w; let n = 1. / dims();
  let hat = textureLoad(tI, id, 0);
  var o = hat;
  if (P_.c.w > .5) {
    let old = textureLoad(vI, id, 0);
    for (var c = 0; c < 3; c++) {
      let xf = vec3f(id) + faceOff(c); let h = .5 * axis(c);
      let back = trace(xf, s);
      let fwd = trace(xf, -s);
      let til = textureSampleLevel(tI, smp, (fwd + h) * n, 0.)[c];
      var mn: vec4f; var mx: vec4f;
      boxMinMax(vI, back + h, &mn, &mx);
      o[c] = clamp(hat[c] + .5 * (old[c] - til), mn[c], mx[c]);
    }
  }
  textureStore(vO, id, o);
}

// ---------------------------------------------------------------- sources for fog and ink
@compute @workgroup_size(4, 4, 4) fn denSrc(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let dt = P_.a.x;
  let w = world(vec3f(id) + .5);
  let k = textureLoad(sI, id, 0).w;
  var d = textureLoad(dI, id, 0);
  if (k == OPEN) { d = vec4f(fogTarget(w.y), 0., 0., 0.); }
  if (k == SOLID) {
    // copy the fluid next to a wall into it, so filtered lookups near walls do not fade
    var sum = vec4f(0.); var cnt = 0.;
    for (var i = 0; i < 6; i++) {
      let o = vec3i(axis(i >> 1)) * ((i & 1) * 2 - 1);
      let q = clamp(vec3i(id) + o, vec3i(0), vec3i(P_.dim.xyz) - 1);
      if (textureLoad(sI, q, 0).w != SOLID) { sum += textureLoad(dI, q, 0); cnt += 1.; }
    }
    d = sum / max(cnt, 1.);
  } else {
    for (var i = 0u; i < P_.dim.w; i++) {
      let e = P_.em[i];
      let f = fall(sdCapsule(w, e.a.xyz, e.b.xyz), e.a.w);
      d = d / (1. + max(e.s.z, 0.) * dt * f); // expanding air thins what it carries
      d.x += e.s.x * dt * f; d.z += e.s.y * dt * f;
    }
    d.x += (fogTarget(w.y) - d.x) * P_.b.y * dt;
    d.z *= exp(-P_.b.z * dt);
    d = max(d, vec4f(0.));
  }
  textureStore(dO, id, d);
}

// ---------------------------------------------------------------- forces
@compute @workgroup_size(4, 4, 4) fn curl(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = vec3f(id) + .5;
  let dx = velAt(c + X) - velAt(c - X);
  let dy = velAt(c + Y) - velAt(c - Y);
  let dz = velAt(c + Z) - velAt(c - Z);
  let w = vec3f(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) * (.5 / P_.org.w);
  textureStore(wO, id, vec4f(w, length(w)));
}

fn solidFace(id: vec3u, c: i32, vel: ptr<function, f32>) -> bool {
  let here = textureLoad(sI, id, 0);
  let prev = textureLoad(sI, vec3u(max(vec3i(id) - vec3i(axis(c)), vec3i(0))), 0);
  if (here.w == SOLID) { *vel = here[c]; return true; }
  if (prev.w == SOLID) { *vel = prev[c]; return true; }
  return false;
}

// reads the advected velocity (vI), vorticity (tI), density (dI); writes the forced velocity
@compute @workgroup_size(4, 4, 4) fn force(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let dt = P_.a.x; let h = P_.org.w; let n = 1. / dims();
  var o = textureLoad(vI, id, 0);
  for (var c = 0; c < 3; c++) {
    let xf = vec3f(id) + faceOff(c);
    var sv: f32;
    if (solidFace(id, c, &sv)) { o[c] = sv; continue; }
    var f = 0.;
    if (P_.a.y > 0.) {
      // vorticity confinement: push along N x w, where N points up the gradient of |w|
      let g = vec3f(
        textureSampleLevel(tI, smp, (xf + X) * n, 0.).w - textureSampleLevel(tI, smp, (xf - X) * n, 0.).w,
        textureSampleLevel(tI, smp, (xf + Y) * n, 0.).w - textureSampleLevel(tI, smp, (xf - Y) * n, 0.).w,
        textureSampleLevel(tI, smp, (xf + Z) * n, 0.).w - textureSampleLevel(tI, smp, (xf - Z) * n, 0.).w);
      let N = g / (length(g) + 1e-5);
      f += P_.a.y * h * cross(N, textureSampleLevel(tI, smp, xf * n, 0.).xyz)[c];
    }
    // fog is heavier than clear air. Measured against the resting profile, so still fog exerts no force
    // and the open sides of the box agree with the resting fog outside it.
    if (c == 1) { f -= P_.a.z * (textureSampleLevel(dI, smp, xf * n, 0.).x - .5 * (fogTarget(world(xf - .5 * Y).y) + fogTarget(world(xf + .5 * Y).y))); }
    o[c] += f * dt;
    let w = world(xf);
    for (var i = 0u; i < P_.dim.w; i++) {
      let e = P_.em[i];
      if (e.b.w > .5 || e.v.w <= 0.) { continue; }
      let k = fall(sdCapsule(w, e.a.xyz, e.b.xyz), e.a.w);
      o[c] += (e.v[c] - o[c]) * min(1., e.v.w * dt * k);
    }
  }
  textureStore(vO, id, o);
}

// ---------------------------------------------------------------- pressure
// rO = sum of face differences minus sources. mO packs what the relaxation needs to know about the neighbourhood.
@compute @workgroup_size(4, 4, 4) fn diverg(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let k = textureLoad(sI, id, 0).w;
  if (k != FLUID) { textureStore(rO, id, vec4f(0.)); textureStore(mO, id, vec4u(u32(k) << 9u)); return; }
  let v = textureLoad(vI, id, 0);
  var d = textureLoad(vI, id + vec3u(1u, 0u, 0u), 0).x - v.x
        + textureLoad(vI, id + vec3u(0u, 1u, 0u), 0).y - v.y
        + textureLoad(vI, id + vec3u(0u, 0u, 1u), 0).z - v.z;
  let w = world(vec3f(id) + .5);
  for (var i = 0u; i < P_.dim.w; i++) {
    let e = P_.em[i];
    if (e.s.z != 0.) { d -= P_.org.w * e.s.z * fall(sdCapsule(w, e.a.xyz, e.b.xyz), e.a.w); }
  }
  var cnt = 0u; var mask = 0u;
  for (var i = 0; i < 6; i++) {
    let o = vec3i(axis(i >> 1)) * ((i & 1) * 2 - 1);
    let kn = textureLoad(sI, vec3i(id) + o, 0).w;
    if (kn != SOLID) { cnt += 1u; }
    if (kn == FLUID) { mask |= 1u << u32(i); }
  }
  textureStore(rO, id, vec4f(d));
  textureStore(mO, id, vec4u(mask | (cnt << 6u)));
}

// subtract the pressure gradient; faces touching a solid take the solid's velocity
@compute @workgroup_size(4, 4, 4) fn project(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  var o = textureLoad(vI, id, 0);
  let kh = textureLoad(sI, id, 0).w;
  let ph = select(0., textureLoad(pI, id, 0).x, kh == FLUID);
  for (var c = 0; c < 3; c++) {
    var sv: f32;
    if (solidFace(id, c, &sv)) { o[c] = sv; continue; }
    if (id[c] == 0u) { continue; }
    let q = vec3u(vec3i(id) - vec3i(axis(c)));
    let pp = select(0., textureLoad(pI, q, 0).x, textureLoad(sI, q, 0).w == FLUID);
    o[c] -= ph - pp;
  }
  textureStore(vO, id, o);
}
