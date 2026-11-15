// 巨相撲鬼: what the giant does. It waits in a wrestler's crouch at the path's end, rises when the four shadows are down,
// and then fights like a wrestler: it stamps (a ring runs out through the fog and the reeds) and it throws its whole
// weight down behind an open hand. No three.js in here; the rig in giant.js reads the numbers and reports back where
// the hands and feet really are.
import { height, ARENA, FOG_TOP } from './world.js';

export const GH = 10.5; // metres tall
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), cl = x => Math.min(1, Math.max(0, x)), ease = x => { x = cl(x); return x * x * (3 - 2 * x); };
// stamp: raise the leg, hold it, bring it down, settle. slam: raise the arm, strike, lie on the hand, get up
const S_UP = .85, S_HOLD = .32, S_DROP = .13, S_SET = 1.0, M_UP = 1.05, M_HIT = .2, M_LIE = 1.7, M_BACK = 1.1;
const REACH = [4.0, 5.6];
// sweep: the hand goes down at its own side, then scythes across the front. charge: down into the start, a drive forward, a skid
const W_UP = .9, W_GO = .42, W_BACK = .9, C_UP = 1.0, C_GO = .55, C_END = .6, C_DIST = 6.5, STUN = 3;
export const DYING = 6.5; // from the sword going in to the last of the ink: reel, sway, fall, run out

