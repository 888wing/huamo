// The fighters. The player is one body with four forms; each form moves differently and pushes on the fog differently.
// The enemy is an ink shadow of the swordsman that closes in, shows its strike before it comes, and can be cut down.
import { height, SIZE, FOG_TOP, FIGHT_STATIONS, pushOut, START } from './world.js';

export const FORMS = ['人 斬', '虎 吼', '鶴 翼', '鯉 游'];
const SPEED = [5.5, 12, 11, 7.5], ACT = [0.36, 0.35, 0.7, 0.5], COOL = [0.62, 1.4, 0.9, 1.2];
// a stroke is not even: it gathers (first 35 % of the time, 8 % of the arc), snaps (next 25 %, 80 % of the arc), then trails off
export const swing = t => t < .35 ? .08 * (t / .35) ** 2 : t < .6 ? .08 + .8 * (t - .35) / .25 : 1 - .12 * (1 - (t - .6) / .4) ** 2;
const swingRate = t => t < .35 ? .2 : t < .6 ? 3.2 : .4;
const SWORD_MOVES = [
  { duration: ACT[0], cooldown: COOL[0], windup: .35, releaseEnd: .60, lunge: 7, hitStart: .38, hitEnd: .68, range: 3.9, angle: 1.35, power: 1, impact: 1 },
  { duration: .30, cooldown: .52, windup: .28, releaseEnd: .58, lunge: 5.5, hitStart: .33, hitEnd: .66, range: 3.85, angle: 1.24, power: 1, impact: .88 },
  { duration: .49, cooldown: .80, windup: .43, releaseEnd: .69, lunge: 5, hitStart: .46, hitEnd: .76, range: 3.75, angle: .86, power: 2, impact: 1.45 },
];
const COMBO_LINK = .22;

// Put the snap of each stroke into the same phase interval for the trail, smoke and rig.
export function swordTiming(t, combo) {
  const { windup, releaseEnd } = SWORD_MOVES[combo];
  if (t < windup) return .35 * t / windup;
  if (t < releaseEnd) return .35 + .25 * (t - windup) / (releaseEnd - windup);
  return .60 + .40 * (t - releaseEnd) / (1 - releaseEnd);
}

export const HP = 5;
// dodges: a hop straight back when no direction is held, a roll when one is. [duration s, distance m, untouchable from, to (s)]
const HOP = [.30, 3.2, .05, .22], ROLL = [.42, 4.2, .06, .30];
export const DEATH = 2.6; // kneel, fall, run out into ink, gather again at the last safe spot
const BURST = 0.32, SHAKE = [.14, .7, .16, .1];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// the sword during a stroke (t 0..1): where the blade is and how fast it sweeps
function bladeAt(p, v, yaw, side, t, dur) {
  const e = swing(t), ang = yaw + side * (-1.25 + 2.5 * e), w = side * 2.5 / dur * swingRate(t), U = [0, 1, 0];
  const D = [Math.sin(ang), 0, Math.cos(ang)], hand = add(p, U, 1.25 + .4 * side * (.5 - e));
  return { a: add(hand, D, .7), b: add(add(hand, D, 3.1), U, side * (e - .5) * 1.2), snap: t >= .35 && t < .6, vel: add(v, [Math.cos(ang) * w * 2.2, 5, -Math.sin(ang) * w * 2.2]) }; // swept sideways and thrown up
}

