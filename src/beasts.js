// The three animal forms, each a small skeleton posed in code with ink-washed parts and strips for tail, feathers and fins.
import * as THREE from 'three/webgpu';
import { Fn, float, smoothstep, sin, positionLocal, normalView, uniform } from 'three/tsl';
import { wash, basic, SEAL } from './stage.js';
import { cloth, taper, ball, cone, box } from './figure.js';
import { Strips } from './strips.js';

class Rig {
  constructor(scene) { this.group = new THREE.Group(); scene.add(this.group); this.bones = []; }
  bone(parent, x, y, z) { const b = new THREE.Group(); b.position.set(x, y, z); b.t = [0, 0, 0]; b.home = [x, y, z]; parent.add(b); this.bones.push(b); return b; }
  add(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx; parent.add(m); return m; }
  set visible(v) { if (v && !this.group.visible) this.cloth.fresh = true; this.group.visible = this.cloth.mesh.visible = v; }
  // ease every bone towards its target, place the body, then let the strips follow
  settle(dt, st, cam, rate = 16, lift = 0) {
    const k = 1 - Math.exp(-rate * dt), g = this.group;
    for (const b of this.bones) { b.rotation.x += (b.t[0] - b.rotation.x) * k; b.rotation.y += (b.t[1] - b.rotation.y) * k; b.rotation.z += (b.t[2] - b.rotation.z) * k; b.t = [0, 0, 0]; }
    // changing form: the body leaving is drawn out along its length into a streak of ink, the one arriving swells up from a point
    const size = (1 - .65 * (st.fade ?? 0)) * (.2 + .8 * (st.grow ?? 1)), sk = st.streak ?? 0;
    g.position.set(st.p[0], st.p[1] + lift, st.p[2]); g.rotation.y = st.yaw; g.scale.set(size * (1 - .9 * sk), size * (1 - .9 * sk), size * (1 + .7 * sk)); g.updateMatrixWorld(true);
    this.cloth.update(dt, st.p, st.yaw, g.scale.x, cam);
  }
}

