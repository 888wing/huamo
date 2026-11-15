// The three animal forms, each a skeleton posed in code with ink-washed parts and strips for tail, feathers and fins.
// Tiger: a spine that gathers and stretches, three-segment legs, a gallop with a moment off the ground.
// Crane: three-bone wings that fold, flap with a soft outer wing, glide, bank and tuck for a dive.
// Carp: seven vertebrae carrying a wave, fins that steer, a body that rolls into turns and arcs when it leaves the fog.
import * as THREE from 'three/webgpu';
import { Fn, float, smoothstep, sin, positionLocal, normalView, uniform } from 'three/tsl';
import { wash, basic, SEAL } from './stage.js';
import { cloth, taper, ball, cone, box } from './figure.js';
import { Strips } from './strips.js';
import { height, FOG_TOP } from './world.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), cl = x => Math.min(1, Math.max(0, x)), sm = (x, a, b) => { const k = cl((x - a) / (b - a)); return k * k * (3 - 2 * k); };

class Rig {
  constructor(scene) { this.group = new THREE.Group(); this.group.rotation.order = 'YXZ'; scene.add(this.group); this.bones = []; this.pYaw = 0; this.turn = 0; }
  bone(parent, x, y, z) { const b = new THREE.Group(); b.position.set(x, y, z); b.t = [0, 0, 0]; parent.add(b); this.bones.push(b); return b; }
  add(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx; parent.add(m); return m; }
  set visible(v) { if (v && !this.group.visible) this.cloth.fresh = true; this.group.visible = this.cloth.mesh.visible = v; }
  // how fast the body is turning (smoothed, rad/s): every beast leans into its turns by this
  turning(dt, yaw) { if (dt > 1e-4) this.turn += (Math.max(-6, Math.min(6, wrap(yaw - this.pYaw) / dt)) - this.turn) * Math.min(1, 8 * dt); this.pYaw = yaw; return this.turn; }
  // ease every bone towards its target, place the body (pitch nose-down positive, roll), then let the strips follow
  settle(dt, st, cam, rate = 16, lift = 0, pitch = 0, roll = 0) {
    const k = 1 - Math.exp(-rate * dt), g = this.group;
    for (const b of this.bones) { b.rotation.x += (b.t[0] - b.rotation.x) * k; b.rotation.y += (b.t[1] - b.rotation.y) * k; b.rotation.z += (b.t[2] - b.rotation.z) * k; b.t = [0, 0, 0]; }
    // changing form: the body leaving is drawn out along its length into a streak of ink, the one arriving swells up from a point
    const size = (1 - .65 * (st.fade ?? 0)) * (.2 + .8 * (st.grow ?? 1)), sk = st.streak ?? 0;
    g.position.set(st.p[0], st.p[1] + lift, st.p[2]); g.rotation.set(pitch, st.yaw, roll); g.scale.set(size * (1 - .9 * sk), size * (1 - .9 * sk), size * (1 + .7 * sk)); g.updateMatrixWorld(true);
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

  // ---- tiger: pelvis -> loin -> chest -> neck -> head down the spine; each leg is three segments ending in a paw
  const T = new Rig(scene), tg = T.group;
  const pelvis = T.bone(tg, 0, .86, -.5), loin = T.bone(pelvis, 0, .02, .36), chest = T.bone(loin, 0, .02, .4), neck = T.bone(chest, 0, .12, .4), head = T.bone(neck, 0, .06, .26), jaw = T.bone(head, 0, -.08, .1);
  T.add(pelvis, ball, hide, 0, 0, -.04, .3, .32, .4); T.add(loin, ball, hide, 0, -.01, .16, .27, .29, .36); T.add(chest, ball, hide, 0, 0, .12, .33, .37, .42);
  const blades = [1, -1].map(s => T.add(chest, ball, hide, s * .2, .2, .12, .12, .16, .2));                 // shoulder blades: they ride up as each foreleg takes the weight
  T.add(neck, ball, hide, 0, 0, .1, .2, .22, .26); T.add(head, ball, hide, 0, 0, .05, .21, .2, .22); T.add(head, ball, pale, 0, -.05, .22, .12, .09, .12);
  T.add(jaw, box, dark, 0, -.02, .1, .13, .035, .18); T.add(head, cone, dark, .13, .2, 0, .06, .12, .05); T.add(head, cone, dark, -.13, .2, 0, .06, .12, .05);
  T.add(head, ball, red, .09, .05, .24, .028, .022, .02); T.add(head, ball, red, -.09, .05, .24, .028, .022, .02);
  const legs = [];
  for (const front of [1, 0]) for (const s of [1, -1]) {
    const a = T.bone(front ? chest : pelvis, s * .2, front ? -.1 : -.08, front ? .2 : -.12), b = T.bone(a, 0, -.4, 0), c = T.bone(b, 0, front ? -.36 : -.38, 0);
    T.add(a, taper(.14, .09, .42), hide); T.add(b, taper(.085, .06, front ? .38 : .4), hide); T.add(c, taper(.06, .05, front ? .13 : .26), hide); T.add(c, ball, pale, 0, front ? -.14 : -.27, .05, .09, .05, .13);
    legs.push({ a, b, c, front, lag: s > 0 ? 0 : .38, s });                                                 // the two of a pair land a little apart: a rotary gallop
  }
  T.cloth = new Strips(scene, noise, [[pelvis, 0, .12, -.4, 0, .25, -1, 1.25, .13, .06, .22], [neck, .16, .0, .1, .5, -.6, -.3, .22, .16, .05, .8], [neck, -.16, .0, .1, -.5, -.6, -.3, .22, .16, .05, .8]], { grav: 9, pull: 9 });
  T.update = (dt, st, cam) => {
    const w = st.phase * 2.2, r = st.run, roar = st.act >= 0 ? Math.sin(Math.PI * st.act) : 0, turn = T.turning(dt, st.yaw);
    const curl = 1 - (st.grow ?? 1);                       // coming out of the roll: curled, forepaws reaching, then straightening into the run
    // the hind legs come forward under the body together and drive it; the forelegs reach, land and pull. Between the two the spine
    // gathers (back arched, feet close) and stretches (flat out, a moment with nothing on the ground)
    const gather = Math.cos(w - .5) * r, air = Math.max(0, Math.sin(w + .9)) ** 2 * r;
    for (const l of legs) {
      const p = w - l.lag + (l.front ? -2.3 : 0), sw = Math.sin(p), fold = Math.max(0, Math.cos(p)) * r;          // fold: the leg tucked up as it comes forward
      if (l.front) { l.a.t[0] = .12 - .95 * sw * r - .5 * roar - 1.0 * curl; l.b.t[0] = -.22 - .75 * fold + .5 * curl; l.c.t[0] = .3 + 1.25 * fold; }
      else { l.a.t[0] = -.38 - .8 * sw * r + .7 * curl; l.b.t[0] = .8 + .6 * fold + 1.1 * curl; l.c.t[0] = -.62 - .55 * fold - .4 * Math.max(0, -sw) * r; }
      l.a.t[2] = l.s * .05;
    }
    blades.forEach((b, i) => { b.position.y = .2 + .05 * Math.max(0, -Math.sin(w - 2.3 - (i ? .38 : 0))) * r; });
    pelvis.t[0] = -.3 * gather - .5 * curl + .1 * roar; loin.t[0] = .32 * gather + .5 * curl - .25 * roar; chest.t[0] = .26 * gather + .6 * curl - .3 * roar;
    pelvis.t[1] = -turn * .05; loin.t[1] = turn * .05; chest.t[1] = turn * .06;                                   // the spine bends into a turn
    neck.t[0] = -.2 - .2 * gather - .3 * roar; neck.t[1] = turn * .05; head.t[0] = .25 - .1 * gather - .35 * roar; jaw.t[0] = .1 + .75 * roar;
    // st.slope: running up a surface (the giant's arm, a rock face): the whole body is pitched to lie along it
    T.settle(dt, st, cam, 20, .1 * air + .04 * Math.abs(Math.sin(w)) * r, -(st.slope ?? 0) + .07 * Math.sin(w - 1) * r, Math.max(-.35, Math.min(.35, -turn * .09 * r)));
  };

  // ---- crane: each wing is shoulder -> elbow -> wrist, the flight feathers fanning from the last
  const C = new Rig(scene), cg = C.group;
  C.add(cg, ball, pale, 0, 0, 0, .2, .19, .5);
  const n1 = C.bone(cg, 0, .06, .42), n2 = C.bone(n1, 0, 0, .3), ch = C.bone(n2, 0, 0, .3);
  C.add(n1, ball, pale, 0, 0, .15, .05, .05, .18); C.add(n2, ball, dark, 0, 0, .15, .042, .042, .18); C.add(ch, ball, pale, 0, 0, .05, .06, .055, .085);
  C.add(ch, ball, red, 0, .045, .04, .04, .025, .05); C.add(ch, cone, dark, 0, 0, .25, .02, .26, .02, 1.57);
  const wings = [], feathers = [];
  for (const s of [1, -1]) {
    const a = C.bone(cg, s * .12, .06, .08), b = C.bone(a, s * .55, 0, 0), c = C.bone(b, s * .6, 0, 0);
    C.add(a, box, pale, s * .28, 0, 0, .58, .04, .46); C.add(b, box, pale, s * .3, 0, -.02, .62, .034, .4); C.add(c, box, pale, s * .2, 0, -.04, .42, .028, .3);
    for (let i = 0; i < 6; i++) feathers.push([c, s * (.06 + i * .075), 0, -.12, s * (.25 + .16 * i), -.12, -1 + .13 * i, .6 + .07 * i, .16, .05, .04]);   // primaries: black, spread like fingers
    for (let i = 0; i < 4; i++) feathers.push([b, s * (.08 + i * .15), 0, -.18, s * .08, -.15, -1, .42, .2, .08, i % 2 ? .1 : .82]);
    for (let i = 0; i < 3; i++) feathers.push([a, s * (.1 + i * .16), 0, -.2, 0, -.15, -1, .34, .2, .09, .82]);
    const leg = C.bone(cg, s * .05, -.1, -.3), shank = C.bone(leg, 0, -.42, 0); C.add(leg, taper(.022, .016, .42), dark); C.add(shank, taper(.016, .012, .42), dark);
    wings.push({ a, b, c, s, leg, shank });
  }
  for (let i = 0; i < 3; i++) feathers.push([cg, (i - 1) * .08, 0, -.46, (i - 1) * .25, -.1, -1, .36, .14, .05, .08]);
  C.cloth = new Strips(scene, noise, feathers, { grav: 2.5, pull: 22 });
  C.glide = 0;
  C.update = (dt, st, cam) => {
    const hard = st.act >= 0, vy = st.vy ?? 0, turn = C.turning(dt, st.yaw), alt = st.p[1] - height(st.p[0], st.p[2]);
    // climbing or beating hard it flaps; moving fast and level it holds its wings out and glides; dropping it tucks them and dives
    const dive = sm(-vy, 3.5, 7), wantGlide = hard || vy > 1 ? 0 : sm(st.run, .45, .85) * (1 - dive); C.glide += (wantGlide - C.glide) * Math.min(1, 3 * dt);
    const beat = (hard ? 1.0 : .52) * (1 - .8 * C.glide) * (1 - dive), ph = st.phase * (hard ? 3 : 1.25);
    const fold = Math.max(1 - (st.grow ?? 1), 0);                                                                // out of the jump: the wings come up folded and open
    const up = Math.max(0, Math.cos(ph));                                                                        // the upstroke: the outer wing drops and folds so it slips through the air
    for (const wg of wings) {
      const { s } = wg;
      wg.a.t[2] = s * ((Math.sin(ph) * beat + .14 * C.glide + .45 * dive) * (1 - fold) + 1.25 * fold);
      wg.b.t[2] = s * ((Math.sin(ph - 1) * beat * .9 - .12 - .5 * up * beat - .3 * dive) * (1 - fold) - 2.2 * fold);
      wg.c.t[2] = s * (Math.sin(ph - 1.8) * beat * .7 - .15 - .7 * up * beat) * (1 - fold);
      wg.a.t[1] = s * (.9 * dive + .08 * C.glide); wg.b.t[1] = s * (1.1 * dive + .5 * fold); wg.c.t[1] = s * (.6 * dive + .12 * C.glide);   // swept back
      // legs trail behind in flight and come down and forward close to the ground
      const down = sm(2.2 - alt, 0, 1.6) * (1 - st.run * .6);
      wg.leg.t[0] = 1.45 + vy * .03 - 1.25 * down; wg.shank.t[0] = .05 + .5 * down;
    }
    const stretch = Math.min(1, st.run); n1.t[0] = -.55 + .35 * stretch - .3 * dive; n2.t[0] = .4 - .25 * stretch - .2 * dive; ch.t[0] = .25 - .1 * stretch + vy * .03; n1.t[1] = turn * .08; n2.t[1] = turn * .06;
    C.settle(dt, st, cam, 22, -Math.sin(ph) * beat * .1, -vy * .05 + .5 * dive, Math.max(-.7, Math.min(.7, -turn * .32)));
  };

  // ---- carp: seven vertebrae from the head back, each a little slimmer
  const K = new Rig(scene), kg = K.group, sp = [K.bone(kg, 0, 0, .5)];
  const girth = [[.24, .29, .3], [.3, .37, .32], [.3, .36, .3], [.26, .32, .29], [.2, .26, .27], [.14, .19, .24], [.085, .12, .2]];
  for (let i = 1; i < 7; i++) sp.push(K.bone(sp[i - 1], 0, 0, -.31 + .012 * i));
  girth.forEach((d, i) => { K.add(sp[i], ball, i === 2 || i === 4 ? pale : red, 0, 0, 0, d[0], d[1], d[2]); });
  K.add(sp[0], ball, pale, 0, -.08, .14, .19, .19, .25); K.add(sp[0], ball, dark, .2, .06, .2, .03, .03, .03); K.add(sp[0], ball, dark, -.2, .06, .2, .03, .03, .03);
  K.add(sp[0], ball, dark, 0, -.1, .36, .07, .04, .03);                                                         // mouth
  const fins = [];
  for (let i = 0; i < 5; i++) fins.push([sp[6], 0, (i - 2) * .06, -.14, 0, (i - 2) * .32, -1, .8 + .1 * (2 - Math.abs(i - 2)), .32, .2, 2]);   // tail: a fan of five
  for (const i of [1, 2, 3]) fins.push([sp[i], 0, .34 - .02 * i, 0, 0, .55, -1, .38 - .05 * i, .26, .08, 2]);   // dorsal
  for (const s of [1, -1]) {
    fins.push([sp[1], s * .28, -.12, .1, s * .9, -.4, -.5, .52, .22, .07, .86]);                                // pectoral: these steer
    fins.push([sp[3], s * .14, -.2, 0, s * .6, -.6, -.6, .32, .15, .05, .86]); fins.push([sp[5], 0, -.16 * s, 0, 0, -s, -.7, .26, .14, .05, s > 0 ? 2 : .86]);   // pelvic, anal and adipose
    fins.push([sp[0], s * .13, -.14, .34, s * .5, -.7, .25, .3, .028, .008, .1]);                               // barbels
  }
  K.cloth = new Strips(scene, noise, fins, { grav: .6, pull: 20 });
  K.update = (dt, st, cam) => {
    const turn = K.turning(dt, st.yaw), vy = st.vy ?? 0, out = st.p[1] > FOG_TOP - .28, v = st.v ?? [0, 0, 0], sp2 = Math.hypot(v[0], v[2]);
    // the wave runs down the body and grows towards the tail; in a turn the whole spine bows the way it is going
    sp.forEach((b, i) => { b.t[1] = Math.sin(st.phase * 2.4 - i * .75) * (.05 + i * .075) * (.5 + .5 * st.run) + (i ? turn * .045 : 0); });
    // out of the fog it follows its own arc, nose first up and nose first down
    K.settle(dt, st, cam, 20, 0, out ? -Math.atan2(vy, Math.max(sp2, 2)) : -vy * .08, Math.max(-.8, Math.min(.8, -turn * .3)));
  };
  return [T, C, K];
}
