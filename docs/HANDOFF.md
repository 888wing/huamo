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

## Rounds 12-13 (2026-11-15): ten layers, then photographed smoke

Owner: the fluid motion now feels right; the smoke's edge texture does not. They asked whether supplied textures
would help, then generated 12 greyscale smoke photographs to my spec (`assets/smoke/`: 6 puffs, 3 wisps, 2 sheets,
1 fine detail; 1024 px, black background). They want realistic smoke, not ink-wash smoke.

- Ten layers (six between camera and figure, more restless the nearer). The bright ring at puff edges and the
  edge-strand noise (which showed as flakes once layers stacked) were removed.
- `tools/atlas.sh` packs the 12 pictures into `assets/smoke_atlas.jpg` (4 x 3 cells of 512 px, 125 KB), which the
  build embeds as a data URL (`loader: { '.jpg': 'dataurl' }` in `build.mjs`).
- `fog.js`: each layer's simulated density is multiplied by photographed smoke (a sheet, a puff and a wisp cell,
  different per layer) and eroded at its edges by the fine-detail cell. The photographs are attached to the layer
  (`off` scroll), pulled by the layer's velocity, and drift slowly. The simulation decides where smoke is and how
  it moves; the photographs decide what it looks like.

`dist/index.html`: 1046.6 KB raw, **347.6 KB gzip** (+98 KB for the atlas). Stills show real billowing puffs with
wispy edges. Known: the puff cells repeat in a visible grid in places. Motion not judged frame by frame.

## Round 14 (2026-11-15): pictures carried by the fluid, scattered puffs

Owner approved both follow-ups.

- Carried pictures: each layer now also advects a displacement field ("how far the smoke here has been carried",
  `eI`/`eO` in `veil.wgsl`), relaxing back at 1.7/s and clamped to 90 texels. `project` writes displacement and
  density into one texture (`E0`), which is the only texture the renderer reads per layer. `fog.js` looks the
  photographs up at the displaced position, so they bend and curl exactly as the fluid moved, then settle.
  With a slow relax (0.3/s) the ambient flow smeared every picture flat: keep it fast.
- Scattered puffs (`scatter` in `fog.js`): one picture per lattice cell with its own size, rotation, offset and
  choice of picture; 16 % of cells left empty. Replaces straight tiling for puffs and wisps.
- The composite hit the default limit of 16 sampled textures per shader stage; density and displacement were merged
  into one texture per layer, and `createDevice` now asks for up to 32 where the adapter allows.

Stills of a stroke show the smoke swept into curved bands along the blade's arc and curled puffs afterwards.
Not judged in motion.

Round 14 follow-up: the carried pictures stretched into long smears with a hard arc after a strong stroke, and the
whole frame reached 16.9 ms at 1080p. Fixed by (1) letting the pull saturate smoothly (about 40 texels at most) and
(2) compositing the smoke layers in their own half-resolution pass (`smoke` / `smokeRT` in `fog.js`), returning
weighted colour and transmittance. Now 8.6 ms at 720p and 11.6 ms at 1080p on the M4.

Round 15 (2026-11-15): the owner found it ugly to keep seeing whole smoke pictures and asked for every picture to be
at least twice as large. Lookup scales in `fog.js` were more than halved (sheet 0.9 -> 0.4, puffs 1.5 -> 0.46 with
smaller in-cell scale, wisps 2.2 -> 0.7, detail 2.6 -> 1.15). Two seams appeared once enlarged and were fixed: the
sheet and detail cells now repeat mirrored (`cellM`), and a rotated puff is kept wholly inside its lattice cell
(in-cell scale 0.56-0.78, offset limited to 0.5 - 0.62 x scale) so the cell boundary can no longer cut it.

Round 16 (2026-11-15): the owner wants the blade to cut the smoke picture where it actually is — the two sides part,
the picture ends up split and then slowly dissolves — instead of the whole mass moving together "like a sealed dome";
and foreground smoke dense enough to hide part of the figure.

- A push in `veil.wgsl` is now a line (`Splat.q` holds the end point and a split speed): smoke within the radius
  is carried, pushed apart from the line to both sides, and thinned.
- `main.js`: a blade meets each layer only at the point along its length whose view depth matches that layer
  (weight falls off over 2.1 m of depth), as a short line 1.9 m long, radius 1.15 m during the snap, split 75,
  density -45/s. As the stroke sweeps, that point travels across the layer and leaves a cut.
  The earlier whole-blade push on every layer is what looked like a dome.
- Near layers: more smoke, and it gathers up to 5-7 m altitude instead of 4.4 m, so it crosses the figure.
  A first setting hid the figure completely and was eased by about a third.

Round 17 (2026-11-15): smoke parked. Owner asked for refined body motion, weight when blades meet, and a sword-light
shape with variation (it read as a rectangular brush stroke).

- Sword light (`buildTrail` in `stage.js`, `arc()` in `main.js`): a crescent between a point partway down the blade and
  the tip — thin at both ends, widest at the snap — crisp on the outer edge, feathered inside, drying into streaks.
  The stroke scene's green channel carries a white light along the fresh outer edge; red is ink coverage.
- Body (`figure.js`): the stroke has three poses blended by phase: gather (crouch, sword arm drawn back and bent,
  torso wound past the start), snap (hips lead, lunge, wrist breaks), and rising out; the head tracks the target.
- Steel on steel (`main.js`, `fog.js`): clash and parry stop time for 13 frames, throw 110 droplets, blink the
  picture white (`u.flash`) and punch the lens in by 6 degrees of field of view, both decaying within a few frames.

## Round 18 (2026-11-15): the slice the owner wants, and its first two steps

Owner: the feel is right now, fog density included. The slice: the player walks a forest path lined with bushes and
trees, meets a few enemies on it, and at the end a gigantic enemy attacks; the player must use the different forms to
run up onto its head and drive the sword in. Build it step by step.

Plan: (1) refine the figure and make the cloth sit on it, (2) path, more trees, bushes, grass, (3) enemies placed
along the path, (4) the giant at the path's end, (5) climbing it with the forms and the final stab.

