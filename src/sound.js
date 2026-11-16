// Sound, made in code: no recordings. Every voice is a few oscillators and filtered noise with an envelope, written
// against whatever audio context it is handed, so the same code plays live and renders offline for checking.
// The context starts on the first key or click (browsers require it); until then every call is a no-op.

const cache = new WeakMap();
// two seconds of white noise, the same every time
function noiseOf(ctx) {
  if (!cache.has(ctx)) { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } cache.set(ctx, b); }
  return cache.get(ctx);
}
const shape = (g, t, a, d, peak) => { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(peak, .0002), t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); };
// filtered noise: its band slides from f0 to f1 over its length
function hiss(ctx, out, t, { dur, f0, f1 = f0, type = 'bandpass', q = 1, gain = .3, a = .006 }) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = noiseOf(ctx); src.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  shape(g, t, a, dur, gain); src.connect(f).connect(g).connect(out); src.start(t, (t * 37) % 1.7); src.stop(t + a + dur + .05);
}
// a tone that slides from f0 to f1
function tone(ctx, out, t, { dur, f0, f1 = f0, type = 'sine', gain = .3, a = .004 }) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  shape(g, t, a, dur, gain); o.connect(g).connect(out); o.start(t); o.stop(t + a + dur + .05);
}
// steel: a handful of high partials that do not agree, ringing down
const ring = (ctx, out, t, gain, dur) => { for (const [f, k] of [[1870, 1], [2630, .8], [3420, .7], [4880, .5], [6210, .35]]) tone(ctx, out, t, { dur: dur * (.6 + .4 * k), f0: f, gain: gain * k, a: .001 }); hiss(ctx, out, t, { dur: .03, f0: 6000, type: 'highpass', gain: gain * 1.5, a: .001 }); };
// a plucked string: a tick of noise going round a short delay, a little duller each time
function pluck(ctx, out, t, f, gain = .25) {
  const src = ctx.createBufferSource(), g = ctx.createGain(), d = ctx.createDelay(.05), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), o = ctx.createGain();
  src.buffer = noiseOf(ctx); shape(g, t, .001, .012, 1); d.delayTime.value = 1 / f; fb.gain.value = .988; lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = -3.01; // a low-pass's Q is in decibels here: the default lifts the cutoff by 1 dB, which in this loop is more than one, and the string runs away. -3 dB is flat
  src.connect(g).connect(d); d.connect(lp).connect(fb).connect(d); d.connect(o).connect(out);
  o.gain.setValueAtTime(gain, t); o.gain.setValueAtTime(gain, t + 2.2); o.gain.linearRampToValueAtTime(0, t + 2.8); fb.gain.setValueAtTime(.988, t + 2.2); fb.gain.linearRampToValueAtTime(0, t + 2.8);
  src.start(t, .3); src.stop(t + .05);
}
// a great weight meeting the ground
const boom = (ctx, out, t, k) => { tone(ctx, out, t, { dur: .7 * k, f0: 54, f1: 25, gain: .55 * k, a: .003 }); hiss(ctx, out, t, { dur: .55 * k, f0: 240, f1: 90, type: 'lowpass', gain: .42 * k }); hiss(ctx, out, t, { dur: .07, f0: 1900, gain: .5 * k, a: .001 }); };

