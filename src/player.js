// The fighters. The player is one body with four forms; each form moves differently and pushes on the fog differently.
// The enemy is an ink shadow of the swordsman that closes in, shows its strike before it comes, and can be cut down.
import { height, SIZE, FOG_TOP } from './world.js';

export const FORMS = ['人 斬', '虎 吼', '鶴 翼', '鯉 游'];
const SPEED = [5.5, 12, 11, 7.5], ACT = [0.36, 0.35, 0.7, 0.5], COOL = [0.62, 1.4, 0.9, 1.2];
// a stroke is not even: it gathers (first 35 % of the time, 8 % of the arc), snaps (next 25 %, 80 % of the arc), then trails off
export const swing = t => t < .35 ? .08 * (t / .35) ** 2 : t < .6 ? .08 + .8 * (t - .35) / .25 : 1 - .12 * (1 - (t - .6) / .4) ** 2;
const swingRate = t => t < .35 ? .2 : t < .6 ? 3.2 : .4;
export const HP = 5;
const BURST = 0.32, SHAKE = [.14, .7, .16, .1];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// the sword during a stroke (t 0..1): where the blade is and how fast it sweeps
function bladeAt(p, v, yaw, side, t, dur) {
  const e = swing(t), ang = yaw + side * (-1.25 + 2.5 * e), w = side * 2.5 / dur * swingRate(t), U = [0, 1, 0];
  const D = [Math.sin(ang), 0, Math.cos(ang)], hand = add(p, U, 1.25 + .4 * side * (.5 - e));
  return { a: add(hand, D, .7), b: add(add(hand, D, 3.1), U, side * (e - .5) * 1.2), snap: t >= .35 && t < .6, vel: add(v, [Math.cos(ang) * w * 2.2, 5, -Math.sin(ang) * w * 2.2]) }; // swept sideways and thrown up
}
// the blade sweeps fog out of its path; it leaves only a trace of ink, so a stroke reads as fog being parted
const bladeEmitters = bl => [{ a: bl.a, b: bl.b, r: bl.snap ? 1.8 : 1.0, v: bl.vel, drag: bl.snap ? 90 : 30 }]; // no ink and no fog removed: the fog is only moved
// walk with walls: anything rising faster than a step blocks, one axis at a time
function walk(p, v, dt, step) {
  for (const a of [0, 2]) {
    const q = [p[0], p[1], p[2]]; q[a] += v[a] * dt;
    if (Math.abs(q[a]) < SIZE / 2 - 2.5 && height(q[0], q[2]) - p[1] < step) p[a] = q[a]; else v[a] = 0;
  }
}

export class Player {
  constructor() {
    this.p = [0, 0, 13]; this.p[1] = height(0, 13);
    this.v = [0, 0, 0]; this.yaw = Math.PI; this.form = 0;
    this.act = 0; this.cool = 0; this.side = 1; this.ground = true; this.phase = 0; this.burst = 0; this.shake = 0; this.t = 0; this.stagger = 0; this.hit = false;
    this.hp = HP; this.dodge = 0; this.dodgeCool = 0; this.guard = false; this.guardT = 0; this.fallen = 0; this.dv = [0, 0];
  }
  setForm(f) { if (f !== this.form) { this.form = f; this.act = 0; this.burst = BURST; this.shake = .25; } } // momentum carries over
  get actT() { return this.act > 0 ? 1 - this.act / ACT[this.form] : -1; }
  get burstT() { return this.burst / BURST; }