Done this round, steps 1 and 2:
- Figure (`figure.js`): a solid robe skirt to mid-thigh, a shoulder mantle, neck and crossed collar under the
  cloth; the torn hem now hangs from the skirt's rim; cloak strips start under the mantle; smoother limbs.
  `Strips` has `stiff`: the first segment of each strip is held along its rest direction so cloth leaves the body
  at a fixed angle instead of hinging on a point.
- Scene (`world.js`, `stage.js`): `PATH` (6 points, south to north) and `pathDist()`; the terrain shader draws the
  path as paler worn earth with a broken ink edge; 46 more pines standing 3.4 m back from the path; 240 bushes and
  1300 grass tufts as instanced meshes, thicker near the path. Foliage shapes are smooth lumps (position-based
  bumps), after per-vertex jitter looked like angular slabs up close.

Not done: nothing collides with trees or bushes; the camera can pass through them; the demos do not walk the path;
the path was not seen clearly in the stills (fog over it). Frame cost unchanged: 8.4 ms at 720p, 11.5 ms at 1080p.

## Round 19 (2026-11-15): step 3 — enemies along the path, solid trees, reeds

Owner: enemies met one at a time along the path; trees must collide; grass should be like Ghost of Tsushima — reeds
below waist height that move when the figure moves; the grass looked sparse.

- Enemies (`Enemy` in `player.js`): four stations at 20/40/60/80 % of the path (`pathPoint`). Each stands in the fog
  (`wait`) until the player is within 8.5 m, fights, and when it has melted the next one appears at the next station.
  After the fourth the enemy is `done`. The corner line shows which of the four is up. Player starts at (1.5, 19).
- Trees: every ground pine registers its trunk in `OBSTACLES` (`world.js`); `pushOut` keeps the player, the enemy and
  the camera outside them.
- Reeds (`stage.js`): about 11,000 instanced tufts of nine blades, 0.75-1.15 m, some with a plume, standing 1.25 m
  back from the path's centre and thinning with distance from it. The vertex stage sways them in the wind and leans
  them away from the player and the enemy within 1.8 m. Replaces the 1300 short tufts.

Whole frame on the M4: 8.7 ms at 720p, 12.4 ms at 1080p. Scripted run: all four enemies met in order and defeated.
Seen in two stills: a dense reed field with the path through it. Reeds leaning from movement was not checked in motion.

## Round 20 (2026-11-15): step 4 — the giant; gold reeds; pines redrawn

Owner: sent the design sheet for the boss, 巨相撲鬼 (a giant sumo demon: topknot, twisted rope belt hung with folded
paper, ragged skirt, bare feet, about six swordsmen tall). The reeds' white triangle plumes were too loud: keep only
the grass and make it yellow. The background trees' foliage shapes were ugly. Density and mood were right.

