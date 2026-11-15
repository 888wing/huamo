// Scripted runs for repeatable captures: each sets the player's form and input over time and may pin the camera.
import { DUEL_CLEARING, height, START } from './world.js';

const place = (player, x, z, y) => { player.p[0] = x; player.p[2] = z; player.p[1] = y ?? height(x, z); player.v.fill(0); };
const once = (player, key, fn) => { if (!player['_' + key]) { player['_' + key] = true; fn(); } };

// The moves demo, as [what, for how long (s)]. `-` is a pause. tools/strip.sh finds a move's time from this list.
export const MOVE_SEQ = [
  ['-', .3], ['run', 1.1], ['-', .5], ['circle', 2.5], ['-', .2], ['walk', 2.0], ['face', .4],
  ['jump', .1], ['-', .8], ['jump', .5], ['-', .6], ['run', .2], ['runjump', .5], ['run', .3], ['-', .4],
  ['home', 1.6], ['face', .3], ['guard', .4], ['guardback', .6], ['block', .5], ['parry', .6], ['-', .3],
  ['home', 1.2], ['face', .3], ['hop', .1], ['-', .7], ['roll', .1], ['-', .8],
  ['home', 1.4], ['face', .3], ['roll', .1], ['-', .2], ['cut', .1], ['-', .7],
  ['home', 1.4], ['face', .3], ['cut', .1], ['-', .25], ['cut', .1], ['-', .2], ['cut', .1], ['-', .9],
  ['home', 1.0], ['face', .3], ['hitfront', .7], ['hitside', .7], ['hitheavy', .9],
  ['home', 1.0], ['face', .3], ['thrown', 2.4],
  ['home', 1.0], ['face', .3], ['thrown', .35], ['jump', .1], ['-', .9],
  ['home', 1.0], ['face', .3], ['jump', .45], ['stab', .1], ['-', 1.2],
  ['home', 1.0], ['face', .3], ['death', 3.6],
];

// The shift demo. Pressing the same key twice is two steps with a gap between: jump, -, jump.
export const SHIFT_SEQ = [
  ['-', .4], ['run', .5], ['jump', .12], ['run', .14], ['jump', .1], ['fly', 2.3], ['cut', .1], ['-', 1.3],          // jump, jump: the crane; attack: the stab
  ['home', 1.6], ['face', .3], ['roll', .08], ['-', .1], ['roll', .08], ['gallop', 2.2], ['cut', .1], ['-', 1.2],    // roll, roll: the tiger; attack: the pounce cut
  ['home', 2.0], ['face', .3], ['guard', .1], ['-', .1], ['guard', .1], ['swim', 2.4], ['cut', .1], ['-', 1.2],      // guard, guard: the carp; attack: the rising cut
  ['home', 4.2], ['face', .3], ['run', .4], ['jump', .12], ['run', .14], ['jump', .1], ['soar', 5.6], ['-', 1.2],    // and a flight held until the ink is gone
  ['run', .4], ['jump', .12], ['run', .14], ['jump', .1], ['-', 1.4],                                                // too little ink yet: the second press does nothing
];

