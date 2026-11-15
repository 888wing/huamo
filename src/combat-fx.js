import * as THREE from 'three/webgpu';
import { float, length, max, mix, mrt, positionWorld, smoothstep, texture3D, uniform, uv, vec3 } from 'three/tsl';
import { height } from './world.js';
import { wash } from './stage.js';

export const HIT_FEEDBACK = {
  cut: { stop: 4, ink: 32, light: 6, size: .8, flash: .10, kick: .10, shake: .44 },
  kill: { stop: 7, ink: 58, light: 8, size: 1.06, flash: .19, kick: .22, shake: .72 },
  push: { stop: 3, ink: 22, light: 0, size: .64, flash: .07, kick: .18, shake: .55, radius: 1.6, air: 18 },
  taken: { stop: 5, ink: 42, light: 2, size: .9, flash: .14, kick: .14, shake: .58 },
  down: { stop: 8, ink: 66, light: 2, size: 1.08, flash: .24, kick: .22, shake: .76 },
  block: { stop: 3, ink: 12, light: 13, size: .6, flash: .13, kick: .14, shake: .52, radius: 1.1, air: 4 },
  parry: { stop: 10, ink: 28, light: 37, size: .9, flash: .64, kick: .55, shake: 1.12, radius: 1.4, air: 7 },
  clash: { stop: 11, ink: 32, light: 43, size: .94, flash: .76, kick: .65, shake: 1.24, radius: 1.45, air: 8 },
};

// A thin surface that follows the terrain. The wet edge advances as the body runs out,
// then the pool sinks into the paper independently of the next enemy.
export function buildGroundInk(scene, noise) {
  const duration = 3.1;
  const pools = Array.from({ length: 4 }, () => {
    const geometry = new THREE.PlaneGeometry(2, 2, 12, 12);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true, alphaTest: .025, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const age = uniform(duration);
    const grain = texture3D(noise, positionWorld.mul(1.1));
    const reach = mix(.2, .93, smoothstep(0, 1.2, age));
    const edge = length(uv().sub(.5).mul(2)).add(grain.r.sub(.5).mul(.25)).sub(reach);
    const shape = smoothstep(-.1, .024, edge).oneMinus();
    const wet = smoothstep(-.11, -.055, edge).mul(smoothstep(-.05, .012, edge).oneMinus());
    const opacity = shape.mul(smoothstep(duration - 1.06, duration, age).oneMinus())
      .mul(smoothstep(0, .11, age)).mul(.92);
    material.opacityNode = opacity;
    material.mrtNode = mrt({ subjectMask: opacity.mul(.5) });
    material.colorNode = wash(grain.g.mul(.09).add(wet.mul(grain.b).mul(.38)));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, age };
  });
  let next = 0;
  return {
    land(at, yaw) {
      const pool = pools[next++ % pools.length];
      const { position, uv: coords } = pool.mesh.geometry.attributes;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      for (let i = 0; i < position.count; i++) {
        const side = (coords.getX(i) - .5) * 2.35;
        const back = (coords.getY(i) - .5) * 3.15 - .62;
        const x = at[0] + side * cos + back * sin, z = at[2] - side * sin + back * cos;
        position.setXYZ(i, x, height(x, z) + .028, z);
      }
      position.needsUpdate = true;
      pool.age.value = 0;
      pool.mesh.visible = true;
    },
    update(dt) {
      for (const pool of pools) {
        if (!pool.mesh.visible) continue;
        pool.age.value += dt;
        if (pool.age.value >= duration) pool.mesh.visible = false;
      }
    },
  };
}