- Reeds (`stage.js`): plumes removed, eleven blades per tuft, ochre at the root to straw gold at the tip. The depth
  line pass (`fog.js`) now draws its line as a darker stroke of the pixel's own colour on anything saturated, so the
  field is not inked grey. New uniforms: `press` (three heavy things with a radius: the giant's feet and a hand) and
  `ring` (a shock running outwards: the whole field bows as it passes).
- Pines (`stage.js`): the stacked discs are gone. A pine is now a crooked trunk (a tube along a wandering spine),
  4-6 branches on alternate sides, and along each branch a row of needle tufts. A tuft is three crossed upright
  cards; the material cuts each into a fan of needles (two rings, constant needle width, each needle its own length;
  far away the needles fatten and close up; within 3.4 m of the lens they drop out one by one). All wood is one
  mesh and all needles another: two draw calls for every tree and bush, where there were about 450. Bushes are the
  same tufts bunched on the ground. `buildBodies` (unused since round 4) was removed.
- World (`world.js`): `START` (the player now begins at (0.4, 22.5)), `ARENA` and `arenaDist()` (a clearing with no
  pines or bushes round the giant), the sixth pillar moved from (2, -14) to (9.5, -16) so it stands at the clearing's
  edge, `pushOut(p, pad, list)` takes any list of circles. Enemy stations are now at 22/38/54/70 % of the path.
- The giant, logic (`src/boss.js`, no three.js): `Giant` waits in a wrestler's crouch at `ARENA.home`, wakes when the
  fourth shadow is done and the player is within 12.5 m, rises (2.4 s), bellows, stamps once, then fights:
  `stomp` (leg up 0.85 s, held 0.32 s, down in 0.13 s; a ring runs out at 14 m/s and takes 1 health from anyone
  standing on the ground when it passes, out to 11.5 m: jump it, dodge through it, or be in the air),
  `slam` (arm raised 1.05 s, aimed until 72 % of that, strike 0.2 s; 2 health within 2.7 m of the palm; the hand then
  lies on the ground for 1.7 s), `step` (one pace, never more than 2.4 m from home). A sword stroke on the lying hand
  makes it flinch; on an ankle it only throws ink. **The giant cannot be killed yet: that is step 5.**
  `emitters()` / `stir()` feed the 3D fog and the smoke layers from where its hands and feet really are;
  `solids()` are the circles the player cannot walk through. `stir()` also thins the smoke in front of its chest and
  head through every layer between it and the eye (a density sink with `reach`), so the raised arm or leg that
  announces a blow can be read through the fog; its legs stay sunk in it.
- The giant, body (`src/giant.js`): `GiantRig`, 15 bones, one unit = its full height, scaled to `GH` = 10.5 m.
  Torso as overlapping ellipsoids, limbs as turned shapes (`limb()`), fingers that curl as one, toes, face with a
  scowl and vermilion eyes that light when it wakes, rope (torus with a twisted-strand pattern), five paper
  streamers on spring pendulums, 50 verlet strips (skirt in two layers, hair, rope tails). Every mass also has a
  back-face ink shell whose width wanders: that is the heavy brush outline. Legs are posed against the ground,
  not the pelvis; soles are set flat from the shin's world rotation; the body is dropped so its lower foot stands on
  the terrain; arms reach with a two-bone solver (`reach()`: crouch fists, the slamming palm).
- `main.js`: giant events become shake, flash, lens punch, hit-stop, ink, a divergence burst in the 3D fog and a
  `blast` in the smoke layers (a point splat that pushes outwards and thins); camera drops back 70 % and looks up
  while the giant is awake; a fall after waking it brings the player back at (-1, -6), and after each shadow at the
  spot it fell. Emitter limit 12 -> 16; emitters outside the simulated box are not sent. `?boss` skips the four
  shadows. `?hide=needles,wood,reeds,giant` hides parts for measuring. `__set({clear:true})` switches fog and smoke
  off to look at models. Demos: `boss` (a scripted bout), `stand` (a player who does not defend), `oni` (a walk
  round the giant).
- `tools/check-boss.mjs [seconds]`: runs the bout and prints the mode sequence, how far the planted hand lands from
  its aim, how low the soles sit, the tally and any errors.

Measured, scripted, 60 s bout: 8 slams and 5 stamps, no errors; the planted hand is at most 0.9 m from its aim at the
instant of impact and on it 0.3 s later (the palm centre rides 0.4 m above the ground point); the lower sole is within
2 cm of the ground throughout. That player dodged everything; a second scripted player who only walks up and stands
there (`?demo=stand`) was hit 10 times in 50 s, fell and came back, with no errors. Whole frame on the M4 with another session using the GPU at the same
time: 9.3 ms at 720p, 13.5 ms at 1080p (round 19: 8.7 and 12.4). With needles, giant and its emitters hidden: 8.9 and
12.6 ms.

Bugs found on the way, worth remembering:
- A child bone's rotation is relative to its parent: pitching the pelvis forward 56 deg carried the thighs with it,
  so a "deep squat" stood nearly upright. Legs are now posed in ground terms (`thigh.x - hipX`).
- The wind-up lean stayed on through the strike, so the body never bowed far enough for the hand to reach.
- Ground height in the arena is about 0.9 m, not 0: reach estimates made from the origin were all short.

**Another session (Codex) was changing the smoke system in the same working tree during this round** (procedural
smoke atlas, blade cut strips, `fogDensity`). Its edits were left uncommitted and untouched; this round's commit and
the deployed page were built in a separate worktree from this round's changes only.

## Round 21 (2026-11-15): the Codex session integrated; a sweep for blind spots

While round 20 was being built, a Codex session worked in the same checkout. The owner prefers its fog and asked for
its work to be integrated and swept. Its own notes are in [CODEX-SESSION-HANDOFF.md](CODEX-SESSION-HANDOFF.md)
(Chinese): procedural smoke atlas (`--procedural-smoke`, `src/smoke-procedural.*`), denser foreground veils capped at
88 % cover, blade seams and walking wakes that carry density (`transportCount` splats in `veil.wgsl`), a
`subjectMask` MRT target that lets the hero and the opponent show through the foreground veils, a three-stroke combo
(`SWORD_MOVES`, `swordTiming`, `comboBladeAt` in `player.js`), a point-by-point sword trail, reeds pressed by the
hero's soles (`tread`), a clearing for the first duel (`DUEL_CLEARING`), hit feedback table and ground ink
(`src/combat-fx.js`), a more detailed hero (`figure.js`, `{ detailed: true }`), and camera shake and punch-in done
as a CSS transform on the canvas so fog and scene share one stable projection.

Integration changes made on top of it:

- **The 3D fog march was the hidden cost.** A level or upward view makes every ray run all its steps: the giant
  fight cost 17.8 ms a frame at 1080p (13.4 ms of it render), where the tour demo, which looks down, cost 13.8 ms.
  Hiding the giant, reeds, needles and wood together changed that by 1.3 ms; the step count changed it by 7.7 ms.
  Default `STEPS` 56 -> 28 (`?steps=56` restores it). Against 56 the picture differs by 48-62 dB PSNR, i.e. not
  visibly, because the 2D veils now carry the look.
- **The giant was nearly invisible behind the denser veils.** It is now in the subject matte at its own value
  (.25, `markSubject(giant, .25)` in `fog.js`); `main.js` drives `enemyClear` from its state (22 % asleep, 50 %
  awake, 100 % while a leg or arm is raised or the hand lies on the ground). In the compositor the reveal grows with
  height, so its legs stay sunk in the fog and it comes through from the chest up.
- **A low camera looked out through a wall of yellow blades** (tiger form in the reed field). Tufts within 0.9-2.6 m
  of the lens now shrink to nothing.
- Smoke splats per layer 10 -> 14 (`MAXS`): blade strips, a wake, two bodies, the giant's six parts and two blasts
  did not fit, and the blasts were the ones dropped.
- Demos `journey` (the four shadows, then on to the giant) and `spin` (fast camera swings); `tools/check-spar.mjs`
  takes a duration and reports the giant's state; both check tools take `PAGE=` to run against either build.
- The page deployed from the repo root is now the **procedural** build (`cp dist/smoke-procedural.html index.html`):
  it is what the Codex review videos were recorded from and it is a quarter smaller. `node build.mjs` still makes
  the photographed-smoke build.

Measured after integration (Apple M4, headless Chrome with the real GPU, nothing else on the GPU):

| | photographed smoke `dist/index.html` | procedural smoke `dist/smoke-procedural.html` |
|---|---|---|
| size, raw / gzip | 1128.7 KB / 378.2 KB | 972.7 KB / 282.7 KB |
| frame, tour demo, 720p / 1080p | 8.1 ms / 10.5 ms | 8.4 ms / 11.2 ms |
| frame, giant fight, 720p / 1080p | not measured | 9.2 ms / 13.3 ms (was 10.9 / 18.0 with 56 steps) |

Scripted checks, run on both builds with identical results and no console errors: `spar` (four shadows down in 25 s),
`ward` (15 blows warded in 40 s, none taken), `journey` (shadows, then the giant wakes at 28 s and fights on to 90 s),
`boss` (8 slams, 5 stamps in 60 s; planted hand at most 0.91 m from its aim at impact; soles within 1 cm of the
ground), `stand` (a player who does not defend is hit 10 times in 50 s, falls and returns). The demos `combo`,
`fogwalk`, `reeds`, `smokecut`, `slash`, `roar`, `flap`, `carp`, `tour` and `spin` each ran on the procedural build
without errors and were looked at as contact sheets, not as video.

Found and left for the owner to decide:
- **A shadow now dies to one three-stroke combo** (1 + 1 + 2 damage against 3 health), so in the scripted runs the
  four shadows never get to attack: guard, parry and dodge are no longer needed against them.
- Camera shake and punch-in are a CSS transform of the canvas: screenshots and the page show it, but anything that
  reads the canvas pixels directly (a recorder using `captureStream`) will not.
- The first shadow stands at the clearing 9.7 m from the start, inside its 8.5 m wake distance after two steps.
- Not exercised by any script: the ring or palm hitting a player in the air, guard against the giant, the three
  beast forms against the giant, a window resize, and anything on a real phone.

The plan for the next three pieces of work (player motion, beast transitions, the giant's staging and the climb to
its head) is in [PLAN-NEXT.md](PLAN-NEXT.md) (Chinese).

## Round 22 (2026-11-15): the swordsman's motion

The owner's answers to the plan's questions: carp = guard pressed again while guarding; one shared ink gauge for the
beasts; the giant dies to one stab (a game-jam slice, keep it short); brush onomatopoeia yes; sound after all the
visuals; shadows get more health. Then the first item of [PLAN-NEXT.md](PLAN-NEXT.md) was built.

- `figure.js`, `update()` rewritten. The pose is built in four layers, each laid over the one before with a weight:
  ground (stand, walk, the leaning run), air (rise, top, fall, landing), action (guard, block, parry, the three
  strokes exactly as the Codex session posed them, hop, roll, the stab from the air), reaction (a cut from any side,
  a heavy blow, thrown and getting up, dying). Bones follow their targets on springs (stiffness per state, damping
  ratio 0.8), so poses overshoot a little and settle.
- **Planted feet.** `plant()` keeps a world point per foot. A planted foot does not move; when the body has gone on
  by half a stride it lifts, swings to where the body will be, and plants again (the foot furthest behind goes
  first; in a run the next may leave before the last lands). `reachLeg()` is a two-bone solver with the knee
  forward. The hips are held low enough for both planted feet to be reached: that is the walk's rise and fall. Legs
  are posed directly (no solver) in the air, in strokes, rolls and falls; the feet's memory follows them, so there
  is no jump when the solver takes over again. The shadows use the same code.
- Root motion: `pitch` turns the body about a `pivot` above the feet (a roll goes over its own middle), `roll` banks
  it into turns from the yaw rate, lean follows speed and acceleration.
- The sword can be held point down (`grip`): its world orientation is set upright whatever the arm does. Used by the
  stab and by the kneel before dying. The sheathed sword now points backwards (it pointed forwards since round 3).
- `player.js`: `Player.hurt(kind, from, power, back)` is the one way in for damage (1 a cut, 2 heavy, 3 thrown);
  `invuln` replaces the bare `dodge > 0` tests; `pose()` hands the figure everything it needs; `events` tells
  `main.js` about jumps, landings, the stab and being floored, which become bursts in the fog. Jump height follows
  how long the key is held. Dodge with no direction is a hop back (0.30 s, 3.2 m, untouchable 0.05-0.22 s); with a
  direction a roll (0.42 s, 4.2 m, untouchable 0.06-0.30 s); a press of attack late in a dodge cuts straight out of
  it. Attack in the air is the stab downwards (2 damage where it lands). A parry opens the enemy to double damage
  for 0.9 s. Thrown: in the air, 0.35 s down, 0.6 s getting up (untouchable from landing); jump pressed in the air
  lands it standing. Death takes 2.6 s (`DEATH`), slowed at the start, and bleeds ink into the 3D fog.
- The giant's blows now throw the player (`pl.hurt(3, ...)`). Shadows have 6 health (`maxHp`).
- Demo `moves` (`MOVE_SEQ` in `demos.js`); `tools/check-moves.mjs` measures it; `tools/strip.sh` makes a close-up
  strip of any stretch of a demo; `tools/moves-times.mjs` prints when each move starts.

Measured by `check-moves.mjs`: 85 stances, a planted foot slides 0.5 cm on average and 4.0 cm at worst (one stance,
in the tight circle); hop 3.33 m in 0.30 s, roll 4.32 m in 0.42 s; a tapped jump reaches 1.05 m, a held one 1.75 m;
thrown and back in control in 1.55 s, or 0.35 s with the recovery; death to standing again 2.9 s.
Regression on the procedural build after the change, no console errors: `spar` (the four shadows, now 6 health each,
down in 37 s), `ward`, `journey` to 110 s, `boss`, `stand`. Whole frame, tour demo: 8.3 ms at 720p, 11.1 ms at 1080p.
`dist/smoke-procedural.html` 986.8 KB raw, 287.9 KB gzip (5 KB more than round 21); `dist/index.html` 382.7 KB gzip.

Not done from the plan's first item: the skid when stopping from a run has no pose of its own (the lean follows the
deceleration, nothing more); a hard landing rolls only when the fall is faster than 13 m/s, which nothing in the
slice reaches yet; the hat does not lag behind the head. Seen only as frame strips and in two recordings, not played.

