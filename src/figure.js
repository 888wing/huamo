// The wandering swordsman, after the owner's design sheet: straw hat, robe with wide sleeves, a ragged cloak carried on
// the back, baggy trousers, bound shins, sandals, a sword. Built in code: a small skeleton posed procedurally, limbs as
// tapered ink-washed shapes, and every ragged piece of cloth as a strip of verlet points drawn like a brush stroke.
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, mix, smoothstep, normalWorld, normalView, positionWorld, positionLocal, texture3D, dot, uniform, sin, atan, length } from 'three/tsl';
import { wash, basic, SEAL } from './stage.js';
import { Strips } from './strips.js';
import { swing, swordTiming } from './player.js';
import { height } from './world.js';

const sun = vec3(.45, .8, .35).normalize();
const ZERO = [0, 0, 0], AX = ['x', 'y', 'z'], X = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), v5 = new THREE.Vector3(), v6 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), m4 = new THREE.Matrix4();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), cl = x => Math.min(1, Math.max(0, x)), sm = (x, a, b) => { const k = cl((x - a) / (b - a)); return k * k * (3 - 2 * k); };

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
const wovenHat = (noise, tone) => basic(Fn(() => {
  const radius = length(positionLocal.xz);
  const angle = atan(positionLocal.z, positionLocal.x);
  const ribs = smoothstep(.5, .95, sin(angle.mul(22).add(radius.mul(11))).abs());
  const braid = smoothstep(.28, .91, sin(radius.mul(158).add(ribs.mul(.46))));
  const straw = texture3D(noise, positionLocal.mul(5.2)).g.sub(.5);
  const boundRim = smoothstep(.408, .44, radius);
  const crownShade = smoothstep(.02, .22, radius);
  const lit = dot(normalWorld, sun).mul(.12);
  const upper = float(tone - .12).add(crownShade.mul(.18)).add(ribs.mul(.16)).add(braid.mul(.13)).add(straw.mul(.18)).add(lit);
  return wash(mix(float(.10).add(ribs.mul(.09)), upper.sub(boundRim.mul(.34)), smoothstep(.123, .159, positionLocal.y)));
})());

// Build the curved cloth panels as a lathe, with broad pleats cut into its silhouette.
function garmentProfile(points, depth, folds, segments = 32) {
  const geo = new THREE.LatheGeometry(points.map(([radius, y]) => new THREE.Vector2(radius, y)), segments);
  const positions = geo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), angle = Math.atan2(x, z);
    const flare = 1 + folds * (.65 * Math.cos(angle * 7) + .35 * Math.cos(angle * 11 + .8));
    positions.setXYZ(i, x * flare, positions.getY(i), z * flare * depth);
  }
  geo.computeVertexNormals();
  return geo;
}

