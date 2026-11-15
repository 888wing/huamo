@group(0) @binding(0) var noise: texture_3d<f32>;
@group(0) @binding(1) var repeatSampler: sampler;
@group(0) @binding(2) var atlas: texture_storage_2d<rgba8unorm, write>;

override smokeSeed: u32 = 0u;
override smokeTurbulence: f32 = 1.;
override smokeScale: f32 = 1.;
override smokeWisps: f32 = 1.;

fn hash32(value: u32) -> u32 {
  var x = value;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn variation(kind: u32, channel: u32) -> vec3f {
  if (smokeSeed == 0u && channel == 0u) { return vec3f(0.); }
  let h = hash32(smokeSeed ^ (kind * 0x9e3779b9u) ^ (channel * 0x85ebca6bu));
  let v = vec3u(hash32(h + 1u), hash32(h + 2u), hash32(h + 3u));
  return vec3f(v >> vec3u(8u)) * (1. / 16777216.) - .5;
}

fn sampleNoise(p: vec3f) -> vec3f {
  return textureSampleLevel(noise, repeatSampler, p, 0.).rgb;
}

fn ellipsoid(p: vec3f, center: vec3f, radius: vec3f) -> f32 {
  return 1. - length((p - center) / radius);
}

fn softUnion(a: f32, b: f32) -> f32 {
  let h = max(.24 - abs(a - b), 0.);
  return max(a, b) + h * h / .96;
}

const PUFF_SIZE = array<vec3f, 6>(
  vec3f(.62, .64, .66), vec3f(.61, .57, .66), vec3f(.79, .39, .51),
  vec3f(.8, .31, .43), vec3f(.35, .78, .42), vec3f(.65, .53, .54)
);
const PUFF_STRENGTH = array<f32, 6>(9.4, 9.4, 9., 4.1, 8.2, 3.15);

fn puff(p: vec3f, kind: u32, seed: vec3f) -> f32 {
  let broad = sampleNoise(p * .35 + seed);
  let curl = sampleNoise(p * .76 + seed.zyx + (broad - .5) * (.36 * smokeTurbulence));
  let q = p + ((broad - .5) * .49 + (curl - .5) * .13) * smokeTurbulence;
  let size = PUFF_SIZE[kind];
  let lobeOffset = select(vec3f(-.39, .38, .17), vec3f(-.42, .16, .14), kind == 2u || kind == 3u);
  let center = select(vec3f(0.), vec3f(-.13, -.05, .02), kind == 2u || kind == 3u);
  var shape = softUnion(
    ellipsoid(q, center, size * .87),
    ellipsoid(q, size * lobeOffset, size * vec3f(.61, .75, .71))
  );
  let tail = select(vec3f(.63, .60, .69), vec3f(.61, .40, .50), kind == 2u);
  shape = softUnion(shape, ellipsoid(q, size * vec3f(.56, -.24, -.28), size * tail));
  if (kind == 1u || kind == 4u) {
    shape = softUnion(shape, ellipsoid(q, size * vec3f(.31, .61, .05), size * vec3f(.74, .49, .69)));
  }
  let grain = sampleNoise(q * 1.32 - (curl - .5) * .23 + seed);
  let folds = broad.r * .38 + curl.g * .38 + grain.r * .24;
  let edge = 1. - smoothstep(.035, .16, abs(grain.g - .52));
  let threads = edge * (.12 * smokeTurbulence) * smoothstep(-.43, .1, shape) * smoothstep(.40, .66, folds);
  let cutoff = select(.53, .59, kind == 3u || kind == 5u);
  return (max(.56 * shape + (folds - cutoff) * 1.46, 0.) + threads) * PUFF_STRENGTH[kind];
}

fn ribbon(p: vec3f, phase: f32, width: f32) -> f32 {
  let y = p.y;
  let x = .25 * sin(y * 5.9 + phase) + .105 * sin(y * 11.9 - phase);
  let z = .17 * cos(y * 4.7 + phase);
  let taper = .35 + .65 * (1. - smoothstep(.20, .82, abs(y)));
  let dist = length((p.xz - vec2f(x, z)) / vec2f(width * taper, .13 * taper));
  return 1. - smoothstep(.04, 1.4, dist);
}

fn wisp(p: vec3f, kind: u32, seed: vec3f, twist: f32) -> f32 {
  let broad = sampleNoise(p * .58 + seed);
  let q = p + (broad - .5) * vec3f(.39, .25, .29) * smokeTurbulence;
  let grain = sampleNoise(q * 1.67 + (broad - .5) * .33 + seed.yzx);
  let phase = f32(kind) * 1.65 + twist;
  var density = ribbon(q, phase, .062);
  if (kind == 6u) {
    density = max(density, ribbon(q - vec3f(.09, -.09, -.08), phase + .58, .043) * .65);
    density = max(density, ribbon(q - vec3f(-.13, .22, .02), phase - .44, .035) * .53);
  } else if (kind == 7u) {
    // A short coil in the middle catches the light where it passes the stem.
    let d = q.xy - vec2f(.04, .22);
    let angle = atan2(d.y, d.x);
    let radius = length(d);
    let spiral = .087 + .019 * angle;
    let spiralDist = min(abs(radius - spiral), abs(radius - spiral - .119));
    let coil = (1. - smoothstep(.013, .050, spiralDist)) * (1. - smoothstep(.14, .26, radius));
    density = max(density, coil * (1. - smoothstep(.02, .145, abs(q.z - .02))) * .82);
  } else {
    let fragments = smoothstep(.39, .72, grain.r + .23 * sin(q.y * 13.));
    density *= fragments * .54;
  }
  let fine = mix(.48, 1.24, smoothstep(.27, .74, grain.g));
  return density * fine * (1. - smoothstep(.27, .87, abs(p.y))) * (6.4 * smokeWisps);
}

fn density(p: vec3f, kind: u32, seed: vec3f, twist: f32) -> f32 {
  if (kind < 6u) { return puff(p, kind, seed); }
  return wisp(p, kind, seed, twist);
}

fn project(p: vec2f, kind: u32, random: vec3f) -> f32 {
  let margin = max(abs(p.x), abs(p.y));
  if (margin >= .836 || (kind >= 6u && smokeWisps == 0.)) { return 0.; }
  let seed = vec3f(.37, .19, .73) * f32(kind + 1u) + random;
  let resize = 1. / ((1. + random.xy * .34) * smokeScale);
  let twist = random.z * 4.8;
  let lightDir = normalize(vec3f(-.58, .79, .44));
  let steps = 28u;
  let dz = 1.8 / f32(steps);
  // Midpoints give a stable atlas with no screen-space grain when the game enlarges a cell.
  var transmittance = 1.;
  var light = 0.;
  for (var i = 0u; i < steps; i++) {
    let pos = vec3f(p * resize, .9 - (f32(i) + .5) * dz);
    let here = density(pos, kind, seed, twist);
    if (here > .006) {
      let towardLight = density(pos + lightDir * .17, kind, seed, twist);
      let scatter = .36 + .64 * exp(-towardLight * .51);
      let opacity = 1. - exp(-here * dz);
      light += transmittance * opacity * scatter;
      transmittance *= 1. - opacity;
      if (transmittance < .012) { break; }
    }
  }
  let fade = 1. - smoothstep(.67, .836, margin);
  return fade * (1. - exp(-light * 1.78)) * 1.14;
}

fn tileable(p: vec2f, kind: u32, random: vec3f) -> f32 {
  let uv = p + random.xy;
  let z = f32(kind - 8u) * .173 + random.z;
  let warp = sampleNoise(vec3f(uv, z));
  let low = sampleNoise(vec3f(uv, z + .32) + (warp - .5) * (.23 * smokeTurbulence));
  if (kind == 9u) { return .24 + .40 * mix(warp.r, low.r, .72); }
  let medium = sampleNoise(vec3f(uv * 2., z + .47) + (low - .5) * (.34 * smokeTurbulence));
  if (kind == 10u) { return .23 + .44 * mix(low.r, medium.r, .77); }
  let high = sampleNoise(vec3f(uv * 3., z + .21) + (medium - .5) * (.26 * smokeTurbulence));
  let thread = 1. - smoothstep(.02, .21, abs(high.g - .51));
  return clamp(.05 + .32 * medium.r + .44 * thread * smoothstep(.32, .72, high.r), 0., 1.);
}

@compute @workgroup_size(8, 8)
fn bakeSmoke(@builtin(global_invocation_id) id: vec3u) {
  let span = textureDimensions(atlas).x / 4u;
  let cell = id.xy / span;
  let kind = cell.x + 4u * cell.y;
  let uv = (vec2f(id.xy % span) + .5) / f32(span);
  var values: vec4f;
  for (var channel = 0u; channel < 4u; channel++) {
    let random = variation(kind, channel);
    if (kind < 9u) {
      values[channel] = project(uv * vec2f(2., -2.) + vec2f(-1., 1.), kind, random);
    } else {
      values[channel] = tileable(uv, kind, random);
    }
  }
  textureStore(atlas, id.xy, values);
}
