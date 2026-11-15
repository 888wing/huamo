import * as THREE from 'three/webgpu';
import { length, mix, mrt, positionWorld, smoothstep, texture3D, uniform, uv } from 'three/tsl';
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