function comboBladeAt(p, v, yaw, side, t, combo) {
  const trailPhase = swordTiming(t, combo);
  const { duration, windup, releaseEnd } = SWORD_MOVES[combo];
  if (combo === 0) return { ...bladeAt(p, v, yaw, side, t, duration), combo, trailPhase };

  // The second strike rises across the body. The finisher falls in a steeper, narrower plane.
  const rising = combo === 1;
  const point = (phase, reach) => {
    const e = swing(swordTiming(phase, combo));
    const azimuth = yaw + side * (rising ? -1.18 + 2.25 * e : -.39 + .82 * e);
    const pitch = rising ? -.27 + .92 * e : 1.02 - 1.32 * e;
    const y = rising ? .96 + .46 * e : 1.20 + .47 * (1 - e);
    const horizontal = reach * Math.cos(pitch);
    return [p[0] + horizontal * Math.sin(azimuth), p[1] + y + reach * Math.sin(pitch), p[2] + horizontal * Math.cos(azimuth)];
  };
  const before = Math.max(0, t - .008), after = Math.min(1, t + .008);
  const from = point(before, 1.9), to = point(after, 1.9);
  const speed = 1 / ((after - before) * duration);
  return {
    a: point(t, .68), b: point(t, rising ? 3.05 : 3.15), snap: t >= windup && t < releaseEnd,
    vel: to.map((value, i) => v[i] + (value - from[i]) * speed), combo, trailPhase,
  };
}
// the blade sweeps fog out of its path; it leaves only a trace of ink, so a stroke reads as fog being parted
const bladeEmitters = bl => [{ a: bl.a, b: bl.b, r: bl.snap ? 1.8 : 1.0, v: bl.vel, drag: bl.snap ? 90 : 30 }]; // no ink and no fog removed: the fog is only moved
// walk with walls: anything rising faster than a step blocks, one axis at a time
function walk(p, v, dt, step) {
  for (const a of [0, 2]) {
    const q = [p[0], p[1], p[2]]; q[a] += v[a] * dt;
    if (Math.abs(q[a]) < SIZE / 2 - 2.5 && height(q[0], q[2]) - p[1] < step) p[a] = q[a]; else v[a] = 0;
  }
  pushOut(p, .32);
}