## Round 23 (2026-11-15): changing form

Step 3 of [PLAN-NEXT.md](PLAN-NEXT.md): a beast comes from pressing a move's key again in the middle of the move.

- `player.js`: `shift(f)` and `revert(move, foe)`. Jump pressed again in the air is the crane; dodge pressed again
  during a hop or a roll is the tiger; guard pressed twice within 0.4 s is the carp. One gauge, `ink` (0..1), is
  shared: a beast spends it at 1/`SHIFT_TIME` (5 s from full), the swordsman regains it at 1/`REFILL` (8 s) plus
  `INK_PER_CUT` (0.1) for every cut that lands; below `SHIFT_MIN` (1/3) a change is refused. When the ink is gone
  the form reverts where it is (a crane's rider falls, and a long fall ends in the hard-landing roll). A press of
  attack as a beast reverts early with a blow: tiger -> the overhead cut out of a pounce, crane -> the stab from the
  air, carp -> the rising cut out of the fog. A blow taken knocks the beast out of it. The change itself lasts
  `MORPH` (0.22 s) and nothing can hurt during it. A beast's old own move (roar, hard wing-beat) is on the guard
  key, since attack now means "back to the sword". `setForm()` (demos, the number keys with `?debug`) sets `free`:
  no gauge, no limit, and the beast's move stays on attack.
- The change is drawn with both bodies present for those 0.22 s (`main.js`): the one leaving gets `streak` (the
  swordsman is drawn up into a vertical streak, or down into the fog when the carp is coming; a beast is drawn out
  along its length), the one arriving gets `grow` (swells from a fifth of its size; the crane's wings come up
  folded and open, the tiger arrives curled with forepaws reaching and straightens). A small breath of ink and a
  push on the smoke layers mark the spot.
- The gauge on screen is one brush stroke (inline SVG with a turbulence filter) at the foot of the picture: it
  shortens as it is spent, paper-coloured streaks show through as it dries, it greys below a third, and the
  character beside it names the beast. It is hidden while full.
- Demo `shift` (`SHIFT_SEQ`), `tools/check-shift.mjs`.

Measured by `check-shift.mjs`: crane 2.40 s out with the stab, tiger 2.27 s out with the overhead cut, carp 2.50 s
out with the rising cut; a full gauge lasts 5.017 s (301 frames); ink returns at 0.1250 per second; horizontal speed
carried over the change 100 %, 91 % and 100 %; a second jump pressed with the gauge at 0.32 changed nothing.
Regression on the procedural build, no console errors: `spar`, `ward` (the double-tap for the carp is not set off by
ordinary guarding: 17 blows warded, form unchanged), `journey` to 100 s, `boss`, `stand`, `moves` (numbers unchanged
from round 22). Whole frame, tour demo: 8.3 ms at 720p, 11.2 ms at 1080p. `dist/smoke-procedural.html` 993.3 KB raw,
290.1 KB gzip; `dist/index.html` 385.0 KB gzip.

Not done: the beasts' rigs and motion are as they were in round 4 (step 4 is next); the tiger does not yet run on
surfaces; a beast has no reaction of its own to a blow, it just reverts. Seen as frame strips and two recordings.

## Rounds 24-25 (2026-11-15): the beasts' bodies; the giant staged, climbed and killed

The owner: "implement everything in the plan". Steps 4-7 of [PLAN-NEXT.md](PLAN-NEXT.md); sound is left for after.

Step 4, `beasts.js` rewritten:
- Tiger: pelvis -> loin -> chest spine that arches and flattens through the gallop, three-segment legs with paws
  (the two of a pair land 0.38 rad apart), shoulder blades, a moment off the ground, a lean and a spine bend into
  turns, `st.slope` to pitch the whole body along a surface.
- Crane: wings of three bones; the outer wing drops on the upstroke; glides when fast and level (`C.glide`), banks
  by its turn rate, tucks and sweeps the wings back to dive, legs come down near the ground.
- Carp: seven vertebrae, a five-strip tail, dorsal, pectoral, pelvic fins, barbels; rolls into turns; at the fog's
  surface jump throws it clear (`breach`) and it follows its arc nose first.
- Off the ground as tiger or carp, jump pressed again hands on to the crane. The crane's ceiling is 16 m (was 8).

Steps 5-7:
- **The giant's new moves** (`boss.js`): `sweep` (the hand goes down at its own side, then scythes across the front
  in 0.42 s; 1 damage to whoever is under 1.25 m off the ground where it passes), `charge` (a wrestler's start for
  1 s, then 6.5 m forward in 0.55 s; 2 damage) and `back` (paces backwards to its mark). A cut on the lying hand
  pins the arm for `STUN` = 3 s, once per slam. `die()` -> `dying` (`DYING` = 6.5 s: reel, sway, fall like a tree
  at 56 %, flatten and run out) -> `dead`. `ramp` is the arm lying on the ground as hand, elbow, shoulder.
  `volumes()` are spheres a flying body cannot pass. A stamp throws a carp within 6.5 m out of the fog at 17 m/s
  (`gate`). The carp under the fog, and anyone riding, cannot be hit.