export function buildBeasts(scene, noise) {
  const red = basic(uniform(new THREE.Color(SEAL))), dark = cloth(noise, .06), pale = cloth(noise, .86);
  // striped hide: dark bands wrap each part, rim goes to ink
  const hide = basic(Fn(() => {
    const band = smoothstep(.45, .8, sin(positionLocal.z.mul(8).add(positionLocal.y.mul(4))).abs());
    return wash(float(.64).sub(band.oneMinus().mul(.5)).sub(smoothstep(.3, .85, float(1).sub(normalView.z.abs())).mul(.7)));
  })());

  // ---- tiger
  const T = new Rig(scene), tg = T.group;
  const hips = T.bone(tg, 0, .84, -.55), chest = T.bone(tg, 0, .88, .5), neck = T.bone(chest, 0, .1, .3), head = T.bone(neck, 0, .06, .24), jaw = T.bone(head, 0, -.08, .1);
  T.add(tg, ball, hide, 0, .86, 0, .29, .3, .8); T.add(hips, ball, hide, 0, 0, 0, .31, .33, .44); T.add(chest, ball, hide, 0, 0, 0, .34, .36, .44);
  T.add(neck, ball, hide, 0, 0, .1, .2, .22, .26); T.add(head, ball, hide, 0, 0, .05, .21, .2, .22); T.add(head, ball, pale, 0, -.05, .22, .12, .09, .12);
  T.add(jaw, box, dark, 0, -.02, .1, .13, .035, .18); T.add(head, cone, dark, .13, .2, 0, .06, .12, .05); T.add(head, cone, dark, -.13, .2, 0, .06, .12, .05);
  T.add(head, ball, red, .09, .05, .24, .028, .022, .02); T.add(head, ball, red, -.09, .05, .24, .028, .022, .02);
  const legs = [];
  for (const [par, z, front] of [[chest, .08, 1], [hips, -.05, 0]]) for (const s of [1, -1]) {
    const up = T.bone(par, s * .2, -.12, z), lo = T.bone(up, 0, -.42, 0);
    T.add(up, taper(.13, .085, .44), hide); T.add(lo, taper(.075, .06, .4), hide); T.add(lo, ball, pale, 0, -.4, .04, .085, .05, .12);
    legs.push({ up, lo, off: (front ? 0 : 2.6) + (s > 0 ? 0 : .5), front });
  }
  T.cloth = new Strips(scene, noise, [[hips, 0, .12, -.4, 0, .25, -1, 1.25, .13, .06, .22], [neck, .16, .0, .1, .5, -.6, -.3, .22, .16, .05, .8], [neck, -.16, .0, .1, -.5, -.6, -.3, .22, .16, .05, .8]], { grav: 9, pull: 9 });
  T.update = (dt, st, cam) => {
    const w = st.phase * 2.2, r = st.run, roar = st.act >= 0 ? Math.sin(Math.PI * st.act) : 0;
    for (const l of legs) { const a = w + l.off; l.up.t[0] = Math.sin(a) * .95 * r + (l.front ? -.5 * roar : 0); l.lo.t[0] = (l.front ? -1 : 1) * (.25 + Math.max(0, Math.cos(a)) * 1.0 * r); }
    // coming out of the roll: curled, forepaws reaching for the ground, then straightening into the run
    const curl = 1 - (st.grow ?? 1);
    for (const l of legs) { l.up.t[0] += (l.front ? -1.0 : .7) * curl; l.lo.t[0] += (l.front ? .5 : 1.1) * curl; }
    chest.t[0] = Math.sin(w) * .13 * r - .45 * roar + .6 * curl; hips.t[0] = -Math.sin(w) * .13 * r - .5 * curl; neck.t[0] = -.15 - .3 * roar + Math.sin(w + 1) * .08 * r; head.t[0] = .2 - .35 * roar; jaw.t[0] = .1 + .75 * roar;
    T.settle(dt, st, cam, 18, Math.abs(Math.sin(w)) * .12 * r);
  };

  // ---- crane
  const C = new Rig(scene), cg = C.group;
  C.add(cg, ball, pale, 0, 0, 0, .2, .19, .5);
  const n1 = C.bone(cg, 0, .06, .42), n2 = C.bone(n1, 0, 0, .3), ch = C.bone(n2, 0, 0, .3);
  C.add(n1, ball, pale, 0, 0, .15, .05, .05, .18); C.add(n2, ball, dark, 0, 0, .15, .042, .042, .18); C.add(ch, ball, pale, 0, 0, .05, .06, .055, .085);
  C.add(ch, ball, red, 0, .045, .04, .04, .025, .05); C.add(ch, cone, dark, 0, 0, .25, .02, .26, .02, 1.57);
  const wings = [], feathers = [];
  for (const s of [1, -1]) {
    const a = C.bone(cg, s * .12, .06, .08), b = C.bone(a, s * .85, 0, 0);
    C.add(a, box, pale, s * .43, 0, 0, .88, .035, .46); C.add(b, box, pale, s * .36, 0, -.02, .74, .03, .36);
    for (let i = 0; i < 5; i++) feathers.push([b, s * (.15 + i * .17), 0, -.14, s * .35 * (i / 4), -.15, -1, .55 + .1 * i, .17, .05, .04]);
    for (let i = 0; i < 4; i++) feathers.push([a, s * (.15 + i * .2), 0, -.2, 0, -.15, -1, .34, .2, .08, i % 2 ? .1 : .82]);
    wings.push({ a, b, s });
    const leg = C.bone(cg, s * .05, -.1, -.3); leg.home.r = 1.45; C.add(leg, taper(.02, .012, .8), dark);
    wings[wings.length - 1].leg = leg;
  }
  for (let i = 0; i < 3; i++) feathers.push([cg, (i - 1) * .08, 0, -.46, (i - 1) * .25, -.1, -1, .36, .14, .05, .08]);
  C.cloth = new Strips(scene, noise, feathers, { grav: 2.5, pull: 22 });
  C.update = (dt, st, cam) => {
    const hard = st.act >= 0, a = Math.sin(st.phase * (hard ? 3 : 1.25)) * (hard ? 1.0 : .5), b = Math.sin(st.phase * (hard ? 3 : 1.25) - 1) * (hard ? .8 : .45) - .12;
    // out of the jump: the wings come up folded and open
    const fold = 1 - (st.grow ?? 1);
    for (const wg of wings) { wg.a.t[2] = wg.s * (a * (1 - fold) + 1.25 * fold); wg.b.t[2] = wg.s * (b * (1 - fold) - 2.2 * fold); wg.leg.t[0] = 1.45 + st.vy * .03; }
    const stretch = Math.min(1, st.run); n1.t[0] = -.55 + .35 * stretch; n2.t[0] = .4 - .25 * stretch; ch.t[0] = .25 - .1 * stretch + st.vy * .03;
    cg.rotation.x = -st.vy * .05;
    C.settle(dt, st, cam, 22, -a * .1);
  };

  // ---- carp
  const K = new Rig(scene), kg = K.group, sp = [K.bone(kg, 0, 0, .35)];
  for (const z of [-.42, -.42, -.36, -.28]) sp.push(K.bone(sp[sp.length - 1], 0, 0, z));
  [[.25, .3, .36], [.3, .37, .36], [.25, .31, .33], [.17, .22, .28], [.09, .13, .2]].forEach((d, i) => { K.add(sp[i], ball, i === 2 ? pale : red, 0, 0, 0, d[0], d[1], d[2]); });
  K.add(sp[0], ball, pale, 0, -.08, .12, .2, .2, .26); K.add(sp[0], ball, dark, .2, .06, .18, .03, .03, .03); K.add(sp[0], ball, dark, -.2, .06, .18, .03, .03, .03);
  const fins = [];
  for (let i = 0; i < 3; i++) fins.push([sp[4], 0, (i - 1) * .1, -.15, 0, (i - 1) * .35, -1, .85, .36, .2, 2]);
  for (const i of [1, 2]) fins.push([sp[i], 0, .33, 0, 0, .5, -1, .36, .24, .08, 2]);
  for (const s of [1, -1]) { fins.push([sp[1], s * .27, -.12, .1, s * .9, -.4, -.5, .5, .2, .07, .86]); fins.push([sp[3], s * .12, -.16, 0, s * .6, -.6, -.6, .3, .14, .05, .86]); }
  K.cloth = new Strips(scene, noise, fins, { grav: .6, pull: 20 });
  K.update = (dt, st, cam) => {
    sp.forEach((b, i) => { b.t[1] = Math.sin(st.phase * 2.4 - i * .85) * (.08 + i * .1) * (.5 + .5 * st.run); });
    kg.rotation.x = -st.vy * .08;
    K.settle(dt, st, cam, 20);
  };
  return [T, C, K];
}
