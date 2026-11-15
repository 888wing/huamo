// The picture: fog and ink marched at half resolution, then one full-resolution pass that draws brush lines at
// depth edges, lets distance wash things towards paper, lays the fog over, and finishes on textured paper.
import * as THREE from 'three/webgpu';
import { Fn, vec2, vec3, vec4, float, uniform, texture, texture3D, screenUV, screenCoordinate, screenSize, pass, rtt, Loop, If, Break, mrt, output,
  getViewPosition, perspectiveDepthToViewZ, interleavedGradientNoise, exp, max, min, length, mix, smoothstep, clamp, abs, floor, fract, dot, sin, cos, step, mod, int } from 'three/tsl';
import { PAPER, INK } from './stage.js';
import { FOG_TOP } from './world.js';
import { VW, VH } from './veil.js';

// March steps through the 3D fog. 28 is the default: against 56 the picture differs by less than 1 grey level on average
// (48-62 dB), and a level or upward view costs 4.4 ms less at 1080p. ?steps=56 restores the old count for comparison.
const STEPS = +(new URLSearchParams(location.search).get('steps') ?? 28), ZREF = 140;

export function createFog(renderer, scene, camera, noise, den, strokes, vel, veils = [], atlas = null,
  { procedural = false, seed = 0, foregroundDensity = 1.85, hero = null, shade = null, giant = null } = {}) {
  veils.forEach((L, i) => { L.i = i; L.offU = uniform(new THREE.Vector2()); });
  const scenePass = pass(scene, camera), strokeT = pass(strokes, camera).getTextureNode('output');
  const colT = scenePass.getTextureNode('output'), depT = scenePass.getTextureNode('depth');
  scenePass.setMRT(mrt({ output, subjectMask: float(0) }).setClearColor('subjectMask', 0));
  const subjectMask = scenePass.getTexture('subjectMask');
  subjectMask.format = THREE.RedFormat;
  subjectMask.type = THREE.UnsignedByteType;
  subjectMask.minFilter = subjectMask.magFilter = THREE.NearestFilter;
  const subjectT = scenePass.getTextureNode('subjectMask');
  const markSubject = (figure, value) => {
    if (!figure) return;
    const mark = mrt({ subjectMask: float(value) });
    figure.group.traverse(object => {
      if (object.isMesh) object.material.mrtNode = mark;
    });
    figure.cloth.mesh.material.mrtNode = mark;
  };
  markSubject(hero, 1);
  markSubject(shade, .5);
  markSubject(giant, .25); // the giant uses the opponent matte at its own value: main.js raises enemyClear while it announces a blow
  // fog is thin veils, not a wall (kFog): the scene shows through and the fog's own movement becomes visible
  const u = {
    projInv: uniform(camera.projectionMatrixInverse), camWorld: uniform(camera.matrixWorld), camPos: uniform(new THREE.Vector3()),
    near: uniform(camera.near), far: uniform(camera.far), dpr: uniform(1),
    boxMin: uniform(new THREE.Vector3()), boxSize: uniform(new THREE.Vector3(1, 1, 1)),
    flash: uniform(0), smoke: uniform(1), foregroundDensity: uniform(foregroundDensity), heroClear: uniform(0), enemyClear: uniform(0), kFog: uniform(0.13), wisp: uniform(0.85), kInk: uniform(5), haze: uniform(0.0048), hero: uniform(new THREE.Vector3()), heroR: uniform(1.3), hero2: uniform(new THREE.Vector3(0, -99, 0)), time: uniform(0), detail: uniform(1),
    slice: uniform(0.3), sliceV: uniform(0), top: uniform(10), reach: uniform(90), fogTop: uniform(FOG_TOP),
    paper: uniform(new THREE.Color(PAPER)), ink: uniform(new THREE.Color(INK)),
    air: uniform(new THREE.Color(PAPER).lerp(new THREE.Color(INK), .26)), // the air is a grey wash, so white fog is the lightest thing in the picture
  };
  const sun = vec3(.45, .8, .35).normalize();

  // fog and ink at a world position: the simulated box near the player, fog at rest beyond it
  // the simulated box near the player, fog at rest beyond it
  const base = p => {
    const q = p.sub(u.boxMin).div(u.boxSize), s = texture3D(den, q).level(0);
    const m = min(q, q.oneMinus()), inBox = smoothstep(0, .04, min(m.x, m.z)).mul(smoothstep(0, .02, m.y));
    return { q, s, inBox, b: mix(smoothstep(.6, -.6, p.y.sub(u.fogTop)), s.r, inBox) };
  };
  const lite = p => base(p).b;
  // fog and ink at a world position. The fine detail is carried by the simulated flow (two noise lookups displaced
  // along the velocity and cross-faded), so wisps stream around whatever moves through them.
  const density = p => {
    const { q, s, inBox, b } = base(p);
    const v = texture3D(vel, q).level(0).xyz.mul(inBox);
    const drift = vec3(u.time.mul(.02), u.time.mul(-.004), u.time.mul(.012));
    const ph = u.time.mul(.45).fract(), ph2 = ph.add(.5).fract();
    const n0 = texture3D(noise, p.sub(v.mul(ph.sub(.5).mul(1.7))).mul(.085).add(drift)).level(0);
    const n1 = texture3D(noise, p.sub(v.mul(ph2.sub(.5).mul(1.7))).mul(.085).add(drift).add(.37)).level(0);
    const n = mix(n1, n0, float(1).sub(ph.mul(2).sub(1).abs()));
    const edge = b.mul(b.oneMinus()).mul(4);
    const body = clamp(b.add(n.r.sub(.5).mul(2.1).add(n.g.sub(.5).mul(1.1)).mul(edge).mul(u.detail)), 0, 1);
    // bands of mist drifting above the fog sea: they pass in front of rocks, trees and figures; fast air tears them open
    const h = p.y.sub(u.fogTop), env = smoothstep(-.7, .8, h).mul(smoothstep(4.6, 1.6, h));
    const band = smoothstep(.47, .72, n.a.add(n.r.sub(.5).mul(.55))).mul(env).mul(u.wisp).mul(float(1).sub(clamp(length(v).mul(.14), 0, 1)));
    const fib = texture3D(noise, p.mul(.55).add(n.rgb.mul(.9))).level(0).g;
    return vec2(max(body, band), s.b.mul(inBox).mul(fib.mul(.7).add(.65)));
  };

  // half-resolution march. Returns (light scattered by fog, ink laid down, what still shows through, depth it stopped at)
  const march = Fn(() => {
    const vp = getViewPosition(screenUV, depT.r, u.projInv);
    const wp = u.camWorld.mul(vec4(vp, 1)).xyz;
    const ro = u.camPos, dir = wp.sub(ro), tScene = length(dir), rd = dir.div(tScene);
    const tTop = u.top.sub(ro.y).div(rd.y);
    const tN = rd.y.lessThan(0).select(max(tTop, 0), 0);
    const tF = min(min(tScene, u.reach), rd.y.greaterThan(0).select(tTop, 1e5));
    const T = float(1).toVar(), aFog = float(0).toVar(), aInk = float(0).toVar();
    If(tF.greaterThan(tN), () => {
      const jit = interleavedGradientNoise(screenCoordinate.xy);
      const span = tF.sub(tN);
      const ease = x => x.mul(float(.35).add(x.mul(.65))); // steps grow with distance: detail where it shows
      Loop(STEPS, ({ i }) => {
        const e0 = ease(float(i).div(STEPS)), e1 = ease(float(i).add(1).div(STEPS));
        const t = tN.add(span.mul(mix(e0, e1, jit))), dt = span.mul(e1.sub(e0));
        const p = ro.add(rd.mul(t));
        const d = density(p);
        const sFog = d.x.mul(u.kFog), sInk = d.y.mul(u.kInk), s = sFog.add(sInk);
        If(s.greaterThan(1e-4), () => {
          const a = float(1).sub(exp(s.mul(dt).negate()));
          const lit = exp(lite(p.add(sun.mul(1.4))).mul(-1.2)); // one tap towards the light
          const w = a.mul(T).div(s);
          aFog.addAssign(w.mul(sFog).mul(mix(.55, 1.08, lit)));   // lit crests, grey hollows: the fog has to read as a body   // fog is the paper showing: barely shaded
          aInk.addAssign(w.mul(sInk));
          T.mulAssign(float(1).sub(a));
        });
        If(T.lessThan(.015), () => { Break(); });
      });
    });
    return vec4(aFog, aInk, T, clamp(vp.z.negate().div(ZREF), 0, 1));
  })();
  const fogRT = rtt(march, null, null, { type: THREE.HalfFloatType });
  fogRT.setResolutionScale(0.5);

  const zAt = uv => perspectiveDepthToViewZ(depT.sample(uv).r, u.near, u.far).negate();

  // The smoke layers, composited on their own at half resolution: far to near, each only over what lies beyond its
  // distance. Returns the smoke's colour (already weighted) and how much of the scene still shows through it.
  const smoke = Fn(() => {
    const uv = screenUV, z = zAt(uv), acc = vec3(0).toVar(), T = float(1).toVar();
    // Atlas cells 0–5 are puffs, 6–8 wisps, 9–10 sheets, and 11 fine detail.
    // The procedural bake packs independent shapes into each of the four channels.
    const sampleCell = (index, local) => texture(atlas, local.mul(.96).add(.02).add(index).div(vec2(4, 3))).level(0);
    const sheet = (n, p, bank) => {
      const mirrored = p.mul(.5).fract().mul(2).sub(1).abs().mul(.999);
      const sample = sampleCell(vec2(n % 4, Math.floor(n / 4)), mirrored);
      return procedural ? sample.element(int(bank)) : sample.r;
    };
    const asp2 = screenSize.x.div(screenSize.y);
    const seedOffset = procedural ? (seed % 4093) * .109 : 0;
    const rnd = (c, k) => sin(dot(c, vec2(127.1, 311.7)).add(k)).mul(43758.5453).fract();
    const scatter = (q, layerSeed, first, count) => {
      const seed = layerSeed + seedOffset;
      const c = floor(q), f = q.fract().sub(.5);
      const sc = mix(procedural ? .54 : .56, procedural ? .71 : .78, rnd(c, seed + 1));
      const ang = rnd(c, seed + 2).mul(6.283), cs = cos(ang), sn = sin(ang);
      const offset = vec2(rnd(c, seed + 3), rnd(c, seed + 4)).sub(.5)
        .mul(max(float(.5).sub(sc.mul(procedural ? .70 : .62)), 0)).mul(2);
      const h = f.sub(offset);
      const p = vec2(h.x.mul(cs).sub(h.y.mul(sn)), h.x.mul(sn).add(h.y.mul(cs))).div(sc);
      let g = p.add(.5);
      if (procedural) {
        const squeeze = mix(.87, 1.16, rnd(c, seed + 8));
        const bend = rnd(c, seed + 9).sub(.5).mul(.54);
        g = vec2(p.x.mul(squeeze).add(p.y.mul(p.y).mul(bend)), p.y.div(squeeze)).add(.5);
      }
      const n = floor(rnd(c, seed + 5).mul(count)).add(first);
      const inside = step(0, g.x).mul(step(g.x, 1)).mul(step(0, g.y)).mul(step(g.y, 1)).mul(step(.16, rnd(c, seed + 6)));
      const sample = sampleCell(vec2(mod(n, 4), floor(n.div(4))), clamp(g, 0, 1)).toVar();
      if (!procedural) return sample.r.mul(inside);
      const bank = floor(rnd(c, seed + 7).mul(4));
      const neighbor = mod(bank.add(1), 4);
      const shape = mix(sample.element(int(bank)), sample.element(int(neighbor)), rnd(c, seed + 10).mul(.34));
      return shape.mul(inside).mul(mix(.86, 1.16, rnd(c, seed + 11)));
    };
    for (const L of [...veils].reverse()) {
      const s = texture(L.disp, uv).level(0);
      const tap = o => texture(L.disp, uv.add(o)).level(0).z;
      const e = .004, neighbors = tap(vec2(e, 0)).add(tap(vec2(-e, 0)))
        .add(tap(vec2(0, e * 1.65))).add(tap(vec2(0, -e * 1.65)));
      const blurred = s.z.mul(.64).add(neighbors.mul(.09));
      // Keep fine gaps opened by the blade from disappearing into the compositor's filter.
      const d = mix(blurred, min(s.z, blurred), smoothstep(.03, .45, s.w));
      // Sample the smoke where it was before the flow displaced it.
      const p = uv.sub(L.offU).add(s.xy.div(length(s.xy).div(40).add(1)).div(vec2(VW, VH))).mul(vec2(asp2, 1)).add(vec2(L.i * .37, L.i * .61)).add(vec2(u.time.mul(.006), 0));
      const bank = (L.i + seed % 4) % 4;
      const body = sheet(9 + L.i % 2, p.mul(.4), bank).mul(.55)
        .add(scatter(p.mul(.46), L.i * 17.3, 0, 6).mul(1.25))
        .add(scatter(p.mul(.7).add(.5), L.i * 5.1 + 40, 6, 3).mul(.55));
      const fine = sheet(11, p.mul(1.15), (bank + 1) % 4);
      const dd = max(d.mul(body.mul(1.5).add(.3)).sub(fine.oneMinus().mul(.18).mul(max(d.oneMinus(), 0))), 0);
      const foreground = 1 - Math.min(1, Math.max(0, (L.d - 4.2) / 8.2));
      const extinction = mix(1, u.foregroundDensity, foreground).mul(L.k);
      const a = float(1).sub(exp(dd.mul(dd).div(dd.add(.15)).mul(extinction.negate())))
        .mul(.95).mul(smoothstep(L.d, L.d + 1.4, z));
      const shade = clamp(float(.78).add(body.mul(.3)).sub(max(tap(vec2(-.012, -.02)).sub(d), 0).mul(.5)), .6, 1.04);
      acc.assign(mix(acc, u.paper.mul(shade).mul(L.tone), a)); T.mulAssign(a.oneMinus());
    }
    return vec4(acc, T);
  })();
  const smokeRT = rtt(smoke, null, null, { type: THREE.HalfFloatType });
  smokeRT.setResolutionScale(0.5);

  const final = Fn(() => {
    const uv = screenUV, px = vec2(1).div(screenSize);
    const z = zAt(uv), sky = float(depT.r).greaterThanEqual(1);
    const col = colT.rgb.toVar();

    // brush lines where depth breaks: width wanders, and the stroke runs dry in places
    const wob = texture3D(noise, vec3(uv.mul(vec2(2.3, 1.7)), .37)).level(0).r;
    const r = px.mul(u.dpr).mul(mix(.9, 2.4, wob));
    const lap = zAt(uv.add(vec2(r.x, 0))).add(zAt(uv.sub(vec2(r.x, 0)))).add(zAt(uv.add(vec2(0, r.y)))).add(zAt(uv.sub(vec2(0, r.y)))).sub(z.mul(4));
    const dry = texture3D(noise, vec3(uv.mul(vec2(31, 19)), .11)).level(0).b;
    const line = smoothstep(.01, .045, abs(lap).div(z)).mul(smoothstep(.2, .55, dry.add(wob.mul(.5)))).mul(exp(z.mul(-.018)).mul(.85).add(.15));
    // on anything coloured (the dry grass) the line is a darker stroke of that colour, not black: the field stays gold
    const mx = max(col.r, max(col.g, col.b)), sat = clamp(mx.sub(min(col.r, min(col.g, col.b))).div(max(mx, .001)).mul(1.6), 0, 1);
    col.assign(mix(col, mix(u.ink, col.mul(.45), sat), line.mul(mix(.9, .35, sat))));

    // far things wash out towards paper: distance is ink tone
    col.assign(mix(u.air, col, sky.select(0, exp(z.mul(u.haze).negate()))));

    // lay the half-resolution fog over, taking each of the 4 nearest fog texels only as far as its depth agrees
    const hs = floor(screenSize.mul(.5)), q = uv.mul(hs).sub(.5), b = floor(q), f = fract(q), zn = clamp(z.div(ZREF), 0, 1);
    const sum = vec4(0).toVar(), ws = float(0).toVar();
    for (let k = 0; k < 4; k++) {
      const o = vec2(k & 1, k >> 1), s = fogRT.sample(b.add(o).add(.5).div(hs));
      const wb = mix(f.oneMinus(), f, o), dz = s.a.sub(zn).div(zn.mul(.06).add(.004));
      const w = wb.x.mul(wb.y).add(.001).div(dz.mul(dz).add(1));
      sum.addAssign(s.mul(w)); ws.addAssign(w);
    }
    const fg = sum.div(ws);
    // the figure stays readable: fog thins over the body itself (not over what is behind it)
    const wp = u.camWorld.mul(vec4(getViewPosition(uv, depT.r, u.projInv), 1)).xyz;
    // (only above the feet, so the ground under the figure is not cleared into a pale disc)
    const near = (c, r) => float(1).sub(smoothstep(r.mul(.55), r, length(wp.sub(c).mul(vec3(1, .75, 1))))).mul(smoothstep(-.88, -.6, wp.y.sub(c.y)));
    // The visibility mask follows the figure's real silhouette and respects scene occlusion.
    // A little fog stays around the lower body while the hat, shoulders and robe emerge after a stroke.
    const upper = smoothstep(-.40, .18, wp.y.sub(u.hero.y));
    const playerMask = step(.75, subjectT.r);
    const reveal = playerMask.mul(u.heroClear).mul(mix(.57, 1, upper));
    // The same matte keeps the stagger, fall and wet ink legible inside the foreground veils.
    // The giant (marked .25) comes through from the chest up; its legs stay sunk in the fog.
    const giantMask = step(.1, subjectT.r).mul(step(subjectT.r, .4)), rise = mix(.3, 1, smoothstep(1.5, 5.5, wp.y.sub(u.hero.y)));
    const opponent = clamp(subjectT.r.mul(2), 0, 1).mul(playerMask.oneMinus()).mul(mix(1, rise.mul(2), giantMask)).mul(u.enemyClear);
    const keep = max(max(near(u.hero, u.heroR), near(u.hero2, float(1.35))).mul(.8), max(reveal, opponent).mul(.96));
    col.assign(col.mul(mix(fg.z, 1, keep)).add(u.paper.mul(fg.x.mul(keep.oneMinus()))).add(u.ink.mul(fg.y)));

    // the smoke layers, far to near: each is laid over whatever lies beyond its distance, so smoke passes both behind
    // and in front of things. A second tap towards the light shades each layer: thick smoke up-light puts this texel in shadow.
    const sm = smokeRT.sample(uv);
    // Leave a little of the scene visible when several foreground veils overlap.
    const coverage = sm.a.oneMinus();
    const smokeLimit = min(mix(.88, .19, reveal), mix(.88, .30, opponent));
    const smokeWeight = min(coverage, smokeLimit).div(max(coverage, .0001)).mul(u.smoke);
    col.assign(col.mul(coverage.mul(smokeWeight).oneMinus()).add(sm.rgb.mul(smokeWeight)));

    // the sword stroke goes on last, over the fog
    col.assign(mix(col, u.ink, strokeT.r.mul(.94).mul(max(keep.mul(1.25).oneMinus(), 0))));
    col.assign(mix(col, u.paper.mul(1.1), clamp(strokeT.g.mul(1.6), 0, 1)));  // the sword's light
    col.assign(mix(col, u.paper.mul(1.12), u.flash));                          // steel on steel: the whole picture blinks

    // ink settles into a few tones rather than a smooth grey ramp
    const lum = dot(col, vec3(.3, .59, .11)), ref = dot(u.paper, vec3(.3, .59, .11)), t = clamp(lum.div(ref), 0, 1.05);
    const band = floor(t.mul(5)).add(smoothstep(.3, .7, fract(t.mul(5)))).div(5);
    col.mulAssign(mix(t, band, .42).div(max(t, .001)));

    // paper: fibres, grain, and a little darkening towards the corners
    const asp = screenSize.x.div(screenSize.y);
    const fibA = texture3D(noise, vec3(uv.x.mul(asp).mul(9), uv.y.mul(150), .2)).level(0).b;
    const fibB = texture3D(noise, vec3(uv.x.mul(asp).mul(130), uv.y.mul(11), .7)).level(0).b;
    const grain = texture3D(noise, vec3(uv.x.mul(asp).mul(190), uv.y.mul(190), .45)).level(0).g;
    const c = uv.sub(.5), vig = float(1).sub(dot(c, c).mul(.42));
    col.mulAssign(float(1).sub(fibA.sub(.5).mul(.07)).sub(fibB.sub(.5).mul(.05)).sub(grain.sub(.5).mul(.06)).mul(vig));
    return vec4(col, 1);
  })();

  // a flat cut through the simulated box, for checking the physics: horizontal at height `slice`, or vertical at depth `slice`
  const slice = Fn(() => {
    const q = mix(vec3(screenUV.x, u.slice, screenUV.y.oneMinus()), vec3(screenUV.x, screenUV.y.oneMinus(), u.slice), u.sliceV);
    const s = texture3D(den, q).level(0);
    return vec4(mix(u.paper, u.ink, clamp(s.b.mul(1.5), 0, 1)).mul(mix(1, .55, s.r.oneMinus())), 1);
  })();

  const pipeline = new THREE.RenderPipeline(renderer);
  return {
    u,
    use(name) { pipeline.outputNode = name === 'slice' ? slice : final; pipeline.needsUpdate = true; },
    render() { for (const L of veils) L.offU.value.set(L.off[0] / VW, L.off[1] / VH);
      u.camPos.value.setFromMatrixPosition(camera.matrixWorld); u.dpr.value = renderer.getPixelRatio(); pipeline.render(); },
  };
}