  // inp: { x, z (-1..1 move), up, down, act }, cam: { yaw, pitch }, foe: position of an enemy to face when striking, or null
  update(dt, inp, cam, foe) {
    const { p, v } = this, f = this.form;
    if (this.fallen > 0) { // cut down: scattered as ink, then back at the start
      this.fallen -= dt; v[0] = v[2] = 0;
      if (this.fallen <= 0) { p[0] = 0; p[2] = 13; p[1] = height(0, 13); this.hp = HP; this.burst = BURST; this.stagger = 0; }
      return;
    }
    const F = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)], R = [-F[2], 0, F[0]];
    let d = [F[0] * inp.z + R[0] * inp.x, 0, F[2] * inp.z + R[2] * inp.x];
    const len = Math.hypot(d[0], d[2]);
    if (len > 1) d = [d[0] / len, 0, d[2] / len];
    this.guard = !!inp.guard && f === 0 && this.act <= 0 && this.stagger <= 0 && this.dodge <= 0; this.guardT = this.guard ? this.guardT + dt : 0;
    if (this.guard && foe && Math.hypot(foe[0] - p[0], foe[2] - p[2]) < 7) this.yaw += wrap(Math.atan2(foe[0] - p[0], foe[2] - p[2]) - this.yaw) * Math.min(1, 16 * dt); // a guard faces the threat
    const slow = (f === 3 && this.act > 0 ? 2 : 1) * (this.stagger > 0 ? .25 : 1) * (f === 0 && this.act > 0 ? .35 : 1) * (this.guard ? .3 : 1);
    const flying = f === 2, swimming = f === 3 && p[1] < FOG_TOP - .3;
    const k = Math.min(1, (flying || swimming ? 3.5 : this.ground ? 10 : 2) * dt);
    v[0] += (d[0] * SPEED[f] * slow - v[0]) * k; v[2] += (d[2] * SPEED[f] * slow - v[2]) * k;
    // dodge: a short dash the way we are moving (or straight back), untouchable while it lasts
    this.dodgeCool -= dt;
    if (inp.dodge && f < 2 && this.dodge <= 0 && this.dodgeCool <= 0 && this.stagger <= 0) {
      this.dodge = .28; this.dodgeCool = .75; this.act = 0;
      this.dv = len > .1 ? [d[0] / Math.max(len, 1), d[2] / Math.max(len, 1)] : [-Math.sin(this.yaw), -Math.cos(this.yaw)];
      const l = Math.hypot(this.dv[0], this.dv[1]) || 1; this.dv = [this.dv[0] / l, this.dv[1] / l];
    }
    if (this.dodge > 0) { this.dodge -= dt; v[0] = this.dv[0] * 13; v[2] = this.dv[1] * 13; }
    if (flying || swimming) {
      const vy = (inp.up - inp.down) * (flying ? 6 : 4) + (swimming ? Math.sin(cam.pitch) * inp.z * SPEED[f] : 0);
      v[1] += (vy - v[1]) * Math.min(1, 4 * dt);
    } else {
      v[1] -= 22 * dt;
      if (this.ground && inp.up) { v[1] = f === 1 ? 10 : 8; this.ground = false; }
    }
    walk(p, v, dt, flying || swimming ? 0.2 : 0.7);
    p[1] += v[1] * dt;
    const gh = height(p[0], p[2]) + (flying ? .7 : swimming ? .5 : 0);
    this.ground = false;
    if (p[1] <= gh) { p[1] = gh; if (v[1] < 0) v[1] = 0; this.ground = !flying && !swimming; }
    if (flying) p[1] = Math.min(p[1], 8);
    if (swimming) p[1] = Math.min(p[1], FOG_TOP - .3);
    const sp = Math.hypot(v[0], v[2]);
    if (sp > .4 && this.act <= 0 && !this.guard) this.yaw += wrap(Math.atan2(v[0], v[2]) - this.yaw) * Math.min(1, 12 * dt); // face the way we move
    this.phase += dt * (2 + sp);
    this.cool -= dt; this.stagger = Math.max(0, this.stagger - dt);
    if (f === 0 && this.actT >= .33 && !this.lunged) { this.lunged = true; v[0] += Math.sin(this.yaw) * 7; v[2] += Math.cos(this.yaw) * 7; this.shake = Math.max(this.shake, .3); } // the body goes in with the cut
    if (this.act > 0) this.act -= dt;
    else if (inp.act && this.cool <= 0 && this.stagger <= 0 && !this.guard && this.dodge <= 0) {
      this.act = ACT[f]; this.cool = COOL[f]; this.side = -this.side; this.shake = SHAKE[f]; this.hit = false; this.lunged = false;
      if (f === 0 && foe && Math.hypot(foe[0] - p[0], foe[2] - p[2]) < 7) this.yaw = Math.atan2(foe[0] - p[0], foe[2] - p[2]); // turn into the stroke
    }
    this.burst = Math.max(0, this.burst - dt); this.t += dt;
  }

  blade() { const t = this.actT; return this.form === 0 && t >= 0 ? bladeAt(this.p, this.v, this.yaw, this.side, t, ACT[0]) : null; }

  // what this body does to the fluid this step
  emitters() {
    const { p, v, form: f, yaw } = this;
    const F = [Math.sin(yaw), 0, Math.cos(yaw)], R = [-F[2], 0, F[0]], U = [0, 1, 0];
    const t = this.actT, e = [];
    if (f === 0) {
      // a solid body the fog must flow around, and a wider push that thins the fog along its path: the wake
      e.push({ a: add(p, U, .6), b: add(p, U, 1.5), r: .45, v, solid: true });
      e.push({ a: add(p, U, .4), b: add(p, U, 1.6), r: this.dodge > 0 ? 1.6 : 1.1, v, drag: this.dodge > 0 ? 30 : 10 });
      const bl = this.blade(); if (bl) e.push(...bladeEmitters(bl));
    } else if (f === 1) {
      e.push({ a: add(add(p, U, .85), F, -.7), b: add(add(p, U, .85), F, .8), r: .5, v, solid: true });
      e.push({ a: add(add(p, U, .8), F, -.8), b: add(add(p, U, .8), F, .9), r: 1.3, v, drag: 12 });
      if (t >= 0) e.push({ a: add(add(p, U, 1), F, 1.2), r: 5, div: 11 * Math.sin(Math.PI * t) }); // a roar: air expanding
    } else if (f === 2) {
      const down = t >= 0 ? -20 : -7;
      e.push({ a: add(add(p, R, -1.6), U, -.7), b: add(add(p, R, 1.6), U, -.7), r: 1.9, v: add(v, [0, down, 0]), drag: t >= 0 ? 18 : 9 });
    } else {
      e.push({ a: add(p, F, -1), b: add(p, F, .9), r: .75, v, solid: true }); // a body the fog has to go around
      e.push({ a: add(p, F, -1.5), r: .4, ink: 3 });
    }
    // changing form: the body bursts into ink
    if (this.burst > 0) { const k = Math.sin(Math.PI * this.burstT); e.push({ a: add(p, U, f < 2 ? 1 : 0), r: 1.1, ink: 3.5 * k, div: 5 * k }); }
    // slow gusts circling the player keep the whole fog surface rolling
    for (let i = 0; i < 2; i++) {
      const a = this.t * .13 + i * 3.3, b = this.t * .31 + i * 1.9;
      e.push({ a: [p[0] + Math.cos(a) * 8, 2.3, p[2] + Math.sin(a) * 8], r: 6.5, v: [Math.cos(b) * 2.6, .5 * Math.sin(b * 1.7), Math.sin(b) * 2.6], drag: 1.1 });
    }
    return e;
  }
}

