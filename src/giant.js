// 巨相撲鬼, after the owner's design sheet: a mountain of a wrestler with a topknot, a thick twisted rope round the waist
// hung with folded paper, a ragged skirt and bare feet. Built in code like the swordsman: a skeleton posed procedurally,
// the body as overlapping ink-washed masses each with its own drawn rim, skirt and hair as verlet strips.
// One unit in here is the giant's full height; the whole group is scaled to GH metres.
import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, float, mix, smoothstep, normalWorld, normalView, normalLocal, positionWorld, positionLocal, texture3D, dot, uniform, sin, uv, cameraProjectionMatrix, cameraViewMatrix, modelWorldMatrix, modelNormalMatrix } from 'three/tsl';
import { wash, basic, SEAL } from './stage.js';
import { ball, box, cloth } from './figure.js';
import { Strips } from './strips.js';
import { height } from './world.js';
import { GH } from './boss.js';

const sun = vec3(.45, .8, .35).normalize(), SOLE = .045;
// skin: a pale wash mottled with darker blots that stay on the body, shadow on every underside, the rim drawn in ink
const skin = (noise, tone) => basic(Fn(() => {
  const rim = smoothstep(.6, .97, float(1).sub(normalView.z.abs())); // thin: where two masses meet there is no line, so the body reads as one
  const blot = texture3D(noise, positionLocal.mul(.5).add(tone * 7)).r, mott = texture3D(noise, positionLocal.mul(.85).add(.3)).g, dab = texture3D(noise, positionWorld.mul(.9)).b;
  const under = smoothstep(.2, -.8, normalWorld.y);
  return wash(float(tone).add(blot.sub(.5).mul(.42)).sub(smoothstep(.5, .72, mott).mul(.2)).sub(smoothstep(.6, .8, dab).mul(.1)).add(dot(normalWorld, sun).mul(.1)).sub(under.mul(.32)).sub(rim.mul(.45)));
})());

// a limb: a turned shape running down from the joint, swelling where the muscle is, rounded off past both ends.
// r0, r1: radius at the upper and lower joint as a share of the widest; at: how far down the swell sits
const limbs = new Map();
function limb(r0, r1, bulge, at = .4) {
  const key = [r0, r1, bulge, at].join();
  if (!limbs.has(key)) {
    const pts = [];
    for (let i = 0; i <= 18; i++) { const t = 1.12 - 1.24 * i / 18, u = Math.min(1, Math.max(0, t)), end = Math.max(0, Math.abs(t - .5) - .5) / .12; pts.push(new THREE.Vector2((r0 + (r1 - r0) * u + bulge * Math.exp(-(((u - at) / .3) ** 2))) * Math.sqrt(Math.max(0, 1 - end * end)) + 1e-4, -t)); }
    limbs.set(key, new THREE.LatheGeometry(pts, 20));
  }
  return limbs.get(key);
}

const X = new THREE.Vector3(1, 0, 0), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), v5 = new THREE.Vector3(), v6 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), m4 = new THREE.Matrix4();
const FLAT = new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2), UP = new THREE.Vector3(0, 1, 0);
const sm = (x, a, b) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