export const DEMOS = {
  // a sword stroke through standing fog, seen from above the shoulder
  slash(t, player, cam, inp) {
    once(player, 's', () => { place(player, 0, 14); player.setForm(0); player.yaw = Math.PI; });
    cam.fixed = { pos: [3.4, 5.4, 20], look: [0, 1.2, 12.5] };
    inp.act = (t > .5 && t < .6) || (t > 1.6 && t < 1.7) || (t > 2.7 && t < 2.8);
  },
  // A side-on walk from the path through the reeds, with time for the first patch to rise again.
  reeds(t, player, cam, inp) {
    once(player, 's', () => {
      place(player, 1.6, 19);
      place(player.foe, -19, 4);
      player.setForm(0);
      player.yaw = -Math.PI / 2;
    });
    cam.yaw = -Math.PI / 2;
    cam.fixed = { pos: [-1.7, 4.4, 24.1], look: [-1.6, .65, 19] };
    inp.z = t > .45 && t < 2.55 ? .48 : 0;
  },
  // Face the camera across the low pond so the blade cuts a foreground layer in full view.
  smokecut(t, player, cam, inp) {
    const x = 4.3, z = -2.75;
    once(player, 's', () => {
      place(player, x, z);
      player.setForm(0);
      player.yaw = -.5;
      place(player.foe, -20, 19);
    });
    const eye = t < 10 ? [2.6, 3.7, 2.8] : t < 20 ? [2.4, 6, -9.1] : [10.7, 2.8, -.35];
    const angle = Math.atan2(eye[0] - x, eye[2] - z);
    cam.fixed = { pos: eye, look: [x + Math.sin(angle) * .75, .95, z + Math.cos(angle) * .75] };
    cam.yaw = angle;
    const beat = t % 5;
    const returnHome = beat >= 4.05 && beat < 4.8;
    const dx = x - player.p[0], dz = z - player.p[2], s = Math.sin(angle), c = Math.cos(angle);
    const move = v => returnHome ? Math.min(1, Math.max(-1, v)) : 0;
    inp.act = beat >= 2.35 && beat < 2.57;
    inp.x = move(dx * -c + dz * s);
    inp.z = move(dx * s + dz * c);
    if (beat < 2.32 && player.act <= 0 && Math.hypot(player.v[0], player.v[2]) < .3) {
      const look = angle - player.yaw;
      player.yaw += Math.atan2(Math.sin(look), Math.cos(look)) * .12;
    }
  },
  // Cross the pond side-on, then hold the camera as the wake fills back in.
  fogwalk(t, player, cam, inp) {
    once(player, 's', () => {
      place(player, 5.7, -3.9);
      place(player.foe, -20, 19);
      player.setForm(0);
      player.yaw = -Math.PI / 2;
    });
    cam.yaw = -Math.PI / 2;
    cam.fixed = { pos: [2.1, 3.55, 2.4], look: [3.25, .98, -3.9] };
    inp.z = t > 2.1 && t < 4.2 ? .48 : 0;
  },
  roar(t, player, cam, inp) {
    once(player, 's', () => { place(player, 0, 14); player.setForm(1); player.yaw = Math.PI; });
    cam.fixed = { pos: [9, 12, 26], look: [0, 1.5, 11] };
    inp.act = t > .5 && t < .6;
  },
  flap(t, player, cam, inp) {
    once(player, 's', () => { place(player, 0, 13, 7); player.setForm(2); player.yaw = Math.PI; });
    cam.fixed = { pos: [10, 12.5, 27], look: [0, 3, 11] };
    inp.up = player.p[1] < 7 ? 1 : 0; inp.down = 0;
    inp.act = t > .5 && t < 2.5;
  },
  carp(t, player, cam, inp) {
    once(player, 's', () => { place(player, -7, 15, 1.4); player.setForm(3); player.yaw = Math.PI / 2; cam.yaw = Math.PI / 2; cam.pitch = 0; });
    cam.fixed = { pos: [4, 26, 15.01], look: [4, 0, 15] };
    inp.z = t > .3 && player.p[0] < 16 ? 1 : 0;
  },
  // all four forms in one lap of the basin, with the normal third-person camera
  tour(t, player, cam, inp) {
    once(player, 's', () => { place(player, 10, 9); player.yaw = 0; cam.yaw = 0; cam.pitch = -.2; });
    const seg = (a, b) => t >= a && t < b;
    player.setForm(t < 6 ? 0 : t < 11 ? 1 : t < 17 ? 2 : 3);
    // steer along a circle of radius 9 around (1, 9): aim at a point a little ahead on it
    const ang = Math.atan2(player.p[2] - 9, player.p[0] - 1) + .45, tx = 1 + 9 * Math.cos(ang), tz = 9 + 9 * Math.sin(ang);
    let d = Math.atan2(tx - player.p[0], tz - player.p[2]) - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.yaw += d * Math.min(1, 3 / 60);
    inp.z = seg(.3, 2.2) || seg(4.6, 6) || seg(6.3, 8.3) || seg(9.6, 10.6) || seg(11.3, 16.5) || seg(17.6, 23) ? 1 : 0;
    inp.up = seg(11, 12.6) ? 1 : 0; inp.down = seg(15.6, 17) ? 1 : 0;
    inp.act = seg(2.5, 2.6) || seg(3.2, 3.3) || seg(3.9, 4) || seg(8.8, 8.9) || seg(13, 15) || seg(19.5, 19.6);
    cam.pitch = t > 11 && t < 17 ? -.42 : t >= 17 ? -.55 : -.26;
  },
  // sparring: walk up to the ink shadow and trade strokes with it
  spar(t, player, cam, inp) {
    once(player, 's', () => { place(player, ...START); player.setForm(0); player.burst = 0; });
    const e = player.foe.p, dx = e[0] - player.p[0], dz = e[2] - player.p[2], d = Math.hypot(dx, dz);
    let a = Math.atan2(dx, dz) + .5 - cam.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
    cam.yaw += a * Math.min(1, 2.5 / 60); cam.pitch = -.2;
    inp.z = d > 3 ? 1 : 0; inp.x = d > 3 ? .45 : 0;
    const tell = player.foe.windup, turn = Math.floor(t / 3.2) % 3; // answer each raised sword a different way
    inp.guard = tell > .62 && turn === 0; inp.dodge = tell > .85 && turn === 1; if (inp.dodge) inp.x = 1;
    inp.act = d < 3.9 && player.foe.alive && !inp.guard && (t * 1.25) % 1 < .15;
  },
  // Three separate presses against the first forest guard, then leave its defeat in view.
  combo(t, player, cam, inp) {
    const [x, z] = DUEL_CLEARING.center;
    once(player, 's', () => {
      place(player, ...DUEL_CLEARING.entry);
      player.setForm(0);
      player.yaw = Math.atan2(x - player.p[0], z - player.p[2]);
      player.burst = 0;
    });
    cam.yaw = Math.atan2(x - player.p[0], z - player.p[2]);
    const floor = height(x, z);
    cam.fixed = { pos: [x + 5.2, floor + 4.7, z + 5.6], look: [x + .55, floor + 1.0, z + 1.1] };
    const press = at => t >= at && t < at + .075;
    inp.act = press(.96) || press(1.20) || press(1.47);
  },
  // the giant, seen plainly: pass ?boss, and switch the fog off with --set='{"clear":true}'. The camera walks round it
  oni(t, player, cam, inp) {
    once(player, 's', () => { place(player, .3, -14.5); player.setForm(0); player.burst = 0; player.yaw = Math.PI; });
    const g = player.boss, a = t < 4 ? 0 : t < 8 ? -.78 : t < 12 ? -1.57 : -1.57 - (t - 12) * .5, c = g.p;
    if (t < 16) g.think = 9; // it stands and breathes while we look
    cam.fixed = { pos: [c[0] + Math.sin(a) * 16, c[1] + 5.4, c[2] + Math.cos(a) * 16], look: [c[0], c[1] + 5.4, c[2]] };
  },
  // the bout: walk in, wake it, keep moving, jump the rings, step out from under the hand and cut it while it lies there
  boss(t, player, cam, inp) {
    once(player, 's', () => { place(player, 3.6, -3.8); player.setForm(0); player.burst = 0; player.yaw = Math.PI; cam.yaw = Math.PI - .16; });
    const g = player.boss, dx = g.p[0] - player.p[0], dz = g.p[2] - player.p[2], d = Math.hypot(dx, dz);
    let a = Math.atan2(dx, dz) + (g.awake ? .5 : 0) - cam.yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); cam.yaw += a * Math.min(1, 2.5 / 60); cam.pitch = -.3;
    inp.x = 0; inp.z = 0; inp.up = 0; inp.dodge = false; inp.act = false;
    if (g.mode === 'sleep' || g.mode === 'rise') inp.z = d > 9.5 ? 1 : 0;
    else if (g.planted) { // the hand is down: run to it and cut
      const h = g.parts[g.side > 0 ? 'handL' : 'handR'], hx = h[0] - player.p[0], hz = h[2] - player.p[2], hd = Math.hypot(hx, hz), F = [Math.sin(cam.yaw), Math.cos(cam.yaw)];
      inp.z = hd > 3 ? (hx * F[0] + hz * F[1]) / hd : 0; inp.x = hd > 3 ? (hx * -F[1] + hz * F[0]) / hd : 0; inp.act = hd < 3.9 && (t * 1.6) % 1 < .2;
    } else {
      inp.z = d > 6 ? 1 : d < 4.6 ? -1 : 0;
      if (g.mode === 'slam' && g.wind > .55 && g.fall < 1) { inp.x = g.side; inp.dodge = g.wind > .95 && g.fall < .1; }   // out from under the hand
      if (g.ring) { const rd = Math.hypot(player.p[0] - g.ring.at[0], player.p[2] - g.ring.at[2]); inp.up = rd - g.ring.r < 3.2 && rd > g.ring.r ? 1 : 0; } // over the ring
    }
  },
  // the same bout with a player who only walks up and stands there: checks that the ring and the palm hurt, and the fall and the return
  stand(t, player, cam, inp) {
    once(player, 's', () => { place(player, .2, -15); player.setForm(0); player.burst = 0; player.yaw = Math.PI; });
    const g = player.boss; cam.yaw = Math.atan2(g.p[0] - player.p[0], g.p[2] - player.p[2]); cam.pitch = -.3;
    inp.x = inp.up = 0; inp.z = Math.hypot(g.p[0] - player.p[0], g.p[2] - player.p[2]) > 5.5 ? 1 : 0; inp.act = inp.dodge = inp.guard = false;
  },
  // the whole slice in one run: the four shadows along the path, then on to the giant. For checking the full flow
  journey(t, player, cam, inp) {
    if (player.foe.mode !== 'done') return DEMOS.spar(t, player, cam, inp);
    inp.guard = false; DEMOS.boss(t, player, cam, inp);
  },
  // stand in the reeds and swing the camera round fast, both ways: for checking that the smoke layers keep their place
  spin(t, player, cam, inp) {
    once(player, 's', () => { place(player, .8, 8); player.setForm(0); player.burst = 0; cam.yaw = Math.PI; player.foe.n = player.foe.total; player.foe.spawn(); });
    inp.x = inp.z = inp.up = 0; inp.act = inp.dodge = inp.guard = false;
    cam.yaw = Math.PI + 1.6 * Math.sin(t * 2.4) * Math.min(1, t / 1.5); cam.pitch = -.3 + .25 * Math.sin(t * 1.7);
  },
  // Every move of the swordsman in turn (MOVE_SEQ), in the first clearing with the shadows sent away. For looking at
  // motion: add --set='{"clear":true}' to see it without fog. Blows are dealt by hand here, without cost to health.
  moves(t, player, cam, inp) {
    const [cx, cz] = DUEL_CLEARING.center, p = player.p, mark = [cx + .3, cz];
    once(player, 's', () => { place(player, cx - 3, cz); player.setForm(0); player.burst = 0; player.yaw = Math.PI / 2; player.foe.n = player.foe.total; player.foe.spawn(); player.home = [...mark]; });
    const go = (x, z, k = 1) => { const l = Math.hypot(x, z) || 1; inp.x = -x / l * k; inp.z = z / l * k; };   // the camera's yaw is 0: forward is +z, the x key axis points to -x
    const to = (pt, k) => { const d = Math.hypot(pt[0] - p[0], pt[1] - p[2]); if (d > .25) go(pt[0] - p[0], pt[1] - p[2], Math.min(k, d * .8 + .2)); };
    const front = d => [p[0] + Math.sin(player.yaw) * d, p[1], p[2] + Math.cos(player.yaw) * d], side = () => [p[0] + Math.cos(player.yaw) * 2, p[1], p[2] - Math.sin(player.yaw) * 2];
    const back = k => { player.v[0] -= Math.sin(player.yaw) * k; player.v[2] -= Math.cos(player.yaw) * k; };
    const each = {
      run: () => go(1, 0), circle: () => { const a = Math.atan2(p[2] - cz, p[0] - cx) + 1.9; go(Math.cos(a), Math.sin(a)); }, walk: () => to(mark, .42),
      home: () => to(mark, 1), face: () => go(1, 0, .12), jump: () => { inp.up = 1; }, runjump: () => { go(1, 0); inp.up = 1; },
      guard: () => { inp.guard = true; }, guardback: () => { inp.guard = true; go(-1, 0); }, block: () => { inp.guard = true; }, parry: () => { inp.guard = true; },
      hop: () => { inp.dodge = true; }, roll: () => { inp.dodge = true; go(1, 0); }, cut: () => { inp.act = true; }, stab: () => { inp.up = 1; inp.act = true; },
    };
    const first = {
      block: () => { player.blockT = .25; back(4); }, parry: () => { player.parryT = .32; },
      hitfront: () => player.hurt(1, front(2), 0, 2.5), hitside: () => player.hurt(1, side(), 0, 2.5), hitheavy: () => player.hurt(2, front(2), 0, 4),
      thrown: () => player.hurt(3, front(2), 0, 5), death: () => player.hurt(1, front(2), 99, 2),
    };
    inp.x = inp.z = inp.up = 0; inp.act = inp.dodge = inp.guard = false; cam.yaw = 0;
    const lift = Math.max(0, p[1] - height(p[0], p[2])) * .7;
    cam.fixed = { pos: [p[0], height(cx, cz) + 1.25 + lift, p[2] + 4.3], look: [p[0], height(cx, cz) + 1.0 + lift, p[2]] };   // from the side, close, moving with the figure
    let clock = 0;
    for (let i = 0; i < MOVE_SEQ.length; i++) {
      const [name, d] = MOVE_SEQ[i];
      if (t < clock + d) { each[name]?.(); if (first[name]) once(player, 'm' + i, first[name]); player.demoStep = name; break; }
      clock += d;
    }
  },
  // The three changes of form, each out of its move and back with its blow (SHIFT_SEQ), then one flight held until the ink
  // runs out. In the first clearing with the shadows sent away; the camera stands off to one side.
  shift(t, player, cam, inp) {
    const [cx, cz] = DUEL_CLEARING.center, p = player.p, mark = [cx - 2.2, cz];
    once(player, 's', () => { place(player, ...mark); player.setForm(0); player.burst = 0; player.yaw = Math.PI / 2; player.foe.n = player.foe.total; player.foe.spawn(); player.home = [...mark]; });
    const go = (x, z, k = 1) => { const l = Math.hypot(x, z) || 1; inp.x = -x / l * k; inp.z = z / l * k; };
    const to = (pt, k) => { const d = Math.hypot(pt[0] - p[0], pt[1] - p[2]); if (d > .25) go(pt[0] - p[0], pt[1] - p[2], Math.min(k, d * .8 + .2)); };
    const round = () => { const a = Math.atan2(p[2] - cz, p[0] - cx) + .7; go(cx + 3.1 * Math.cos(a) - p[0], cz + 3.1 * Math.sin(a) - p[2]); };   // circle the clearing, 3.1 m out
    const each = {
      run: () => go(1, 0), home: () => to(mark, 1), face: () => go(1, 0, .12), jump: () => { go(1, 0); inp.up = 1; }, fly: () => { round(); inp.up = p[1] - height(p[0], p[2]) < 3.2 ? 1 : 0; },
      glide: () => round(), cut: () => { inp.act = true; }, roll: () => { inp.dodge = true; go(1, 0); }, gallop: () => { round(); inp.x *= .5; inp.z *= .5; }, guard: () => { inp.guard = true; }, swim: () => round(),
      soar: () => { round(); inp.up = p[1] - height(p[0], p[2]) < 5 ? 1 : 0; },
    };
    inp.x = inp.z = inp.up = 0; inp.act = inp.dodge = inp.guard = false; cam.yaw = 0;
    const lift = Math.max(0, p[1] - height(p[0], p[2])) * .6;
    cam.fixed = { pos: [cx + (p[0] - cx) * .3, height(cx, cz) + 1.6 + lift, cz + 8.6], look: [p[0], height(cx, cz) + 1.0 + lift, p[2]] };
    let clock = 0;
    for (const [name, d] of SHIFT_SEQ) { if (t < clock + d) { each[name]?.(); player.demoStep = name; break; } clock += d; }
  },
  // defence only: stand and answer each raised sword, guarding early, guarding late (a parry), or dodging aside
  ward(t, player, cam, inp) {
    once(player, 's', () => { place(player, 2, 12); player.setForm(0); player.burst = 0; player.n = 0; player.was = 0; });
    const e = player.foe.p, tell = player.foe.windup; cam.yaw = Math.atan2(e[0] - player.p[0], e[2] - player.p[2]); cam.pitch = -.25;
    if (tell > 0 && player.was === 0) player.n++; player.was = tell;
    const turn = player.n % 3, striking = player.foe.actT >= 0;
    inp.guard = turn === 0 ? tell > .3 || striking : turn === 1 ? tell > .93 || striking : false;
    inp.dodge = turn === 2 && player.foe.actT > .05; inp.x = inp.dodge ? 1 : 0; inp.z = 0; inp.act = false;
  },
};
