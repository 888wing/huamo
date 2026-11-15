// The wandering swordsman, after the owner's design sheet: straw hat, robe with wide sleeves, a ragged cloak carried on
// the back, baggy trousers, bound shins, sandals, a sword. Built in code: a small skeleton posed procedurally, limbs as
// tapered ink-washed shapes, and every ragged piece of cloth as a strip of verlet points drawn like a brush stroke.
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, mix, smoothstep, normalWorld, normalView, positionWorld, positionLocal, texture3D, dot, uniform, sin, atan } from 'three/tsl';
import { wash, basic, SEAL, INK } from './stage.js';
import { Strips } from './strips.js';
import { swing } from './player.js';

const sun = vec3(.45, .8, .35).normalize();

// washed cloth or skin: streaks run along the limb, the rim turns to ink like a drawn outline
export const cloth = (noise, tone, grain = 1) => basic(Fn(() => {
  const rim = smoothstep(.3, .85, float(1).sub(normalView.z.abs()));
  const streak = texture3D(noise, positionLocal.mul(vec3(6, 1.3, 6)).add(tone * 3)).g, blot = texture3D(noise, positionWorld.mul(2.1)).r;
  return wash(float(tone).add(streak.sub(.5).mul(.55 * grain)).add(blot.sub(.5).mul(.3)).add(dot(normalWorld, sun).mul(.1)).sub(rim.mul(.8)));
})());
const hatMat = (noise, tone) => basic(Fn(() => {
  const ribs = smoothstep(.55, .95, sin(atan(positionLocal.z, positionLocal.x).mul(22)).abs());
  const rim = smoothstep(.3, .85, float(1).sub(normalView.z.abs()));
  return wash(float(tone).add(ribs.mul(.22)).add(texture3D(noise, positionWorld.mul(3)).b.sub(.5).mul(.3)).sub(rim.mul(.5)));
})());
const geos = new Map();
export const taper = (r0, r1, len) => { const k = `${r0},${r1},${len}`; if (!geos.has(k)) geos.set(k, new THREE.CylinderGeometry(r0, r1, len, 10).translate(0, -len / 2, 0)); return geos.get(k); };
export const ball = new THREE.SphereGeometry(1, 14, 10), cone = new THREE.ConeGeometry(1, 1, 22), box = new THREE.BoxGeometry(1, 1, 1);