// Where the giant's hand is about to come down: a ring of ink on the ground, filling in as the arm goes up.
// Marked in the subject matte like the ground ink, so it shows through the fog.
export function buildBlot(scene, noise) {
  const geometry = new THREE.PlaneGeometry(2, 2, 12, 12), grow = uniform(0), strength = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, alphaTest: .02, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const grain = texture3D(noise, positionWorld.mul(.9)), d = length(uv().sub(.5).mul(2)).add(grain.r.sub(.5).mul(.16));
  const ring = smoothstep(.09, 0, d.sub(.9).abs()), fill = smoothstep(grow.mul(.9), grow.mul(.9).sub(.18), d).mul(.5);
  material.opacityNode = max(ring.mul(.85), fill).mul(strength);
  material.mrtNode = mrt({ subjectMask: smoothstep(.12, .3, material.opacityNode).mul(.5) }); // at full weight in the matte: it has to be read through the fog
  material.colorNode = wash(grain.g.mul(.1));
  const mesh = new THREE.Mesh(geometry, material); mesh.visible = false; mesh.frustumCulled = false; scene.add(mesh);
  let last = '';
  return {
    // at: the centre on the ground, radius in metres, k: 0..1 how far the arm is up (0 hides it)
    set(at, radius, k) {
      mesh.visible = k > .01; strength.value = Math.min(1, k * 3); grow.value = k; if (!mesh.visible) return;
      const key = at[0].toFixed(2) + at[2].toFixed(2); if (key === last) return; last = key;
      const { position, uv: coords } = geometry.attributes;
      for (let i = 0; i < position.count; i++) { const x = at[0] + (coords.getX(i) - .5) * 2 * radius * 1.12, z = at[2] + (coords.getY(i) - .5) * 2 * radius * 1.12; position.setXYZ(i, x, height(x, z) + .04, z); }
      position.needsUpdate = true;
    },
  };
}

// The curtain of fog round the giant's clearing: a tall strip along a closed line on the ground, drawn as slow rising
// wisps of paper-white. Before the bout it stands all the way round; once someone is inside, it shows only near them.
export function buildCurtain(scene, noise, line) {
  const n = line.length, pos = new Float32Array(n * 6), uvs = new Float32Array(n * 4), idx = [];
  for (let i = 0, s = 0; i < n; i++) {
    const [x, z] = line[i]; if (i) s += Math.hypot(x - line[i - 1][0], z - line[i - 1][1]);
    const y = height(x, z); pos.set([x, y - .6, z, x, y + 8.5, z], i * 6); uvs.set([s, 0, s, 1], i * 4);
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i, 2 * i - 1, 2 * i + 1);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setIndex(idx);
  const time = uniform(0), hero = uniform(new THREE.Vector3()), open = uniform(1), strength = uniform(1);
  // (it writes depth where it is thick, so the haze of distance is not laid over it as if it were not there, and the
  // brush finds its edges like any other body's)
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, alphaTest: .34, side: THREE.DoubleSide });
  const q = positionWorld.mul(vec3(.085, .05, .085)).add(vec3(0, time.mul(-.035), time.mul(.012))), a = texture3D(noise, q).r, b = texture3D(noise, q.mul(2.7).add(vec3(.3, time.mul(-.05), 0))).g;
  // long threads hanging in it, drifting down: what makes it a curtain and not more of the same mist
  const thread = texture3D(noise, vec3(uv().x.mul(.42), uv().y.mul(.55).add(time.mul(.045)), time.mul(.008))).r;
  const wisp = smoothstep(.28, .72, a.mul(.7).add(b.mul(.42))), v = uv().y, fade = smoothstep(1, .25, v).mul(smoothstep(0, .05, v));
  const near = smoothstep(10, 3, length(positionWorld.xz.sub(hero.xz)));
  material.opacityNode = wisp.mul(.45).add(.5).mul(fade).mul(mix(near, 1, open)).mul(strength);
  material.colorNode = wash(mix(.62, 1, smoothstep(.3, .62, thread)).mul(mix(.9, 1, b)));
  material.mrtNode = mrt({ subjectMask: float(0) });
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);
  return {
    // t: seconds; at: where the player is; standing: 1 all the way round, 0 only near the player; k: 0 gone .. 1 there
    update(t, at, standing, k) { time.value = t; hero.value.set(at[0], at[1], at[2]); open.value = standing; strength.value = k; mesh.visible = k > .01; },
  };
}
