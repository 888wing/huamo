// The three.js side of the world, all drawn as ink on paper: terrain, far mountains, pines, the four bodies and the sword stroke.
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, mix, smoothstep, normalWorld, positionWorld, positionLocal, texture3D, dot, uniform, attribute, clamp } from 'three/tsl';
import { SIZE, height, PILLARS } from './world.js';
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
    return wash(mix(ground, face, rock));
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
function foliageMaterial(noise, dark) {
  return basic(Fn(() => {
    const n = texture3D(noise, positionWorld.mul(.9)).b;
    return wash(float(dark).add(n.mul(.16)).add(dot(normalWorld, sun).mul(.05)));
  })());
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

  // pines: a leaning trunk and flat layers of needles, on the plateau, the rim and three of the pillars
  // needle pads are lumpy, not round: ink dabs, each a little different
  const trunkG = new THREE.CylinderGeometry(.45, 1, 1, 6);
  const pads = [0, 1, 2, 3].map(() => {
    const c = new THREE.SphereGeometry(1, 8, 5), p = c.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = .62 + rnd() * .7; p.setXYZ(i, p.getX(i) * k, p.getY(i) * (.6 + rnd() * .9), p.getZ(i) * k); }
    c.computeVertexNormals(); return c;
  });
  const trunkM = foliageMaterial(noise, .0), padM = foliageMaterial(noise, .02);
  const pine = (x, z, k, y = height(x, z)) => {
    const t = new THREE.Group(), lean = (rnd() - .5) * .5, hgt = (3.2 + rnd() * 2.6) * k;
    const trunk = new THREE.Mesh(trunkG, trunkM); trunk.scale.set(.13 * k, hgt, .13 * k); trunk.position.y = hgt / 2; t.add(trunk);
    for (let i = 0, nl = 4 + (rnd() * 3 | 0); i < nl; i++) {
      const f = i / (nl - 1), pad = new THREE.Mesh(pads[(rnd() * 4) | 0], padM), w = (1.7 - f * 1.1) * k * (.75 + rnd() * .5);
      pad.scale.set(w, .2 * k * (.7 + rnd() * .6), w * (.45 + rnd() * .3));
      pad.position.set((i % 2 ? .5 : -.5) * w * .7 * (1 - f * .6), hgt * (.48 + f * .55), (rnd() - .5) * .7 * k);
      pad.rotation.set((rnd() - .5) * .5, rnd() * 3, (i % 2 ? -.22 : .22) + (rnd() - .5) * .3); t.add(pad);
    }
    t.position.set(x, y - .15, z); t.rotation.set(lean, rnd() * 6, lean * .6); scene.add(t);
  };
  for (let i = 0; i < 9; i++) pine(-20 - rnd() * 8, -13 + rnd() * 26, 1 + rnd() * .5);
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.283, r = 25 + rnd() * 5; pine(Math.cos(a) * r, Math.sin(a) * r, .9 + rnd() * .7); }
  for (const i of [0, 2, 5]) { const [px, pz, , ph] = PILLARS[i]; pine(px + .3, pz - .2, .55, ph - .1); }
}

// The four bodies. Flat ink silhouettes with one vermilion accent each.
export function buildBodies(scene) {
  const ink = basic(wash(float(.02))), red = basic(uniform(new THREE.Color(SEAL))), pale = basic(wash(float(.82)));
  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz); return m;
  };
  const sph = new THREE.SphereGeometry(1, 16, 12), cyl = new THREE.CylinderGeometry(1, 1, 1, 8), cone = new THREE.ConeGeometry(1, 1, 14), box = new THREE.BoxGeometry(1, 1, 1);
  const grp = (...parts) => { const g = new THREE.Group(), inner = new THREE.Group(); parts.forEach(p => inner.add(p)); g.add(inner); g.inner = inner; g.visible = false; scene.add(g); return g; };
  const pivot = (x, y, z, ...kids) => { const p = new THREE.Group(); p.position.set(x, y, z); kids.forEach(k => p.add(k)); return p; };
  // all bodies face +z; origin at the feet (ground forms) or the centre (crane, carp)
  const sword = pivot(.3, 1.15, .1, part(box, ink, 0, 0, .8, 0, 0, 0, .025, .05, 1.6));
  const human = grp(part(cone, ink, 0, .72, 0, 0, 0, 0, .46, 1.44, .36), part(cone, ink, 0, 1.25, -.12, .5, 0, 0, .5, .8, .3),
    part(sph, ink, 0, 1.6, 0, 0, 0, 0, .16, .18, .16), part(cone, ink, 0, 1.8, 0, 0, 0, 0, .5, .2, .5),
    part(box, red, 0, 1.02, .0, 0, 0, 0, .5, .07, .4), sword);
  const leg = (x, z) => pivot(x, .72, z, part(cyl, ink, 0, -.36, 0, 0, 0, 0, .09, .72, .09));
  const legs = [leg(.2, .62), leg(-.2, .62), leg(.22, -.6), leg(-.22, -.6)];
  const tigerTail = pivot(0, .95, -.9, part(cyl, ink, 0, .1, -.45, -1.2, 0, 0, .05, 1, .05));
  const tiger = grp(part(sph, ink, 0, .82, 0, 0, 0, 0, .36, .38, .98), part(sph, ink, 0, 1.02, 1, 0, 0, 0, .3, .28, .34),
    part(cone, ink, .17, 1.3, .98, 0, 0, 0, .08, .16, .08), part(cone, ink, -.17, 1.3, .98, 0, 0, 0, .08, .16, .08),
    part(sph, red, .12, 1.06, 1.3, 0, 0, 0, .035, .035, .035), part(sph, red, -.12, 1.06, 1.3, 0, 0, 0, .035, .035, .035), ...legs, tigerTail);
  const wing = sx => pivot(0, 0, 0, part(box, pale, sx * 1, 0, 0, 0, 0, 0, 2, .03, .6), part(box, ink, sx * 1.75, 0, -.12, 0, 0, 0, .7, .035, .5));
  const pivL = wing(1), pivR = wing(-1);
  const crane = grp(part(sph, pale, 0, 0, 0, 0, 0, 0, .22, .2, .62), part(cyl, ink, 0, .12, .8, 1.2, 0, 0, .04, .78, .04),
    part(sph, red, 0, .3, 1.16, 0, 0, 0, .07, .06, .08), part(cone, ink, 0, .27, 1.36, 1.55, 0, 0, .035, .3, .035),
    part(cyl, ink, 0, -.08, -.9, 1.5, 0, 0, .022, 1, .022), pivL, pivR);
  const tailPiv = pivot(0, 0, -1.05, part(cone, red, 0, 0, -.3, -1.57, 0, 0, .55, .9, .05));
  const carp = grp(part(sph, red, 0, 0, 0, 0, 0, 0, .34, .42, 1.2), part(sph, pale, 0, -.1, .1, 0, 0, 0, .3, .34, 1.0),
    part(cone, red, 0, .44, -.1, 0, 0, 0, .04, .42, .5), tailPiv);
  return { groups: [human, tiger, crane, carp], pivL, pivR, tailPiv, legs, tigerTail, sword };
}