export class Player {
  constructor() {
    this.p = [START[0], height(...START), START[1]];
    this.v = [0, 0, 0]; this.yaw = Math.PI; this.form = 0;
    this.act = 0; this.cool = 0; this.side = 1; this.ground = true; this.phase = 0; this.burst = 0; this.shake = 0; this.t = 0; this.stagger = 0; this.hit = false;
    this.combo = 0; this.comboWindow = 0; this.comboQueued = false; this.attackHeld = false;
    this.hp = HP; this.dodge = 0; this.dodgeCool = 0; this.guard = false; this.guardT = 0; this.fallen = 0; this.dv = [0, 0]; this.home = [...START];
    this.airT = 0; this.land = 0; this.landHard = false; this.jumpHeld = false;
    this.dodgeKind = 0; this.dodgeDur = 1; this.dashT = 0;                 // dodgeKind: 1 hop back, 2 roll, 3 the tiger's dash
    this.guardK = 0; this.blockT = 0; this.parryT = 0; this.counter = 0;   // counter: time left in which a parried enemy takes double
    this.hurtT = 0; this.hurtDur = .3; this.hurtKind = 0; this.hurtDir = [0, 1];
    this.ko = 0; this.koT = 0;                                             // thrown: 1 in the air, 2 on the ground, 3 getting up
    this.plunge = 0; this.plungeT = 0; this.plungeHit = false;             // the stab from the air: 1 falling, 2 the sword in the ground
    this.events = [];                                                      // what the caller turns into fog, shake and sound: jump, land, plunge, down
  }
  // untouchable: inside a dodge's window, while getting up, while changing form
  get invuln() {
    const e = this.dodgeDur - this.dodge, w = this.dodgeKind === 1 ? HOP : ROLL;
    return (this.dodge > 0 && (this.dodgeKind === 3 || (e > w[2] && e < w[3]))) || this.ko >= 2 || this.burst > 0 || this.fallen > 0;
  }
  // A blow lands. kind: 1 a cut (a flinch), 2 a heavy blow (a stumble), 3 thrown off the feet. Returns true if it kills.
  hurt(kind, from, power, back) {
    const { p, v } = this, dx = p[0] - from[0], dz = p[2] - from[2], l = Math.hypot(dx, dz) || 1;
    this.hp -= power; this.act = 0; this.clearCombo(); this.dodge = 0; this.plunge = 0; this.guard = false;
    v[0] = dx / l * back; v[2] = dz / l * back;
    if (kind === 3 || this.hp <= 0) this.yaw = Math.atan2(-dx, -dz); // it goes over backwards, facing what hit it
    // where the blow came from in the body's own frame: [to its left, in front]
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw); this.hurtDir = [(-dx * cs + dz * sn) / l, (-dx * sn - dz * cs) / l];
    if (this.hp <= 0) { this.fallen = DEATH; this.ko = 0; this.hurtT = 0; this.stagger = 0; return true; }
    if (kind === 3) { this.ko = 1; this.koT = 0; v[1] = 6.5; this.ground = false; this.stagger = 0; this.hurtT = 0; }
    else { this.hurtKind = kind; this.hurtDur = kind === 2 ? .5 : .28; this.hurtT = this.stagger = this.hurtDur; }
    return false;
  }
  // everything the figure needs to pose itself
  pose(time, fade) {
    const { p, v } = this;
    return { p, v, yaw: this.yaw, ground: this.ground, vy: v[1], airT: this.airT, land: this.land, landHard: this.landHard, phase: this.phase,
      run: Math.min(1, Math.hypot(v[0], v[2]) / SPEED[this.form]), act: this.actT, combo: this.combo, side: this.side, windup: 0, stagger: 0,
      guardK: this.guardK, blockT: this.blockT, parryT: this.parryT, dodgeKind: this.dodge > 0 ? this.dodgeKind : 0, dodgeU: 1 - this.dodge / this.dodgeDur,
      hurtU: this.hurtT > 0 ? 1 - this.hurtT / this.hurtDur : -1, hurtKind: this.hurtKind, hurtDir: this.hurtDir, ko: this.ko, koT: this.koT,
      plunge: this.plunge, plungeT: this.plungeT, death: this.fallen > 0 ? 1 - this.fallen / DEATH : 0, fade, time };
  }
  setForm(f) { if (f !== this.form) { this.form = f; this.act = 0; this.combo = 0; this.clearCombo(); this.burst = BURST; this.shake = .25; } } // momentum carries over
  get swordMove() { return SWORD_MOVES[this.combo]; }
  get actT() { return this.act > 0 ? 1 - this.act / (this.form === 0 ? this.swordMove.duration : ACT[this.form]) : -1; }
  get burstT() { return this.burst / BURST; }

  clearCombo() { this.comboWindow = 0; this.comboQueued = false; }

  startSword(combo, foe) {
    this.combo = combo;
    const move = this.swordMove;
    this.act = move.duration; this.cool = move.cooldown; this.side = -this.side;
    this.shake = SHAKE[0]; this.hit = false; this.lunged = false;
    this.clearCombo();
    const { p } = this;
    if (foe && Math.hypot(foe[0] - p[0], foe[2] - p[2]) < 7) this.yaw = Math.atan2(foe[0] - p[0], foe[2] - p[2]);
  }

  // inp: { x, z (-1..1 move), up, down, act }, cam: { yaw, pitch }, foe: position of an enemy to face when striking, or null
  update(dt, inp, cam, foe) {
    const { p, v } = this, f = this.form;
    const pressed = !!inp.act && !this.attackHeld, jumpPressed = !!inp.up && !this.jumpHeld;
    this.attackHeld = !!inp.act; this.jumpHeld = !!inp.up;
    if (this.fallen > 0) { // cut down: it kneels, falls and runs out into ink where it lies, then gathers again at the last safe spot
      this.act = 0; this.clearCombo(); this.guard = false; this.guardK = 0;
      this.fallen -= dt; v[0] *= Math.exp(-6 * dt); v[2] *= Math.exp(-6 * dt); v[1] -= 22 * dt;
      walk(p, v, dt, .7); p[1] = Math.max(height(p[0], p[2]), p[1] + v[1] * dt); if (p[1] <= height(p[0], p[2])) v[1] = 0;
      if (this.fallen <= 0) { p[0] = this.home[0]; p[2] = this.home[1]; p[1] = height(p[0], p[2]); v.fill(0); this.hp = HP; this.burst = BURST; this.stagger = 0; this.ground = true; this.ko = 0; }
      this.t += dt;
      return;
    }
    // thrown off the feet: nothing answers until it has landed, lain a moment and got up; a press of jump in the air lands it standing
    const helpless = this.ko > 0 || this.plunge === 2;
    if (this.ko) {
      this.koT += dt;
      if (this.ko === 1) {
        if (jumpPressed && this.koT > .12 && !this.ground) this.ko = 0;
        else if (this.ground && this.koT > .1) { this.ko = 2; this.koT = 0; this.events.push({ kind: 'down', at: [...p] }); }
      } else if (this.ko === 2) { if (this.koT > .35) { this.ko = 3; this.koT = 0; } }
      else if (this.koT > .6) this.ko = 0;
    }
    if (helpless) inp = { x: 0, z: 0, up: 0, down: 0, act: false, guard: false, dodge: false };
    const F = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)], R = [-F[2], 0, F[0]];
    let d = [F[0] * inp.z + R[0] * inp.x, 0, F[2] * inp.z + R[2] * inp.x];
    const len = Math.hypot(d[0], d[2]);
    if (len > 1) d = [d[0] / len, 0, d[2] / len];
    this.guard = !!inp.guard && f === 0 && this.act <= 0 && this.stagger <= 0 && this.dodge <= 0 && this.ground && !this.plunge; this.guardT = this.guard ? this.guardT + dt : 0;
    this.guardK += ((this.guard ? 1 : 0) - this.guardK) * Math.min(1, dt / .08);
    this.blockT = Math.max(0, this.blockT - dt); this.parryT = Math.max(0, this.parryT - dt); this.counter = Math.max(0, this.counter - dt);
    this.hurtT = Math.max(0, this.hurtT - dt); this.land = Math.max(0, this.land - dt); this.dashT = Math.max(0, this.dashT - dt);
    if (this.guard && foe && Math.hypot(foe[0] - p[0], foe[2] - p[2]) < 7) this.yaw += wrap(Math.atan2(foe[0] - p[0], foe[2] - p[2]) - this.yaw) * Math.min(1, 16 * dt); // a guard faces the threat
    const slow = (f === 3 && this.act > 0 ? 2 : 1) * (this.stagger > 0 ? .25 : 1) * (f === 0 && this.act > 0 ? .35 : 1) * (this.guard ? .3 : 1)
      * (this.land > 0 ? (this.landHard ? .9 : .45) : 1) * (this.blockT > 0 ? .2 : 1) * (helpless || this.plunge ? 0 : 1);
    const flying = f === 2, swimming = f === 3 && p[1] < FOG_TOP - .3;
    const k = Math.min(1, (flying || swimming ? 3.5 : this.ground ? 10 : 2) * dt);
    v[0] += (d[0] * SPEED[f] * slow - v[0]) * k; v[2] += (d[2] * SPEED[f] * slow - v[2]) * k;
    // dodge: a short dash the way we are moving (or straight back), untouchable while it lasts
    this.dodgeCool -= dt;
    if (inp.dodge && f < 2 && this.dodge <= 0 && this.dodgeCool <= 0 && this.stagger <= 0 && this.ground && !this.plunge) {
      // no direction held: a hop straight back, still facing the threat. A direction held: a roll that way
      this.dodgeKind = f === 1 ? 3 : len > .1 ? 2 : 1;
      this.dodgeDur = this.dodgeKind === 3 ? .28 : this.dodgeKind === 2 ? ROLL[0] : HOP[0];
      this.dodge = this.dodgeDur; this.dodgeCool = this.dodgeDur + .35; this.act = 0;
      this.clearCombo();
      this.dv = len > .1 ? [d[0] / Math.max(len, 1), d[2] / Math.max(len, 1)] : [-Math.sin(this.yaw), -Math.cos(this.yaw)];
      const l = Math.hypot(this.dv[0], this.dv[1]) || 1; this.dv = [this.dv[0] / l, this.dv[1] / l];
      if (this.dodgeKind === 2) this.yaw = Math.atan2(this.dv[0], this.dv[1]);
      this.events.push({ kind: 'dodge', at: [...p] });
    }
    if (this.dodge > 0) {
      // fast off the mark and slowing into the landing: the distance is fixed, the speed is not
      const u = 1 - this.dodge / this.dodgeDur, w = this.dodgeKind === 1 ? HOP : ROLL, sp = this.dodgeKind === 3 ? 13 : w[1] / w[0] * 1.5 * (1 - u * u);
      this.dodge -= dt; v[0] = this.dv[0] * sp; v[2] = this.dv[1] * sp;
      if (this.dodge <= 0) this.dashT = .16;
    }
    if (flying || swimming) {
      const vy = (inp.up - inp.down) * (flying ? 6 : 4) + (swimming ? Math.sin(cam.pitch) * inp.z * SPEED[f] : 0);
      v[1] += (vy - v[1]) * Math.min(1, 4 * dt);
    } else {
      v[1] -= (this.plunge === 1 ? 46 : 22) * dt;
      // a tap is a low jump, a held press a high one: letting go on the way up cuts the rise short
      if (!inp.up && v[1] > 2 && !this.ko && this.airT > .04) v[1] -= 55 * dt;
      if (this.ground && jumpPressed && this.stagger <= 0 && this.land <= 0 && !helpless) { v[1] = f === 1 ? 10 : 8.6; this.ground = false; this.airT = 0; this.dodge = 0; this.events.push({ kind: 'jump', at: [...p] }); }
    }
    walk(p, v, dt, flying || swimming ? 0.2 : 0.7);
    p[1] += v[1] * dt;
    const gh = height(p[0], p[2]) + (flying ? .7 : swimming ? .5 : 0), wasGround = this.ground, fallSpeed = -v[1];
    this.ground = false;
    if (p[1] <= gh) { p[1] = gh; if (v[1] < 0) v[1] = 0; this.ground = !flying && !swimming; }
    if (this.ground) {
      if (!wasGround && this.airT > .12) { // coming down: knees take it, or a roll if it was a long drop
        if (this.plunge === 1) { this.plunge = 2; this.plungeT = 0; this.plungeHit = true; v[0] = v[2] = 0; this.events.push({ kind: 'plunge', at: [...p], v: fallSpeed }); }
        else if (!this.ko) { this.landHard = fallSpeed > 13; this.land = this.landHard ? .4 : .14; this.events.push({ kind: 'land', at: [...p], v: fallSpeed }); }
      }
      this.airT = 0;
    } else this.airT += dt;
    if (this.plunge === 2 && (this.plungeT += dt) > .38) this.plunge = 0;
    if (flying) p[1] = Math.min(p[1], 8);
    if (swimming) p[1] = Math.min(p[1], FOG_TOP - .3);
    const sp = Math.hypot(v[0], v[2]);
    // face the way we move, except backing off in a hop, being thrown, or reeling
    if (sp > .4 && this.act <= 0 && !this.guard && !(this.dodge > 0 && this.dodgeKind === 1) && !this.ko && this.hurtT <= 0 && !this.plunge)
      this.yaw += wrap(Math.atan2(v[0], v[2]) - this.yaw) * Math.min(1, 12 * dt);
    this.phase += dt * (2 + sp);
    this.cool -= dt; this.stagger = Math.max(0, this.stagger - dt);
    if (f === 0) {
      // late in a dodge, or just out of it, a press cuts straight from the dodge: the dash and the cut are one move
      const fromDodge = (this.dodge > 0 && this.dodge < this.dodgeDur * .45) || this.dashT > 0;
      const move = this.swordMove, canAttack = this.stagger <= 0 && !this.guard && (this.dodge <= 0 || fromDodge) && !helpless && this.land <= 0;
      // in the air a press is the stab downwards: the body drops behind the point of the sword
      if (pressed && !this.ground && !this.plunge && !this.ko && this.airT > .1 && p[1] - height(p[0], p[2]) > .9) {
        this.plunge = 1; this.plungeT = 0; this.act = 0; this.clearCombo(); this.hit = false;
        v[1] = Math.min(v[1], -9); v[0] *= .35; v[2] *= .35;
      }
      const links = this.combo < SWORD_MOVES.length - 1;
      this.comboWindow = Math.max(0, this.comboWindow - dt);
      if (!canAttack) this.clearCombo();
      if (this.act > 0) {
        if (pressed && canAttack && links && this.actT >= .16) this.comboQueued = true;
        if (this.actT >= move.windup - .02 && !this.lunged) {
          this.lunged = true;
          v[0] += Math.sin(this.yaw) * move.lunge; v[2] += Math.cos(this.yaw) * move.lunge;
          this.shake = Math.max(this.shake, .3 * move.impact);
        }
        this.act = Math.max(0, this.act - dt);
        if (this.act === 0 && links && canAttack) {
          if (this.comboQueued) this.startSword(this.combo + 1, foe);
          else this.comboWindow = COMBO_LINK;
        }
      } else if (pressed && canAttack && this.ground && !this.plunge) {
        if (this.comboWindow > 0 && links) this.startSword(this.combo + 1, foe);
        else if (this.cool <= 0 || fromDodge) {
          this.startSword(0, foe);
          if (fromDodge) { this.dodge = 0; this.dashT = 0; v[0] += Math.sin(this.yaw) * 5; v[2] += Math.cos(this.yaw) * 5; }
        }
      }
    } else if (this.act > 0) this.act -= dt;
    else if (inp.act && this.cool <= 0 && this.stagger <= 0 && !this.guard && this.dodge <= 0) {
      this.act = ACT[f]; this.cool = COOL[f]; this.side = -this.side; this.shake = SHAKE[f]; this.hit = false; this.lunged = false;
    }
    this.burst = Math.max(0, this.burst - dt); this.t += dt;
  }

  blade() { const t = this.actT; return this.form === 0 && t >= 0 ? comboBladeAt(this.p, this.v, this.yaw, this.side, t, this.combo) : null; }

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
    // dying: the body runs out into ink where it lies, and the fog carries it off
    if (this.fallen > 0) { const k = Math.sin(Math.PI * Math.min(1, Math.max(0, (1 - this.fallen / DEATH - .45) / .5))); e.length = 0; e.push({ a: add(p, U, .35), r: 1, ink: 4.5 * k, div: 1.6 * k }); }
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

