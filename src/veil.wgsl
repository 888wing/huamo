// One layer of smoke: a 2D incompressible fluid on a plane that faces the camera at a fixed distance.
// State texel: xy = velocity in texels per second, z = smoke density, w = recent blade separation.
// A push is a line from p.xy to q.xy (a point when they coincide). p: start xy (texels), radius, weight for this layer;
// v: velocity xy (texels/s), density per second, drag; q: end xy, outward speed, walking-wake flag.
struct Splat { p: vec4f, v: vec4f, q: vec4f }
struct Params {
  a: vec4f, // width, height, dt, time
  b: vec4f, // scroll xy (texels: how far the camera's motion moved this layer on screen), amount of smoke, heal rate
  c: vec4f, // camera height, layer distance, tan(half vertical fov), aspect
  f: vec4f, // camera forward.y, up.y, right.y, altitude below which smoke gathers
  g: vec4f, // turbulence, lift, splat count, seed
  h: vec4f, // total xy scroll (texels) to anchor smoke to the layer, transport splat count
  s: array<Splat, 14>,
}
@group(0) @binding(0) var<uniform> P_: Params;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var aI: texture_2d<f32>;
@group(0) @binding(3) var pI: texture_2d<f32>;
@group(0) @binding(4) var dI: texture_2d<f32>;
@group(0) @binding(5) var aO: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var pO: texture_storage_2d<rgba16float, write>;
// how far the smoke at each texel has been carried from where it started (texels): the renderer uses it to bend its pictures
@group(0) @binding(7) var eI: texture_2d<f32>;
@group(0) @binding(8) var eO: texture_storage_2d<rgba16float, write>;

// smoke-shaped texture: layered soft noise, bent by itself, so the layer is made of puffs and gaps rather than a flat sheet
fn h2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vn(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2f(1., 0.)), u.x), mix(h2(i + vec2f(0., 1.)), h2(i + vec2f(1., 1.)), u.x), u.y);
}
fn fbm(p: vec2f) -> f32 { var a = .5; var s = 0.; var q = p; for (var i = 0; i < 4; i++) { s += a * vn(q); q = q * 2.03 + 7.1; a *= .5; } return s; }
fn at(t: texture_2d<f32>, p: vec2i) -> vec4f { return textureLoad(t, clamp(p, vec2i(0), vec2i(textureDimensions(t)) - 1), 0); }
fn fromLine(pos: vec2f, e: Splat) -> vec2f {
  let line = e.q.xy - e.p.xy;
  let fromStart = pos - e.p.xy;
  return fromStart - line * clamp(dot(fromStart, line) / max(dot(line, line), 1e-4), 0., 1.);
}