// The sword stroke: a band along the path of the sword's tip, pressed down in the middle and lifted at both ends like a
// brush stroke. It lives in its own scene and is laid over the finished picture, so the fog never hides it.
// The material writes coverage into the red channel over a black clear.
export function buildTrail(noise, into, N = 22) {
  const scene = into ?? new THREE.Scene(); if (!into) scene.background = new THREE.Color(0);
  const pos = new Float32Array(N * 2 * 3), age = new Float32Array(N * 2).fill(1), idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('age', new THREE.BufferAttribute(age, 1)); g.setIndex(idx);
  g.setAttribute('side', new THREE.BufferAttribute(Float32Array.from({ length: N * 2 }, (_, i) => i % 2 ? -1 : 1), 1));
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  const a = attribute('age', 'float'), n = texture3D(noise, positionWorld.mul(vec3(.35, 3.2, .35))).b;
  // soft at both edges, streaked along its length like bristles, and running dry as it ages
  const sd = attribute('side', 'float'), bristle = texture3D(noise, vec3(sd.mul(2.2), positionWorld.x.mul(.07), positionWorld.z.mul(.07))).g;
  m.opacityNode = smoothstep(1, .2, a).mul(smoothstep(-1, -.2, sd).mul(smoothstep(1, .9, sd))).mul(smoothstep(a.mul(.8).add(.12), a.mul(.8).add(.4), n.mul(.5).add(bristle.mul(.7))));
  // red = ink coverage; green = the white light along the leading outer edge, gone almost at once
  m.colorNode = vec3(1, smoothstep(.45, .9, sd).mul(a.oneMinus().pow(3)), 0);
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
  let live = 0;
  return {
    scene,
    // tip: where the sword's tip is now, w: half-width of the stroke there (or null when not striking)
    update(dt, tip, w) {
      pos.copyWithin(6, 0, (N - 1) * 6); age.copyWithin(2, 0, (N - 1) * 2);
      for (let i = 2; i < N * 2; i++) age[i] = Math.min(1, age[i] + dt / .5);
      if (tip) { pos.set(tip, 0); pos.set(w, 3); age[0] = age[1] = 0; live = N; } // tip = outer edge, w = inner edge of the crescent
      else { pos.copyWithin(0, 6, 12); age[0] = age[1] = 1; live--; }
      mesh.visible = live > 0;
      g.attributes.position.needsUpdate = true; g.attributes.age.needsUpdate = true;
    },
  };
}

// Ink thrown off by a blow: droplets that fly, fall and shrink. They sit in the stroke scene, so they land on top of the fog.
export function buildSplash(scene, N = 160) {
  const m = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false }); m.colorNode = vec3(1, 0, 0); // red channel only: ink, not light
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), m, N); mesh.frustumCulled = false; scene.add(mesh);
  const p = new Float32Array(N * 3), v = new Float32Array(N * 3), life = new Float32Array(N), size = new Float32Array(N), M = new THREE.Matrix4();
  let next = 0;
  return {
    // at: where the blow landed, dir: which way it was travelling (x, z), n: how many droplets
    burst(at, dir, n) {
      for (let i = 0; i < n; i++) {
        const k = next++ % N, a = Math.random() * 6.283, s = 2 + Math.random() * 9, up = Math.random();
        p.set(at, k * 3); v[k * 3] = Math.cos(a) * s * .6 + dir[0] * s; v[k * 3 + 1] = 1 + up * 7; v[k * 3 + 2] = Math.sin(a) * s * .6 + dir[1] * s;
        life[k] = .35 + Math.random() * .5; size[k] = .03 + Math.random() ** 3 * .16;
      }
    },
    update(dt) {
      for (let k = 0; k < N; k++) {
        if (life[k] > 0) { life[k] -= dt; v[k * 3 + 1] -= 20 * dt; for (let a = 0; a < 3; a++) { v[k * 3 + a] *= 1 - 2.5 * dt; p[k * 3 + a] += v[k * 3 + a] * dt; } }
        const s = life[k] > 0 ? size[k] * Math.min(1, life[k] * 4) : 0, sp = Math.hypot(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]) * .012;
        M.makeScale(s, s * (1 + sp * 8), s).setPosition(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); mesh.setMatrixAt(k, M); // stretched along its fall
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