const WIND = 0.55, STRIKE = 0.34;
const FALL_DURATION = .45, MELT_START = .54, MELT_DURATION = 1.16;

export class Enemy {
  constructor() { this.n = 0; this.spawn(); }
  spawn() {
    this.total = FIGHT_STATIONS.length;
    if (this.n >= this.total) { this.mode = 'done'; this.p = [0, -99, 0]; this.v = [0, 0, 0]; return; }
    const [x, z] = FIGHT_STATIONS[this.n];
    this.p = [x, height(x, z), z]; this.v = [0, 0, 0]; this.yaw = 0; this.hp = this.maxHp = 6; this.mode = 'wait'; this.clock = 0; this.side = 1; this.stagger = 0; this.phase = 0; this.t = 0; this.hit = false; this.orbit = 1;
  }
  get alive() { return !['fall', 'gone', 'rise', 'wait', 'done'].includes(this.mode); }
  get present() { return this.mode !== 'gone' && this.mode !== 'done'; }
  get windup() { return this.mode === 'wind' ? this.clock / WIND : 0; }
  get actT() { return this.mode === 'strike' ? Math.min(1, this.clock / STRIKE) : -1; }
  get fallT() { return this.mode === 'fall' ? Math.min(1, this.clock / FALL_DURATION) : 0; }
  get meltT() { return this.mode === 'fall' ? Math.max(0, Math.min(1, (this.clock - MELT_START) / MELT_DURATION)) : 0; }
  get fade() {
    if (this.mode === 'fall') return this.meltT ** 2 * .92;
    return this.mode === 'rise' ? 1 - Math.min(1, this.clock / .8) : this.mode === 'gone' ? 1 : 0;
  }
  go(mode) { this.mode = mode; this.clock = 0; }
  hurt(from, power = 1, impact = 1) {
    this.hp = Math.max(0, this.hp - power);
    this.stagger = .5;
    const x = this.p[0] - from[0], z = this.p[2] - from[2], distance = Math.hypot(x, z) || 1;
    // Keep a standing enemy close enough for the return cut. The finishing blow topples it away.
    const speed = this.hp === 0 ? 4.65 : 3.25 * impact;
    this.v[0] = x / distance * speed; this.v[2] = z / distance * speed;
    if (this.hp === 0) this.yaw = Math.atan2(-x, -z);
    this.go(this.hp === 0 ? 'fall' : 'reel');
    return this.hp === 0;
  }
  update(dt, pl) {
    const { p, v } = this; this.clock += dt; this.t += dt; this.stagger = Math.max(0, this.stagger - dt);
    const dx = pl[0] - p[0], dz = pl[2] - p[2], dist = Math.hypot(dx, dz) || 1, to = Math.atan2(dx, dz);
    let want = [0, 0];
    if (this.mode === 'done') return;
    if (this.mode === 'gone') { if (this.clock > 1.5) { this.n++; this.spawn(); } return; }
    if (this.mode === 'wait') { this.yaw += wrap(to - this.yaw) * Math.min(1, 3 * dt); if (dist < 8.5) this.go('stalk'); return; } // standing in the fog until the player comes near
    if (this.mode === 'rise') { if (this.clock > .8) this.go('stalk'); }
    else if (this.mode === 'fall') {
      if (this.clock >= MELT_START + MELT_DURATION) this.go('gone');
      if (this.clock >= FALL_DURATION) v[0] = v[2] = 0;
    }
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
    if (this.mode !== 'strike' && this.mode !== 'fall' && this.mode !== 'gone') this.yaw += wrap(to - this.yaw) * Math.min(1, 9 * dt);
    this.phase += dt * (2 + Math.hypot(v[0], v[2]));
  }
  blade() { const t = this.actT; return t >= 0 ? bladeAt(this.p, this.v, this.yaw, this.side, t, STRIKE) : null; }
  emitters() {
    if (!this.present) return [];
    const U = [0, 1, 0], sp = Math.hypot(this.v[0], this.v[2]);
    if (this.mode === 'fall') { // the body on the ground bleeds ink along its length
      const back = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)], k = Math.sin(Math.PI * this.meltT);
      return [{ a: add(this.p, U, .12), b: add(add(this.p, back, 1.7), U, .12), r: .64, ink: 1.4 * k, div: 1.2 * k, v: this.v, drag: 4 }];
    }
    const e = [{ a: add(this.p, U, .6), b: add(this.p, U, 1.5), r: .45, v: this.v, solid: true },
      { a: add(this.p, U, .4), b: add(this.p, U, 1.6), r: 1.1, v: this.v, drag: 10, ink: this.mode === 'rise' ? 1.5 : 0 }];
    const bl = this.blade(); if (bl) e.push(...bladeEmitters(bl));
    return e;
  }
}

