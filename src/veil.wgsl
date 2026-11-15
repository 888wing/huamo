// One layer of smoke: a 2D incompressible fluid on a plane that faces the camera at a fixed distance.
// State texel: xy = velocity in texels per second, z = smoke density. Background is empty (density 0 = fully transparent).
struct Splat { p: vec4f, v: vec4f } // p: centre xy (texels), radius, weight for this layer; v: velocity xy (texels/s), density per second, drag
struct Params {
  a: vec4f, // width, height, dt, time
  b: vec4f, // scroll xy (texels: how far the camera's motion moved this layer on screen), amount of smoke, heal rate
  c: vec4f, // camera height, layer distance, tan(half vertical fov), aspect
  f: vec4f, // camera forward.y, up.y, right.y, altitude below which smoke gathers
  g: vec4f, // turbulence, lift, splat count, seed
  h: vec4f, // how far this layer has scrolled in total (texels): keeps the smoke's shapes attached to the layer
  s: array<Splat, 10>,
}
@group(0) @binding(0) var<uniform> P_: Params;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var aI: texture_2d<f32>;
@group(0) @binding(3) var pI: texture_2d<f32>;
@group(0) @binding(4) var dI: texture_2d<f32>;
@group(0) @binding(5) var aO: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var pO: texture_storage_2d<rgba16float, write>;

// smoke-shaped texture: layered soft noise, bent by itself, so the layer is made of puffs and gaps rather than a flat sheet
fn h2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vn(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2f(1., 0.)), u.x), mix(h2(i + vec2f(0., 1.)), h2(i + vec2f(1., 1.)), u.x), u.y);
}
fn fbm(p: vec2f) -> f32 { var a = .5; var s = 0.; var q = p; for (var i = 0; i < 4; i++) { s += a * vn(q); q = q * 2.03 + 7.1; a *= .5; } return s; }
fn at(t: texture_2d<f32>, p: vec2i) -> vec4f { return textureLoad(t, clamp(p, vec2i(0), vec2i(textureDimensions(t)) - 1), 0); }

// carry everything along the flow (and along with the camera), then feed, stir and push
@compute @workgroup_size(8, 8) fn advect(@builtin(global_invocation_id) gid: vec3u) {
  let id = vec2i(gid.xy); let size = P_.a.xy; if (any(vec2f(id) >= size)) { return; }
  let dt = P_.a.z; let t = P_.a.w; let pos = vec2f(id) + .5;
  let here = textureLoad(aI, id, 0);
  let s = textureSampleLevel(aI, smp, (pos - here.xy * dt - P_.b.xy) / size, 0.);
  var v = s.xy;
  // smoke spreads a little every step, so its edges stay soft instead of hardening into outlines
  var d = mix(s.z, .25 * (at(aI, id + vec2i(2, 0)).z + at(aI, id - vec2i(2, 0)).z + at(aI, id + vec2i(0, 2)).z + at(aI, id - vec2i(0, 2)).z), .1);
  // where this texel is in the world: smoke gathers below a certain altitude, in drifting patches
  let ndc = pos / size * 2. - 1.;
  let y = P_.c.x + P_.c.y * (P_.f.x + ndc.x * P_.c.z * P_.c.w * P_.f.z - ndc.y * P_.c.z * P_.f.y);
  let q = pos * .017 + P_.g.w;
  let w = (pos - P_.h.xy) * .012 + P_.g.w + vec2f(t * .014, -t * .007);
  let clump = smoothstep(.36, .7, fbm(w + .7 * fbm(w * 1.8 + 3.1))) * 1.7; // dense cores, thin skirts, clear gaps
  d += (smoothstep(P_.f.w, P_.f.w - 2.4, y) * clump * P_.b.z - d) * P_.b.w * dt;
  // billowing: a slowly changing shearing flow, stronger where there is smoke, plus a little lift
  v += P_.g.x * d * dt * vec2f(cos(q.y * 2.3 + t * .7) + .6 * cos(q.y * 4.7 - t * 1.1 + q.x), -cos(q.x * 2.1 - t * .6) - .6 * cos(q.x * 4.3 + t * .9 + q.y));
  v.y -= P_.g.y * d * dt;
  for (var i = 0; i < i32(P_.g.z); i++) {
    let e = P_.s[i]; let o = pos - e.p.xy; let k = max(0., 1. - length(o) / e.p.z) * e.p.w; // strongest at the centre, fading in a straight line to nothing at the edge
    v = mix(v, e.v.xy, clamp(k * e.v.w * dt, 0., 1.));
    d = max(0., d + e.v.z * k * dt);
  }
  textureStore(aO, id, vec4f(v * (1. - .5 * dt), d, 0.));
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
  textureStore(aO, id, vec4f(s.xy - g, s.z, 0.));
}
