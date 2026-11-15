// 巨相撲鬼: what the giant does. It waits in a wrestler's crouch at the path's end, rises when the four shadows are down,
// and then fights like a wrestler: it stamps (a ring runs out through the fog and the reeds) and it throws its whole
// weight down behind an open hand. No three.js in here; the rig in giant.js reads the numbers and reports back where
// the hands and feet really are.
import { height, ARENA } from './world.js';

export const GH = 10.5; // metres tall
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), cl = x => Math.min(1, Math.max(0, x)), ease = x => { x = cl(x); return x * x * (3 - 2 * x); };
// stamp: raise the leg, hold it, bring it down, settle. slam: raise the arm, strike, lie on the hand, get up
const S_UP = .85, S_HOLD = .32, S_DROP = .13, S_SET = 1.0, M_UP = 1.05, M_HIT = .2, M_LIE = 1.7, M_BACK = 1.1;
const REACH = [4.0, 5.6];

export class Giant {
  constructor() {
    const [x, z] = ARENA.home;
    this.p = [x, height(x, z), z]; this.yaw = 0; this.mode = 'sleep'; this.clock = 0; this.time = 0; this.side = 1; this.walk = 0; this.walkAmt = 0;
    this.crouch = 1; this.lift = 0; this.squat = 0; this.wind = 0; this.down = 0; this.fall = 0; this.ik = 0; this.flinch = 0; this.roar = 0; this.glow = 0; this.fast = false;
    this.target = [x, this.p[1], z + 5]; this.ring = null; this.parts = null; this.prev = null; this.vel = {}; this.seed = 7; this.think = 1; this.count = 0; this.done = false;
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  get awake() { return this.mode !== 'sleep'; }
  get planted() { return this.mode === 'slam' && this.clock > M_UP + M_HIT && this.clock < M_UP + M_HIT + M_LIE + M_BACK * .35; }
  go(mode) { this.mode = mode; this.clock = 0; this.done = false; }
  rest(t) { this.go('idle'); this.think = t; this.lift = this.squat = this.wind = this.down = this.fall = this.ik = 0; this.fast = false; }

  // pl: the player. ready: the four shadows are down. Returns what happened: [{ kind, at }]
  update(dt, pl, ready) {
    const ev = [], { p } = this, P = this.parts; this.clock += dt; this.time += dt; const c = this.clock;
    // how fast each part moved, for the fog
    if (P && dt > 0) { for (const k in P) { const a = P[k], b = this.prev?.[k] ?? a; this.vel[k] = [0, 1, 2].map(i => Math.max(-30, Math.min(30, (a[i] - b[i]) / dt))); } this.prev = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, [...v]])); }
    const dx = pl.p[0] - p[0], dz = pl.p[2] - p[2], d = Math.hypot(dx, dz), to = Math.atan2(dx, dz), off = wrap(to - this.yaw);
    const turn = rate => { this.yaw += Math.max(-rate * dt, Math.min(rate * dt, off)); };
    this.flinch = Math.max(0, this.flinch - dt * 2);
    if (this.mode === 'sleep') { if (ready && d < 12.5) { this.go('rise'); ev.push({ kind: 'wake', at: [...p] }); } }
    else if (this.mode === 'rise') { // unfolds from the crouch, throws its head back, then stamps once before the bout
      this.crouch = 1 - ease(c / 2.4); this.glow = cl(c / .6); this.roar = Math.sin(Math.PI * cl((c - 1.5) / 1.6)); turn(.5);
      if (c > 1.9 && !this.done) { this.done = true; ev.push({ kind: 'roar', at: P?.head ?? [...p] }); }
      if (c > 3.2) { this.roar = 0; this.go('stomp'); this.side = 1; }
    } else if (this.mode === 'idle') {
      turn(1.1); this.think -= dt;
      if (this.think <= 0 && pl.fallen <= 0) {
        const r = this.rnd(), far = Math.hypot(p[0] - ARENA.home[0], p[2] - ARENA.home[1]), facing = Math.abs(off) < .45;
        this.side = -this.side;
        if (d > 17) this.think = .5;                                             // out of reach: it only watches
        else if (!facing) this.think = .12;
        else if (d < 3.3) this.go('stomp');                                      // underfoot
        else if (d <= 6.6) this.go(r < .7 ? 'slam' : 'stomp');
        else if (d > 8.5 && far < 2.4 && r < .55) this.go('step');
        else this.go('stomp');
        if (this.mode === 'slam') this.side = off > 0 ? 1 : -1;                  // the hand on the player's side
      }
    } else if (this.mode === 'step') { // one heavy pace towards the player
      const k = c / 1.25; this.walkAmt = Math.sin(Math.PI * cl(k)); this.walk += Math.PI * dt / 1.25;
      const sp = 2.3 / 1.25 * 1.57 * Math.sin(Math.PI * cl(k)); p[0] += Math.sin(this.yaw) * sp * dt; p[2] += Math.cos(this.yaw) * sp * dt; p[1] = height(p[0], p[2]); turn(.6);
      if (k >= 1) { this.walkAmt = 0; ev.push({ kind: 'step', at: P ? [...P[Math.sin(this.walk) > 0 ? 'footR' : 'footL']] : [...p] }); this.rest(.5 + this.rnd() * .5); }
    } else if (this.mode === 'stomp') {
      this.fast = c > S_UP + S_HOLD;
      this.lift = c < S_UP ? ease(c / S_UP) : c < S_UP + S_HOLD ? 1 : Math.max(0, 1 - ((c - S_UP - S_HOLD) / S_DROP) ** 2);
      if (c < S_UP) turn(.5);
      const land = S_UP + S_HOLD + S_DROP + .05;
      if (c >= land && !this.done) {
        this.done = true; const at = P ? [...P[this.side > 0 ? 'footL' : 'footR']] : [...p]; at[1] = height(at[0], at[2]);
        this.ring = { at, r: 0, t: 0, hit: false }; ev.push({ kind: 'stomp', at });
      }
      this.squat = c >= land ? 1 - ease((c - land) / S_SET) : 0;
      if (c > land + S_SET) this.rest(.7 + this.rnd() * .7);
    } else if (this.mode === 'slam') {
      const k1 = c / M_UP, k2 = (c - M_UP) / M_HIT, k3 = (c - M_UP - M_HIT - M_LIE) / M_BACK;
      this.fast = k2 > 0 && k2 < 3.5; // the body follows the hand down at once
      if (k1 < .72) { // until late in the wind-up the hand is still being aimed
        turn(1.3);
        const a = this.yaw + Math.max(-.55, Math.min(.55, off)) + this.side * .1, r = Math.max(REACH[0], Math.min(REACH[1], d));
        const x = p[0] + Math.sin(a) * r, z = p[2] + Math.cos(a) * r; this.target = [x, height(x, z), z];
      }
      this.wind = k2 > 0 ? Math.max(0, 1 - k2 * 2) : ease(k1); this.fall = k2 <= 0 ? 0 : cl(k2) ** 2; this.down = k3 > 0 ? 1 - ease(k3) : this.fall; this.ik = k2 <= 0 ? 0 : k3 > 0 ? 1 - ease(k3 * 1.7) : cl(k2 * 2.5);
      if (k2 >= 1 && !this.done) {
        this.done = true; ev.push({ kind: 'slam', at: [...this.target] });
        const t = this.target, hd = Math.hypot(pl.p[0] - t[0], pl.p[2] - t[2]);
        if (hd < 2.7 && pl.p[1] - t[1] < 3.2 && this.canHurt(pl)) this.hurt(pl, t, 2, 12, ev);
      }
      if (k3 >= 1) this.rest(.6 + this.rnd() * .6);
    }
    // the ring a stamp sends out: it catches whoever is standing on the ground when it passes
    if (this.ring) {
      const g = this.ring, r0 = g.r; g.t += dt; g.r += 14 * dt;
      const rd = Math.hypot(pl.p[0] - g.at[0], pl.p[2] - g.at[2]);
      if (!g.hit && rd > r0 && rd <= g.r && rd < 11.5 && pl.p[1] - height(pl.p[0], pl.p[2]) < .45 && pl.form !== 2 && this.canHurt(pl)) { g.hit = true; this.hurt(pl, g.at, 1, 9, ev); }
      if (g.r > 15) this.ring = null;
    }
    return ev;
  }
  canHurt(pl) { return pl.dodge <= 0 && pl.burst <= 0 && pl.fallen <= 0; }
  hurt(pl, from, power, throwBack, ev) {
    const dx = pl.p[0] - from[0], dz = pl.p[2] - from[2], l = Math.hypot(dx, dz) || 1;
    pl.hp -= power; pl.stagger = .6; pl.v[0] = dx / l * throwBack; pl.v[2] = dz / l * throwBack; pl.v[1] = 5; pl.ground = false;
    if (pl.hp <= 0) pl.fallen = 1.8;
    ev.push({ kind: 'struck', at: [pl.p[0], pl.p[1] + 1.2, pl.p[2]], dir: [dx / l, dz / l], down: pl.hp <= 0 });
  }

  // what a sword stroke can reach: the hand while it lies on the ground, otherwise the nearer ankle
  aim(q) {
    const P = this.parts; if (!P || !this.awake) return null;
    const opts = [P.footL, P.footR]; if (this.planted) opts.unshift(P[this.side > 0 ? 'handL' : 'handR']);
    let best = null, bd = 1e9;
    for (const o of opts) { const d = Math.hypot(o[0] - q[0], o[2] - q[2]) - (o === opts[0] && this.planted ? 2 : 0); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  // the player's stroke against the giant. A cut on the planted hand makes it flinch; its ankles only bleed ink
  struck(pl) {
    const P = this.parts, t = pl.actT;
    if (!P || !this.awake || pl.form !== 0 || pl.hit) return null;
    const { hitStart, hitEnd, angle } = pl.swordMove;
    if (t < hitStart || t > hitEnd) return null;
    const hand = P[this.side > 0 ? 'handL' : 'handR'], near = (o, r) => Math.hypot(o[0] - pl.p[0], o[2] - pl.p[2]) < r && Math.abs(wrap(Math.atan2(o[0] - pl.p[0], o[2] - pl.p[2]) - pl.yaw)) < angle;
    if (this.planted && near(hand, 4.3)) { pl.hit = true; this.flinch = 1; this.count++; return { kind: 'cut', at: [hand[0], hand[1] + .5, hand[2]], big: true }; }
    for (const k of ['footL', 'footR']) if (P[k][1] - height(P[k][0], P[k][2]) < 1.5 && near(P[k], 3.6)) { pl.hit = true; this.count++; return { kind: 'cut', at: [P[k][0], P[k][1] + .9, P[k][2]] }; }
    return null;
  }
  // things the player cannot walk through: [x, z, radius]
  solids() {
    const P = this.parts, out = []; if (!P) return out;
    for (const k of ['footL', 'footR']) if (P[k][1] - height(P[k][0], P[k][2]) < 1.2) out.push([P[k][0], P[k][2], .95]);
    if (this.planted) { const h = P[this.side > 0 ? 'handL' : 'handR']; out.push([h[0], h[2], 1.1]); }
    if (this.crouch > .5) out.push([P.hips[0], P.hips[2], 2.3], [P.handL[0], P.handL[2], 1], [P.handR[0], P.handR[2], 1]);
    return out;
  }
  // what the body does to the simulated fog
  emitters() {
    const P = this.parts, V = this.vel, e = []; if (!P || !V.footL) return e;
    const cap = v => { const l = Math.hypot(...v); return l > 14 ? v.map(x => x * 14 / l) : v; };
    for (const k of ['L', 'R']) {
      e.push({ a: P['foot' + k], b: P['knee' + k], r: .85, v: cap(V['foot' + k]), solid: true });
      e.push({ a: P['hand' + k], b: P['elbow' + k], r: 1.5, v: cap(V['hand' + k]), drag: 26 });
    }
    if (this.crouch > .3) e.push({ a: P.hips, b: P.chest, r: 2.2, solid: true });
    return e;
  }
  // and to the smoke layers
  stir() {
    const P = this.parts, V = this.vel, s = []; if (!P || !V.footL) return s;
    for (const k of ['L', 'R']) { s.push({ p: P['hand' + k], v: V['hand' + k], r: 2.2, drag: 55, gain: 1 }); s.push({ p: P['foot' + k], v: V['foot' + k], r: 2.2, drag: 40, gain: 1 }); }
    // smoke thins in front of its chest and head, through every layer between it and the eye: however thick the fog,
    // the raised arm or leg that announces a blow can be read. Its legs stay sunk in the fog
    const k = this.awake ? 1 : .4;
    s.push({ p: P.chest, v: V.chest, r: 4.6, drag: 10, gain: 1, den: -1.3 * k, reach: 14 });
    s.push({ p: P.head, v: V.head, r: 3, drag: 6, gain: 1, den: -1.6 * k, reach: 14 });
    return s;
  }
}
