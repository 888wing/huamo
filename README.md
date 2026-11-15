# 化墨 (huamo)

A fog-as-ink action slice, built to answer one question: **how small and how accurate can a real-time fluid simulation be on three.js?**

The game ships as one self-contained HTML file. The standard build embeds a photographed smoke atlas, and the procedural build generates its smoke on the GPU at startup.

## Run

Open `dist/smoke-procedural.html` (or `dist/index.html` for the photographed smoke) in desktop Chrome or Edge (WebGPU). No server needed. The page deployed from the repo root `index.html` is the procedural build.

| Key | Action |
|---|---|
| `W` `A` `S` `D` | move |
| mouse (click the page first) | look |
| `Space` | jump: a tap is low, a held press high (climb as crane or carp). Pressed in the air after being thrown: land standing |
| `Shift` | dodge: a hop back with no direction held, a roll with one (descend as crane or carp) |
| the same key again | changes form, out of the move: jump again in the air = 鶴 crane, dodge again mid-dodge = 虎 tiger, guard twice quickly = 鯉 carp. All three spend one gauge of ink (the brush stroke at the foot of the screen): 5 s from full, 8 s to refill, a third needed to change. As a beast, attack returns to the sword with a blow (high in the air: the stab downwards, which finds the giant's head from above it) and guard is the beast's own move. |
| `1` `2` `3` `4` | with `?debug` only: set a form directly, no gauge |
| left mouse or `F` | the form's action. Tap again during each human swing to link a rising slash and an overhead finish. In the air: a stab downwards. Late in a dodge: a cut straight out of it. |
| right mouse or `Q` | guard (raised just in time: a parry) |
| `V` | top-down slice of the simulation |
| `T` | GPU time per simulation stage |
| `P` | validation numbers (slow) |
| `R` | reset the fog |
| `M` | mute (sound starts with the first key or click) |
| `Tab` | help and details |

URL options: `?f32=1` (32-bit float fields), `?n=96,40,96&h=0.25` (box cells and cell size), `?cycles=2` (pressure accuracy), `?dpr=2` (pixel ratio cap, default 1.5), `?demo=bout|fin|pillar|moves|shift|beasts|journey|far|combo|fogwalk|reeds|smokecut|spar|ward|boss|stand|oni|spin|tour|slash|roar|flap|carp`, `?steps=56` (march steps through the 3D fog, default 28), `?arena` (start at the first clearing with normal controls), `?boss` (skip the four shadows and start just outside the giant's curtain), `?finish=tiger|crane|carp` (choose the beast that ends the bout instead of drawing lots).

The path opens into a clearing for the first duel before heading north through the reeds. Defeat four ink shadows one after another, and the way to the giant (巨相撲鬼) is open. The bout with it is laid out the way such bouts are in the Souls games:

- **Entrance.** A curtain of fog hangs round its clearing. Walk in through it and the giant rises: a staged camera, its name, wooden clappers, and then its health as one long red stroke along the foot of the picture, with a drum under the bout. The curtain lets no one out until it is over.
- **The bout.** Cuts at its ankles take its health; cuts on its hand while the hand lies on the ground take twice as much (the first of them holds the arm down longer). Jump its shock rings and its sweeping hand, roll out from under the open hand (a ring of ink on the ground shows where). The stab downwards from the air onto its head is a heavy blow: the crane can get above it, and so can the carp, thrown up by a stamp from under the fog beside its foot. At half its health it rears and bellows (a ring: jump it) and is faster from then on, and its stamps come in pairs.
- **Cut down**, the swordsman gathers again inside the curtain (the band reads 墨盡) and the giant stands whole on its mark: the bout starts over without the entrance.
- **The end.** When its health is gone it goes down on one hand, and the end is played for you: one of the three beasts, by lot, carries the sword to its head (the tiger up the arm, the crane over it, the carp thrown clear of the fog), the sword goes in, it falls and runs out into ink, the band reads 伏誅, the curtain lifts.

## Build

```bash
npm install
node build.mjs            # dist/index.html, minified, prints the size split
node build.mjs --readable # unminified, shader line numbers match the source
node build.mjs --procedural-smoke # dist/smoke-procedural.html, no embedded smoke images
```

Open `dist/smoke-procedural.html?demo=smokecut` in a WebGPU browser to watch the blade part the procedural smoke. The generated atlas feeds the same fluid and depth compositor as the photographed atlas. The generator is in [smoke-procedural.wgsl](src/smoke-procedural.wgsl).

Change the procedural smoke with URL options and reload to generate the new shapes. The same seed and settings reproduce the same variants. Each atlas cell contains four variants without increasing its texture size, and patches choose and deform their own variants as they drift through the scene.

| URL option | Range | Effect |
|---|---:|---|
| `fogDensity` | 0.65–3 | Foreground opacity multiplier, default 1.85. Also works with the photo atlas. |
| `smokeSeed` | 0–4294967295 | Seed for all the generated shapes, default 0 |
| `smokeTurbulence` | 0.45–1.65 | Amount of folding and fraying in the shape, default 1 |
| `smokeScale` | 0.65–1.2 | Size of the generated puffs and wisps, default 1 |
| `smokeWisps` | 0–2 | Density of fine wisps, default 1 |

Try `?demo=smokecut&fogDensity=2.2&smokeSeed=42&smokeTurbulence=1.4&smokeScale=0.85&smokeWisps=1.5` for denser foreground fog with smaller, more ruffled puffs and stronger wisps.

## Check

```bash
tools/ta.sh "?f32=0" "?f32=1"   # solver numbers (build dist/t-a.html first: see docs/HANDOFF.md)
node tools/bench.mjs [page]      # whole-frame cost at 720p and 1080p
node tools/check-spar.mjs spar   # the four shadows; `ward` = defence only; `journey 110` = shadows, then the giant
node tools/check-moves.mjs       # the swordsman's motion: foot slide, dodge distances, jump heights, recovery times
node tools/check-sound.mjs       # renders every voice offline: peak, loudness, length; then plays a whole kill with audio running
node tools/check-bout.mjs bout 150 tiger  # the whole bout: when it turned, when it was beaten, the end; `fin 45 carp` = the giant one cut from beaten; `stand 70` = a player who does not defend
node tools/trace.mjs bout 30 6    # what the giant and the player are doing, line by line (demo, seconds, from second)
node tools/check-shift.mjs       # changing form: how long a gauge lasts, how fast it refills, speed across the change
tools/strip.sh moves roll 16.9 17.8 4   # a close-up strip of one stretch of a demo (start s, end s, frames between shots)
node tools/check-boss.mjs 60     # the giant: mode sequence, where its hand lands, feet on the ground; `60 stand` = a player who does not defend
PAGE=dist/smoke-procedural.html node tools/check-spar.mjs journey 110   # any check against the other build
node tools/capture.mjs "?demo=tour" out/tour --frames=12 --every=110   # contact sheet; add --mp4 for a video
```

## Files

| File | What it is |
|---|---|
| `src/gpu.js` | raw WebGPU helper: device, textures, cached bind groups, per-stage GPU timing, read-back. No three.js |
| `src/sim3d.wgsl`, `src/sim3d.js` | solver A: 3D incompressible flow on a staggered grid, in a box that follows the player |
| `src/mg.wgsl` | multigrid pressure solver used by solver A |
| `src/world.js` | the valley's height function, shared by mesh, collision and both solvers |
| `src/stage.js` | three.js scene in ink: terrain, far mountains, pines, reeds, the sword stroke, ink droplets |
| `src/fog.js` | the picture: half-resolution fog and ink march, brush lines, paper |
| `src/figure.js` | the swordsman: skeleton posed in code, ink-washed limbs, verlet cloth strips |
| `src/player.js` | the four forms, the three-stroke combo, the enemy and the sparring rules |
| `src/boss.js`, `src/giant.js` | the giant: what it does, and its body |
| `src/beasts.js`, `src/strips.js` | tiger, crane and carp; verlet strips for cloth, feathers and fins |
| `src/veil.wgsl`, `src/veil.js` | the ten 2D smoke layers and how blades, bodies and blasts move them |
| `src/smoke-procedural.wgsl`, `src/smoke-procedural.js` | the smoke atlas generated on the GPU for the procedural build |
| `src/combat-fx.js` | hit feedback table, the ink left on the ground, the ring where the giant's hand will land |
| `src/sound.js` | every sound, made in code |
| `src/main.js` | boot, input, frame loop, HUD |
| `src/demos.js` | scripted runs for repeatable captures |
| `src/tests/` | numeric tests that run the solvers without a renderer |
| `tools/` | headless Chrome runner, capture, benchmark |

Findings, measured numbers and next steps are in [`docs/HANDOFF.md`](docs/HANDOFF.md).