export class Giant {
  constructor() {
    const [x, z] = ARENA.home;
    this.p = [x, height(x, z), z]; this.yaw = 0; this.mode = 'sleep'; this.clock = 0; this.time = 0; this.side = 1; this.walk = 0; this.walkAmt = 0;
    this.crouch = 1; this.lift = 0; this.squat = 0; this.wind = 0; this.down = 0; this.fall = 0; this.ik = 0; this.flinch = 0; this.roar = 0; this.glow = 0; this.fast = false;
    this.lie = M_LIE; this.twist = 0; this.death = 0; this.dir = [0, 1]; this.sweepA = 0; this.gone = 0;
    this.target = [x, this.p[1], z + 5]; this.ring = null; this.parts = null; this.prev = null; this.vel = {}; this.seed = 7; this.think = 1; this.count = 0; this.done = false;
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  get awake() { return this.mode !== 'sleep'; }
  get alive() { return this.mode !== 'dying' && this.mode !== 'dead'; }
  get planted() { return this.mode === 'slam' && this.clock > M_UP + M_HIT && this.clock < M_UP + M_HIT + this.lie + M_BACK * .35; }
  // the arm lying on the ground is a way up: hand, elbow, shoulder (null when it is not down)
  get ramp() { const P = this.parts, k = this.side > 0 ? 'L' : 'R'; return P && this.mode === 'slam' && this.fall >= 1 && this.clock < M_UP + M_HIT + this.lie ? [P['hand' + k], P['elbow' + k], P['shoulder' + k]] : null; }
  // the sword has gone into its head
  die() { if (!this.alive) return; this.go('dying'); this.ring = null; this.lift = this.wind = this.ik = this.roar = 0; this.fast = false; }
  go(mode) { this.mode = mode; this.clock = 0; this.done = false; }
  rest(t) { this.go('idle'); this.think = t; this.lift = this.squat = this.wind = this.down = this.fall = this.ik = this.twist = 0; this.fast = false; this.lie = M_LIE; this.pinned = false; if (this.crouch < 1) this.crouch = 0; }

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
        if (pl.ride) this.think = .3;                                            // someone is on it: it cannot reach them
        else if (far > 1.5 && d > 7) this.go('back');                            // drawn off its mark: it backs up to it
        else if (d > 17) this.think = .5;                                        // out of reach: it only watches
        else if (!facing) this.think = .12;
        else if (d < 3.3) this.go('stomp');                                      // underfoot
        else if (d <= 6.6) this.go(r < .5 ? 'slam' : r < .78 ? 'sweep' : 'stomp');
        else if (d > 8.5 && d < 16 && r < .55) this.go('charge');
        else this.go('stomp');
        if (this.mode === 'slam' || this.mode === 'sweep') this.side = off > 0 ? 1 : -1;   // the hand on the player's side
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
        // 鯉躍龍門: the fog thrown up by the stamp carries a carp near it out of the fog and high into the air
        if (pl.form === 3 && pl.p[1] < FOG_TOP && Math.hypot(pl.p[0] - at[0], pl.p[2] - at[2]) < 6.5) { pl.v[1] = 17; pl.p[1] = FOG_TOP - .29; ev.push({ kind: 'gate', at: [...pl.p] }); }
      }
      this.squat = c >= land ? 1 - ease((c - land) / S_SET) : 0;
      if (c > land + S_SET) this.rest(.7 + this.rnd() * .7);
    } else if (this.mode === 'slam') {
      const k1 = c / M_UP, k2 = (c - M_UP) / M_HIT, k3 = (c - M_UP - M_HIT - this.lie) / M_BACK;
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
    } else if (this.mode === 'sweep') { // the open hand goes down at its own side and scythes across the front, a man's height off the ground at most
      const s = this.side, k1 = c / W_UP, k2 = (c - W_UP) / W_GO, k3 = (c - W_UP - W_GO) / W_BACK, R = this.sweepR ??= Math.max(3.8, Math.min(5.4, d));
      if (k1 < .6) { turn(1.2); this.sweepR = Math.max(3.8, Math.min(5.4, d)); }
      const a0 = this.sweepA, a = s * (1.25 - 2.35 * ease(k2)); this.sweepA = a; this.fast = k2 > 0 && k2 < 1.2;
      const x = p[0] + Math.sin(this.yaw + a) * R, z = p[2] + Math.cos(this.yaw + a) * R; this.target = [x, height(x, z) + .25, z];
      this.fall = 1; this.ik = k3 > 0 ? 1 - ease(k3 * 1.6) : ease(k1 * 1.5); this.down = (k3 > 0 ? 1 - ease(k3) : ease(k1 * 1.3)) * .72; this.twist = k3 > 0 ? a * (1 - ease(k3)) : a * ease(k1 * 1.3); this.wind = k2 > 0 ? 0 : ease(k1) * .5;
      // whoever is on the ground where the hand passes this step is carried off by it
      const pr = d, pa = wrap(to - this.yaw);
      if (k2 > 0 && k2 <= 1 && !this.done && pr > R - 2.6 && pr < R + 1.7 && (pa - a0) * (pa - a) <= .02 && pl.p[1] - height(pl.p[0], pl.p[2]) < 1.25 && this.canHurt(pl)) { this.done = true; this.hurt(pl, [p[0] + Math.sin(this.yaw + a0) * pr, pl.p[1], p[2] + Math.cos(this.yaw + a0) * pr], 1, 11, ev); }
      if (k2 > 0 && !this.swept) { this.swept = true; ev.push({ kind: 'sweep', at: [...this.target] }); }
      if (k3 >= 1) { this.swept = false; this.sweepR = undefined; this.rest(.7 + this.rnd() * .6); }
    } else if (this.mode === 'charge') { // down into the wrestler's start, then the whole mass driven forward
      const k1 = c / C_UP, k2 = (c - C_UP) / C_GO, k3 = (c - C_UP - C_GO) / C_END;
      if (k1 < .6) { turn(1.4); this.dir = [Math.sin(this.yaw), Math.cos(this.yaw)]; }
      this.crouch = k3 > 0 ? .3 * (1 - ease(k3)) : k2 > 0 ? .55 - .25 * cl(k2) : .55 * ease(k1 * 1.2); this.wind = k2 > 0 ? 0 : ease(k1) * .6; this.fast = k2 > 0 && k2 < 1;
      if (k2 > 0 && k2 < 1) {
        const sp = C_DIST / C_GO * 1.57 * Math.sin(Math.PI * cl(k2)); p[0] += this.dir[0] * sp * dt; p[2] += this.dir[1] * sp * dt; p[1] = height(p[0], p[2]); this.walk += 9 * dt; this.walkAmt = .8;
        if (!this.done && d < 3.1 && pl.p[1] - height(pl.p[0], pl.p[2]) < 2.2 && this.canHurt(pl)) { this.done = true; this.hurt(pl, [p[0] - this.dir[0] * 2, p[1], p[2] - this.dir[1] * 2], 2, 13, ev); }
      } else this.walkAmt = 0;
      if (k2 > 0 && !this.swept) { this.swept = true; ev.push({ kind: 'charge', at: [...p] }); }
      if (k2 >= 1 && !this.stopped) { this.stopped = true; ev.push({ kind: 'step', at: [...p] }); }
      if (k3 >= 1) { this.swept = this.stopped = false; this.rest(.5); }
    } else if (this.mode === 'back') { // heavy paces backwards to its mark, still facing the player
      const hx = ARENA.home[0] - p[0], hz = ARENA.home[1] - p[2], far = Math.hypot(hx, hz), k = c / 1.0; turn(.8);
      this.walkAmt = Math.sin(Math.PI * cl(k)); this.walk += Math.PI * dt;
      const sp = Math.min(far, 2.3) * 1.57 * Math.sin(Math.PI * cl(k)); if (far > .05) { p[0] += hx / far * sp * dt; p[2] += hz / far * sp * dt; p[1] = height(p[0], p[2]); }
      if (k >= 1) { this.walkAmt = 0; ev.push({ kind: 'step', at: P ? [...P[Math.sin(this.walk) > 0 ? 'footR' : 'footL']] : [...p] }); if (far < .4) this.rest(.4); else this.clock = 0; }
    } else if (this.mode === 'dying') { // the sword is in: it reels, sways, comes down like a tree, and runs out into ink
      this.death = cl(c / DYING); this.glow = Math.max(0, 1 - c * 1.2) * (.5 + .5 * Math.sin(c * 40));
      if (c > DYING * .56 && !this.done) { this.done = true; ev.push({ kind: 'topple', at: P?.chest ? [P.chest[0], height(P.chest[0], P.chest[2]), P.chest[2]] : [...p] }); }
      if (c >= DYING) { this.mode = 'dead'; ev.push({ kind: 'dead', at: [...p] }); }
    } else if (this.mode === 'dead') this.gone += dt;
    // the ring a stamp sends out: it catches whoever is standing on the ground when it passes
    if (this.ring) {
      const g = this.ring, r0 = g.r; g.t += dt; g.r += 14 * dt;
      const rd = Math.hypot(pl.p[0] - g.at[0], pl.p[2] - g.at[2]);
      if (!g.hit && rd > r0 && rd <= g.r && rd < 11.5 && pl.p[1] - height(pl.p[0], pl.p[2]) < .45 && pl.form !== 2 && this.canHurt(pl)) { g.hit = true; this.hurt(pl, g.at, 1, 9, ev); }
      if (g.r > 15) this.ring = null;
    }
    return ev;
  }
  // out of its reach: anyone it carries, and the carp while it is under the fog
  canHurt(pl) { return !pl.invuln && !pl.ride && !(pl.form === 3 && pl.p[1] < FOG_TOP - .2); }
  // everything the giant does throws the player off their feet; a guard does not hold against it
  hurt(pl, from, power, throwBack, ev) {
    const dx = pl.p[0] - from[0], dz = pl.p[2] - from[2], l = Math.hypot(dx, dz) || 1;
    const down = pl.hurt(3, from, power, throwBack);
    ev.push({ kind: 'struck', at: [pl.p[0], pl.p[1] + 1.2, pl.p[2]], dir: [dx / l, dz / l], down });
  }

  // what a sword stroke can reach: the hand while it lies on the ground, otherwise the nearer ankle
  aim(q) {
    const P = this.parts; if (!P || !this.awake || !this.alive) return null;
    const opts = [P.footL, P.footR]; if (this.planted) opts.unshift(P[this.side > 0 ? 'handL' : 'handR']);
    let best = null, bd = 1e9;
    for (const o of opts) { const d = Math.hypot(o[0] - q[0], o[2] - q[2]) - (o === opts[0] && this.planted ? 2 : 0); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  // the player's stroke against the giant. A cut on the planted hand makes it flinch; its ankles only bleed ink
  struck(pl) {
    const P = this.parts, t = pl.actT;
    if (!P || !this.awake || !this.alive || pl.form !== 0 || pl.hit) return null;
    const { hitStart, hitEnd, angle } = pl.swordMove;
    if (t < hitStart || t > hitEnd) return null;
    const hand = P[this.side > 0 ? 'handL' : 'handR'], near = (o, r) => Math.hypot(o[0] - pl.p[0], o[2] - pl.p[2]) < r && Math.abs(wrap(Math.atan2(o[0] - pl.p[0], o[2] - pl.p[2]) - pl.yaw)) < angle;
    if (this.planted && near(hand, 4.3)) { // a cut on the lying hand: it flinches, and the arm stays down for STUN seconds from now
      pl.hit = true; this.flinch = 1; this.count++; if (!this.pinned) { this.pinned = true; this.lie = Math.max(this.lie, this.clock - M_UP - M_HIT + STUN); }
      return { kind: 'cut', at: [hand[0], hand[1] + .5, hand[2]], big: true };
    }
    for (const k of ['footL', 'footR']) if (P[k][1] - height(P[k][0], P[k][2]) < 1.5 && near(P[k], 3.6)) { pl.hit = true; this.count++; return { kind: 'cut', at: [P[k][0], P[k][1] + .9, P[k][2]] }; }
    return null;
  }
  // the bulk a flying or falling body cannot pass through: [x, y, z, radius]
  volumes() {
    const P = this.parts; if (!P || this.mode === 'dead' || this.death > .5) return [];
    return [[...P.chest, 2.6], [P.hips[0], P.hips[1] + .9, P.hips[2], 2.7], [...P.head, 1.0]];
  }
  // things the player cannot walk through: [x, z, radius]
  solids() {
    const P = this.parts, out = []; if (!P || !this.alive) return out;
    for (const k of ['footL', 'footR']) if (P[k][1] - height(P[k][0], P[k][2]) < 1.2) out.push([P[k][0], P[k][2], .95]);
    if (this.planted) { const h = P[this.side > 0 ? 'handL' : 'handR']; out.push([h[0], h[2], 1.1]); }
    if (this.crouch > .5) out.push([P.hips[0], P.hips[2], 2.3], [P.handL[0], P.handL[2], 1], [P.handR[0], P.handR[2], 1]);
    return out;
  }
  // what the body does to the simulated fog
  emitters() {
    const P = this.parts, V = this.vel, e = []; if (!P || !V.footL || this.mode === 'dead') return e;
    if (this.mode === 'dying') { // ink pours out of it as it goes, and the air it displaces as it falls
      const k = Math.sin(Math.PI * cl((this.death - .5) / .5));
      return [{ a: P.hips, b: P.head, r: 3, ink: 5 * k, div: 3 * k, v: V.chest, drag: 6 }, { a: P.crown, r: 1.6, ink: 3 * cl(1 - this.death * 6), div: 6 * cl(1 - this.death * 6) }];
    }
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
    const P = this.parts, V = this.vel, s = []; if (!P || !V.footL || this.mode === 'dead') return s;
    for (const k of ['L', 'R']) { s.push({ p: P['hand' + k], v: V['hand' + k], r: 2.2, drag: 55, gain: 1 }); s.push({ p: P['foot' + k], v: V['foot' + k], r: 2.2, drag: 40, gain: 1 }); }
    // smoke thins in front of its chest and head, through every layer between it and the eye: however thick the fog,
    // the raised arm or leg that announces a blow can be read. Its legs stay sunk in the fog
    const k = this.awake ? 1 : .4;
    s.push({ p: P.chest, v: V.chest, r: 4.6, drag: 10, gain: 1, den: -1.3 * k, reach: 14 });
    s.push({ p: P.head, v: V.head, r: 3, drag: 6, gain: 1, den: -1.6 * k, reach: 14 });
    return s;
  }
}
