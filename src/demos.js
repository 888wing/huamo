// Scripted runs for repeatable captures: each sets the player's form and input over time and may pin the camera.
import { height } from './world.js';

const place = (player, x, z, y) => { player.p[0] = x; player.p[2] = z; player.p[1] = y ?? height(x, z); player.v.fill(0); };
const once = (player, key, fn) => { if (!player['_' + key]) { player['_' + key] = true; fn(); } };

export const DEMOS = {
  // a sword stroke through standing fog, seen from above the shoulder
  slash(t, player, cam, inp) {
    once(player, 's', () => { place(player, 0, 14); player.setForm(0); player.yaw = Math.PI; });
    cam.fixed = { pos: [3.4, 5.4, 20], look: [0, 1.2, 12.5] };
    inp.act = (t > .5 && t < .6) || (t > 1.6 && t < 1.7) || (t > 2.7 && t < 2.8);
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
    once(player, 's', () => { place(player, 1.5, 19); player.setForm(0); player.burst = 0; });
    const e = player.foe.p, dx = e[0] - player.p[0], dz = e[2] - player.p[2], d = Math.hypot(dx, dz);
    let a = Math.atan2(dx, dz) + .5 - cam.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
    cam.yaw += a * Math.min(1, 2.5 / 60); cam.pitch = -.2;
    inp.z = d > 3 ? 1 : 0; inp.x = d > 3 ? .45 : 0;
    const tell = player.foe.windup, turn = Math.floor(t / 3.2) % 3; // answer each raised sword a different way
    inp.guard = tell > .62 && turn === 0; inp.dodge = tell > .85 && turn === 1; if (inp.dodge) inp.x = 1;
    inp.act = d < 3.9 && player.foe.alive && !inp.guard && (t * 1.25) % 1 < .15;
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
