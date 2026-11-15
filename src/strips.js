// Torn cloth, feathers, fins and tails: strips of verlet points hung from bones and drawn as ribbons turned to the camera.
import * as THREE from 'three/webgpu';
import { vec3, mix, smoothstep, texture3D, attribute, uv, uniform, step } from 'three/tsl';
import { wash, SEAL } from './stage.js';
import { height } from './world.js';

const P = 7; // points per strip

export class Strips {
  // defs: [bone, anchor x y z, rest direction x y z (body space), length, width at root, width at tip, tone (2 = vermilion)]
  // opt: gravity and pull towards the rest direction; body radius and height the strips are kept out of
  constructor(scene, noise, defs, opt = {}) {
    this.o = { grav: 16, pull: 5, rad: 0, top: 0, stiff: 0, ...opt };
    this.S = defs.map(s => ({ bone: s[0], at: new THREE.Vector3(s[1], s[2], s[3]), dir: [s[4], s[5], s[6]], len: s[7], w0: s[8], w1: s[9] }));
    const n = defs.length, pos = new Float32Array(n * P * 6), uvs = new Float32Array(n * P * 4), tone = new Float32Array(n * P * 2), sid = new Float32Array(n * P * 2), idx = [];
    defs.forEach((s, i) => {
      for (let j = 0; j < P; j++) for (let e = 0; e < 2; e++) { const v = (i * P + j) * 2 + e; uvs[v * 2] = e; uvs[v * 2 + 1] = j / (P - 1); tone[v] = s[10]; sid[v] = i; }
      for (let j = 0; j < P - 1; j++) { const a = (i * P + j) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('tone', new THREE.BufferAttribute(tone, 1)); geo.setAttribute('sid', new THREE.BufferAttribute(sid, 1)); geo.setIndex(idx);
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const t = attribute('tone', 'float'), id = attribute('sid', 'float'), q = uv(), edge = q.x.sub(.5).abs();
    const hole = texture3D(noise, vec3(q.x.mul(.9).add(id.mul(.37)), q.y.mul(1.5), id.mul(.61))).b, fray = texture3D(noise, vec3(q.x.mul(3.2).add(id), q.y.mul(.45), .3)).g;
    m.colorNode = mix(wash(t.add(fray.sub(.5).mul(.5)).sub(smoothstep(.22, .5, edge).mul(.4))), uniform(new THREE.Color(SEAL)).mul(fray.mul(.5).add(.7)), step(1.5, t));
    m.opacityNode = hole.sub(mix(.08, .6, q.y.mul(q.y))).sub(edge.mul(.3)).mul(8).add(.5); // torn more towards the tip
    m.alphaTest = .5;
    this.mesh = new THREE.Mesh(geo, m); this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.pts = new Float32Array(n * P * 3); this.prev = new Float32Array(n * P * 3); this.tmp = new THREE.Vector3(); this.fresh = true;
  }
  // feet: body position, yaw: its heading, sc: its scale, cam: camera position
  update(dt, feet, yaw, sc, cam) {
    const { pts, prev, S, tmp, o } = this, sy = Math.sin(yaw), cy = Math.cos(yaw), hx = feet[0], hz = feet[2];
    const pos = this.geo.attributes.position.array, ground = height(hx, hz) + .03, rad = o.rad * sc;
    for (let i = 0; i < S.length; i++) {
      const c = S[i], b0 = i * P * 3, seg = c.len * sc / (P - 1);
      c.bone.localToWorld(tmp.copy(c.at));
      const d = [c.dir[0] * cy + c.dir[2] * sy, c.dir[1], -c.dir[0] * sy + c.dir[2] * cy], acc = [d[0] * o.pull, d[1] * o.pull - o.grav, d[2] * o.pull];
      pts[b0] = tmp.x; pts[b0 + 1] = tmp.y; pts[b0 + 2] = tmp.z;
      for (let j = 1; j < P; j++) {
        const q = b0 + j * 3;
        if (this.fresh || j <= o.stiff) { for (let a = 0; a < 3; a++) pts[q + a] = prev[q + a] = pts[b0 + a] + d[a] * seg * j; continue; }
        for (let a = 0; a < 3; a++) { const v = (pts[q + a] - prev[q + a]) * .9; prev[q + a] = pts[q + a]; pts[q + a] += v + acc[a] * dt * dt; }
        const ex = pts[q] - pts[q - 3], ey = pts[q + 1] - pts[q - 2], ez = pts[q + 2] - pts[q - 1], l = Math.hypot(ex, ey, ez) || 1;
        pts[q] = pts[q - 3] + ex / l * seg; pts[q + 1] = pts[q - 2] + ey / l * seg; pts[q + 2] = pts[q - 1] + ez / l * seg;
        const bx = pts[q] - hx, bz = pts[q + 2] - hz, bd = Math.hypot(bx, bz);
        if (bd < rad && pts[q + 1] < feet[1] + o.top * sc) { pts[q] = hx + bx / (bd || 1) * rad; pts[q + 2] = hz + bz / (bd || 1) * rad; }
        if (pts[q + 1] < ground) pts[q + 1] = ground;
      }
      for (let j = 0; j < P; j++) {
        const q = b0 + j * 3, a = b0 + Math.max(0, j - 1) * 3, b = b0 + Math.min(P - 1, j + 1) * 3;
        const tx = pts[b] - pts[a], ty = pts[b + 1] - pts[a + 1], tz = pts[b + 2] - pts[a + 2], cx = cam.x - pts[q], cyy = cam.y - pts[q + 1], cz = cam.z - pts[q + 2];
        let nx = ty * cz - tz * cyy, ny = tz * cx - tx * cz, nz = tx * cyy - ty * cx; const hw = (c.w0 + (c.w1 - c.w0) * j / (P - 1)) * .5 * sc / (Math.hypot(nx, ny, nz) || 1);
        nx *= hw; ny *= hw; nz *= hw;
        const v = (i * P + j) * 6; pos[v] = pts[q] + nx; pos[v + 1] = pts[q + 1] + ny; pos[v + 2] = pts[q + 2] + nz; pos[v + 3] = pts[q] - nx; pos[v + 4] = pts[q + 1] - ny; pos[v + 5] = pts[q + 2] - nz;
      }
    }
    this.fresh = false; this.geo.attributes.position.needsUpdate = true;
  }
}
