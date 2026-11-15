# 化墨 handoff

State on 2026-11-15. Read this before changing the solvers.

## What was asked

Design a fog-driven ink-wash action slice (third-person, free movement in fog, shapeshifting into animals), using
[Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden) as the reference. The owner then narrowed the goal:
**validate how to build a low-size, high-precision physics simulation on three.js.** Phones are not a hard target.
Size should be as small as practical, three.js stays.

## Decision on 2026-11-15 (second round)

The owner chose **solver A only** and asked for the ink-wash picture and motion to be polished. Solver B (the 2.5D
layer) was removed from the code; its measurements stay below as a record of why. The numbers in "Measured" marked
*round 1* predate the picture rework; the current ones are in "Current state".

## Round 3 (2026-11-15): figure, thicker fog, sparring

Owner feedback on round 2: direction right; body motion and skeleton detail too thin; fog not dense enough and not
stirred enough; add an enemy to spar with. The owner supplied a design sheet for the swordsman (straw hat, robe with
wide sleeves, ragged cloak on the back, baggy trousers, bound shins, sandals, sword) and said it may be simplified but
must be redrawn with an ink shader.

Done:

- `src/figure.js`: the swordsman as a 15-bone skeleton posed in code (gait with knee bend, lunge and wind-through for
  the stroke, raised-sword tell, stagger), limbs as tapered ink-washed shapes with a dark rim, and 22 cloth strips
  (cloak, robe hem, sash tails, hair) as verlet points drawn as camera-facing torn ribbons. Used twice: the player
  (pale robe) and the enemy (an ink shadow of the same figure with red eyes).