- **Riding** (`Player.riding`, `ride` = arm | shoulder | head | rock): the tiger takes the lying arm when within
  2.6 m of the hand and runs up it at 7 m/s, body pitched along it; then stands on the shoulder (jump = a leap
  towards the head; shrugged off after 2.8 s); the tiger also takes any rock pillar it faces while driven at it and
  runs up the face at 8 m/s. The stab from the air homes on the crown within 4.5 m and, on reaching it, plants the
  swordsman on the head and kills the giant; he jumps off sideways as it starts to fall.
- **Staging** (`main.js`): the entrance (5.6 s, any key skips it, input locked and the player untouchable): camera
  low before the giant as it rises, sliding aside, FOV 50 -> 62, a little roll, then back; black bars; the name
  「巨相撲鬼」 with a "Boss" seal slammed on at 3 s. The kill: slowed time, the camera round the head, ink out of the
  wound, a vermilion 「斬」. The end: the fog lifts (`kFog`, veil amounts), a card with the seal, R reloads. The bars,
  name and card are moved a step each frame, not by CSS transitions, so stepped captures match play.
- **Comic lines** (`fog.js`, uniforms `mangaC`, `focus`, `burst`, `slash`, `slashDir`, `invert`): wedges of ink
  closing in on a raised limb, thrown outwards from a blow, streaks along a falling hand, and the picture inverted
  for two frames on impact.