const SPOTS = [[7, 15], [-5, 16], [4, 3], [-7, 8], [11, 8]];
const WIND = 0.55, STRIKE = 0.34;

export class Enemy {
  constructor() { this.n = 0; this.spawn(); }
  spawn() {
    const [x, z] = SPOTS[this.n++ % SPOTS.length];
    this.p = [x, height(x, z), z]; this.v = [0, 0, 0]; this.yaw = 0; this.hp = 3; this.mode = 'rise'; this.clock = 0; this.side = 1; this.stagger = 0; this.phase = 0; this.t = 0; this.hit = false; this.orbit = 1;
  }
  get alive() { return this.mode !== 'fall' && this.mode !== 'gone' && this.mode !== 'rise'; }
  get windup() { return this.mode === 'wind' ? this.clock / WIND : 0; }
  get actT() { return this.mode === 'strike' ? Math.min(1, this.clock / STRIKE) : -1; }
  get fallT() { return this.mode === 'fall' ? Math.min(1, this.clock / .45) : 0; }                                  // toppling backwards
  get meltT() { return this.mode === 'fall' ? Math.max(0, Math.min(1, (this.clock - .55) / 1.15)) : 0; }           // lying, running out into ink
  get fade() { return this.mode === 'rise' ? 1 - Math.min(1, this.clock / .8) : this.mode === 'gone' ? 1 : 0; }
  go(mode) { this.mode = mode; this.clock = 0; }
  hurt(from, power = 1) { // returns true when this blow finishes it
    this.hp -= power; this.stagger = .5;
    const d = [this.p[0] - from[0], this.p[2] - from[2]], l = Math.hypot(d[0], d[1]) || 1;
    this.v[0] = d[0] / l * 7; this.v[2] = d[1] / l * 7;
    this.go(this.hp <= 0 ? 'fall' : 'reel'); return this.hp <= 0;
  }
  update(dt, pl) {
    const { p, v } = this; this.clock += dt; this.t += dt; this.stagger = Math.max(0, this.stagger - dt);
    const dx = pl[0] - p[0], dz = pl[2] - p[2], dist = Math.hypot(dx, dz) || 1, to = Math.atan2(dx, dz);
    let want = [0, 0];
    if (this.mode === 'gone') { if (this.clock > 2.2) { this.spawn(); } return; }
    if (this.mode === 'rise') { if (this.clock > .8) this.go('stalk'); }
    else if (this.mode === 'fall') { if (this.clock > 1.75) this.go('gone'); }
    else if (this.mode === 'reel') { if (this.clock > .5) this.go('stalk'); }
    else if (this.mode === 'stalk') { // close in, then circle at sword's reach until ready
      const tang = [dz / dist * this.orbit, -dx / dist * this.orbit], rad = dist - 2.9;
      want = [dx / dist * Math.max(-1, Math.min(1, rad)) * 3.4 + tang[0] * 1.3, dz / dist * Math.max(-1, Math.min(1, rad)) * 3.4 + tang[1] * 1.3];
      if (this.clock > 1.1 && dist < 3.5) { this.go('wind'); this.side = -this.side; this.orbit = -this.orbit; }
    } else if (this.mode === 'wind') { if (this.clock > WIND) { this.go('strike'); this.hit = false; } }
    else if (this.mode === 'strike') { want = [dx / dist * 3, dz / dist * 3]; if (this.clock > STRIKE) this.go('rest'); }
    else if (this.mode === 'rest') { if (this.clock > .55) this.go('stalk'); }
    const k = Math.min(1, (this.mode === 'reel' || this.mode === 'fall' ? 3 : 9) * dt);
    v[0] += (want[0] - v[0]) * k; v[2] += (want[1] - v[2]) * k;
    walk(p, v, dt, .7); p[1] = height(p[0], p[2]);
    if (this.mode !== 'strike') this.yaw += wrap(to - this.yaw) * Math.min(1, 9 * dt);
    this.phase += dt * (2 + Math.hypot(v[0], v[2]));
  }
  blade() { const t = this.actT; return t >= 0 ? bladeAt(this.p, this.v, this.yaw, this.side, t, STRIKE) : null; }
  emitters() {
    if (this.mode === 'gone') return [];
    const U = [0, 1, 0], sp = Math.hypot(this.v[0], this.v[2]);
    if (this.mode === 'fall') { // the body on the ground bleeds ink along its length
      const back = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)], k = Math.sin(Math.PI * this.meltT);
      return [{ a: add(this.p, U, .3), b: add(add(this.p, back, 1.7), U, .3), r: .85, ink: 4 * k, div: 2.5 * k, v: this.v, drag: 4 }];
    }
    const e = [{ a: add(this.p, U, .6), b: add(this.p, U, 1.5), r: .45, v: this.v, solid: true },
      { a: add(this.p, U, .4), b: add(this.p, U, 1.6), r: 1.1, v: this.v, drag: 10, ink: this.mode === 'rise' ? 1.5 : 0 }];
    const bl = this.blade(); if (bl) e.push(...bladeEmitters(bl));
    return e;
  }
}