- `src/player.js`: `Enemy` (rises from ink, stalks and circles at sword reach, raises the sword with a vermilion
  blade before striking, reels when cut, dissolves after 3 cuts, comes back elsewhere) and `spar()` (cuts, clashes
  when both blades are live, blows taken, the tiger's roar as a push). A stroke turns to face the enemy within 7 m.
  Every blow adds a burst of ink and air to the simulation.
- Fog: extinction 0.19 -> 0.3, resting surface 2.7 -> 3.1 m, stronger shading and wisps, vorticity confinement
  0.25 -> 0.6, wider and stronger pushes from bodies and blades, two gusts of 2.6 m/s instead of 0.9. Up to 12
  emitters (was 8). Ink fades faster (0.25/s) so a fight does not flood the valley black.
- The tiger, crane and carp are still the primitive bodies; only the human form has the new figure.

`dist/index.html`: **866.6 KB raw, 242.8 KB gzip** (own code 54.3 KB raw). Whole frame on the M4: 5.8 ms at 720p,
7.0 ms at 1080p (simulation 3.8 ms). Checked with `?demo=spar` captures and the scripted live run; not played by hand.

Not done from the design sheet: the face, hands with fingers, the hat's torn brim, the gourd, the laced sandals.
No sound. No health or defeat for the player: blows taken only stagger and are counted in the corner.

## Round 4 (2026-11-15): all four forms rigged, health, dodge, guard

The owner approved both follow-ups from round 3.

- `src/strips.js`: the verlet ribbon system, now shared (cloth, feathers, fins, tails; tone 2 = vermilion).
- `src/figure.js`: face (nose, beard, brow), hands with a finger block and thumb, the hat's torn brim (16 strips),
  the gourd, a guard pose.
- `src/beasts.js`: tiger (two-mass spine, neck, head, jaw, four two-segment legs, gallop, rearing roar, striped
  hide, strip tail), crane (three-bone neck, two-bone wings with a lagging outer wing, 21 feather strips, trailing
  legs), carp (five-bone spine carrying a travelling wave, vermilion fin and tail strips). The primitive bodies in
  `stage.js` (`buildBodies`) are no longer used.
- Sparring: the player has 5 health; at 0 the body scatters into ink and returns at the start with full health.
  `Shift` dodges on the ground forms (0.28 s dash, untouchable). Right mouse or `Q` guards in human form and turns
  to face the enemy: a guard raised less than 0.25 s before the blow is a parry and throws the enemy open, otherwise
  it is a block. The corner line shows both health rows and counts of blows dealt, warded and taken.

`dist/index.html`: **871.4 KB raw, 244.6 KB gzip** (own code 58.6 KB raw). Whole frame on the M4: 5.9 ms at 720p,
7.1 ms at 1080p.

Checked with `node tools/check-spar.mjs spar|ward` (40 simulated seconds each): attacking run 19 cuts, 1 blow taken;
defence-only run 16 of 16 strikes warded, none taken. A run before the guard fix confirmed health loss, falling at
0 and the return at full health. Not played by hand.

## Round 5 (2026-11-15): death animation, mist bands, wakes

Owner feedback: the enemy needs a hit, fall and dissolve-into-ink animation; the fog still lacks visual design: fog
should pass in front of things, and things moving through it should disturb it the way a real fluid would.

- Enemy death (`Enemy` modes in `player.js`, `fall`/`melt` in `figure.js`): the last cut knocks it back, it topples
  onto its back with arms flung wide (0.45 s), then lies and flattens while ink pours out along the body into the
  simulation (1.15 s), then is gone.
- Mist bands (`fog.js`): patchy bands of mist from 0 to about 4 m above the fog sea, so fog crosses in front of
  rocks, pines and figures. Fast air tears them open.
- Flow-carried detail (`fog.js`): the renderer now reads the velocity field; the fine fog detail is looked up twice,
  displaced along the flow, and cross-faded, so wisps stream around moving bodies instead of scrolling uniformly.
- Wakes (`player.js`): the swordsman, tiger and enemy are solid bodies in the simulation (fog flows around them),
  each with a wider push that thins the fog along its path; the blade removes fog along the cut.

`dist/index.html`: 872.8 KB raw, 245.0 KB gzip. Whole frame on the M4: 6.1 ms at 720p, 7.8 ms at 1080p.
Checked with the scripted fight (no errors, enemy passes through fall and returns) and stills; the topple itself was
not seen frame by frame. Not played by hand.

## Round 6 (2026-11-15): weight of the stroke, hit feedback, fog as a body

Owner feedback: the swing is too even and has no force; a struck enemy has no particles or hit feedback; and the
picture reads as "waving black smoke on a white screen", not "pushing white smoke aside".

- Stroke rhythm (`swing()` in `player.js`): gather (35 % of the time, 8 % of the arc), snap (25 %, 80 %), trail off.
  The body lunges 7 m/s into the cut as the snap begins. The blade's push on the fog is three times wider and
  stronger during the snap, and it removes fog along the cut.
- Hit feedback (`main.js`, `buildSplash` in `stage.js`): time slows to 5 % for 5 frames (8 on a kill, clash or
  parry); 34 to 60 ink droplets fly off in the direction of the blow; a strong burst of air blows the fog open
  around the point of impact; camera shake is larger.
- Fog as a body (`fog.js`, `stage.js`, `player.js`): the blade now leaves almost no ink (1.6 during the snap, none
  otherwise; it was 8 throughout), hit bursts carry less ink, fog self-shadowing is much deeper (lit crests, grey
  hollows), fog extinction 0.3 -> 0.36, and the ground wash is darker (0.7 -> 0.42) so a cleared gap shows dark
  through white.

`dist/index.html`: 877.3 KB raw, 246.4 KB gzip. Scripted fight runs clean (cuts, a parry, kills, returns). The
swing's feel, the hit-stop and the droplets were not judged frame by frame; one pair of stills confirmed the fog now
reads as a shaded body with little ink. Frame cost was not re-measured this round.

## Round 7 (2026-11-15): the "black smoke" test — READ THIS FIRST

Owner: it still feels like black smoke being struck out; is the design wrong or is this impossible?

Test left in the build: the blade and hits emit no ink and remove no fog (fog is only pushed and thrown up), the air
behind is a grey wash, fog shading is light. Result from `?demo=slash` stills: the black smoke is gone, **but the
fog's reaction is now almost invisible** — the frame is white on white; only the brush stroke shows.

Conclusion: the simulation is not the limit. The limit is tonal: uniformly white fog has no visible internal motion.
Every way tried so far of making its motion visible added dark (ink, holes showing dark ground, deep self-shadow),
and a soft dark shape in white reads as black smoke. Thick fog also whites out any backdrop, so a grey sky does not
help while the camera sits inside it.

Untried direction that should work: thin, layered, translucent fog (extinction about a third of now) over a scene
with crisp recognisable dark detail (rock edges, grass, the enemy), camera a little above the layer, low side light
so crests catch light. Then a stroke changes how much sharp scene shows through — a veil parting — instead of
producing a soft dark blob.

## Round 8 (2026-11-15): thin veils over grey ground

Owner agreed with the round 7 diagnosis: a mass of white is not the point; they want white fog whose layers the
fluid simulation brings out, and suggested a slightly grey ground to set the fog off.

Changed: fog extinction 0.36 -> 0.13, mist bands 0.62 -> 0.85, moderate fog shading, air a lighter grey, ground a
mid grey (0.46) with crisper dabs, camera pitched further down (-0.36). The blade still emits no ink and removes no
fog. Stills of `?demo=slash`: no black smoke, grey ground and pillars show through a pale veil, **but the fog's
response to the stroke is faint in stills** — not yet judged in motion. Knobs: `kFog`, `wisp` and the shading
`mix(.55, 1.08, lit)` in `fog.js`; ground tone in `terrainMaterial` (`stage.js`); blade push in `bladeEmitters`
(`player.js`). Scripted fight still runs clean.

## Round 9 (2026-11-15): layered 2D smoke — the owner's new approach

Owner: nothing so far gives a real smoke effect; change the method. Put 4-5 flat fluid-simulation layers in the
picture at different depths, at least one between the character and the camera; when the player moves, every layer
computes its fluid response in real time; each layer is smoke on a transparent background with its own parameters.

Built: `src/veil.wgsl` + `src/veil.js`. Five camera-facing layers at 2.6, 4.6, 8, 12 and 18 m from the camera (the
first two are in front of the figure). Each is a 384 x 216 2D incompressible fluid (advect, 16 Jacobi sweeps,
project) with its own opacity, tone and amount of smoke. Smoke gathers below 3.6 m world altitude in drifting clumps
and billows under a slow shearing flow. Camera motion scrolls each layer by its own parallax. The player, both
blades and the enemy are projected into every layer and push it, weighted by how close their depth is to the
layer's. `fog.js` lays the layers over the scene far to near, each only over what lies beyond its distance, with a
second tap towards the light for shading. The blade emits no ink.

The 3D solver still runs underneath as a thin ground mist. Stills of `?demo=slash` show soft white billows in front
of and behind the figure. Whether a stroke visibly parts them was not judged in motion.

## Rounds 10-11 (2026-11-15): bolder, then softer, eight layers

Owner on round 9: direction finally right (smoke is being parted), but be much bolder: denser, far stronger push,
linear falloff. Then: edges too hard for smoke (want a long fade and strands drifting in front), try more layers,
and a stroke seems to move only one layer: make it move a band of depth around it regardless of exact position.

- Push: linear falloff in the splat (`veil.wgsl`); blade radius 3.4 m, drag 300, velocity gain 2.2; bodies 1.7 m.
- Blades use `reach: 8`: every layer within about 8 m of the blade's depth gets (nearly) the full push.
- Eight layers at 1.6, 2.7, 3.9, 5.2, 7.4, 10, 14, 19 m; the nearest is thin restless wisps.
- Soft edges: density diffuses slightly each step; the composite blurs each layer with 5 taps, uses a long-toe
  opacity curve capped at 0.94, and breaks the fading edge into drifting strands with noise.

Whole frame on the M4 with eight layers: 8.1 ms at 720p, 11.5 ms at 1080p (simulation 4.0 ms). Checked from two
stills and an error-free scripted fight; motion not judged frame by frame. Live at https://888wing.github.io/huamo/.

## Current state

`dist/index.html`: **854.5 KB raw, 238.1 KB gzip, 193.3 KB brotli** (three.js 811.8 KB raw, own code 42.2 KB raw).

Whole frame on the M4, simulation + render, no vsync, tour demo running:

| | frame | simulation | render and the rest |
|---|---|---|---|
| 1280 x 720 | 5.9 ms | 3.9 ms | 2.0 ms |
| 1920 x 1080 | 7.1 ms | 4.7 ms | 2.4 ms |

The render cost fell from 8.9 ms to 2.4 ms at 1080p by marching the fog at half resolution (`fog.js`).

The picture pipeline, in order (`src/fog.js`):

1. Scene pass: ink-toned materials (`stage.js`): pale pooled wash on flat ground, dry-brush streaks on rock, far
   mountains dark at the ridge and dissolving at the foot, lumpy pines, bodies as flat ink with one vermilion accent.
2. Half-resolution march of fog and ink into (fog light, ink, transmittance, depth).
3. Full-resolution composite: brush lines at depth breaks (width wanders, stroke runs dry), distance washes things
   towards paper, the fog is laid over with a depth-aware 4-tap upsample, fog thins over the figure itself so it
   stays readable, the sword stroke (own scene, own pass) goes on top, tones settle into five soft bands, then paper
   fibres, grain and vignette.

Motion added: sword stroke as a pressed-and-lifted brush band that runs dry; ink burst and swell on changing form;
procedural body motion (gait, lean, wing-beat, tail); camera lag and shake; two slow breezes that keep the fog alive.

What "AAA" still lacks, plainly: the bodies are primitives, not modelled and rigged characters; there is no sound;
pines and rocks are simple shapes; nothing here was judged by a person in motion at full frame rate. The look was
checked from scripted captures in headless Chrome only.

## The design that was validated

1. **The simulation owns the GPU device; three.js is a guest on it.** `createDevice()` requests the device,
   `new WebGPURenderer({ device })` renders on it, and the simulation hands its textures to three through
   `THREE.ExternalTexture` (with `is3DTexture = true` for volumes). The solvers are plain WGSL compute shaders with
   no three.js dependency, so they would move unchanged to a renderer without three.
2. **Zero assets.** Terrain, noise, bodies and fog are all computed.
3. **Small volume, fine cells.** Solver A simulates only a 32 x 12 x 32 m box around the player at 0.25 m cells and
   slides it in 2 m blocks; outside the box the fog is drawn at rest and the box's open sides agree with it.
4. **Each form is one fluid test:** sword stroke = line impulse, roar = divergence source, wing-beat = downward jet,
   carp = moving solid body.

## Measured in round 1 (Apple M4, Chrome, headless with the real GPU)

Size of `dist/index.html`: **853 KB raw, 237 KB gzip, 193 KB brotli.** three.js is 810 KB of the raw bytes, own code
42.6 KB. Baselines: an empty three.js WebGPU scene is 218 KB gzip, an empty WebGL one 130 KB gzip. The solver test
pages without three.js are 10-12 KB gzip.

Whole frame, simulation + render, no vsync:

| | 1280 x 720 | 1920 x 1080 |
|---|---|---|
| Solver A (3D, 128 x 48 x 128 = 786k cells, half-float) | 8.6 ms (sim 3.9) | 12.8 ms (sim 3.9) |
| Solver B (2.5D, 512 x 512, 8 sub-steps) | 6.1 ms (sim 2.9) | 9.0 ms (sim 3.0) |

Solver A stages: advect fog+ink 0.65, advect velocity 0.73, forces 0.53, pressure 1.67, project 0.25 ms.

Solver A correctness (`src/tests/a-basic.js`, a 10 m/s push for 1 s, then 2 s free):

| Setting | Divergence left after the solve | Kinetic energy kept over 2 s | Ink total over 2 s | Step |
|---|---|---|---|---|
| half-float, MacCormack, 1 V-cycle (default) | 3.3 % | 58.5 % | +4 % | 3.9 ms |
| half-float, MacCormack, 2 V-cycles | 1.0 % | 58.5 % | +4 % | +1.7 ms |
| half-float, plain semi-Lagrangian | 3.0 % | 44.6 % | -11 % | -0.5 ms |
| 32-bit float, MacCormack, 1 V-cycle | 3.3 % | 69.7 % | +7 % | +2.4 ms |

Resting fog stays at rest: peak speed 4e-4 m/s with half floats, 2e-8 m/s with 32-bit floats.

Solver B correctness (the solver and its test were removed in round 2; kept as a record):

- Resting fog: peak speed 2e-6 m/s.
- Fog total after a stirred 3 s: changed by 1.5e-8 of itself. Ink total: 2e-8. (Flux form, 32-bit state.)
- Dam break on a dry bed against Ritter's exact solution, 6 s: L1 error 2.8 %, **but the front is at 4.6 m where the
  exact one is at 12 m.** The body of the wave is right; the dry front lags badly.

Phenomena, checked in slice views (`out/validate.png`, `out/v_carp2.png`):

| Form | Solver A | Solver B |
|---|---|---|
| Sword stroke | gap opens, edges roll up | not captured |
| Roar | circular cleared region with a sharp front | ring wave with a depression inside |
| Wing-beat | fog pushed down and thrown up on both sides, curling (vortex-ring cross-section) | not captured in slice; in the scene it shows as tall thin curtains, which looks wrong |
| Carp | thin ink trail; **no alternating vortex street** | narrow wedge wake (the carp is far faster than the layer's wave speed) |

## Findings worth keeping

- **Read-write storage textures are slow on Metal.** In-place red-black relaxation on a `read_write` r32float texture
  cost 4.2 ms; the same sweeps between two textures (read one, write the other) cost 2.6 ms.
- **Multigrid beats plain relaxation by a wide margin.** 16 red-black sweeps on the fine grid: 10 % divergence left
  at 5.1 ms. One V-cycle over 4 levels: 3.3 % at 1.7 ms.
- **A warm-started pressure solve can be unstable even when the solver converges.** One undamped V-cycle per frame
  blew up; two were fine. Leftover divergence stays in the velocity field and comes back next frame, and the
  warm start doubles the error the solver sees, so any error mode the cycle over-corrects by more than a third grows
  from frame to frame. Applying 85 % of the coarse correction (`DAMP` in `mg.wgsl`) fixes it.
- **MacCormack inside is second order already.** A midpoint back-trace added 1 ms and changed nothing measurable.
- **Half floats cost about a sixth of the kinetic energy** over 2 s compared with 32-bit floats, and save 2.4 ms.
- **Semi-Lagrangian advection does not conserve.** MacCormack's limiter clips undershoots around a blob and so
  gains mass (+4 % in 2 s); plain semi-Lagrangian loses it. Solver B's flux form conserves to rounding.
- **A divergence source must thin what it expands**, or it manufactures fog.
- **Buoyancy has to be measured against the resting profile**, otherwise the box's open sides drain the fog.
- WGSL reserves `smooth` and `restrict` as identifiers.

## Known problems

- Solver A: a solid body pushed into terrain produced speckle noise in the fog (seen once, when the carp demo
  started inside the plateau). Cause not confirmed; enclosed pockets of fluid with no pressure reference are the
  suspect.
- Solver A: no vortex street behind the carp at 0.25 m cells.
- The simulation takes one fixed 1/60 s step per rendered frame, so it slows down if the frame rate drops.
- No combat, no ink resource, no enemies. The bodies are still primitives.
- Not tested: Safari, Firefox, Windows, any phone, a real interactive play session (all checks were scripted runs in
  headless Chrome).

## Tools

- `tools/run.mjs <page> "?query"` opens a built page in headless system Chrome and prints `window.__report`.
- `tools/ta.sh "?f32=0" ...` runs the solver A test once per query. Build it first:
  `node build.mjs --readable --entry=src/tests/a-basic.js --out=dist/t-a.html`.
- `tools/capture.mjs` steps the page deterministically (`?manual`, `window.__advance(n)`) and writes frames, a
  contact sheet and optionally an mp4. `--set='{"view":"slice","slice":0.3}'` switches to the slice view.
- `tools/bench.mjs` measures whole-frame cost.
- Pages are opened from `file://`; that is why the build inlines everything.

## Next steps, in the order I would take them

1. Owner plays `dist/index.html` and judges the look and feel in motion.
2. Real bodies: model and rig the four forms in Blender, export glTF, keep the flat-ink material.
3. Sound: wind, the stroke, the roar, wings, water-like movement for the carp.
4. Composition pass on the valley: rock shapes, more varied pines, a waterfall or bridge as a focal point.
5. Then the game: the ink resource, enemies made of fog.