- **Brush characters** stamped at blows (DOM, the gauge's turbulence filter): 吼 轟 砰 鏘 斬.
- **The blot** (`buildBlot` in `combat-fx.js`): a ring on the ground where the open hand will land, filling as the
  arm goes up, marked in the subject matte so it reads through fog.
- Demos `beasts`, `climb`, `pillar`, `gate`, `far`; `tools/check-climb.mjs [climb|pillar|gate]`.

Measured (`check-climb.mjs`, procedural build): all three ways kill it. Arm: hand pinned at 12.9 s, tiger and on the
arm 13.3 s, shoulder 13.9 s, crane 14.4 s, sword in its head 14.9 s (2.0 s from the pin), dead 22.8 s, end card
25.0 s. Rock: tiger 6.0 s, on the rock 6.2 s, crane 7.6 s, head 8.6 s. Carp: under the fog 8.0 s, thrown clear 8.9 s,
crane 9.0 s, head 10.2 s. In each the scripted player took no damage.
Regression on the procedural build, no console errors: `spar`, `ward`, `journey` to 110 s, `boss` (now with sweeps:
5 stamps, 2 slams, 8 sweeps in 60 s), `stand`, `moves` and `shift` (numbers unchanged), the arm route again on the
photo build. Whole frame: tour demo 8.4 ms at 720p and 11.0 ms at 1080p; the kill by the arm, start to end card,
9.2 ms and 12.8 ms.

## Round 26 (2026-11-15): sound

The owner asked for sound only after every visual was done. `src/sound.js`: 23 voices made in code, no recordings.
Each is a few oscillators and filtered noise with an envelope, written against whatever context it is given, so the
same code plays live and renders offline (`renderVoice`) for measuring. Steps (from the planted feet's `landed`
flag), the blade as it snaps through, cuts, steel, blocks, hurts, jump, landing, roll, the change of form, wings, the
tiger's roar, the carp's splash, the giant's footfall, stamp, slam, sweep, roar and waking rumble, the stab into its
head, and a plucked string (a tick of noise round a short delay) played sparsely while the giant is not up and as a
three-note close at the end. A wind bed follows the player's speed. One compressor and a generated two-second room.
The context starts on the first key or click; `M` mutes; `?mute`.

Measured by `tools/check-sound.mjs`: all 23 voices render with a raw peak between 0.08 and 1.06 and none silent; with
a key pressed in headless Chrome the audio context runs and the whole kill plays through with no errors.
**Nobody has listened to any of it**: levels are measured, the character of the sounds is not judged.

Found on the way: a low-pass filter's `Q` is in decibels in Web Audio, and its default lifts the cutoff by 1 dB.
Inside the plucked string's feedback loop that made the loop gain more than one: the offline render peaked at
3.8e17. `Q = -3.01` is flat. It was only caught because the voices are rendered and measured.

Sizes after everything: `dist/smoke-procedural.html` 1022.2 KB raw, **300.5 KB gzip**; `dist/index.html` 395.3 KB gzip.

Bugs found on the way:
- The cut on the lying hand re-armed the stun every time it landed, so a player who kept cutting held the giant down
  for ever. It now pins once per slam.
- The jump-height cut (extra gravity when jump is not held) also killed the carp's launch and would have killed any
  throw upwards. It now applies only to a jump off the ground (`hop`).
- The tiger could not take a rock: `walk()` zeroes velocity against a wall before the "moving towards it" test.
  The test uses facing and input instead.
- Double quotes in a font list broke `style=""` attributes built as strings: the end card rendered at 13 px.

Not done from the plan: the giant's free hand does not swat at the crane; trees do not shake at a stamp; the charge
was looked at only from far off through trees; nothing has been played by hand.

## Round 27 (2026-11-15): the way onto the head, put in order

The owner's verdict on round 25's kill: the process was confusing and the motion looked a mess; any one beast should
be enough. The old main route took four changes of form in four seconds (roll, tiger, shoulder, leap, crane, attack)
under a free camera. What changed:

- **The tiger alone** (`?boss&demo=climb`). At the lying hand it gathers itself (0.3 s), runs the arm at 4.3 m/s, makes
  one bound from the shoulder onto the crown (`ride.kind` `arm` → `leap` → `head`) and stands there. On the head the
  blow is the player's: attack, and the swordsman rises out of the tiger, lifts the sword in both hands (`raise`, 0.62 s)
  and drives it in. Four seconds without a press and the giant tosses its head. With a tiger on it the arm does not get
  up (`Giant.hold`), and no ink is spent while carried, so the cut on the hand is no longer needed first (it still holds
  the arm down, 4 s now). The hand lies 2.2 s on its own (was 1.7).
- **The crane alone** (`?demo=wing`) and **the carp alone** (`?demo=gate`). Out of any beast, attack high in the air is
  the stab downwards, and a stab begun above the head and within 9 m horizontally goes straight to the crown
  (`homing`). It hangs over the head for the 0.22 s the body takes to change back, then goes; before that fix the carp
  arrived still a carp and lay on the head through the slow motion. The stamp throws the carp at 22.5 m/s (was 17),
  about 3 m above the head.
- **A camera for the ride.** While carried, the view is taken from the player: it stands 10.5 m off to the arm's open
  side (never swung more than 1.1 rad from where it was), tilts up with the climb, comes in to 6.8 m level with the
  crown, and to 5 m as the sword goes up. It is handed back looking the way it was left, also after the kill.
- **High in the air the camera stays close.** The drop back and the look upwards that face the giant are for someone
  at its feet; they fade out between 2.5 and 7 m off the ground. Before, the crane was a speck 16 m from a camera
  lying in the reeds.
- **The giant stays legible to someone above it.** Its reveal through the smoke was measured from the hero's height,
  so it washed out as soon as the hero climbed or flew. It is measured from the giant's own ground (`giantY`).
- **Three lines at the foot of the left edge** name the three ways (key, then what to do). The line of the beast in
  use grows and says what comes next ("衝向地上的手掌", "沿手臂直上頭頂", "按出招　刺下！"); with the hand down and no
  beast taken, the tiger's line speaks up.
- The brush character 斬 is stamped beside the head, not over the blow.

`tools/check-climb.mjs` reports which beasts were used up to the stab; `tools/trace.mjs` prints a demo line by line.

Measured, scripted, both builds (`tools/check-climb.mjs`), from the change of form to the sword in its head:

| way | beasts used | time | stages |
|---|---|---|---|
| `climb` | tiger | 3.2 s | on the arm 12.8 s, the bound 14.0 s, on the head 14.6 s, sword up 15.4 s, in 16.0 s |
| `wing` | crane | 2.4 s | crane 7.1 s, in 9.5 s |
| `gate` | carp | 1.5 s | carp 8.0 s, thrown 8.9 s, in 9.5 s |
| `pillar` | tiger, crane | 2.7 s | unchanged route, still works |

All four end with full health and no errors. With the blow withheld (`?boss&demo=climb&nostab`, read with
`tools/trace.mjs`) the tiger is tossed off after 4.1 s and lands unhurt. The other checks (moves, shift, boss, the
journey, sound) pass as before. Whole frame 8.3 / 11.1 ms at 720p / 1080p, unchanged. Sizes:
`dist/smoke-procedural.html` **302.3 KB gzip**, `dist/index.html` 397.2 KB gzip.

Not verified: none of it was played by hand; the hint lines were read only at 1280 px wide (at 640 px they run under
the ink gauge); how the timing of the tiger's window (2.2 s to reach the hand) feels with real hands.

## Round 28 (2026-11-15): the bout laid out as the Souls games lay theirs out

The owner: look at how the Souls games design entrance, fight and ending; the beast finish belongs only in a random
cut scene after the fight is won. So round 27's "any beast can climb and kill at any time" is withdrawn. The giant has
health now and has to be beaten; then one beast, by lot, ends it.

**Entrance.** `buildCurtain` (`combat-fx.js`): a strip 9 m tall along `arenaEdge()` (`world.js`, a capsule `SEAL` =
8.5 m round the line home-gate), drawn as hanging threads of paper-white. It writes depth where it is thick; without
that the compositor laid the haze of distance over it and it could not be told from the mist. Walking in through it
wakes the giant (`arenaDist < SEAL`); `arenaKeep` holds the player inside while the giant lives; it lifts when it dies.
The entrance camera and name are unchanged. New: the bar (`bossBar`: name and one red stroke along the foot of the
picture, a grey stroke behind it for what the last blows took), wooden clappers (`clacks`), a drum under the bout
(`sound.frame(..., drive)`: a slow figure, a faster one in the second half, silent otherwise).

**The bout.** `Giant.hp` (24). `struck()` now deals damage: an ankle takes the stroke's `power` (1, 1, 2), the lying
hand twice that, `headHit()` 6 (the stab from the air onto the head: `Player` springs clear instead of staying on).
`damage()` returns `hit`, `rage` or `fell`. At half: mode `rage` (it rears and bellows, a ring goes out, 怒 is stamped),
then `rate` 1.22 on everything it does and stamps in pairs. Never the same move three times running; underfoot it no
longer only stamps. The tiger does not take the arm during the bout (`ramp` mount needs `player.fin`).
Cut down: the band reads 墨盡, the swordsman gathers again at `home` inside the curtain, `Giant.reset()` puts the
giant whole on its mark, no entrance.

**The end.** Health gone: mode `fell` (down on the hand nearer the player, the slam's pose held). `main.js` draws a
lot among `tiger`, `crane`, `carp` (`?finish=` chooses) and calls `Player.finish(kind)`: `direct()` replaces input with
what a player would have pressed (`become()`, steer, press), so the finisher runs through the same code as play: the
tiger's ride of round 27, the crane's climb and homing stab, the carp swum out past the hand and thrown clear. Bars
on, the staged camera of round 27, then the existing kill camera, death, and the band 伏誅 in place of the full-screen
end card; `R` restarts. A safety net ends it on the head after 9 s if the script is ever stuck.

Removed with round 27's routes: demos `climb`, `wing`, `gate`, `tools/check-climb.mjs` and the three hint lines. In their
place: demos `bout` (the whole bout), `fin` (the giant one cut from beaten), `stand` (no defence), and
`tools/check-bout.mjs`. `pillar` stays as the demo of the stab onto the head.

Found on the way:
- The carp's finish hung: thrown up from under the bowed body it was held down by the body's collision spheres. It
  now surfaces 2.2 m beyond the hand, and those spheres are skipped for it.
- `querySelector('div > div')` on an element matches that element's own child div against the element itself as
  parent: setting its text wiped the span beside it. Use `firstChild` / `lastChild`.
- A comment after `{` on a one-line `if` swallowed the rest of the line.

Measured, scripted (`tools/check-bout.mjs`, procedural build; the scripted player cuts ankles, cuts the lying hand,
jumps rings and the sweep, rolls out from under the hand):

| run | result |
|---|---|
| `bout 150 carp` | in through the curtain 0.5 s, bout begins 3.7 s, turns 28.1 s into the fighting, beaten after 42.1 s, the carp's end 3.3 s, dead 55.7 s, band 56.2 s; 3 blows taken (two paired stamps, the bellow's ring), health 2 of 5 left |
| `bout 150 crane` | the same bout; the crane's end 2.9 s |
| `fin 45 tiger / crane / carp` | from beaten to the sword in its head 4.9 / 3.4 / 3.6 s |
| `stand 70` (no defence) | cut down three times in 70 s; each time the band, the return and the giant whole again; no errors |
| `journey 200` | four shadows, then the giant dying at about 80 s and dead by 90 s: the whole slice start to finish |
| `trace pillar` | the stab onto its head from the rock: 24 -> 18 |

`check-sound.mjs`: 27 voices, none flagged (taiko peak 0.61, clack 0.53), the kill plays through to the end card with
audio running. `check-moves` and `check-shift` as before. Sizes: `dist/smoke-procedural.html` **304.6 KB gzip**,
`dist/index.html` 400.0 KB gzip.

During the bout the curtain is not drawn while the camera is outside it (it writes depth, and a player with their back
to it would be watched through its threads). Keeping the camera inside instead was tried and dropped: the clearing is
smaller than the camera's boom, so the view was squeezed to overhead most of the time.

Not verified: nothing was played by hand, so the difficulty is unknown (the numbers come from a script that takes
three blows in 42 s); none of the new sounds were listened to; the photo build ran only `fin` after the last change;
frame cost was not measured again (one more transparent strip and three DOM elements were added).

## Round 29 (2026-11-15): the curtain that did not wake it; stutter

The owner played round 28: the fog gate did not start the bout, and the game stuttered ("is the GPU too weak?").

**The gate.** The fourth shadow's station (`pathPoint(.7)`) stood 2 m *inside* the curtain I drew in round 28. A player
walked in through the curtain to reach that shadow, and nothing woke, because the giant waited for all four to be
dead; it then woke with the player already inside. The scripted run never showed it: it only reports that the giant
rises. Changes:
- `FIGHT_STATIONS` are `[.22, .32, .41, .5]` of the path: 17, 13, 9 and 6 m outside the curtain.
- The curtain always starts the bout. A shadow still alive is left outside (dismissed).
- Coming to it is staged (`cine.kind === 'gate'`): control is set aside, the swordsman walks in at a walk, the smoke is
  blown open there, bars close in, and the giant wakes once he is 2.6 m inside (`Giant.woken` if he is stopped).
- The entrance could be skipped by any key, and a player walking in is pressing keys. It now takes space, enter,
  escape or attack, after one second, and says so.

**The stutter.** Not the GPU as such. Two things, both mine:
- The picture was drawn at 1.5x the CSS size. On the test machine (an M4 laptop, 3024x1964 at 120 Hz, a Chrome
  window of about 1512x860) that is 2.93 million pixels and **16.0 ms a frame** in the bout (`tools/cost.mjs`): the
  whole of a 60 Hz frame. 1.25x costs 11.9 ms, 1x 9.7 ms. Every benchmark before this was taken at 720p and 1080p.
- The game took one fixed 1/60 s step per drawn frame. A late frame was therefore slow motion, and a 120 Hz display
  would have run it at up to double speed. Played in real time at that window size (`tools/realtime.mjs`): 38 fps and
  the game clock at **59 %** of real time.

Changes: the loop banks real time and spends it in whole steps (none on a call that comes too soon, two with one
draw on a call that comes late, never more); the picture's ratio starts at what 1.8 million pixels allow and drops a
notch (1.5, 1.25, 1.1, 1, .85, .75) when more than one call in six is late, coming back after twenty clean seconds.
`?dpr=` fixes it; the HUD line shows it. Measured after, same window, real time: **55 to 58 fps in the bout, the game
clock at 91 to 97 %** (the rest is hit pauses and staged slow motion), the picture starting at 1663x946 and the ratio
settling at 1. About one frame in twenty still takes two refreshes, in bursts when a stamp throws ink about. With the
display's rate limit off, as a stand-in for a fast display, the clock stays at 94 %: it does not run fast.

Every scripted check passes again (`check-bout` fin x3 and bout, `stand`, `journey` with the stations moved: four
shadows by 35 s, in through the curtain, the giant up at 40 s; sound; moves; shift).

Not verified: a real 120 Hz display (headless Chrome calls at 60 Hz); a person's hands; whether what the owner calls
stutter also includes the hit pauses, which are deliberate (a cut on the giant stops time for 5 frames, a stamp 8, a
slam 11). `check-spar.mjs` and `check-boss.mjs` default to `dist/index.html`: pass `PAGE=` for the build you mean.

**Another session is working in this checkout** (uncommitted `build.mjs` and `README.md` on 2026-11-15, making the
default build the procedural one and adding `--photo-smoke`). This round was committed from a separate worktree with
only its own files, and the README was left alone: `tools/realtime.mjs` and `tools/cost.mjs` are not listed there yet.

## Round 30 (2026-11-16): a 60-second reel, with the game's own sound

The owner asked for a 60-second gameplay video to post on X.

- **Sound for stepped captures.** `createSound(muted, log)` writes every sound into `log` as `[tick, name, options]`
  whether or not an audio device is running (a tick is one call of `frame()`), and `renderLog(log, from, to, tail)`
  renders that stretch through the same mixer on an `OfflineAudioContext` and returns a WAV. One tick is one captured
  picture, so picture and sound cannot drift. In `?manual` mode the page keeps the log; `__tick()` and
  `__audio(from, to, tail)` expose it. The drum and the plucked notes now keep time whether or not sound is playing.
- **`tools/reel.mjs <edit list> <out base> [--draft] [--join]`** cuts a reel from scripted runs: each shot is a stretch
  of one run (`q`, `from`, `dur`, optional fades from and to paper), captured tick by tick at 60 fps with its sound;
  the shots are joined, an end card is photographed from a small page, loudness is set with one fixed gain and a
  ceiling, and three files are written: a 1080p master, the same without sound, and a 720p copy under 30 MiB.
  `--draft` is half size at 30 fps for choosing cuts; `--join` reuses captured shots.
- **`tools/reel-x.json`** is the cut that was delivered: a flash of the crane's kill, the path and the first duel, the
  blade parting the smoke, a second duel in the reeds, the tiger and the crane, in through the curtain and the giant's
  entrance, five stretches of the bout, the fall, the carp's leap, the tiger's kill, the giant coming down, the band,
  the card. 17 shots and the card, 60.00 s.
- The giant's bar is not drawn under the black bars of a staged moment (its name showed there, dark on black), and
  `__set({ hud: false })` also hides the hint for skipping the entrance.

Result: 1920x1080 at 60 fps, 3600 frames, 106 MiB (capped at 16 Mbit/s); 1280x720 copy 28.1 MiB. Sound as rendered
-23.1 LUFS, delivered at -17.5 LUFS with a true peak of -1.6 dBFS.

Choosing shots: with the default fog the transformations of `?demo=shift` cannot be seen (small bodies, far camera),
so the beasts are shown from `?demo=beasts` and from the endings. Several stretches of the bout have a pine or a trunk
across the lens (the camera stands among the trees round the clearing); the cut avoids them, the game does not.

Not verified: **nobody has heard the sound**, in the game or in the reel; only levels were measured. The picture was
checked from contact sheets and single frames, not watched in motion.

Other sessions' files in the checkout on 2026-11-16, left untouched and not committed here: `unreal/`, `tools/ue-*`,
and the uncommitted `build.mjs` and `README.md`.

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
- (Fixed in round 29: the simulation no longer takes one step per rendered frame.)
- After the giant falls, what is left of the curtain shows for a few seconds as a long grey bar while it fades.
- The scripted player in `bout` is hit by the bellow's ring and by paired stamps; that is the script, but nobody has
  checked by hand that a person can read them in time.
- The giant's feet slide a little when the pose changes; skirt strips pass through a raised leg; nothing collides
  with bushes. Standing on its head, the swordsman's feet are set on the crown's point, not on the skull's surface.
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
