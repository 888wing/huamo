// The three.js side of the world, all drawn as ink on paper: terrain, far mountains, pines, reeds and the sword stroke.
import * as THREE from 'three/webgpu';
import { Fn, vec2, vec3, float, mix, min, max, length, smoothstep, normalWorld, positionWorld, positionLocal, positionView, cameraPosition, texture3D, dot, uniform, attribute, clamp, sin, cos, atan, step, floor, fract, exp } from 'three/tsl';
import { SIZE, height, PILLARS, PATH, pathDist, arenaDist, DUEL_CLEARING, duelDist, OBSTACLES } from './world.js';
import noiseSrc from './noise.wgsl';

export const INK = new THREE.Color(0x121419), PAPER = new THREE.Color(0xece6d8), SEAL = new THREE.Color(0xb3301f);

// wraps a texture the simulation created so three can sample it
export function external(gpuTex, { repeat = false } = {}) {
  const t = new THREE.ExternalTexture(gpuTex);
  if (gpuTex.dimension === '3d') t.is3DTexture = true;
  t.type = gpuTex.format.includes('32') ? THREE.FloatType : gpuTex.format.includes('16') ? THREE.HalfFloatType : THREE.UnsignedByteType;
  t.format = THREE.RGBAFormat; t.colorSpace = THREE.NoColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.image = { width: gpuTex.width, height: gpuTex.height, depth: gpuTex.depthOrArrayLayers };
  if (repeat) t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  return t;
}

export async function noiseTexture(gpu) {
  const tex = gpu.tex([64, 64, 64], 'rgba8unorm');
  const pipe = await gpu.pipeline(await gpu.module(noiseSrc, 'noise'), 'main');
  const f = gpu.begin(); f.stage('noise'); f.run(pipe, { 0: tex }, 16, 16, 16); f.end();
  return external(tex, { repeat: true });
}

const sun = vec3(.45, .8, .35).normalize();
const inkC = uniform(new THREE.Color(INK)), paperC = uniform(new THREE.Color(PAPER));
// tone 0 = full ink, 1 = bare paper
export const wash = tone => mix(inkC, paperC, clamp(tone, 0, 1));
export const basic = node => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = node; return m; };