// carry everything along the flow (and along with the camera), then feed, stir and push
@compute @workgroup_size(8, 8) fn advect(@builtin(global_invocation_id) gid: vec3u) {
  let id = vec2i(gid.xy); let size = P_.a.xy; if (any(vec2f(id) >= size)) { return; }
  let dt = P_.a.z; let t = P_.a.w; let pos = vec2f(id) + .5;
  let here = textureLoad(aI, id, 0);
  let transportCount = i32(P_.h.z);
  var split = vec2f(0.);
  var air = 0.;
  var compression = 1.;
  for (var i = 0; i < transportCount; i++) {
    let e = P_.s[i];
    let o = fromLine(pos, e);
    let dist = length(o);
    let u = clamp(dist / e.p.z, 0., 1.);
    let wake = e.q.w > .5;
    let opening = min(e.q.z * dt, e.p.z * select(.34, .14, wake)) * e.p.w;
    let displacement = opening * (1. - u * u * (3. - 2. * u));
    // Walking rolls the smoke around the body with a soft centre and a loose shoulder.
    // The blade still opens a much narrower and sharper seam.
    if (wake) {
      let axis = e.q.xy - e.p.xy;
      let along = axis * dot(o, axis) / max(dot(axis, axis), 1e-4);
      let side = o - along;
      let shoulder = length(side) / max(dist, .05);
      split += (side + .24 * along) / max(dist, e.p.z * .26) * displacement;
      compression *= 1. + 3.5 * u * (1. - u) * opening / e.p.z * mix(.18, 1., shoulder);
      let displacedFromLayer = opening / e.p.z * (1. - smoothstep(.08, .61, u));
      air = max(air, min(.17, displacedFromLayer * 1.42));
    } else {
      split += o / max(dist, .05) * displacement;
      compression *= 1. + 6. * u * (1. - u) * opening / e.p.z;
      air = max(air, (1. - smoothstep(displacement * .46, displacement + .48, dist)) * smoothstep(.10, 1.55, displacement));
    }
  }
  let travel = here.xy * dt + split;
  let source = (pos - travel - P_.b.xy) / size;
  let s = textureSampleLevel(aI, smp, source, 0.);
  let carried = textureSampleLevel(eI, smp, source, 0.).xy;
  let cut = max(s.w * exp(-1.85 * dt), air);
  // carried along with the flow, and slowly let go, so the pictures curl with the smoke and then settle back
  textureStore(eO, id, vec4f(clamp((carried - travel) * (1. - 1.7 * dt), vec2f(-90.), vec2f(90.)), 0., 0.));
  var v = s.xy + split * 18.;
  // smoke spreads a little every step, so its edges stay soft instead of hardening into outlines
  let diffused = .25 * (at(aI, id + vec2i(2, 0)).z + at(aI, id - vec2i(2, 0)).z + at(aI, id + vec2i(0, 2)).z + at(aI, id - vec2i(0, 2)).z);
  let diffusion = min(.1, 6. * dt) * (1. - cut);
  var d = mix(s.z, diffused, diffusion) * compression * (1. - air);
  // where this texel is in the world: smoke gathers below a certain altitude, in drifting patches
  let ndc = pos / size * 2. - 1.;
  let y = P_.c.x + P_.c.y * (P_.f.x + ndc.x * P_.c.z * P_.c.w * P_.f.z - ndc.y * P_.c.z * P_.f.y);
  let q = pos * .017 + P_.g.w;
  let w = (pos - P_.h.xy) * .012 + P_.g.w + vec2f(t * .014, -t * .007);
  let clump = smoothstep(.36, .7, fbm(w + .7 * fbm(w * 1.8 + 3.1))) * 1.7; // dense cores, thin skirts, clear gaps
  d += (smoothstep(P_.f.w, P_.f.w - 2.4, y) * clump * P_.b.z - d) * P_.b.w * dt * (1. - .85 * cut);
  // billowing: a slowly changing shearing flow, stronger where there is smoke, plus a little lift
  v += P_.g.x * d * dt * vec2f(cos(q.y * 2.3 + t * .7) + .6 * cos(q.y * 4.7 - t * 1.1 + q.x), -cos(q.x * 2.1 - t * .6) - .6 * cos(q.x * 4.3 + t * .9 + q.y));
  v.y -= P_.g.y * d * dt;
  for (var i = transportCount; i < i32(P_.g.z); i++) {
    let e = P_.s[i]; let o = fromLine(pos, e); let dist = length(o);
    let k = max(0., 1. - dist / e.p.z) * e.p.w; // only what the line touches moves: strongest on it, fading in a straight line to nothing
    v += o / max(dist, .5) * e.q.z * k * dt;    // and what it touches parts to either side
    v = mix(v, e.v.xy, clamp(k * e.v.w * dt, 0., 1.));
    d = max(0., d + e.v.z * k * dt);
  }
  textureStore(aO, id, vec4f(v * (1. - .5 * dt), d, cut));
}
@compute @workgroup_size(8, 8) fn diverg(@builtin(global_invocation_id) gid: vec3u) {
  let id = vec2i(gid.xy); if (any(gid.xy >= textureDimensions(aI))) { return; }
  let dv = .5 * (at(aI, id + vec2i(1, 0)).x - at(aI, id - vec2i(1, 0)).x + at(aI, id + vec2i(0, 1)).y - at(aI, id - vec2i(0, 1)).y);
  textureStore(pO, id, vec4f(dv, 0., 0., 0.));
}
@compute @workgroup_size(8, 8) fn jacobi(@builtin(global_invocation_id) gid: vec3u) {
  let id = vec2i(gid.xy); if (any(gid.xy >= textureDimensions(pI))) { return; }
  let p = at(pI, id + vec2i(1, 0)).x + at(pI, id - vec2i(1, 0)).x + at(pI, id + vec2i(0, 1)).x + at(pI, id - vec2i(0, 1)).x;
  textureStore(pO, id, vec4f((p - textureLoad(dI, id, 0).x) * .25, 0., 0., 0.));
}
@compute @workgroup_size(8, 8) fn project(@builtin(global_invocation_id) gid: vec3u) {
  let id = vec2i(gid.xy); if (any(gid.xy >= textureDimensions(aI))) { return; }
  let s = textureLoad(aI, id, 0);
  let g = .5 * vec2f(at(pI, id + vec2i(1, 0)).x - at(pI, id - vec2i(1, 0)).x, at(pI, id + vec2i(0, 1)).x - at(pI, id - vec2i(0, 1)).x);
  textureStore(aO, id, vec4f(s.xy - g, s.zw));
  textureStore(eO, id, vec4f(textureLoad(eI, id, 0).xy, s.zw)); // displacement, density and cut marker for the renderer
}