export class GiantRig {
  constructor(scene, noise) {
    const g = this.group = new THREE.Group(); g.rotation.order = 'YXZ'; g.scale.setScalar(GH); scene.add(g);
    const sk = skin(noise, .64), sk2 = skin(noise, .54), hair = cloth(noise, .05);
    // the drawn outline: every mass has a shell of ink a hand's breadth outside it, seen only from behind, so a heavy
    // brush line follows the whole silhouette and every muscle that stands out from the body. Its width wanders like a brush
    const line = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide }); line.colorNode = wash(float(.03));
    const pw = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz, wide = texture3D(noise, pw.mul(.21)).r.mul(.1).add(.025);
    line.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(pw.add(modelNormalMatrix.mul(normalLocal).normalize().mul(wide)), 1));
    this.glow = uniform(0);
    const eye = basic(mix(wash(float(.04)), uniform(new THREE.Color(SEAL)).mul(1.5), this.glow));
    // the rope: strands twisted round each other
    const rope = basic(Fn(() => {
      const q = uv(), twist = sin(q.x.mul(6.2832 * 30).add(q.y.mul(6.2832))), rim = smoothstep(.35, .9, float(1).sub(normalView.z.abs()));
      return wash(float(.82).sub(smoothstep(.1, .9, twist).mul(.42)).add(texture3D(noise, positionWorld.mul(1.5)).b.sub(.5).mul(.2)).sub(rim.mul(.6)));
    })());
    const paper = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }); paper.colorNode = wash(float(1.03).sub(texture3D(noise, positionWorld.mul(1.2)).b.mul(.12)));

    const bones = this.bones = [], B = this.B = {};
    const bone = (name, parent, x, y, z) => { const b = new THREE.Group(); b.position.set(x, y, z); b.t = [0, 0, 0]; parent.add(b); bones.push(b); B[name] = b; return b; };
    const add = (parent, mat, x, y, z, sx, sy, sz, geo = ball, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz; parent.add(m);
      if (mat !== eye) m.add(new THREE.Mesh(geo, line));
      return m;
    };
    bone('hips', g, 0, .43, 0); bone('belly', B.hips, 0, .04, 0); bone('chest', B.belly, 0, .2, 0); bone('head', B.chest, 0, .17, .03);
    add(B.hips, sk2, 0, 0, -.01, .215, .12, .18);                                                 // pelvis
    add(B.belly, sk2, 0, .1, -.015, .245, .2, .19);                                               // the trunk: one barrel from seat to ribs
    this.gut = add(B.belly, sk, 0, .08, .065, .235, .17, .22);                                    // the belly, carried well out in front
    add(B.chest, sk, 0, .03, -.01, .262, .16, .185);                                              // ribs and back
    add(B.chest, sk, .105, .03, .12, .125, .085, .085); add(B.chest, sk, -.105, .03, .12, .125, .085, .085); // chest, heavy and low
    add(B.chest, sk2, 0, .14, -.02, .17, .075, .12);                                              // no neck: the head sits in the shoulders
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      const up = bone('arm' + k, B.chest, s * .25, .1, 0), fore = bone('fore' + k, up, 0, -.2, 0), hand = bone('hand' + k, fore, 0, -.18, 0);
      add(up, sk, s * .005, -.005, 0, .092, .095, .097);                                          // shoulder
      add(up, sk, 0, 0, 0, .082, .2, .088, limb(.92, .7, .12, .45));                              // upper arm
      add(fore, sk, 0, 0, 0, .07, .18, .074, limb(.82, .58, .2, .28));                            // forearm
      add(hand, sk, 0, -.04, 0, .05, .052, .034);                                                 // palm
      add(hand, sk2, s * -.05, -.035, .012, .017, .034, .019, ball, s * -.5);                     // thumb
      const f = this['fing' + k] = new THREE.Group(); f.position.set(0, -.082, 0); hand.add(f);   // four fingers that curl as one
      for (let i = 0; i < 4; i++) add(f, sk2, (i - 1.5) * .024, -.034, 0, .0125, .04, .0155);
      const th = bone('thigh' + k, B.hips, s * .135, -.02, 0), sh = bone('shin' + k, th, 0, -.19, 0), ft = bone('foot' + k, sh, 0, -.19, 0);
      add(th, sk, 0, 0, 0, .118, .19, .124, limb(.88, .62, .14, .35));                            // thigh
      add(sh, sk, 0, 0, -.004, .084, .19, .09, limb(.76, .5, .26, .3));                           // calf
      add(ft, sk, 0, -.017, .05, .064, .028, .1);                                                 // foot
      for (let i = 0; i < 5; i++) add(ft, sk2, s * (-.05 + i * .024), -.026, .14 - Math.abs(i - 1) * .006, .017 - i * .0015, .015, .023); // toes, the big one inside
    }
    const H = B.head;
    add(H, sk, 0, .062, 0, .058, .068, .063);                                                     // skull
    add(H, sk, 0, .03, .014, .061, .046, .056);                                                   // a jaw wider than the skull
    add(H, sk2, 0, .052, .062, .017, .015, .014);                                                 // nose
    add(H, hair, 0, .092, -.014, .059, .048, .062);                                               // hair, drawn back
    add(H, hair, 0, .012, .026, .055, .026, .04);                                                 // stubble under the jaw
    add(H, hair, 0, .138, -.012, .013, .02, .013); add(H, hair, 0, .158, -.004, .024, .016, .032); // topknot
    add(H, hair, 0, .024, .066, .034, .005, .006, box);                                           // mouth, turned down at the corners
    this.eyes = [];
    for (const s of [1, -1]) {
      add(H, sk2, s * .06, .058, -.004, .012, .02, .014);                                         // ear
      add(H, hair, s * .055, .04, .012, .012, .034, .028);                                        // sideburn
      add(H, hair, s * .027, .081, .057, .034, .011, .012, box, s * .42);                         // brow, pulled down to the nose
      add(H, hair, s * .036, .019, .062, .012, .005, .006, box, s * -.7);
      this.eyes.push(add(H, eye, s * .025, .067, .058, .008, .0045, .005));
    }
    // the rope sits under the belly; its knot is at the back
    add(B.hips, rope, 0, .055, .03, .25, .26, .25, new THREE.TorusGeometry(1, .19, 10, 48).rotateX(Math.PI / 2));
    add(B.hips, rope, .04, .06, -.24, .045, .05, .045); add(B.hips, rope, -.04, .06, -.24, .045, .05, .045);
    // folded paper streamers hanging from the rope in front: each a zigzag of four leaves
    const sp = [], si = [];
    for (let k = 0; k < 4; k++) { const x0 = k % 2 ? .011 : -.011, y0 = -k * .043, o = sp.length / 3; sp.push(x0 - .019, y0, 0, x0 + .019, y0, 0, -x0 - .019, y0 - .05, 0, -x0 + .019, y0 - .05, 0); si.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(si);
    this.shide = [-2, -1, 0, 1, 2].map(i => {
      const a = i * .3, piv = new THREE.Group(); piv.rotation.order = 'YXZ'; piv.position.set(Math.sin(a) * .265, .035, .03 + Math.cos(a) * .265); piv.rotation.y = a; B.hips.add(piv);
      const m = new THREE.Mesh(sg, paper); m.scale.setScalar(1.3 - Math.abs(i) * .12); piv.add(m); piv.sw = 0; piv.sv = 0; return piv;
    });
    // strips: the skirt in two layers, loose hair, the rope's tails
    const S = [];
    for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283 + .12, c = Math.cos(a), sn = Math.sin(a); S.push([B.hips, sn * .245, .02, .03 + c * .24, sn * .28, -1, c * .28, .2 + .09 * Math.max(0, c) + .035 * Math.sin(i * 2.3), .1, .05, .3 + .07 * ((i * 5) % 3)]); }
    for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283, c = Math.cos(a), sn = Math.sin(a); S.push([B.hips, sn * .225, .0, .03 + c * .22, sn * .2, -1, c * .2, .15 + .03 * Math.sin(i * 1.9), .13, .07, .14 + .05 * (i % 2)]); }
    for (let i = 0; i < 7; i++) { const a = (i - 3) / 3; S.push([B.head, a * .056, .1 - .03 * Math.abs(a), -.04 - .02 * (1 - Math.abs(a)), a * .9, -.5, -.7, .075 + .03 * ((i * 3) % 4) / 3, .022, .006, .03]); }
    S.push([B.head, 0, .165, .02, 0, .3, 1, .05, .03, .01, .03]);
    for (const s of [1, -1]) S.push([B.hips, s * .04, .05, -.26, s * .15, -1, -.2, .15, .05, .035, .78]);
    this.cloth = new Strips(scene, noise, S, { grav: 16, pull: 5, rad: .2, top: .44, stiff: 1 });
    this.from = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.lastYaw = 0;
  }

  // Bends one arm so the wrist lands on a world point: the elbow goes up, out and back. w blends it over the posed arm.
  reach(k, s, wrist, w, flat) {
    const { B, group: g } = this, up = B['arm' + k], fore = B['fore' + k], hand = B['hand' + k], L1 = .2 * GH, L2 = .18 * GH;
    up.getWorldPosition(v1); v2.copy(wrist).sub(v1);
    const dist = Math.min(L1 + L2 - .02, Math.max(Math.abs(L1 - L2) + .02, v2.length())); v2.normalize();
    const A = Math.acos((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)), E = Math.acos((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2));
    v3.set(s * .7, .9, -.5).applyQuaternion(g.quaternion); v4.copy(v2).cross(v3).normalize();          // v4: the axis the arm bends about
    v5.copy(v2).applyAxisAngle(v4, A).negate(); v6.copy(v4).cross(v5);                                   // the bone's own Y and Z
    q1.setFromRotationMatrix(m4.makeBasis(v4, v5, v6)); up.parent.getWorldQuaternion(q2); up.quaternion.slerp(q3.copy(q2).invert().multiply(q1), w);
    fore.quaternion.slerp(q1.setFromAxisAngle(X, E - Math.PI), w);
    up.updateMatrixWorld(true); fore.getWorldQuaternion(q2); q1.copy(g.quaternion); if (flat) q1.multiply(FLAT);
    hand.quaternion.slerp(q3.copy(q2).invert().multiply(q1), w);
  }

  // st: the Giant from boss.js. Writes st.parts: where hands, feet, knees, elbows, hips, chest and head really are.
  update(dt, st, cam) {
    const { B, group: g } = this, T = (b, x = 0, y = 0, z = 0) => { b.t[0] = x; b.t[1] = y; b.t[2] = z; };
    const t = st.time, br = Math.sin(t * 1.15), c = st.crouch, lf = st.lift, sq = st.squat, wd = st.wind, dn = st.down, fl = st.flinch, ro = st.roar, s = st.side;
    const sw = Math.sin(st.walk), cw = Math.cos(st.walk), wa = st.walkAmt, stomp = st.mode === 'stomp', slam = st.mode === 'slam', sweep = st.mode === 'sweep', dd = st.death ?? 0;
    for (const b of this.bones) T(b);
    // standing: knees bent and wide apart, arms hanging clear of the body, the head lowered at whoever is down there
    let hipX = .08, hipY = 0, hipZ = .02 * Math.sin(t * .5), chX = .1 + .015 * br, chY = 0, chZ = 0, headX = .25, curl = { L: 1.9, R: 1.9 };
    const leg = { L: [-.28, .42, .5, -.3], R: [-.28, -.42, .5, .3] };      // thigh x, thigh z, shin x, shin z
    const arm = { L: [-.08, .4, -.35, -.18], R: [-.08, -.4, -.35, .18] };  // upper x, upper z, fore x, fore z
    const mixTo = (a, b, k) => { for (let i = 0; i < 4; i++) a[i] += (b[i] - a[i]) * k; };
    // a pace: the body rolls over the standing leg
    leg.L[0] -= sw * .42 * wa; leg.R[0] += sw * .42 * wa; leg.L[2] += Math.max(0, cw) * .6 * wa; leg.R[2] += Math.max(0, -cw) * .6 * wa;
    hipZ += sw * .08 * wa; chZ -= sw * .06 * wa; arm.L[0] += sw * .25 * wa; arm.R[0] -= sw * .25 * wa;
    // the stamp: one leg goes up sideways, the body tips over the other, then everything comes down into a squat
    if (stomp) {
      const kU = s > 0 ? 'L' : 'R', kD = s > 0 ? 'R' : 'L';
      mixTo(leg[kU], [-.55, s * 1.42, 1.45, -s * .2], lf); mixTo(leg[kD], [-.12, -s * .3, .22, s * .22], lf);
      hipZ += s * .2 * lf; chZ -= s * .12 * lf; arm.L[1] += .35 * lf; arm.R[1] -= .35 * lf; arm.L[2] -= .5 * lf; arm.R[2] -= .5 * lf; headX += .1 * lf;
    }
    for (const k of ['L', 'R']) { const z = k === 'L' ? 1 : -1; mixTo(leg[k], [-.9, z * .62, 1.45, -z * .32], sq * .8); }
    hipX += .18 * sq; chX += .1 * sq;
    // the slam: the arm goes up and back with the hand open, then the whole body falls forward behind it
    if (slam) {
      const kS = s > 0 ? 'L' : 'R', kO = s > 0 ? 'R' : 'L';
      mixTo(arm[kS], [-2.85, s * .3, -.6, 0], wd); mixTo(arm[kO], [-.7, -s * .75, -.5, 0], wd * .8);
      hipX += -.24 * wd + .9 * dn; chX += -.22 * wd + .42 * dn; chY += s * (.38 * wd - .7 * dn); headX += -.1 * wd - .75 * dn;
      for (const k of ['L', 'R']) { const z = k === 'L' ? 1 : -1; mixTo(leg[k], [-1.3, z * .7, 2.0, -z * .25], dn); }
      mixTo(arm[kO], [.9, -s * .7, -.4, 0], dn);
      curl[kS] = 1.9 - 1.8 * Math.max(wd, dn);
    }
    // the sweep: down low and turned with the hand as it scythes across; the arm itself is carried by its reach for the hand's point
    if (sweep) {
      const kS = s > 0 ? 'L' : 'R', kO = s > 0 ? 'R' : 'L', tw = st.twist ?? 0;
      hipX += .9 * dn; chX += .42 * dn; hipY += tw * .35; chY += tw * .55; headX -= .7 * dn;
      for (const k of ['L', 'R']) { const z = k === 'L' ? 1 : -1; mixTo(leg[k], [-1.3, z * .7, 2.0, -z * .25], dn); }
      mixTo(arm[kO], [.6, -s * .9, -.5, 0], dn); curl[kS] = .15;
    }
    // the crouch it waits in: the wrestler's start, deep in a squat, bowed over, both fists on the ground
    for (const k of ['L', 'R']) { const z = k === 'L' ? 1 : -1; mixTo(leg[k], [-1.45, z * .8, 2.05, -z * .1], c); mixTo(arm[k], [-.9, z * .2, -.3, 0], c); }
    hipX += .7 * c; chX += .3 * c; headX -= .85 * c;
    // thrown back to bellow; knocked back when the hand is cut
    hipX -= .12 * ro + .1 * fl; chX -= .3 * ro + .28 * fl; headX -= .6 * ro + .35 * fl;
    // the end: it reels with its head thrown back, sways as its knees go, and then there is nothing holding it up
    let pitch = 0, flat = 0;
    if (dd > 0) {
      const reel = sm(dd, 0, .06) * (1 - sm(dd, .3, .45)), sway = sm(dd, .08, .2) * (1 - sm(dd, .42, .5)), drop = sm(dd, .42, .56);
      hipX -= .2 * reel; chX -= .4 * reel - .5 * drop; headX += -.9 * reel + .6 * drop; hipZ += .13 * Math.sin(t * 4.2) * sway;
      for (const k of ['L', 'R']) { const z = k === 'L' ? 1 : -1; arm[k][1] += z * (.9 * reel - .2 * drop); arm[k][2] -= .7 * reel; arm[k][0] -= .5 * drop; mixTo(leg[k], [-.75, z * .55, 1.3, -z * .3], .55 * sway + .3 * drop); curl[k] = 1.9 - 1.4 * sm(dd, .05, .5); }
      pitch = 1.47 * drop * drop; flat = sm(dd, .62, .96);
    }
    for (const k of ['L', 'R']) { const z = k === 'L' ? 1 : -1; arm[k][1] += z * (.55 * ro + .3 * fl); arm[k][2] -= 1.1 * ro + .4 * fl; arm[k][0] -= .15 * ro; }
    // (the legs are posed against the ground, not against the pelvis: however far the hips pitch, the thighs stay where they were put)
    for (const k of ['L', 'R']) { T(B['thigh' + k], leg[k][0] - hipX, 0, leg[k][1]); T(B['shin' + k], leg[k][2], 0, leg[k][3]); T(B['arm' + k], arm[k][0], 0, arm[k][1]); T(B['fore' + k], arm[k][2], 0, arm[k][3]); T(B['hand' + k], 0, 0, 0); }
    T(B.hips, hipX, hipY, hipZ); T(B.belly, chX * .4, chY * .4, chZ * .4); T(B.chest, chX * .6, chY * .6, chZ * .6); T(B.head, headX, -chY * .6, -hipZ);
    const k = 1 - Math.exp(-(st.fast ? 26 : dd > .4 ? 12 : 6.5) * dt);
    for (const b of this.bones) { b.rotation.x += (b.t[0] - b.rotation.x) * k; b.rotation.y += (b.t[1] - b.rotation.y) * k; b.rotation.z += (b.t[2] - b.rotation.z) * k; }
    for (const kk of ['L', 'R']) { const f = this['fing' + kk]; f.rotation.x += (curl[kk] - f.rotation.x) * Math.min(1, 9 * dt); }
    const bs = 1 + .03 * br; this.gut.scale.set(.235 * bs, .17 * (1 + .02 * br), .22 * (1 + .045 * br));  // it breathes with its belly
    this.glow.value = st.glow * (dd > 0 ? 1 : (.75 + .25 * Math.sin(t * 5)) * (1 + .6 * Math.max(wd, lf)));

    // place the body: soles flat whatever the legs do, and the lower foot standing on the ground
    g.position.set(st.p[0], 0, st.p[2]); g.rotation.set(0, st.yaw, 0); g.scale.setScalar(GH); g.updateMatrixWorld(true);
    let lowest = -1e9;
    for (const kk of ['L', 'R']) {
      const z = kk === 'L' ? 1 : -1, ft = B['foot' + kk], up = stomp && (s > 0 ? 'L' : 'R') === kk ? lf : 0;
      B['shin' + kk].getWorldQuaternion(q2); q1.copy(g.quaternion).multiply(q3.setFromAxisAngle(UP, z * .3)); ft.quaternion.copy(q2.invert().multiply(q1)).slerp(q3.identity(), up * .8);
      ft.getWorldPosition(v1); lowest = Math.max(lowest, height(v1.x, v1.z) - (v1.y - SOLE * GH));
    }
    // falling it goes over about its feet like a tree and lies on its front; then it flattens and spreads, ink soaking into paper
    if (dd > 0) { this.baseY ??= lowest; lowest = this.baseY + .09 * GH * Math.sin(pitch); g.rotation.x = pitch; const end = 1 - sm(dd, .93, 1); g.scale.set(GH * (1 + .25 * flat) * end, GH * (1 + .1 * flat) * end, GH * (1 - .9 * flat) * end); }
    g.position.y = lowest; g.updateMatrixWorld(true);
    g.visible = this.cloth.mesh.visible = st.mode !== 'dead';
    // hands: on the ground in the crouch; in the slam, one of them travels from where it was raised to where it lands
    for (const kk of ['L', 'R']) {
      const z = kk === 'L' ? 1 : -1, mine = (slam || sweep) && (s > 0 ? 'L' : 'R') === kk;
      if (c > .01) {
        v6.set(z * .19, 0, .31).multiplyScalar(GH).applyQuaternion(g.quaternion).add(v1.set(st.p[0], 0, st.p[2])); v6.y = height(v6.x, v6.z) + .1 * GH;
        this.reach(kk, z, v6, c * c * (3 - 2 * c), false);
      }
      if (mine) {
        if (st.ik <= 0) B['hand' + kk].getWorldPosition(this.from[kk]);
        else { v6.set(0, 0, -.045 * GH).applyQuaternion(g.quaternion).add(v1.set(st.target[0], st.target[1] + .04 * GH, st.target[2])); v6.lerpVectors(this.from[kk], v6, st.fall); this.reach(kk, z, v6, st.ik, true); }
      }
    }
    g.updateMatrixWorld(true);
    const P = st.parts ??= {}, put = (name, b, y = 0) => { b.localToWorld(v1.set(0, y, 0)); P[name] = [v1.x, v1.y, v1.z]; };
    for (const kk of ['L', 'R']) { put('hand' + kk, B['hand' + kk], -.045); put('foot' + kk, B['foot' + kk], -SOLE); put('knee' + kk, B['shin' + kk]); put('elbow' + kk, B['fore' + kk]); put('shoulder' + kk, B['arm' + kk]); }
    put('hips', B.hips); put('chest', B.chest, .05); put('head', B.head, .06); put('crown', B.head, .13);
    // the paper streamers swing behind the hips' movement
    const turn = Math.atan2(Math.sin(st.yaw - this.lastYaw), Math.cos(st.yaw - this.lastYaw)); this.lastYaw = st.yaw;
    for (const piv of this.shide) { piv.sv += (-piv.sw * 30 - piv.sv * 3 + (B.hips.rotation.x - hipX) * 20 + turn * 300) * dt; piv.sw += piv.sv * dt; piv.rotation.x = -B.hips.rotation.x * .8 + piv.sw + .04 * Math.sin(t * 1.3 + piv.rotation.y * 5); }
    this.cloth.update(dt, [st.p[0], g.position.y, st.p[2]], st.yaw, GH, cam);
  }
}