// ground: a pale pooled wash. rock: dark dry-brush strokes running down the face, lighter where it catches the light
function terrainMaterial(noise) {
  return basic(Fn(() => {
    const n = normalWorld, p = positionWorld;
    const streak = texture3D(noise, p.mul(vec3(.15, .028, .15))).g, blotch = texture3D(noise, p.mul(.04)).r, fine = texture3D(noise, p.mul(.6)).b;
    const rock = smoothstep(.1, .42, n.y.oneMinus().add(streak.sub(.5).mul(.3)));
    const lit = dot(n, sun).mul(.5).add(.5);
    const ground = float(.46).add(blotch.sub(.5).mul(.26)).sub(smoothstep(.66, .8, fine).mul(.16)); // grey ground with crisp dabs: what the white fog is seen against // a few darker dabs
    const face = float(.05).add(streak.mul(.36)).add(lit.mul(.24)).add(blotch.sub(.5).mul(.12));
    // the path: worn earth, paler than the ground, with a broken ink line along each edge
    let d = float(1e3);
    for (let i = 0; i < PATH.length - 1; i++) {
      const a = vec2(...PATH[i]), ba = vec2(PATH[i + 1][0] - PATH[i][0], PATH[i + 1][1] - PATH[i][1]), pa = p.xz.sub(a);
      d = min(d, length(pa.sub(ba.mul(clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1)))));
    }
    const dw = d.add(streak.sub(.5).mul(.9)), onPath = smoothstep(1.9, 1.3, dw);
    const duel = length(p.xz.sub(vec2(...DUEL_CLEARING.center))).add(streak.sub(.5).mul(1.05));
    const clearing = smoothstep(DUEL_CLEARING.radius + .55, DUEL_CLEARING.radius - .6, duel);
    const pathEdge = smoothstep(.35, 0, dw.sub(1.75).abs()).mul(clearing.oneMinus());
    const clearingEdge = smoothstep(.64, 0, duel.sub(DUEL_CLEARING.radius).abs()).mul(onPath.oneMinus());
    const edge = max(pathEdge, clearingEdge.mul(.62)).mul(smoothstep(.35, .6, fine)).mul(.3);
    return wash(mix(mix(ground, float(.8).add(blotch.sub(.5).mul(.12)), max(onPath, clearing)).sub(edge), face, rock));
  })());
}
// a far mountain: ink at the ridge, dissolving into nothing at its foot
function mountainMaterial(noise) {
  return basic(Fn(() => {
    const t = positionLocal.y.add(.5), p = positionWorld;
    const streak = texture3D(noise, p.mul(vec3(.02, .006, .02))).g;
    const lit = dot(normalWorld, sun).mul(.5).add(.5);
    const body = float(-.08).add(streak.mul(.2)).add(lit.mul(.12));
    return wash(mix(1.02, body, smoothstep(.0, .62, t.add(streak.sub(.5).mul(.3)))));
  })());
}
// bark: dark dry-brush ink, a little paler where the brush ran dry
function barkMaterial(noise) {
  return basic(Fn(() => {
    const dry = texture3D(noise, positionWorld.mul(vec3(2.2, .5, 2.2))).g;
    return wash(float(.02).add(smoothstep(.55, .8, dry).mul(.2)).add(dot(normalWorld, sun).mul(.04)));
  })());
}
// needles: every card is cut into a fan of brush strokes spreading from its foot. Solid at the heart, separate needles at
// the rim, each needle its own length; far away the needles fatten and close up so the fan does not sparkle
function needleMaterial(noise, time) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const fan = attribute('fan', 'vec2'), sd = attribute('seed', 'float');
  const a0 = atan(fan.y, fan.x), ang = a0.add(step(a0, -1.5708).mul(6.2832)), rad = length(fan), t = ang.add(.33).div(3.8), dist = positionView.z.negate(), far = smoothstep(6, 30, dist);
  const hash = (id, k) => fract(sin(id.mul(12.9898).add(sd.mul(78.233)).add(k)).mul(43758.5453));
  // one ring of needles: n of them, each `w` wide at arm's length (they do not widen towards the tip, as a brush hair does not)
  const ring = (n, reach, w, k) => {
    const id = floor(t.mul(n)), s = fract(t.mul(n)).sub(.5).abs(), h = hash(id, k), q = rad.div(mix(.55, 1, h).mul(reach));
    // close to the lens the needles drop out one by one, so a tuft never stands in the way as a slab
    return step(q, 1).mul(step(s, min(float(.7), float(w * n).div(rad.add(.02))).mul(smoothstep(1.02, .7, q)).add(far.mul(.42)))).mul(step(hash(id, k + 9), smoothstep(.7, 3.4, dist)));
  };
  const h = hash(floor(t.mul(26)), 0), q = rad;
  m.opacityNode = max(ring(26, 1, .0065, 0), ring(17, .62, .008, 5)).mul(step(0, t)).mul(step(t, 1));
  m.alphaTest = .5;
  // most fans are full ink; some are a thinner wash, which sets them back
  const thin = step(.7, fract(sin(sd.mul(3.7)).mul(917.3)));
  m.colorNode = wash(float(.03).add(thin.mul(.22)).add(h.mul(.1)).add(q.mul(.08)).add(texture3D(noise, positionWorld.mul(.5)).b.sub(.5).mul(.1)));
  // the tips stir in the wind
  const sway = vec3(sin(time.mul(1.3).add(positionLocal.x.mul(.4)).add(positionLocal.z.mul(.3))), 0, cos(time.mul(1.1).add(positionLocal.z.mul(.5)))).mul(.035).mul(max(fan.y, 0));
  m.positionNode = positionLocal.add(sway);
  return m;
}