export class Figure {
  // pal: tones (0 ink .. 1 paper) for robe, cloak, legs, hat, skin, wraps
  constructor(scene, noise, pal) {
    const g = this.group = new THREE.Group(); g.rotation.order = 'YXZ'; scene.add(g);
    const M = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, k === 'hat' ? hatMat(noise, v) : cloth(noise, v)]));
    const red = basic(uniform(new THREE.Color(SEAL)));
    this.glow = uniform(0);
    const blade = basic(mix(wash(float(.55)), uniform(new THREE.Color(SEAL)), this.glow));
    const bones = this.bones = [];
    const bone = (parent, x, y, z) => { const b = new THREE.Group(); b.position.set(x, y, z); b.t = [0, 0, 0]; parent.add(b); bones.push(b); return b; };
    const add = (parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx; parent.add(m); return m; };
    const B = this.B = {};
    B.hips = bone(g, 0, .92, 0); B.spine = bone(B.hips, 0, .08, 0); B.chest = bone(B.spine, 0, .24, 0); B.head = bone(B.chest, 0, .3, 0);
    add(B.hips, ball, M.legs, 0, -.02, 0, .19, .13, .15);
    add(B.spine, taper(.2, .17, .3), M.robe, 0, .28, 0);
    add(B.spine, taper(.19, .19, .09), M.cloak, 0, .05, 0);                           // sash
    add(B.spine, ball, red, .13, .0, .15, .035, .05, .03);                            // its knot: the one vermilion mark
    add(B.chest, ball, M.robe, 0, .13, 0, .27, .13, .16);
    add(B.chest, ball, M.cloak, 0, .1, -.17, .25, .2, .15);                           // the cloak, bundled on the back
    add(B.head, ball, M.skin, 0, .09, .01, .095, .115, .1);
    add(B.head, ball, M.cloak, 0, .11, -.04, .1, .11, .1);                            // hair
    add(B.head, cone, M.skin, 0, .075, .105, .018, .05, .022, 1.2);                   // nose
    add(B.head, cone, M.cloak, 0, -.02, .07, .04, .09, .03, 3.3);                     // beard
    add(B.head, box, M.cloak, 0, .115, .092, .12, .012, .02);                         // brow
    add(B.hips, ball, M.wraps, -.2, .02, .1, .05, .07, .05); add(B.hips, ball, M.wraps, -.2, .1, .1, .03, .035, .03); // gourd
    add(B.head, cone, M.hat, 0, .23, 0, .44, .17, .44);
    add(B.head, ball, M.cloak, 0, .33, -.02, .045, .05, .045);                        // topknot
    this.eyes = [add(B.head, ball, red, .04, .1, .1, .014, .012, .01), add(B.head, ball, red, -.04, .1, .1, .014, .012, .01)];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      const up = B['arm' + k] = bone(B.chest, s * .23, .17, 0), fore = B['fore' + k] = bone(up, 0, -.3, 0), hand = B['hand' + k] = bone(fore, 0, -.27, 0);
      add(up, taper(.075, .135, .34), M.robe); add(fore, taper(.05, .04, .27), M.skin); add(fore, taper(.052, .048, .12), M.cloak, 0, -.13, 0); add(hand, ball, M.skin, 0, -.04, 0, .042, .05, .03); add(hand, box, M.skin, 0, -.105, .005, .06, .07, .022); add(hand, box, M.skin, s * .04, -.06, .02, .018, .05, .02);
      const th = B['thigh' + k] = bone(B.hips, s * .1, -.04, 0), sh = B['shin' + k] = bone(th, 0, -.44, 0), ft = B['foot' + k] = bone(sh, 0, -.42, 0);
      add(th, taper(.12, .145, .46), M.legs); add(sh, taper(.145, .075, .24), M.legs); add(sh, taper(.058, .05, .2), M.wraps, 0, -.22, 0); add(ft, box, M.cloak, 0, .0, .06, .095, .05, .25);
    }
    // sword: in the right hand when drawn, at the left hip when not
    const sword = parent => { const s = new THREE.Group(); add(s, box, blade, 0, -.62, 0, .014, 1.0, .04); add(s, box, M.cloak, 0, -.1, 0, .03, .22, .035); add(s, box, M.cloak, 0, -.215, 0, .07, .015, .09); parent.add(s); return s; };
    this.drawn = sword(B.handR); this.drawn.position.y = -.04;
    this.sheathed = sword(B.hips); this.sheathed.position.set(.2, .12, .02); this.sheathed.rotation.set(-1.2, 0, .12);

    // cloth strips: [bone, anchor x y z, rest direction x y z (figure space), length, width at top, width at hem, tone]
    const S = [];
    for (let i = 0; i < 7; i++) { const a = (i - 3) / 3; S.push([B.chest, a * .22, .12, -.2 - .05 * (1 - a * a), a * .35, -1, -.55, 1.0 + .25 * Math.cos(i * 2.1), .24, .07, pal.cloak + .03 * (i % 3)]); }
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283; S.push([B.hips, Math.sin(a) * .17, .02, Math.cos(a) * .13, Math.sin(a) * .22, -1, Math.cos(a) * .22, .6 + .14 * Math.sin(i * 1.7), .2, .12, pal.robe - .06 * (i % 2)]); }
    S.push([B.spine, .15, .0, .14, .3, -1, .3, .5, .05, .02, pal.cloak], [B.spine, .11, .0, .15, .1, -1, .4, .42, .05, .02, pal.cloak]);
    for (let i = 0; i < 3; i++) S.push([B.head, (i - 1) * .06, .08, -.11, (i - 1) * .2, -.8, -.7, .26 + .06 * i, .05, .015, pal.cloak]);
    // the hat's torn brim
    for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; S.push([B.head, Math.sin(a) * .41, .155, Math.cos(a) * .41, Math.sin(a) * .5, -1, Math.cos(a) * .5, .1 + .07 * ((i * 7) % 3), .13, .03, pal.hat - .1]); }
    this.cloth = new Strips(scene, noise, S, { rad: .16, top: 1.25 });
    this.tip = new THREE.Vector3();
  }

  set visible(v) { if (v && !this.group.visible) this.cloth.fresh = true; this.group.visible = this.cloth.mesh.visible = v; }

  // st: { p, yaw, phase, run 0..1, act -1|0..1, side, windup 0..1, stagger 0..1, fade 0..1 }
  update(dt, st, cam) {
    const { B, group: g } = this, set = (b, x = 0, y = 0, z = 0) => { b.t[0] = x; b.t[1] = y; b.t[2] = z; };
    const w = st.phase * 1.9, r = st.run, sw = Math.sin(w), cw = Math.cos(w), t = st.act, s = st.side;
    for (const b of this.bones) set(b);
    // gait
    let hipY = .92 - .05 * r + Math.abs(sw) * .05 * r, lean = .06 + .2 * r, twist = 0;
    set(B.thighL, -sw * .8 * r, 0, .04); set(B.thighR, sw * .8 * r, 0, -.04);
    set(B.shinL, .08 + Math.max(0, cw) * 1.2 * r); set(B.shinR, .08 + Math.max(0, -cw) * 1.2 * r);
    set(B.armL, sw * .7 * r, 0, .16); set(B.armR, -sw * .7 * r, 0, -.16);
    set(B.foreL, -.3 - .5 * r); set(B.foreR, -.3 - .5 * r);
    set(B.spine, .03 * Math.sin(st.time * 1.4)); set(B.head, -.1 * r);
    const drawn = t >= 0 || st.windup > 0 || !!st.guard;
    if (st.guard) { set(B.armR, -1.25, 0, .45); set(B.foreR, -1.25); set(B.armL, -1.0, 0, -.35); set(B.foreL, -1.2); hipY -= .08; } // sword raised across the body
    if (st.windup > 0) { // sword raised: the tell before a strike
      const k = Math.sin(Math.min(1, st.windup) * 1.57);
      set(B.armR, -2.7 * k, 0, -.25); set(B.foreR, -.5 * k); set(B.armL, -.9 * k, 0, .3); twist = -s * .5 * k; hipY -= .06 * k; lean -= .12 * k;
    }
    if (t >= 0) { // the stroke: hips and chest wind through, the arm carries the sword flat, the front leg lunges
      const e = swing(t); twist = s * (-1.15 + 2.3 * e);
      set(B.armR, -1.5 + .25 * s * (e - .5), 0, -.1); set(B.foreR, -.12); set(B.handR, -.25);
      set(B.armL, .7, 0, .7); set(B.foreL, -.6);
      set(B.thighL, s > 0 ? -.75 : .5, 0, .12); set(B.shinL, s > 0 ? .8 : .3); set(B.thighR, s > 0 ? .5 : -.75, 0, -.12); set(B.shinR, s > 0 ? .3 : .8);
      hipY -= .17; lean += .22;
    }
    if (st.stagger > 0) { const k = st.stagger; lean -= .55 * k; hipY -= .08 * k; set(B.armL, -.6 * k, 0, 1.0 * k); set(B.armR, -.4 * k, 0, -1.0 * k); set(B.head, .35 * k); }
    const fall = st.fall ?? 0, melt = st.melt ?? 0, fe = fall * fall * (3 - 2 * fall);
    if (fall > 0) { lean = -.2; set(B.armL, -.5, 0, 1.35); set(B.armR, -.5, 0, -1.35); set(B.thighL, -.3); set(B.thighR, .25); set(B.shinL, .5); set(B.head, .3); } // cut down: arms flung wide
    set(B.hips, lean, twist * .3); set(B.chest, .05, twist * .7);
    const k = 1 - Math.exp(-(t >= 0 ? 34 : 16) * dt);
    for (const b of this.bones) { b.rotation.x += (b.t[0] - b.rotation.x) * k; b.rotation.y += (b.t[1] - b.rotation.y) * k; b.rotation.z += (b.t[2] - b.rotation.z) * k; }
    B.hips.position.y += (hipY - B.hips.position.y) * k;
    this.drawn.visible = drawn; this.sheathed.visible = !drawn;
    this.glow.value += ((st.windup > 0 ? 1 : 0) - this.glow.value) * Math.min(1, 14 * dt);
    this.eyes.forEach(e => { e.visible = !!st.eyes; });
    // falling: the whole figure tips onto its back; melting: it flattens and spreads like ink soaking into paper
    const sc = 1.04 * (1 - .7 * (st.fade ?? 0));
    g.position.set(st.p[0], st.p[1] + .17 * fe, st.p[2]); g.rotation.y = st.yaw; g.rotation.x = -1.5 * fe; g.scale.set(sc * (1 + .35 * melt), sc * (1 + .12 * melt), sc * (1 - .9 * melt));
    g.updateMatrixWorld(true);
    B.handR.localToWorld(this.tip.set(0, -1.1, 0));

    this.cloth.update(dt, st.p, st.yaw, g.scale.x, cam);
  }
}
void INK;