// name -> (ctx, out, t, o). o carries a strength where it matters.
export const VOICES = {
  step: (c, o, t, { v = 1 }) => { hiss(c, o, t, { dur: .07, f0: 2600, f1: 1200, type: 'highpass', gain: .1 * v }); tone(c, o, t, { dur: .05, f0: 105, f1: 70, gain: .06 * v }); },
  swish: (c, o, t, { heavy = 0 }) => hiss(c, o, t, { dur: .13 + .08 * heavy, f0: 650 - 150 * heavy, f1: 3300 - 900 * heavy, q: 1.3, gain: 1.1 + .5 * heavy }),
  cut: (c, o, t, { k = 1 }) => { tone(c, o, t, { dur: .1, f0: 150, f1: 58, gain: .5 * k }); hiss(c, o, t, { dur: .07, f0: 2500, q: .8, gain: .34 * k, a: .001 }); },
  kill: (c, o, t) => { VOICES.cut(c, o, t, { k: 1.25 }); hiss(c, o, t + .05, { dur: .55, f0: 900, f1: 180, type: 'lowpass', gain: .28 }); },
  steel: (c, o, t, { k = 1 }) => { ring(c, o, t, .13 * k, .55); tone(c, o, t, { dur: .08, f0: 220, f1: 90, gain: .3 * k }); },
  block: (c, o, t) => { ring(c, o, t, .06, .25); tone(c, o, t, { dur: .1, f0: 170, f1: 70, gain: .4 }); },
  hurt: (c, o, t) => { tone(c, o, t, { dur: .16, f0: 190, f1: 66, gain: .5 }); hiss(c, o, t, { dur: .12, f0: 1200, type: 'lowpass', gain: .3 }); },
  jump: (c, o, t) => hiss(c, o, t, { dur: .12, f0: 380, f1: 950, gain: .55 }),
  land: (c, o, t, { v = .5 }) => { tone(c, o, t, { dur: .09, f0: 95, f1: 48, gain: .2 + .3 * v }); hiss(c, o, t, { dur: .09, f0: 700, type: 'lowpass', gain: .12 + .2 * v }); },
  roll: (c, o, t) => { hiss(c, o, t, { dur: .16, f0: 320, f1: 760, gain: .6 }); hiss(c, o, t + .16, { dur: .16, f0: 760, f1: 300, gain: .6 }); },
  shift: (c, o, t, { back = 0 }) => { hiss(c, o, t, { dur: .26, f0: back ? 3600 : 300, f1: back ? 320 : 4000, q: 1.6, gain: .7 }); tone(c, o, t, { dur: .22, f0: back ? 620 : 220, f1: back ? 210 : 660, gain: .12 }); },
  flap: (c, o, t) => hiss(c, o, t, { dur: .2, f0: 520, f1: 260, type: 'lowpass', gain: .5, a: .05 }),
  roar: (c, o, t) => { tone(c, o, t, { dur: .7, f0: 118, f1: 72, type: 'sawtooth', gain: .28, a: .05 }); hiss(c, o, t, { dur: .65, f0: 900, f1: 500, q: 2.5, gain: .32, a: .05 }); },
  splash: (c, o, t) => hiss(c, o, t, { dur: .36, f0: 1500, f1: 300, gain: .6 }),
  gstep: (c, o, t) => boom(c, o, t, .6),
  stomp: (c, o, t) => boom(c, o, t, 1.15),
  slam: (c, o, t) => { boom(c, o, t, 1.3); tone(c, o, t, { dur: .2, f0: 120, f1: 40, gain: .5 }); },
  sweep: (c, o, t) => hiss(c, o, t, { dur: .45, f0: 180, f1: 1300, q: .9, gain: 1.4, a: .08 }),
  groar: (c, o, t) => { for (const [f, d] of [[62, 0], [93, .012], [124.5, .02]]) tone(c, o, t + d, { dur: 1.5, f0: f, f1: f * .7, type: 'sawtooth', gain: .2, a: .15 }); hiss(c, o, t, { dur: 1.5, f0: 420, f1: 250, q: 1.6, gain: .5, a: .15 }); },
  rumble: (c, o, t) => { hiss(c, o, t, { dur: 2.6, f0: 70, f1: 130, type: 'lowpass', gain: .7, a: .8 }); tone(c, o, t, { dur: 2.6, f0: 31, f1: 38, gain: .5, a: .8 }); },
  stab: (c, o, t) => { tone(c, o, t, { dur: .55, f0: 320, f1: 38, gain: .6, a: .002 }); ring(c, o, t, .1, .9); hiss(c, o, t, { dur: .5, f0: 3000, f1: 300, gain: .4 }); },
  // the bout's drum, its rim, and the wooden clappers that call a bout: slow, then running together
  taiko: (c, o, t, { k = 1 }) => { tone(c, o, t, { dur: .34, f0: 98, f1: 44, gain: .6 * k, a: .002 }); hiss(c, o, t, { dur: .09, f0: 330, type: 'lowpass', gain: .3 * k, a: .001 }); hiss(c, o, t, { dur: .02, f0: 1500, gain: .3 * k, a: .001 }); },
  rim: (c, o, t, { k = 1 }) => { tone(c, o, t, { dur: .035, f0: 880, f1: 640, type: 'triangle', gain: .22 * k, a: .001 }); hiss(c, o, t, { dur: .025, f0: 3200, q: 1.5, gain: .3 * k, a: .001 }); },
  clack: (c, o, t, { k = 1 }) => { tone(c, o, t, { dur: .06, f0: 1480, f1: 1300, type: 'square', gain: .1 * k, a: .001 }); tone(c, o, t, { dur: .05, f0: 2350, gain: .1 * k, a: .001 }); hiss(c, o, t, { dur: .02, f0: 4200, type: 'highpass', gain: .4 * k, a: .001 }); },
  clacks: (c, o, t) => { for (let i = 0, at = 0, gap = .5; i < 10; i++) { VOICES.clack(c, o, t + at, { k: .7 + .04 * i }); at += gap; gap = Math.max(.07, gap * .72); } },
  pluck: (c, o, t, { f = 146.83, g = .2 }) => pluck(c, o, t, f, g),
  end: (c, o, t) => { [146.83, 220, 293.66].forEach((f, i) => pluck(c, o, t + i * .32, f, .26)); },
};
const SCALE = [146.83, 174.61, 196, 220, 261.63, 293.66]; // a few notes of a pentatonic scale, low