export function buildStage(scene, noise) {
  // terrain
  const n = 224, pos = new Float32Array(n * n * 3), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -SIZE / 2 + SIZE * i / (n - 1), z = -SIZE / 2 + SIZE * j / (n - 1), o = (j * n + i) * 3;
    pos[o] = x; pos[o + 1] = height(x, z); pos[o + 2] = z;
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, terrainMaterial(noise)));

  let s = 11;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  // far mountains: craggy unit cones in three shapes, scaled and turned
  const shapes = [0, 1, 2].map(() => {
    const c = new THREE.ConeGeometry(.5, 1, 11, 6), p = c.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); if (y > .49) continue;
      const k = 1 + (rnd() - .5) * .55; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, y + (rnd() - .5) * .07);
    }
    c.computeVertexNormals(); return c;
  });
  const mMat = mountainMaterial(noise);
  for (let i = 0; i < 30; i++) {
    const a = rnd() * 6.283, d = 60 + rnd() * 230, hgt = 26 + rnd() * 70 + d * .16;
    const m = new THREE.Mesh(shapes[i % 3], mMat);
    m.scale.set(hgt * (.5 + rnd() * .7), hgt, hgt * (.5 + rnd() * .5));
    m.position.set(Math.cos(a) * d, hgt / 2 - 8, Math.sin(a) * d); m.rotation.y = rnd() * 6;
    scene.add(m);
  }

  // pines, drawn the way ink painters draw them: a crooked trunk, a few reaching branches, and along each branch a row of
  // needle fans. All the wood is one mesh and all the needles another.
  const wood = { p: [], i: [] }, nd = { p: [], fan: [], seed: [], i: [] };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  // a tube along a line of points, each with its own radius
  const tube = (pts, rad, sides = 6) => {
    const base = wood.p.length / 3, n = pts.length, ref = Math.abs(pts[n - 1][1] - pts[0][1]) > Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][2] - pts[0][2]) ? V(1, 0, 0) : V(0, 1, 0);
    pts.forEach((p, j) => {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)], t = V(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(), u = ref.clone().cross(t).normalize(), w = t.clone().cross(u);
      for (let s = 0; s < sides; s++) { const an = s / sides * 6.283, c = Math.cos(an) * rad[j], sn = Math.sin(an) * rad[j]; wood.p.push(p[0] + u.x * c + w.x * sn, p[1] + u.y * c + w.y * sn, p[2] + u.z * c + w.z * sn); }
    });
    for (let j = 0; j < n - 1; j++) for (let s = 0; s < sides; s++) { const a = base + j * sides + s, b = base + j * sides + (s + 1) % sides; wood.i.push(a, b, a + sides, b, b + sides, a + sides); }
  };
  // a tuft of needles: three upright cards crossed through one point, so one always faces the viewer. The fan itself is cut out in the material
  const tuft = (x, y, z, r, sq = .72) => {
    const seed = rnd() * 40;
    for (let f = 0; f < 3; f++) {
      const ya = f * 1.047 + seed, cs = Math.cos(ya) * r, sn = Math.sin(ya) * r, o = nd.p.length / 3;
      for (const [fx, fy] of [[-1, -.34], [1, -.34], [1, 1], [-1, 1]]) { nd.p.push(x + fx * cs, y + fy * r * sq, z + fx * sn); nd.fan.push(fx, fy); nd.seed.push(seed + f * 3.1); }
      nd.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
  };
  const along = (pts, f) => { const q = Math.min(pts.length - 1.001, Math.max(0, f) * (pts.length - 1)), i = q | 0, t = q - i; return [0, 1, 2].map(a => pts[i][a] + (pts[i + 1][a] - pts[i][a]) * t); };
  const pine = (x, z, k, y) => {
    if (y === undefined) { OBSTACLES.push([x, z, .15 * k + .12]); y = height(x, z); } // trunks on the ground are solid
    const hgt = (3.6 + rnd() * 3) * k, la = rnd() * 6.283, lean = .08 + rnd() * .26, ph = rnd() * 6, cx = Math.cos(la), cz = Math.sin(la);
    // the trunk leans one way and wanders as it climbs
    const spine = [], rad = [];
    for (let j = 0; j <= 6; j++) {
      const f = j / 6, off = lean * hgt * f * f + Math.sin(f * 4.2 + ph) * .16 * k * f, side = Math.sin(f * 5.3 + ph * 1.7) * .13 * k * f;
      spine.push([x + cx * off - cz * side, y - .25 + hgt * f, z + cz * off + cx * side]); rad.push((.17 - .12 * f) * k * (j ? 1 : 1.5));
    }
    tube(spine, rad);
    const nb = 4 + (rnd() * 3 | 0);
    for (let i = 0; i < nb; i++) {
      // branches leave the upper trunk on alternate sides, reach out almost level and lift at the tip
      const f = .42 + .5 * (i + rnd() * .5) / nb, s0 = along(spine, f), ba = la + (i % 2 ? 1.57 : -1.57) + (rnd() - .5) * 1.5, len = (2.5 - 1.6 * f) * k * (.75 + rnd() * .5), bx = Math.cos(ba), bz = Math.sin(ba), droop = (rnd() - .35) * .3;
      const br = [s0, [s0[0] + bx * len * .5, s0[1] + len * (.06 - droop * .5), s0[2] + bz * len * .5], [s0[0] + bx * len, s0[1] + len * (.2 - droop), s0[2] + bz * len]];
      tube(br, [.055 * k * (1.2 - f), .035 * k, .012 * k], 5);
      const nt = 4 + (len * 2.4 | 0);
      for (let j = 0; j < nt; j++) { // the needles: fans standing along the outer branch, largest in the middle, a few hanging under it
        const t = .3 + .76 * j / (nt - 1), q = along(br, t), r = (.3 + .26 * Math.sin(Math.PI * (j + .5) / nt)) * k * (.8 + rnd() * .4), sd = (rnd() - .5) * .9 * r;
        tuft(q[0] - bz * sd, q[1] + .02 - (j % 3 === 2 ? r * .3 : 0), q[2] + bx * sd, r);
      }
    }
    const top = spine[6]; // the crown
    for (let j = 0; j < 4; j++) { const a = rnd() * 6.283, d = j ? .3 * k : 0; tuft(top[0] + Math.cos(a) * d, top[1] - .1 * j * k, top[2] + Math.sin(a) * d, (.62 - .07 * j) * k * (.8 + rnd() * .4)); }
  };
  for (let i = 0; i < 9; i++) pine(-20 - rnd() * 8, -13 + rnd() * 26, 1 + rnd() * .5);
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.283, r = 25 + rnd() * 5, x = Math.cos(a) * r, z = Math.sin(a) * r; if (arenaDist(x, z) > 9) pine(x, z, .9 + rnd() * .7); }
  for (const i of [0, 2, 5]) { const [px, pz, , ph] = PILLARS[i]; pine(px + .3, pz - .2, .55, ph - .1); }
  // the forest: pines all through the basin, standing back from the path, the pillars and the clearing at the path's end
  const clear = (x, z, gap) => pathDist(x, z) > gap && PILLARS.every(([px, pz, pr]) => Math.hypot(x - px, z - pz) > pr + 1.2) && Math.hypot(x, z) < 21;
  for (let i = 0, n = 0; i < 400 && n < 46; i++) { const x = (rnd() - .5) * 42, z = (rnd() - .5) * 46; if (clear(x, z, 3.4) && arenaDist(x, z) > 9 && duelDist(x, z) > DUEL_CLEARING.radius + 1) { pine(x, z, .7 + rnd() * .55); n++; } }
  // bushes: the same needle fans, bunched low on the ground, thicker along the path's edges
  for (let i = 0, n = 0; i < 9000 && n < 230; i++) {
    const x = (rnd() - .5) * 44, z = (rnd() - .5) * 50, d = pathDist(x, z);
    if (!clear(x, z, 2.2) || arenaDist(x, z) < 6.5 || duelDist(x, z) < DUEL_CLEARING.radius + .6 || rnd() > 1.2 / (1 + d * .28)) continue;
    const k = .55 + rnd() * .75, y = height(x, z);
    for (let j = 0, m = 4 + (rnd() * 4 | 0); j < m; j++) { const a = rnd() * 6.283, r = rnd() * .7 * k; tuft(x + Math.cos(a) * r, y - .08, z + Math.sin(a) * r, (.5 + rnd() * .45) * k, 1); }
    n++;
  }
  const time = uniform(0);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wood.p, 3)); wg.setIndex(wood.i); wg.computeVertexNormals();
  const woodMesh = new THREE.Mesh(wg, barkMaterial(noise)); woodMesh.frustumCulled = false; scene.add(woodMesh);
  const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(nd.p, 3)); ng.setAttribute('fan', new THREE.Float32BufferAttribute(nd.fan, 2)); ng.setAttribute('seed', new THREE.Float32BufferAttribute(nd.seed, 1)); ng.setIndex(nd.i);
  const needleMesh = new THREE.Mesh(ng, needleMaterial(noise, time)); needleMesh.frustumCulled = false; scene.add(needleMesh);

  // reeds, waist-high and dense, like a field of pampas grass: they sway in the wind and lean away from whoever wades through
  const rp = [], ri = [];
  for (let b = 0; b < 11; b++) {
    const a = b * .7, r = .05 + .09 * (b % 3), lx = Math.cos(a) * r, lz = Math.sin(a) * r, hgt = .72 + .14 * (b % 4), tx = lx * 3 + (b % 2 ? .1 : -.1), tz = lz * 3, o = rp.length / 3;
    rp.push(lx - .021, 0, lz, lx + .021, 0, lz, tx, hgt, tz); ri.push(o, o + 1, o + 2);
  }
  const reed = new THREE.InstancedBufferGeometry(); reed.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); reed.setIndex(ri);
  const RN = 11000, ip = new Float32Array(RN * 4); let rn = 0;
  for (let i = 0; i < RN * 30 && rn < RN; i++) {
    const x = (rnd() - .5) * 44, z = (rnd() - .5) * 52, d = pathDist(x, z);
    if (!clear(x, z, 1.25) || duelDist(x, z) < DUEL_CLEARING.radius || rnd() > 1.6 / (1 + d * .14)) continue;
    ip.set([x, height(x, z) - .04, z, .8 + rnd() * .6], rn++ * 4);
  }
  reed.setAttribute('ipos', new THREE.InstancedBufferAttribute(ip.subarray(0, rn * 4), 4)); reed.instanceCount = rn;
  // A planted foot only touches nearby tufts. Store direction, pressure and contact time;
  // the shader releases the pressure after the foot moves on.
  const footmarks = new Float32Array(rn * 4);
  const footmarkAttribute = new THREE.InstancedBufferAttribute(footmarks, 4).setUsage(THREE.DynamicDrawUsage);
  reed.setAttribute('footmark', footmarkAttribute);
  const reedBins = new Map(), binKey = (x, z) => (x + 32) * 64 + z + 32;
  for (let i = 0; i < rn * 4; i += 4) {
    const key = binKey(Math.floor(ip[i]), Math.floor(ip[i + 2]));
    if (!reedBins.has(key)) reedBins.set(key, []);
    reedBins.get(key).push(i);
  }
  const radius = .66, footprintDecay = 3.2;
  const tread = (clock, feet, vx, vz) => {
    let first = footmarks.length, last = -1;
    const speed = Math.hypot(vx, vz);
    const forwardX = vx / Math.max(speed, 1), forwardZ = vz / Math.max(speed, 1);
    for (const foot of feet) {
      const lift = foot.y - height(foot.x, foot.z);
      if (lift > .24) continue;
      const load = 1 - Math.max(lift, 0) / .27;
      for (let x = Math.floor(foot.x - radius); x <= Math.floor(foot.x + radius); x++) {
        for (let z = Math.floor(foot.z - radius); z <= Math.floor(foot.z + radius); z++) {
          const tufts = reedBins.get(binKey(x, z));
          if (!tufts) continue;
          for (const i of tufts) {
            const dx = ip[i] - foot.x, dz = ip[i + 2] - foot.z, distanceSquared = dx * dx + dz * dz;
            const pressure = Math.max(0, 1 - distanceSquared / (radius * radius)) ** 2 * load;
            const held = footmarks[i + 2] * Math.exp(-(clock - footmarks[i + 3]) * footprintDecay);
            if (pressure < held + .045) continue;
            const distance = Math.max(Math.sqrt(distanceSquared), .10);
            footmarks[i] = dx / distance * .8 + forwardX * .4;
            footmarks[i + 1] = dz / distance * .8 + forwardZ * .4;
            footmarks[i + 2] = pressure;
            footmarks[i + 3] = clock;
            first = Math.min(first, i); last = Math.max(last, i);
          }
        }
      }
    }
    if (last >= first) {
      footmarkAttribute.addUpdateRange(first, last - first + 4);
      footmarkAttribute.needsUpdate = true;
    }
  };
  // a, b: two walkers (position). press: three heavy things (position, radius). ring: a shock running outwards (x, z, radius, strength)
  const P4 = () => uniform(new THREE.Vector4(0, -99, 0, 1));
  const ru = { time, tread, a: uniform(new THREE.Vector3()), b: uniform(new THREE.Vector3(0, -99, 0)), press: [P4(), P4(), P4()], ring: uniform(new THREE.Vector4(0, 0, 0, 0)) };
  const rm = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const I = attribute('ipos', 'vec4'), up = positionLocal.y, root = I.xyz;
  const lean = (c, r) => { const o = root.xz.sub(c.xz), d = length(o); return o.div(d.add(.01)).mul(smoothstep(r, r.mul(.11), d)).mul(smoothstep(2.2, 0, root.y.sub(c.y).abs())); };
  const wind = vec2(sin(ru.time.mul(1.5).add(root.x.mul(.45)).add(root.z.mul(.3))), sin(ru.time.mul(1.1).add(root.z.mul(.5)))).mul(.1);
  const ro = root.xz.sub(ru.ring.xy), rd = length(ro), shock = ro.div(rd.add(.01)).mul(ru.ring.w).mul(exp(rd.sub(ru.ring.z).div(1.3).pow2().negate()));
  let push = lean(ru.a, float(1.8)).add(lean(ru.b, float(1.8))).mul(.8).add(shock);
  for (const c of ru.press) push = push.add(lean(c, c.w).mul(1.15));
  const mark = attribute('footmark', 'vec4'), pressure = mark.z.mul(exp(ru.time.sub(mark.w).mul(-footprintDecay)));
  const bend = wind.add(push).add(mark.xy.mul(pressure.mul(.68))).mul(up.mul(up));
  const lifted = max(up.mul(.08), up.sub(length(bend).mul(.35)).sub(up.mul(pressure.mul(.57))));
  // tufts right at the lens shrink away to nothing, so a low camera (the tiger's) never looks out through a wall of blades
  const nearLens = smoothstep(.9, 2.6, length(root.sub(cameraPosition)));
  rm.positionNode = vec3(positionLocal.x.add(bend.x), lifted, positionLocal.z.add(bend.y)).mul(I.w.mul(nearLens)).add(root);
  // dry grass: ochre at the root, straw gold at the tip, each tuft a little different
  const var_ = texture3D(noise, root.mul(.3)).b, patch = texture3D(noise, root.mul(.045)).r, t = up.div(1.1);
  rm.colorNode = mix(vec3(.3, .17, .03), mix(vec3(.78, .46, .05), vec3(.95, .68, .13), patch), smoothstep(0, .8, t)).mul(var_.sub(.5).mul(.5).add(1));
  const reeds = new THREE.Mesh(reed, rm); reeds.frustumCulled = false; scene.add(reeds);
  return { reeds: ru, parts: { needles: needleMesh, wood: woodMesh, reeds } };
}