// Who hit whom this step. Returns events for the caller to turn into ink, shake and score.
export function spar(pl, en) {
  const ev = [], d = Math.hypot(en.p[0] - pl.p[0], en.p[2] - pl.p[2]), mid = [(pl.p[0] + en.p[0]) / 2, pl.p[1] + 1.3, (pl.p[2] + en.p[2]) / 2];
  const inArc = (a, b) => Math.abs(wrap(Math.atan2(b.p[0] - a.p[0], b.p[2] - a.p[2]) - a.yaw)) < 1.35;
  const pt = pl.actT, et = en.actT;
  if (!en.alive) return ev;
  if (pl.form === 0 && pt > .38 && pt < .7 && !pl.hit && d < 3.9 && inArc(pl, en)) {
    pl.hit = true;
    if (et >= 0 && !en.hit) { en.hit = true; en.go('reel'); en.stagger = .3; pl.stagger = .2; ev.push({ kind: 'clash', at: mid }); } // steel on steel
    else ev.push({ kind: en.hurt(pl.p) ? 'kill' : 'cut', at: [en.p[0], en.p[1] + 1.2, en.p[2]] });
  }
  if (pl.form === 1 && pt > .2 && pt < .5 && !pl.hit && d < 6) { pl.hit = true; ev.push({ kind: en.hurt(pl.p, .5) ? 'kill' : 'push', at: [en.p[0], en.p[1] + 1.2, en.p[2]] }); }
  if (et > .38 && et < .75 && !en.hit && d < 3.6 && inArc(en, pl) && pl.burst <= 0 && pl.form < 2 && pl.fallen <= 0) {
    en.hit = true;
    const l = d || 1, back = k => { pl.v[0] = (pl.p[0] - en.p[0]) / l * k; pl.v[2] = (pl.p[2] - en.p[2]) / l * k; };
    if (pl.dodge > 0) ev.push({ kind: 'dodge', at: mid });
    else if (pl.guard && inArc(pl, en)) {
      if (pl.guardT < .25) { en.go('reel'); en.stagger = .8; ev.push({ kind: 'parry', at: mid }); } // raised just in time: the shadow is thrown open
      else { back(4); ev.push({ kind: 'block', at: mid }); }
    } else {
      pl.hp--; pl.stagger = .45; back(7);
      if (pl.hp <= 0) pl.fallen = 1.8;
      ev.push({ kind: pl.hp <= 0 ? 'down' : 'taken', at: [pl.p[0], pl.p[1] + 1.2, pl.p[2]] });
    }
  }
  return ev;
}