function robeBand(path, width) {
  const vertices = [], triangles = [];
  for (let i = 0; i < path.length; i++) {
    const [x, y, z] = path[i];
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const halfWidth = width * (i === path.length - 1 ? .31 : .5) / Math.hypot(dx, dy);
    vertices.push(x + dy * halfWidth, y - dx * halfWidth, z, x - dy * halfWidth, y + dx * halfWidth, z);
    if (i > 0) {
      const k = (i - 1) * 2;
      triangles.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(triangles);
  geo.computeVertexNormals();
  return geo;
}

let detailedShapes;
function heroShapes() {
  if (detailedShapes) return detailedShapes;
  const hat = new THREE.LatheGeometry([
    [0, .179], [.29, .156], [.413, .128], [.443, .134], [.456, .150], [.442, .168],
    [.397, .179], [.331, .200], [.242, .232], [.150, .284], [.066, .329], [0, .34],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 64);
  const points = hat.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), z = points.getZ(i), a = Math.atan2(x, z);
    const radius = Math.hypot(x, z), rim = (radius / .456) ** 4;
    const shape = 1 + rim * (.016 * Math.sin(a * 11) + .011 * Math.cos(a * 17 + .4));
    points.setXYZ(i, x * shape, points.getY(i) + rim * (.021 * Math.cos(a) + .008 * Math.sin(a * 5)), z * shape);
  }
  hat.computeVertexNormals();

  const profile = new THREE.Shape();
  profile.moveTo(-.024, -.21);
  profile.lineTo(.025, -.21);
  profile.lineTo(.02, -.97);
  profile.quadraticCurveTo(.018, -1.055, 0, -1.12);
  profile.lineTo(-.017, -1.015);
  profile.closePath();
  const steel = new THREE.ExtrudeGeometry(profile, { depth: .013, bevelEnabled: false, curveSegments: 5 })
    .translate(0, 0, -.0065).rotateY(Math.PI / 2);

  const upperLapel = [[-.151, .228, .142], [-.109, .181, .157], [-.061, .126, .171], [-.015, .078, .185], [.018, .049, .188]];
  const outerLapel = [[.144, .236, .143], [.109, .189, .164], [.073, .137, .184], [.029, .069, .194],
    [-.015, .005, .193], [-.055, -.059, .185], [-.093, -.119, .170], [-.119, -.174, .159]];
  const bandEdge = (path, shift) => robeBand(path.map(([x, y, z]) => [x + shift, y, z + .004]), .012);
  detailedShapes = {
    hat, steel,
    upperLapel: robeBand(upperLapel, .054), upperEdge: bandEdge(upperLapel, -.015),
    outerLapel: robeBand(outerLapel, .064), outerEdge: bandEdge(outerLapel, -.017),
    tunic: garmentProfile([[0, -.055], [.158, -.055], [.169, .02], [.184, .195], [.206, .254], [.192, .307], [0, .332]], .83, .072),
    skirt: garmentProfile([[0, -.44], [.268, -.44], [.279, -.415], [.265, -.333], [.226, -.204], [.194, -.052], [.183, .059], [0, .066]], .82, .105),
    sleeve: garmentProfile([[.079, -.31], [.108, -.352], [.143, -.332], [.148, -.267], [.127, -.161], [.09, -.05], [.073, .028], [0, .04]], .91, .09),
    boot: garmentProfile([[0, -.031], [.102, -.032], [.111, -.016], [.103, .011], [.073, .035], [0, .042]], 1, .016, 24),
  };
  return detailedShapes;
}
const geos = new Map();
export const taper = (r0, r1, len) => { const k = `${r0},${r1},${len}`; if (!geos.has(k)) geos.set(k, new THREE.CylinderGeometry(r0, r1, len, 16, 3).translate(0, -len / 2, 0)); return geos.get(k); };
export const ball = new THREE.SphereGeometry(1, 20, 14), cone = new THREE.ConeGeometry(1, 1, 28), box = new THREE.BoxGeometry(1, 1, 1);

export class Figure {
  // pal: tones (0 ink .. 1 paper) for robe, cloak, legs, hat, skin, wraps
  constructor(scene, noise, pal, { detailed = false } = {}) {
    const g = this.group = new THREE.Group(); g.rotation.order = 'YXZ'; scene.add(g);
    const M = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, k === 'hat'
      ? (detailed ? wovenHat(noise, v) : hatMat(noise, v))
      : cloth(noise, v, detailed ? .67 : 1)]));
    const shapes = detailed ? heroShapes() : null;
    const red = basic(uniform(new THREE.Color(SEAL)));
    this.glow = uniform(0);
    const blade = basic(mix(wash(float(.55)), uniform(new THREE.Color(SEAL)), this.glow));
    const bones = this.bones = [];
    const bone = (parent, x, y, z) => { const b = new THREE.Group(); b.position.set(x, y, z); b.t = [0, 0, 0]; b.vel = [0, 0, 0]; parent.add(b); bones.push(b); return b; };
    const add = (parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx; parent.add(m); return m; };
    const seam = (parent, mat, start, end, width, depth) => {
      const offset = new THREE.Vector3(...start), direction = new THREE.Vector3(...end).sub(offset);
      offset.addScaledVector(direction, .5);
      const mesh = add(parent, box, mat, ...offset, width, direction.length(), depth);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      return mesh;
    };
    const B = this.B = {};
    B.hips = bone(g, 0, .92, 0); B.spine = bone(B.hips, 0, .08, 0); B.chest = bone(B.spine, 0, .24, 0); B.head = bone(B.chest, 0, .3, 0);
    add(B.hips, ball, M.legs, 0, -.02, 0, .19, .13, .15);
    if (detailed) {
      M.lapel = cloth(noise, .33, .5);
      M.hood = cloth(noise, .22, .52);
      M.binding = cloth(noise, .48, .55);
      add(B.spine, shapes.tunic, M.robe);
      add(B.hips, shapes.skirt, M.robe);
      const mantle = add(B.chest, ball, M.hood, -.084, .169, -.035, .243, .129, .184, -.19);
      mantle.rotation.z = -.11;
      add(B.chest, ball, M.cloak, .11, .185, -.088, .21, .124, .168, -.27);
      add(B.chest, shapes.upperLapel, M.lapel);
      add(B.chest, shapes.upperEdge, M.binding);
      add(B.chest, shapes.outerLapel, M.lapel);
      add(B.chest, shapes.outerEdge, M.binding);
      // A dark sash and a red tie break up the pale robe in front and in profile.
      add(B.spine, taper(.195, .199, .10), M.lapel, 0, .063, 0, 1, 1, .93);
      add(B.spine, taper(.197, .199, .021), M.binding, 0, .029, 0, 1, 1, .95);
      const tie = add(B.spine, box, red, .058, .027, .19, .152, .036, .024);
      tie.rotation.z = -.17;
      add(B.spine, ball, red, .159, .02, .135, .051, .05, .028);
      // A cord and small wood stopper tie the gourd into the belt.
      seam(B.hips, M.hood, [-.17, .139, .113], [-.226, .045, .131], .024, .013);
      add(B.hips, ball, M.binding, -.227, -.004, .133, .061, .077, .058);
      add(B.hips, ball, M.binding, -.219, .066, .134, .037, .047, .037);
      add(B.hips, taper(.017, .025, .031), M.cloak, -.216, .123, .135);
    } else {
      add(B.spine, taper(.2, .17, .3), M.robe, 0, .28, 0);
      add(B.hips, taper(.18, .27, .5), M.robe, 0, .06, 0);
      add(B.chest, box, M.cloak, .07, .2, .15, .025, .24, .02);
      add(B.chest, box, M.cloak, -.07, .2, .15, .025, .24, .02);
      add(B.spine, taper(.19, .19, .09), M.cloak, 0, .05, 0);
      add(B.spine, ball, red, .13, 0, .15, .035, .05, .03);
      add(B.hips, ball, M.wraps, -.2, .02, .1, .05, .07, .05);
      add(B.hips, ball, M.wraps, -.2, .1, .1, .03, .035, .03);
    }
    add(B.chest, ball, M.cloak, 0, .17, -.06, .3, .1, .2);                            // a mantle over the shoulders: the cloak's strips come out from under it
    add(B.chest, taper(.06, .07, .12), M.skin, 0, .32, 0);                            // neck
    add(B.chest, ball, M.robe, 0, .13, 0, .27, .13, detailed ? .145 : .16);
    // The flexible cape starts under the shoulder mantle.
    if (detailed) add(B.chest, ball, M.hood, -.032, .12, -.165, .226, .149, .119, -.23);
    else add(B.chest, ball, M.cloak, 0, .1, -.17, .25, .2, .15);
    add(B.head, ball, M.skin, 0, .09, .01, .095, .115, .1);
    add(B.head, ball, M.cloak, 0, .11, -.04, .1, .11, .1);                            // hair
    add(B.head, cone, M.skin, 0, .075, .105, .018, .05, .022, 1.2);                   // nose
    add(B.head, cone, M.cloak, 0, -.02, .07, .04, .09, .03, 3.3);                     // beard
    if (detailed) {
      add(B.head, ball, M.skin, 0, .036, .039, .074, .075, .078);
      for (const side of [1, -1]) {
        seam(B.head, M.cloak, [side * .011, .112, .105], [side * .068, .123, .095], .013, .013);
        seam(B.head, M.hood, [side * .013, .052, .122], [side * .061, .035, .105], .01, .014);
        seam(B.head, M.lapel, [side * .128, .143, .038], [side * .047, -.026, .065], .012, .013);
      }
      this.hat = add(B.head, shapes.hat, M.hat);
    } else {
      add(B.head, box, M.cloak, 0, .115, .092, .12, .012, .02);
      this.hat = add(B.head, cone, M.hat, 0, .23, 0, .44, .17, .44);
    }
    add(B.head, ball, M.cloak, 0, .33, -.02, .045, .05, .045);                        // topknot
    this.eyes = [add(B.head, ball, red, .04, .1, .1, .014, .012, .01), add(B.head, ball, red, -.04, .1, .1, .014, .012, .01)];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      const up = B['arm' + k] = bone(B.chest, s * .23, .17, 0), fore = B['fore' + k] = bone(up, 0, -.3, 0), hand = B['hand' + k] = bone(fore, 0, -.27, 0);
      add(up, detailed ? shapes.sleeve : taper(.075, .135, .34), M.robe);
      add(fore, taper(.05, .04, .27), M.skin); add(fore, taper(.052, .048, .12), M.cloak, 0, -.13, 0); add(hand, ball, M.skin, 0, -.04, 0, .042, .05, .03); add(hand, box, M.skin, 0, -.105, .005, .06, .07, .022); add(hand, box, M.skin, s * .04, -.06, .02, .018, .05, .02);
      const th = B['thigh' + k] = bone(B.hips, s * .1, -.04, 0), sh = B['shin' + k] = bone(th, 0, -.44, 0), ft = B['foot' + k] = bone(sh, 0, -.42, 0);
      add(th, taper(.12, .145, .46), M.legs); add(sh, taper(.145, .075, .24), M.legs); add(sh, taper(.058, .05, .2), M.wraps, 0, -.22, 0);
      if (detailed) {
        add(fore, taper(.055, .052, .029), M.binding, 0, -.16, 0);
        add(sh, taper(.071, .063, .032), M.cloak, 0, -.243, 0);
        add(sh, taper(.066, .061, .029), M.cloak, 0, -.337, 0);
        add(ft, shapes.boot, M.cloak, 0, 0, .061, .53, 1, 1.19);
        seam(ft, M.binding, [-.044, .016, .075], [.035, .034, .107], .035, .018);
        seam(ft, M.binding, [.044, .016, .072], [-.026, .035, .107], .023, .016);
      } else {
        add(ft, box, M.cloak, 0, 0, .06, .095, .05, .25);
      }
    }
    // sword: in the right hand when drawn, at the left hip when not
    const sword = (parent, sheathed = false) => {
      const s = new THREE.Group();
      if (detailed && !sheathed) add(s, shapes.steel, blade);
      else add(s, box, detailed ? M.cloak : blade, 0, -.62, 0, .014, 1.0, detailed ? .057 : .04);
      add(s, box, M.cloak, 0, -.1, 0, .03, .22, .035);
      add(s, box, detailed ? M.binding : M.cloak, 0, -.215, 0, .07, .015, .09);
      if (detailed) {
        add(s, box, red, 0, -.017, 0, .034, .041, .036);
        if (sheathed) add(s, box, M.binding, 0, -1.09, 0, .016, .06, .061);
      }
      parent.add(s);
      return s;
    };
    this.drawn = sword(B.handR); this.drawn.position.y = -.04;
    this.sheathed = sword(B.hips, true); this.sheathed.position.set(.2, .1, .1); this.sheathed.rotation.set(1.22, 0, .12); // hilt forward at the hip, the scabbard running back

    // cloth strips: [bone, anchor x y z, rest direction x y z (figure space), length, width at top, width at hem, tone]
    const S = [];
    for (let i = 0; i < 7; i++) { const a = (i - 3) / 3; S.push([B.chest, a * .24, .1, -.17 - .05 * (1 - a * a), a * .35, -1, -.55, 1.0 + .25 * Math.cos(i * 2.1), .24, .07, pal.cloak + .03 * (i % 3)]); }
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283; S.push([B.hips, Math.sin(a) * .25, -.4, Math.cos(a) * .22, Math.sin(a) * .2, -1, Math.cos(a) * .2, .42 + .12 * Math.sin(i * 1.7), .24, .13, pal.robe - .06 * (i % 2)]); }
    S.push([B.spine, .15, .0, .14, .3, -1, .3, .5, .05, .02, pal.cloak], [B.spine, .11, .0, .15, .1, -1, .4, .42, .05, .02, pal.cloak]);
    for (let i = 0; i < 3; i++) S.push([B.head, (i - 1) * .06, .08, -.11, (i - 1) * .2, -.8, -.7, .26 + .06 * i, .05, .015, pal.cloak]);
    // Broken straw sits under the binding and catches the motion of the hat.
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * 6.283;
      const length = detailed ? .033 + .029 * (i % 3) : .1 + .07 * ((i * 7) % 3);
      const y = detailed ? .139 + .02 * Math.cos(a) : .155;
      const r = detailed ? .419 : .41;
      S.push([B.head, Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a) * .5, -1, Math.cos(a) * .5, length, detailed ? .083 : .13, .03, pal.hat - .1]);
    }
    this.cloth = new Strips(scene, noise, S, { rad: .2, top: 1.3, stiff: 1 });
    this.tip = new THREE.Vector3();
    // each foot remembers where it stands in the world and steps when the body has moved on; `t` < 1 while it is in the air
    this.feet = [1, -1].map(side => ({ s: side, k: side > 0 ? 'L' : 'R', pos: new THREE.Vector3(), from: new THREE.Vector3(), t: 1, T: .2, err: 0 }));
    this.fresh = true; this.ikW = 0; this.airW = 0; this.gripW = 0; this.acc = 0; this.bank = 0; this.pFwd = 0; this.pYaw = 0; this.hipV = 0;
    this.hatSize = this.hat.scale.clone();
  }

  set visible(v) { if (v && !this.group.visible) this.cloth.fresh = this.fresh = true; this.group.visible = this.cloth.mesh.visible = v; }

  // Where the feet stand. A planted foot stays put in the world; when the body has gone on far enough it lifts, swings
  // to where the body is about to be, and plants again. Works the same forwards, backwards and sideways, so nothing slides.
  plant(h, st, sp, gk) {
    const { p, yaw } = st, v = st.v ?? ZERO, sy = Math.sin(yaw), cy = Math.cos(yaw);
    if (this.ikW < .05 || this.fresh) { // legs posed directly (a stroke, a roll, the air): the feet's memory just follows them
      for (const f of this.feet) { this.B['foot' + f.k].getWorldPosition(f.pos); f.pos.y = height(f.pos.x, f.pos.z); f.t = 1; f.err = 0; }
      this.fresh = false; return;
    }
    const stride = .5 + .17 * sp, T = Math.max(.13, Math.min(.3, stride / Math.max(sp, 1) * .55)), dx = sp > .05 ? v[0] / sp : 0, dz = sp > .05 ? v[2] / sp : 0;
    const ahead = Math.min(stride * .45, .42), due = sp > .3 ? Math.min(stride * .5, .45) : .13;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], o = this.feet[1 - i], lat = f.s * (.11 + .07 * gk), fw = f.s * .17 * gk; // on guard the stance widens and the left foot leads
      const hx = p[0] + cy * lat + sy * fw, hz = p[2] - sy * lat + cy * fw;
      if (f.t >= 1) {
        f.err = Math.hypot(hx - f.pos.x, hz - f.pos.z);
        // the foot left furthest behind goes first; in a run the next may leave before the last has landed
        // (a foot the leg can no longer reach leaves at once, whatever the other is doing)
        if (f.err > .62 || (f.err > due && (o.t >= 1 ? f.err >= o.err - .01 : o.t > .55 && sp > 3.4))) { f.from.copy(f.pos); f.t = 0; f.T = T; f.err = 0; }
      }
      if (f.t < 1) {
        f.t = Math.min(1, f.t + h / f.T);
        const rem = (1 - f.t) * f.T, tx = hx + v[0] * rem + dx * ahead, tz = hz + v[2] * rem + dz * ahead, e = f.t * f.t * (3 - 2 * f.t);
        f.pos.set(f.from.x + (tx - f.from.x) * e, 0, f.from.z + (tz - f.from.z) * e);
        f.pos.y = height(f.pos.x, f.pos.z) + (.05 + .17 * Math.min(1, sp / 5.5)) * Math.sin(Math.PI * f.t);
      }
    }
  }
  // Bends one leg so its ankle stands on the foot's point: the knee goes forward and a little out. w blends it over the posed leg.
  reachLeg(f, w) {
    const { B, group: g } = this, th = B['thigh' + f.k], sh = B['shin' + f.k], ft = B['foot' + f.k], sc = g.scale.x, l1 = .44 * sc, l2 = .42 * sc;
    th.getWorldPosition(v1); v2.set(f.pos.x, f.pos.y + .045 * sc, f.pos.z).sub(v1);
    const dist = Math.min(l1 + l2 - .004, Math.max(.2, v2.length())); v2.normalize();
    const A = Math.acos((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)), E = Math.acos((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2));
    v3.set(f.s * .25, .1, 1).applyQuaternion(qYaw); v4.copy(v3).cross(v2).normalize();          // v4: the axis the knee bends about, the bone's own X
    v5.copy(v2).applyAxisAngle(v4, -A).negate(); v6.copy(v4).cross(v5);
    q1.setFromRotationMatrix(m4.makeBasis(v4, v5, v6)); th.parent.getWorldQuaternion(q2); th.quaternion.slerp(q3.copy(q2).invert().multiply(q1), w);
    sh.quaternion.slerp(q1.setFromAxisAngle(X, Math.PI - E), w);
    th.updateMatrixWorld(true); sh.getWorldQuaternion(q2);
    q1.copy(qYaw).multiply(q3.setFromAxisAngle(X, f.t < 1 ? .55 * Math.sin(Math.PI * f.t) : 0)); // the toes hang while the foot swings
    ft.quaternion.slerp(q3.copy(q2).invert().multiply(q1), w);
  }

  // st: what Player.pose() returns. The enemy passes the same shape with fewer fields ({ p, v, yaw, act, side, windup, stagger, fall, melt, fade, eyes, time }).
  // The pose is built in four layers, each laid over the one before: moving on the ground, the air, an action
  // (guard, stroke, dodge, the stab from the air), a reaction (a blow, being thrown, dying). Bones then follow their
  // targets on springs, so every change of pose overshoots a little and settles.
  update(dt, st, cam) {
    const { B, group: g } = this, set = (b, x = 0, y = 0, z = 0) => { b.t[0] = x; b.t[1] = y; b.t[2] = z; };
    const mixTo = (b, x, y, z, w) => { b.t[0] += (x - b.t[0]) * w; b.t[1] += (y - b.t[1]) * w; b.t[2] += (z - b.t[2]) * w; };
    const v = st.v ?? ZERO, yaw = st.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw), h = Math.min(dt, 1 / 30);
    const sp = Math.hypot(v[0], v[2]), fwd = v[0] * sy + v[2] * cy, fast = sm(sp, 3.2, 5.3), moving = sm(sp, .15, 1.2);
    const t = st.act, s = st.side, ground = st.ground ?? true, gk = st.guardK ?? 0;
    // how hard the body is speeding up, slowing or turning: it leans into all three
    if (h > 1e-4) {
      this.acc += (Math.max(-40, Math.min(40, (fwd - this.pFwd) / h)) - this.acc) * Math.min(1, 9 * h);
      this.bank += (Math.max(-.32, Math.min(.32, -wrap(yaw - this.pYaw) / h * sp * .016)) - this.bank) * Math.min(1, 7 * h);
    }
    this.pFwd = fwd; this.pYaw = yaw;
    for (const b of this.bones) set(b);
    // which foot is forward: the arms and the shoulders answer it
    const off = f => (f.pos.x - st.p[0]) * sy + (f.pos.z - st.p[2]) * cy, gs = Math.max(-1, Math.min(1, (off(this.feet[1]) - off(this.feet[0])) / .62)) * moving;

    // ---- on the ground: standing, walking, the leaning run
    let hipY = .9 - .03 * fast, lean = .04 + .1 * moving + .4 * fast + (ground ? Math.max(-.3, Math.min(.22, this.acc * .011)) : 0), twist = -gs * .16;
    let roll = this.bank, pitch = 0, pivot = 0, rootY = 0, ik = 1, stiff = 420, headX = 0, headY = 0, headZ = 0, curl = 0, grip = 0, hatTilt = 0;
    let melt = st.melt ?? 0, fade = st.fade ?? 0;
    set(B.thighL, -.06, 0, .04); set(B.thighR, -.06, 0, -.04); set(B.shinL, .12); set(B.shinR, .12);
    // the left hand rides the scabbard; the right swings with the stride, and trails behind in the run
    set(B.armL, .12 - .2 * gs * (1 - fast), 0, .2); set(B.foreL, -.75 - .25 * fast);
    set(B.armR, .5 * gs * (1 - .5 * fast) + .45 * fast, 0, -.16 - .12 * fast); set(B.foreR, -.3 - .35 * moving - .15 * fast);
    set(B.spine, .03 * Math.sin(st.time * 1.4));

    // ---- in the air: one knee up on the way up, both tucked at the top, legs reaching for the ground on the way down
    this.airW += ((ground ? 0 : 1) - this.airW) * Math.min(1, h / .07);
    const aw = this.airW;
    if (aw > .01) {
      const vy = st.vy ?? 0, up = sm(vy, 1, 6), dn = sm(-vy, 1.5, 8), top = Math.max(0, 1 - up - dn), L3 = (a, b, c) => a * up + b * top + c * dn;
      mixTo(B.thighL, L3(-1.2, -1.35, -.35), 0, .06, aw); mixTo(B.shinL, L3(1.55, 1.9, .5), 0, 0, aw);
      mixTo(B.thighR, L3(.35, -1.0, -.5), 0, -.06, aw); mixTo(B.shinR, L3(.6, 1.7, .75), 0, 0, aw);
      mixTo(B.armL, L3(-.7, -.25, -1.1), 0, L3(.75, 1.25, 1.0), aw); mixTo(B.foreL, L3(-.6, -.3, -.5), 0, 0, aw);
      mixTo(B.armR, L3(-.4, -.25, -.95), 0, L3(-.9, -1.25, -1.0), aw); mixTo(B.foreR, L3(-.5, -.3, -.5), 0, 0, aw);
      lean += (L3(.2, .06, -.06) - lean) * aw; twist *= 1 - aw; ik = Math.min(ik, 1 - aw);
    }
    // coming down: the knees take it (the feet are planted, so lowering the hips is all it needs)
    if (st.land > 0 && !st.landHard) { const e = Math.sin(Math.PI * cl(1 - st.land / .14)); hipY -= .27 * e; lean += .22 * e; mixTo(B.armL, -.2, 0, .7, e * .6); mixTo(B.armR, -.2, 0, -.7, e * .6); }

    // ---- actions
    const drawn = t >= 0 || st.windup > 0 || gk > .3 || !!st.guard || st.plunge > 0 || (st.death > 0 && st.death < .6) || st.parryT > 0;
    if (gk > .01) { // on guard: sword raised across the body, the body turned side-on behind it
      mixTo(B.armR, -1.25, 0, .45, gk); mixTo(B.foreR, -1.25, 0, 0, gk); mixTo(B.armL, -1.0, 0, -.35, gk); mixTo(B.foreL, -1.2, 0, 0, gk);
      hipY -= .08 * gk; twist += .3 * gk; lean += (.1 - lean) * gk * .6;
    }
    if (st.blockT > 0) { const e = Math.sin(Math.PI * cl(1 - st.blockT / .25)); mixTo(B.armR, -.9, 0, .55, e); mixTo(B.foreR, -1.85, 0, 0, e); mixTo(B.foreL, -1.7, 0, 0, e); lean -= .22 * e; hipY -= .07 * e; stiff = 900; } // a blow taken on the sword: the arms give
    if (st.parryT > 0) { const e = Math.sin(Math.PI * cl(1 - st.parryT / .32)); mixTo(B.armR, -1.55, 0, -1.2, e); mixTo(B.foreR, -.25, 0, 0, e); twist -= .75 * e; lean += .12 * e; stiff = 1100; }  // turned aside: the sword sweeps out
    if (st.windup > 0) { // sword raised: the tell before a strike
      const k = Math.sin(Math.min(1, st.windup) * 1.57);
      set(B.armR, -2.7 * k, 0, -.25); set(B.foreR, -.5 * k); set(B.armL, -.9 * k, 0, .3); twist = -s * .5 * k; hipY -= .06 * k; lean -= .12 * k;
    }
    if (t >= 0) {
      const combo = st.combo ?? 0, phase = swordTiming(t, combo);
      const e = swing(phase), gather = Math.sin(Math.PI * Math.min(1, phase / .35)) * (phase < .35 ? 1 : 0), snap = Math.min(1, Math.max(0, (phase - .35) / .25)), out = Math.max(0, (phase - .6) / .4);
      // The opening sweep draws the hips through and lets the front leg lunge.
      twist = s * (-1.15 + 2.3 * e - .45 * gather);
      set(B.armR, -1.5 + .25 * s * (e - .5) + .55 * gather + .2 * out, 0, -.1 - .3 * gather); set(B.foreR, -.12 - 1.0 * gather); set(B.handR, -.25 - .3 * snap);
      set(B.armL, .7, 0, .7); set(B.foreL, -.6);
      set(B.thighL, s > 0 ? -.75 : .5, 0, .12); set(B.shinL, s > 0 ? .8 : .3); set(B.thighR, s > 0 ? .5 : -.75, 0, -.12); set(B.shinR, s > 0 ? .3 : .8);
      hipY -= .15 + .12 * gather + .06 * snap - .1 * out; lean += .14 + .2 * snap + .1 * gather - .12 * out;
      if (combo === 1) {
        // A low coil loads the rising diagonal; the elbow leads the sword high and wide.
        twist = s * (-.92 + 1.96 * e);
        set(B.armR, -.55 - 1.84 * e + .22 * gather, .17 * s, -.40 + .57 * e);
        set(B.foreR, -.70 + .48 * e); set(B.handR, .14 - .48 * e);
        set(B.armL, -.25 + .80 * e, 0, .62); set(B.foreL, -.38 - .38 * gather);
        hipY -= .10 * (1 - e);
        lean += .14 * gather - .43 * e;
      } else if (combo === 2) {
        // Keep the blade aloft as the shoulders load, then throw the weight down onto the lead leg.
        twist = s * (-.34 + .99 * e);
        set(B.armR, -2.83 + 2.99 * e - .25 * gather, -.16 * s, -.24 + .17 * e);
        set(B.foreR, -.75 + .56 * e); set(B.handR, -.25 + .51 * e);
        set(B.armL, -1.28 + 1.91 * e, 0, .32 + .37 * snap); set(B.foreL, -.84 + .28 * e);
        hipY += .12 * (1 - e) - .09 * e;
        lean += -.30 * (1 - e) + .26 * e;
      }
      headX = -.12 + lean * .6; headY = -twist * .45; ik = 0; stiff = 1300;
    }
    const dk = st.dodgeKind ?? 0, hardRoll = st.land > 0 && st.landHard;
    if (dk === 1) { // the hop back: knees up, the body low and still facing what it is backing away from
      const e = Math.sin(Math.PI * cl(st.dodgeU)); rootY += .3 * e; ik = 0; stiff = 800; hipY -= .12 * e; lean = .12 + .28 * e;
      set(B.thighL, -.2 - .75 * e, 0, .08); set(B.shinL, .25 + 1.1 * e); set(B.thighR, .1 - .55 * e, 0, -.08); set(B.shinR, .4 + .8 * e);
      mixTo(B.armL, -.9, 0, .55, e); mixTo(B.armR, .45, 0, -.7, e);
    }
    if (dk === 2 || hardRoll) { // the roll: tucked into a ball and once over, turning about its own middle
      const u = dk === 2 ? st.dodgeU : 1 - st.land / .4, tk = Math.sin(Math.PI * cl(u / .92)) ** .6;
      pitch = 6.2832 * sm(u, .04, .9); pivot = .5; ik = 0; stiff = 900; twist = 0; roll = 0; hipY -= .32 * tk; lean = .1 + .75 * tk; curl = .45 * tk; headX = .55 * tk;
      set(B.thighL, -1.95 * tk - .1, 0, .1); set(B.shinL, 2.3 * tk + .1); set(B.thighR, -1.85 * tk - .1, 0, -.1); set(B.shinR, 2.25 * tk + .1);
      mixTo(B.armL, -1.35, 0, -.25, tk); mixTo(B.foreL, -1.7, 0, 0, tk); mixTo(B.armR, -1.35, 0, .25, tk); mixTo(B.foreR, -1.7, 0, 0, tk);
    }
    const pg = st.plunge ?? 0;
    if (pg) { // the stab from the air: both hands on the hilt, the point straight down, the body curled over it; then crouched over the sword in the ground
      const stuck = pg === 2, rise = stuck ? sm(st.plungeT / .38, .55, 1) : 0; ik = stuck ? 1 : 0; stiff = 900; grip = 1 - rise; twist = 0;
      mixTo(B.armR, stuck ? -.55 : -1.05, 0, .3, 1 - rise); mixTo(B.foreR, stuck ? -.35 : -.6, 0, 0, 1 - rise); mixTo(B.armL, stuck ? -.6 : -1.05, 0, -.3, 1 - rise); mixTo(B.foreL, stuck ? -.4 : -.6, 0, 0, 1 - rise);
      if (stuck) { hipY -= .36 * (1 - rise); lean = .5 * (1 - rise) + .05; }
      else { set(B.thighL, -1.1, 0, .1); set(B.shinL, 1.7); set(B.thighR, -.5, 0, -.1); set(B.shinR, 1.3); lean = .32; }
    }

    // ---- reactions
    if (st.hurtU >= 0) { // a blow: the body gives way from where it landed, most at once and then recovering
      const k = Math.sin(Math.PI * Math.pow(st.hurtU, .42)) * (st.hurtKind === 2 ? 1.5 : 1), [left, front] = st.hurtDir, w = Math.min(1, k);
      lean -= .5 * k * front; roll += .42 * k * left; twist += .5 * k * left; hipY -= .07 * k; stiff = 800; headX += .4 * k * front; headZ = -.3 * k * left; hatTilt = .3 * k;
      mixTo(B.armL, -.5, 0, 1.0, w); mixTo(B.armR, -.35, 0, -1.0, w);
    }
    if (st.stagger > 0) { const k = st.stagger; lean -= .55 * k; hipY -= .08 * k; set(B.armL, -.6 * k, 0, 1.0 * k); set(B.armR, -.4 * k, 0, -1.0 * k); headX += .35 * k; }
    const ko = st.ko ?? 0;
    if (ko) { // thrown: over backwards through the air, flat on its back, then up through a crouch
      const u = ko === 1 ? sm(st.koT, 0, .32) : ko === 2 ? 1 : 1 - sm(st.koT, .05, .5), up = ko === 3 ? 1 - u : 0;
      ik = 0; stiff = 700; pitch = -1.5 * u; rootY += .17 * u; lean = -.15 * u; twist = 0; roll = 0; headX = .35 * u; hatTilt = .25 * u;
      set(B.armL, -.5, 0, 1.3 * u + .2); set(B.armR, -.5, 0, -1.3 * u - .2); set(B.foreL, -.4); set(B.foreR, -.4);
      set(B.thighL, -.45 - .75 * up, 0, .12); set(B.shinL, .7 + .9 * up); set(B.thighR, .2 - 1.1 * up, 0, -.12); set(B.shinR, .5 + 1.0 * up);
      if (ko === 3) hipY -= .38 * Math.sin(Math.PI * cl(st.koT / .6));
    }
    const fall = st.fall ?? 0, fe = fall * fall * (3 - 2 * fall);
    if (fall > 0) { lean = -.2; ik = 0; set(B.armL, -.5, 0, 1.35); set(B.armR, -.5, 0, -1.35); set(B.thighL, -.3); set(B.thighR, .25); set(B.shinL, .5); headX = .3; } // the shadow, cut down: arms flung wide
    const dd = st.death ?? 0;
    if (dd > 0) { // the end: down on one knee with the sword planted, forwards onto the ground, and out into ink; the hat is the last of it
      const kneel = sm(dd, 0, .16), drop = sm(dd, .26, .46); ik = 0; stiff = 300; grip = kneel * (1 - drop); twist = 0; roll = 0;
      hipY = .9 - .4 * kneel; lean = .1 * kneel + .25 * sm(dd, .12, .26); headX = .55 * kneel; pitch = 1.42 * drop; rootY += .1 * drop;
      set(B.thighL, -1.5 * kneel, 0, .1); set(B.shinL, 1.55 * kneel); set(B.thighR, -.1 * kneel, 0, -.08); set(B.shinR, 1.6 * kneel);
      set(B.armR, -.85 * kneel * (1 - drop) - .3 * drop, 0, -.15 - .9 * drop); set(B.foreR, -.45 * kneel); set(B.armL, .1 - .4 * drop, 0, .15 + .9 * drop); set(B.foreL, -.3);
      melt = Math.max(melt, sm(dd, .5, .9)); fade = Math.max(fade, sm(dd, .84, .98) * .93);
    }
    set(B.hips, lean, twist * .3); mixTo(B.spine, B.spine.t[0] + curl, 0, 0, 1); set(B.chest, .05 + curl, twist * .7);
    set(B.head, -lean * .6 + .03 * Math.sin(st.time * .9) + headX, headY, headZ);

    // ---- bones follow their targets on springs; the hips' height too
    const C = 1.6 * Math.sqrt(stiff), legs = this.ikW > .5;
    for (const b of this.bones) for (let a = 0; a < 3; a++) { const ax = AX[a]; b.vel[a] += (stiff * (b.t[a] - b.rotation[ax]) - C * b.vel[a]) * h; b.rotation[ax] += b.vel[a] * h; }
    if (legs) for (const k of ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR']) B[k].vel.fill(0);
    // the hips come down as far as the legs need to reach both feet: that is the rise and fall of a walk
    const sc = 1.04 * (1 - .7 * fade), L = .86 * sc;
    let cap = 9;
    if (ik > .5 && this.ikW > .5) for (const f of this.feet) if (f.t >= 1) {
      const d = Math.hypot(f.pos.x - (st.p[0] + cy * f.s * .1), f.pos.z - (st.p[2] - sy * f.s * .1));
      cap = Math.min(cap, (Math.sqrt(Math.max(.04, L * L - d * d)) + .05 * sc + f.pos.y - st.p[1]) / sc + .02);
    }
    this.hipV += (stiff * (Math.min(hipY, cap) - B.hips.position.y) - C * this.hipV) * h; B.hips.position.y += this.hipV * h;
    if (B.hips.position.y > cap) { B.hips.position.y = cap; this.hipV = Math.min(0, this.hipV); } // never so high that a planted foot would be pulled off its place
    this.drawn.visible = drawn; this.sheathed.visible = !drawn;
    this.glow.value += ((st.windup > 0 ? 1 : 0) - this.glow.value) * Math.min(1, 14 * dt);
    this.eyes.forEach(e => { e.visible = !!st.eyes; });
    this.hat.rotation.x += (hatTilt - this.hat.rotation.x) * Math.min(1, 12 * h);
    this.hat.scale.copy(this.hatSize).multiplyScalar(dd > .5 ? Math.min(3.3, 1.04 / sc) : 1); // the hat keeps its size while the body under it goes

    // ---- place the body. `pitch` turns it about a point `pivot` above the feet (a roll goes over its own middle, not over its heels);
    // falling tips the whole figure onto its back; melting flattens and spreads it like ink soaking into paper
    const py = pivot * (1 - Math.cos(pitch)), pz = -pivot * Math.sin(pitch);
    g.position.set(st.p[0] + sy * pz, st.p[1] + rootY + py + .17 * fe, st.p[2] + cy * pz);
    g.rotation.set(pitch - 1.5 * fe, yaw, roll);
    // changing form: leaving, the figure is drawn up into a streak of ink; arriving, it swells out of one
    // (into the carp it goes down into the fog instead: the carp is under the surface)
    const sk = st.streak ?? 0, gr = .2 + .8 * (st.grow ?? 1), sink = st.form === 3 ? sk : 0;
    g.position.y -= 1.1 * sink * sink;
    g.scale.set(sc * (1 + .35 * melt) * (1 - .9 * sk) * gr, sc * (1 + .12 * melt) * (1 + .3 * sk - .6 * sink) * gr, sc * (1 - .9 * melt) * (1 - .9 * sk) * gr);
    g.updateMatrixWorld(true);
    // ---- legs: on the ground they reach for the feet's planted points
    qYaw.setFromAxisAngle(UP, yaw);
    this.ikW += (ik - this.ikW) * Math.min(1, h / .07);
    this.plant(h, st, sp, gk);
    if (this.ikW > .01) { for (const f of this.feet) this.reachLeg(f, this.ikW); g.updateMatrixWorld(true); }
    // held point down (the stab, the kneel): the sword stands upright in the world whatever the arm is doing
    this.gripW += (grip - this.gripW) * Math.min(1, h / .06);
    this.drawn.quaternion.identity();
    if (this.gripW > .01) { B.handR.getWorldQuaternion(q2); this.drawn.quaternion.slerp(q3.copy(q2).invert().multiply(qYaw), this.gripW); this.drawn.updateMatrixWorld(true); }
    this.drawn.localToWorld(this.tip.set(0, -1.12, 0));

    this.cloth.update(dt, st.p, st.yaw, g.scale.x, cam);
  }
}