// Draw only the path the blade has travelled. The green edge flashes first, then the ink dries and narrows behind it.
export function buildTrail(noise, into) {
  const N = 72, lifetime = .29;
  const scene = into ?? new THREE.Scene(); if (!into) scene.background = new THREE.Color(0);
  const pos = new Float32Array(N * 2 * 3), age = new Float32Array(N * 2), weight = new Float32Array(N * 2), idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('age', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('weight', new THREE.BufferAttribute(weight, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('edge', new THREE.BufferAttribute(Float32Array.from({ length: N * 2 }, (_, i) => i % 2 ? 0 : 1), 1));
  g.setIndex(idx);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  m.forceSinglePass = true;
  const a = attribute('age', 'float'), edge = attribute('edge', 'float'), w = attribute('weight', 'float');
  const body = smoothstep(.02, .46, edge).mul(smoothstep(.94, 1, edge).oneMinus());
  const edgeLight = smoothstep(.77, .91, edge).mul(smoothstep(.96, 1, edge).oneMinus());
  const bristle = texture3D(noise, vec3(edge.mul(3.4), positionWorld.x.mul(.12), positionWorld.z.mul(.12))).g;
  const dry = mix(1, smoothstep(a.mul(.71).add(.02), a.mul(.71).add(.28), bristle), smoothstep(.12, .7, a));
  m.opacityNode = body.mul(dry).mul(smoothstep(.06, 1, a).oneMinus()).mul(w);
  // Red is composited as ink and green as light. The fine edge outlasts the dark core only near the moving tip.
  m.colorNode = vec3(mix(.42, .86, w), edgeLight.mul(a.oneMinus().pow(6)).mul(mix(.68, 1.2, w)), 0);
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
  const points = [], smooth = THREE.MathUtils.smoothstep, lerp = THREE.MathUtils.lerp;
  let time = 0, previousPhase = -1;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const cubic = (a, b, c, d, x) => b + .5 * x * (c - a + x * (2 * a - 5 * b + 4 * c - d + x * (3 * b - a - 3 * c + d)));
  return {
    scene,
    update(dt, blade, phase, drawnTip) {
      time += dt;
      if (blade && (previousPhase < 0 || phase < previousPhase)) points.length = 0;
      previousPhase = blade ? phase : -1;
      if (blade && phase > .13 && phase < .99) {
        const pressure = smooth(phase, .24, .52) * (1 - smooth(phase, .57, .99));
        const reach = smooth(phase, .16, .37);
        const tip = blade.b.map((value, i) => lerp(drawnTip.getComponent(i), value, reach));
        tip[1] += .09 * pressure;
        const sweepWeight = blade.combo === 2 ? 1.23 : blade.combo === 1 ? .84 : 1;
        const width = .045 + .51 * pressure ** 1.3 * sweepWeight;
        const inner = tip.map((value, i) => lerp(value, blade.a[i], width));
        inner[1] -= .12 * pressure;
        const strength = smooth(phase, .13, .34) * (.26 + .74 * pressure) * (1 - smooth(phase, .71, 1));
        const last = points.at(-1);
        if (!last || time - last.time >= 1 / 120 || distance(tip, last.tip) > .04) {
          points.push({ time, tip, inner, strength });
        }
      }
      while (points.length && time - points[0].time >= lifetime) points.shift();
      let count = 0;
      const row = (p0, p1, p2, p3, u) => {
        const t = Math.min(1, (time - lerp(p1.time, p2.time, u)) / lifetime);
        const shrink = 1 - .65 * t * t;
        for (let j = 0; j < 3; j++) {
          const outer = cubic(p0.tip[j], p1.tip[j], p2.tip[j], p3.tip[j], u);
          const inner = cubic(p0.inner[j], p1.inner[j], p2.inner[j], p3.inner[j], u);
          pos[count * 6 + j] = outer;
          pos[count * 6 + 3 + j] = lerp(outer, inner, shrink);
        }
        age[count * 2] = age[count * 2 + 1] = t;
        weight[count * 2] = weight[count * 2 + 1] = lerp(p1.strength, p2.strength, u);
        count++;
      };
      // Interpolate the measured tip path between simulation ticks, including the faster release.
      for (let i = points.length - 1; i > 0 && count < N; i--) {
        const b = points[i], c = points[i - 1], a = points[i + 1] ?? b, d = points[i - 2] ?? c;
        const steps = Math.max(1, Math.ceil(distance(b.tip, c.tip) / .17));
        for (let j = 0; j < steps && count < N; j++) row(a, b, c, d, j / steps);
        if (i === 1 && count < N) row(a, b, c, d, 1);
      }
      mesh.visible = count > 1;
      g.setDrawRange(0, Math.max(0, count - 1) * 6);
      if (mesh.visible) for (const attribute of Object.values(g.attributes)) if (attribute !== g.attributes.edge) attribute.needsUpdate = true;
    },
  };
}

// Ink thrown off by a blow: droplets that fly, fall and shrink. They sit in the stroke scene, so they land on top of the fog.
export function buildSplash(scene, N = 260) {
  const geometry = new THREE.SphereGeometry(1, 7, 5);
  const light = new Float32Array(N);
  const lightAttribute = new THREE.InstancedBufferAttribute(light, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('impactLight', lightAttribute);
  const m = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const gleam = attribute('impactLight', 'float');
  m.colorNode = vec3(gleam.oneMinus(), gleam, 0); // red inks the scene; green catches the blade's light
  const mesh = new THREE.InstancedMesh(geometry, m, N);
  mesh.frustumCulled = mesh.visible = false;
  scene.add(mesh);
  const p = new Float32Array(N * 3), v = new Float32Array(N * 3), life = new Float32Array(N), size = new Float32Array(N);
  const M = new THREE.Matrix4(), direction = new THREE.Vector3(), scale = new THREE.Vector3(), point = new THREE.Vector3();
  const orientation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let next = 0;
  return {
    // at: where the blow landed, dir: which way it was travelling (x, z), n: how many droplets
    // big: larger, faster, longer-lived droplets, for the giant's blows
    burst(at, dir, n, big = 1, glints = 0) {
      const strength = Math.sqrt(big);
      for (let i = 0; i < n + glints; i++) {
        const k = next++ % N, j = k * 3, a = Math.random() * 2 * Math.PI;
        const spark = i >= n, speed = (2.5 + Math.random() * (spark ? 13 : 9)) * strength;
        p.set(at, j);
        v[j] = (Math.cos(a) * (spark ? 1 : .48) + dir[0] * .78) * speed;
        v[j + 1] = (spark ? (Math.random() - .25) * 5 : 1.5 + Math.random() * 6.2) * strength;
        v[j + 2] = (Math.sin(a) * (spark ? 1 : .48) + dir[1] * .78) * speed;
        life[k] = (spark ? .075 + Math.random() * .13 : .26 + Math.random() * .47) * strength;
        size[k] = (spark ? .012 + Math.random() * .018 : .018 + Math.random() ** 3 * .11) * big;
        light[k] = spark ? 1 : 0;
      }
      lightAttribute.needsUpdate = true;
    },
    update(dt) {
      let visible = false;
      for (let k = 0; k < N; k++) {
        const j = k * 3;
        if (life[k] > 0) {
          life[k] -= dt;
          v[j + 1] -= (light[k] ? 4 : 22) * dt;
          for (let a = 0; a < 3; a++) { v[j + a] *= 1 - 2.5 * dt; p[j + a] += v[j + a] * dt; }
          if (v[j + 1] < 0 && p[j + 1] <= height(p[j], p[j + 2])) life[k] = 0;
        }
        if (life[k] > 0) {
          const s = size[k] * Math.min(1, life[k] * (light[k] ? 15 : 5));
          const speed = direction.set(v[j], v[j + 1], v[j + 2]).length();
          orientation.setFromUnitVectors(up, direction.divideScalar(Math.max(speed, .001)));
          scale.set(s, s * (1 + speed * (light[k] ? .46 : .14)), s);
          M.compose(point.set(p[j], p[j + 1], p[j + 2]), orientation, scale);
          visible = true;
        } else {
          M.makeScale(0, 0, 0);
        }
        mesh.setMatrixAt(k, M);
      }
      mesh.visible = visible;
      if (visible) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