// the mix every voice goes into: a compressor, a generated room, and the bed of wind. Built on whatever context it is given
function mixer(ctx) {
  const master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), verb = ctx.createConvolver(), send = ctx.createGain(), out = ctx.createGain();
  // a room: two seconds of noise dying away
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let s = 777 + ch; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5 - 1) * Math.exp(-i / (ctx.sampleRate * .45)); } }
  verb.buffer = ir; send.gain.value = .28; master.gain.value = .8;
  out.connect(comp); out.connect(send).connect(verb).connect(comp); comp.connect(master).connect(ctx.destination);
  // the air: wind through reeds, always there, louder with speed
  const src = ctx.createBufferSource(), bedF = ctx.createBiquadFilter(), bed = ctx.createGain(); src.buffer = noiseOf(ctx); src.loop = true; bedF.type = 'bandpass'; bedF.frequency.value = 380; bedF.Q.value = .5; bed.gain.value = .02;
  src.connect(bedF).connect(bed).connect(out); src.start();
  return { out, bed, bedF };
}

// log: an array to write every sound into as [tick, name, options] (a tick is one call of frame()), whether or not anything
// is playing: a run stepped by hand, with no audio device, can have its sound rendered afterwards by renderLog().
export function createSound(muted = false, log = null) {
  let ctx = null, out = null, bed = null, bedF = null, wait = 4, n = 0, beat = 0, step = 0, tick = 0;
  const start = () => { if (muted) return; if (ctx) { ctx.resume(); return; } ctx = new AudioContext(); ({ out, bed, bedF } = mixer(ctx)); };
  addEventListener('pointerdown', start); addEventListener('keydown', start);
  const live = () => !!ctx && ctx.state === 'running';
  const voice = (name, o = {}) => { if (!VOICES[name]) return; log?.push([tick, name, o]); if (live()) VOICES[name](ctx, out, ctx.currentTime + .005, o); };
  return {
    get on() { return live(); },
    get tick() { return tick; },
    toggle() { muted = !muted; if (muted) ctx?.suspend(); else start(); return !muted; },
    play: voice,
    // every frame: speed 0..1 of whatever the player is, whether the giant is up (the plucked notes stop for it), and
    // the bout's drum: 0 silent, 1 a slow figure, 2 faster and fuller once the giant is enraged
    frame(dt, speed, tense, drive = 0) {
      tick++; if (log && tick % 6 === 0) log.push([tick, 'bed', { speed }]);
      if (live()) { const t = ctx.currentTime; bed.gain.setTargetAtTime(.018 + .05 * speed, t, .3); bedF.frequency.setTargetAtTime(340 + 500 * speed, t, .4); }
      if ((wait -= dt) <= 0 && !tense) { wait = 5 + ((n * 7919) % 6); voice('pluck', { f: SCALE[(n * 5 + (n >> 1)) % SCALE.length], g: .12 }); n++; }
      if (!drive) { beat = 0; step = 0; return; }
      const fig = drive > 1 ? [1, 0, .5, 1, 0, .5, 1, .5] : [1, 0, 0, .5, 0, 0, 1, 0];
      if ((beat -= dt) <= 0) { beat += drive > 1 ? .2 : .29; const k = fig[step % 8]; if (k) voice('taiko', { k: .5 * k + .12 }); if (step % 4 === 2) voice('rim', { k: drive > 1 ? .7 : .45 }); step++; }
    },
  };
}
// What a log sounded like between two ticks, rendered without an audio device: one tick is 1/60 s, so a picture made by
// stepping the same run frame by frame and this sound cannot drift apart. `tail` seconds are added for what rings on.
// Three seconds before `from` are rendered too and thrown away, so that what was already sounding is there.
// Returns a WAV file (stereo, 16 bit, 48 kHz) as base64.
export async function renderLog(log, from, to, tail = 0) {
  const sr = 48000, pre = 180, t0 = from - pre, ctx = new OfflineAudioContext(2, Math.ceil(((to - t0) / 60 + tail) * sr), sr), { out, bed, bedF } = mixer(ctx);
  for (const [tk, name, o] of log) {
    if (tk < t0 || tk >= to) continue; const t = Math.max(0, (tk - t0) / 60) + .005;
    if (name === 'bed') { bed.gain.setTargetAtTime(.018 + .05 * o.speed, t, .3); bedF.frequency.setTargetAtTime(340 + 500 * o.speed, t, .4); }
    else VOICES[name](ctx, out, t, o);
  }
  const buf = await ctx.startRendering(), skip = pre / 60 * sr, len = buf.length - skip, L = buf.getChannelData(0), R = buf.getChannelData(1);
  const wav = new DataView(new ArrayBuffer(44 + len * 4)), put = (at, text) => { for (let i = 0; i < text.length; i++) wav.setUint8(at + i, text.charCodeAt(i)); };
  put(0, 'RIFF'); wav.setUint32(4, 36 + len * 4, true); put(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true); wav.setUint32(24, sr, true); wav.setUint32(28, sr * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); put(36, 'data'); wav.setUint32(40, len * 4, true);
  let peak = 0;
  for (let i = 0; i < len; i++) { const l = L[skip + i], r = R[skip + i]; peak = Math.max(peak, Math.abs(l), Math.abs(r)); wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l)) * 32767, true); wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r)) * 32767, true); }
  const bytes = new Uint8Array(wav.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return { wav: btoa(bin), peak, seconds: len / sr };
}
// Renders one voice offline and measures it: for checking that every voice makes sound and none clips.
export async function renderVoice(name, o = {}) {
  const ctx = new OfflineAudioContext(1, 44100 * 3.2, 44100); VOICES[name](ctx, ctx.destination, .01, o);
  const d = (await ctx.startRendering()).getChannelData(0); let peak = 0, sq = 0, last = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sq += v * v; if (v > .002) last = i; }
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sq / Math.max(1, last)).toFixed(4), seconds: +(last / 44100).toFixed(2) };
}