// Place splashes between the torso and blade, following the current sweep on angled cuts.
function swordContact(blade, victim) {
  const p = [victim.p[0], victim.p[1] + 1.18, victim.p[2]];
  if (!blade) return { at: p };
  const ab = blade.b.map((x, k) => x - blade.a[k]);
  const distance = ab.reduce((sum, x) => sum + x * x, 0) || 1;
  const toward = ab.reduce((sum, x, k) => sum + x * (p[k] - blade.a[k]), 0);
  const t = Math.min(1, Math.max(0, toward / distance));
  const at = p.map((x, k) => x + Math.min(.5, Math.max(-.5, (blade.a[k] + ab[k] * t - x) * .58)));
  const speed = Math.hypot(blade.vel[0], blade.vel[2]);
  return { at, dir: speed > .001 ? [blade.vel[0] / speed, blade.vel[2] / speed] : undefined };
}

// Who hit whom this step. Returns events for the caller to turn into ink, shake and score.
export function spar(pl, en) {
  const ev = [], d = Math.hypot(en.p[0] - pl.p[0], en.p[2] - pl.p[2]), mid = [(pl.p[0] + en.p[0]) / 2, pl.p[1] + 1.3, (pl.p[2] + en.p[2]) / 2];
  const inArc = (a, b, angle = 1.35) => Math.abs(wrap(Math.atan2(b.p[0] - a.p[0], b.p[2] - a.p[2]) - a.yaw)) < angle;
  const pt = pl.actT, et = en.actT;
  if (!en.alive) return ev;
  const move = pl.swordMove;
  if (pl.form === 0 && pt > (move?.hitStart ?? .38) && pt < (move?.hitEnd ?? .7) && !pl.hit &&
      d < (move?.range ?? 3.9) && inArc(pl, en, move?.angle)) {
    pl.hit = true;
    if (et >= 0 && !en.hit) { en.hit = true; en.go('reel'); en.stagger = .3; pl.stagger = .2; ev.push({ kind: 'clash', at: mid }); } // steel on steel
    else {
      const impact = move?.impact ?? 1;
      const contact = swordContact(pl.blade(), en);
      ev.push({ kind: en.hurt(pl.p, (move?.power ?? 1) * (pl.counter > 0 ? 2 : 1), impact) ? 'kill' : 'cut', impact, ...contact });
    }
  }
  // the stab from the air: whatever stands where it comes down takes a heavy blow
  if (pl.plungeHit) { pl.plungeHit = false; if (d < 2.4) ev.push({ kind: en.hurt(pl.p, 2, 1.45) ? 'kill' : 'cut', impact: 1.45, at: [en.p[0], en.p[1] + 1.2, en.p[2]] }); }
  if (pl.form === 1 && pt > .2 && pt < .5 && !pl.hit && d < 6) { pl.hit = true; ev.push({ kind: en.hurt(pl.p, .5) ? 'kill' : 'push', at: [en.p[0], en.p[1] + 1.2, en.p[2]] }); }
  if (et > .38 && et < .75 && !en.hit && d < 3.6 && inArc(en, pl) && pl.burst <= 0 && pl.form < 2 && pl.fallen <= 0) {
    en.hit = true;
    const l = d || 1, back = k => { pl.v[0] = (pl.p[0] - en.p[0]) / l * k; pl.v[2] = (pl.p[2] - en.p[2]) / l * k; };
    if (pl.invuln) ev.push({ kind: 'dodge', at: mid });
    else if (pl.guard && inArc(pl, en)) {
      if (pl.guardT < .25) { en.go('reel'); en.stagger = .8; pl.parryT = .32; pl.counter = .9; ev.push({ kind: 'parry', at: mid }); } // raised just in time: the shadow is thrown open, and the next cut counts double
      else { back(4); pl.blockT = .25; ev.push({ kind: 'block', at: mid }); }
    } else {
      const contact = swordContact(en.blade(), pl);
      ev.push({ kind: pl.hurt(1, en.p, 1, 7) ? 'down' : 'taken', ...contact });
    }
  }
  return ev;
}
