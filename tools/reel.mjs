// Cuts a reel from scripted runs. Each shot is a stretch of one run, captured tick by tick (so exactly 60 pictures a
// second of game time) together with the sound that run made, rendered offline from its log: picture and sound cannot
// drift. The shots are joined in the order listed, an end card is added, loudness is set, and the result is written
// as a 1080p master, a copy without sound, and a 720p copy small enough to send to a phone.
// usage: node tools/reel.mjs <edl.json> <out base> [--draft]
//   --draft: half size, 30 fps, one file: for choosing the cuts.   --join: reuse the shots already captured.
// The edit list: { size: [1920, 1080], page, paper: "ece6d8", card: { dur, html }, shots: [{ name, q, from, dur, in, out }] }
//   q: the page's query (a scripted demo), from and dur in seconds of that run, in and out: fades from and to paper,
//   skip: seconds dropped from the start of the shot as captured (a trim that needs no new capture).
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
const [edlPath, base] = process.argv.slice(2).filter(a => !a.startsWith('--')), draft = process.argv.includes('--draft');
const edl = JSON.parse(readFileSync(edlPath, 'utf8')), [W, H] = edl.size.map(x => draft ? x / 2 : x), every = draft ? 2 : 1, fps = 60 / every, paper = '0x' + (edl.paper ?? 'ece6d8');
const tmp = base + (draft ? '_draft_parts' : '_parts'); mkdirSync(tmp, { recursive: true });
const launch = () => puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const total = edl.shots.reduce((a, s) => a + s.dur - (s.skip ?? 0), 0) + (edl.card?.dur ?? 0);
console.log(`${edl.shots.length} shots, ${total.toFixed(2)} s with the card, ${W}x${H} at ${fps} fps`);

// ---- capture: one run of the page for each query, its shots taken in the order they happen
const byQ = new Map(); edl.shots.forEach((s, i) => { s.i = i; if (!byQ.has(s.q)) byQ.set(s.q, []); byQ.get(s.q).push(s); });
const last = edl.shots.at(-1); last.tail = edl.card?.dur ?? 0;   // what is sounding when the pictures end rings on under the card
edl.shots.forEach(s => { s.frames = Math.round(s.dur * 60 / every); });
for (const [q, shots] of process.argv.includes('--join') ? [] : byQ) {   // --join: the parts are already there, only put them together again
  shots.sort((a, b) => a.from - b.from);
  const browser = await launch(), page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror] ' + e.message));
  await page.goto('file://' + resolve(edl.page ?? 'dist/smoke-procedural.html') + q + (q.includes('?') ? '&' : '?') + 'manual&dpr=1');
  await page.waitForFunction('window.__done === true', { timeout: 60000 });
  await page.evaluate(() => window.__set({ hud: false }));
  let tick = await page.evaluate(() => window.__tick());
  for (const s of shots) {
    const start = Math.round(s.from * 60), n = Math.round(s.dur * 60 / every);
    if (start < tick) throw new Error(`shot "${s.name}" starts at ${s.from} s, before the last shot from the same run ended (${(tick / 60).toFixed(2)} s)`);
    while (tick < start) { const k = Math.min(300, start - tick); await page.evaluate(k => window.__advance(k), k); tick += k; }
    const t0 = await page.evaluate(() => window.__tick());
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', `${tmp}/${s.i}.mp4`], { stdio: ['pipe', 'ignore', 'inherit'] });
    const closed = new Promise((ok, no) => { ff.once('error', no); ff.once('close', c => c === 0 ? ok() : no(new Error('ffmpeg exited with ' + c))); });
    async function* shotsOf() { for (let i = 0; i < n; i++) { await page.evaluate(k => window.__advance(k), every); yield await page.screenshot({ type: 'jpeg', quality: 96 }); } }
    await Promise.all([closed, pipeline(shotsOf(), ff.stdin)]);
    tick = await page.evaluate(() => window.__tick());
    const a = await page.evaluate((f, t, tail) => window.__audio(f, t, tail), t0, tick, s.tail ?? 0);
    writeFileSync(`${tmp}/${s.i}.wav`, Buffer.from(a.wav, 'base64')); s.peak = a.peak; s.frames = n;
    console.log(`  ${String(s.i + 1).padStart(2)} ${s.name.padEnd(14)} ${q.padEnd(34)} ${s.from.toFixed(2)} s + ${s.dur.toFixed(2)} s  (${n} frames, sound peak ${a.peak.toFixed(2)})`);
  }
  await browser.close();
}
// ---- the end card: a page of its own, photographed
let cardInput = [];
if (edl.card) {
  const browser = await launch(), page = await browser.newPage();
  await page.setContent(edl.card.html.replaceAll('PAPER', '#' + (edl.paper ?? 'ece6d8'))); await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `${tmp}/card.png` }); await browser.close();
  cardInput = ['-loop', '1', '-framerate', String(fps), '-t', String(edl.card.dur), '-i', `${tmp}/card.png`];
}
// ---- join
const N = edl.shots.length, inputs = [], parts = [];
edl.shots.forEach(s => inputs.push('-i', `${tmp}/${s.i}.mp4`)); edl.shots.forEach(s => inputs.push('-i', `${tmp}/${s.i}.wav`)); inputs.push(...cardInput);
edl.shots.forEach((s, i) => {
  const sk = s.skip ?? 0, d = s.frames / fps - sk, fades = (s.in ? `,fade=t=in:st=0:d=${s.in}:color=${paper}` : '') + (s.out ? `,fade=t=out:st=${(d - s.out).toFixed(3)}:d=${s.out}:color=${paper}` : '');
  parts.push(`[${i}:v]fps=${fps},trim=start=${sk},setpts=PTS-STARTPTS,format=yuv420p,setsar=1${fades}[v${i}]`);
  const len = d + (s.tail ?? 0), fo = s.tail ? Math.min(0.8, s.tail) : 0.05;
  parts.push(`[${N + i}:a]apad=whole_dur=${(sk + len).toFixed(4)},atrim=start=${sk}:end=${(sk + len).toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st=${(len - fo).toFixed(3)}:d=${fo}[a${i}]`);
});
if (edl.card) parts.push(`[${2 * N}:v]fps=${fps},format=yuv420p,setsar=1,fade=t=in:st=0:d=0.45:color=${paper}[vc]`);
parts.push(edl.shots.map((s, i) => `[v${i}]`).join('') + (edl.card ? '[vc]' : '') + `concat=n=${N + (edl.card ? 1 : 0)}:v=1:a=0[v]`);
parts.push(edl.shots.map((s, i) => `[a${i}]`).join('') + `concat=n=${N}:v=0:a=1[a]`);
const run = args => { const r = spawnSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8' }); if (r.status !== 0) { console.log(r.stderr.slice(-2500)); throw new Error('ffmpeg failed'); } return r.stderr; };
const joined = `${tmp}/joined.mkv`;
run(['-loglevel', 'error', ...inputs, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', draft ? '20' : '10', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', joined]);
if (draft) { run(['-loglevel', 'error', '-i', joined, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', base + '-draft.mp4']); console.log('wrote ' + base + '-draft.mp4'); process.exit(0); }
// ---- loudness: measured once over the whole reel, then one fixed gain and a ceiling (nothing that breathes with the sound)
const meter = run(['-nostats', '-i', joined, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']), I = +meter.match(/I:\s+(-?[\d.]+) LUFS/g).at(-1).match(/-?[\d.]+/)[0], TP = +meter.match(/Peak:\s+(-?[\d.]+) dBFS/g).at(-1).match(/-?[\d.]+/)[0];
const target = edl.loudness ?? -16, gain = Math.min(target - I, 20);
console.log(`sound as rendered: ${I} LUFS, true peak ${TP} dBFS; gain ${gain.toFixed(1)} dB towards ${target} LUFS, ceiling -2.5 dBFS`);
const af = `volume=${gain.toFixed(2)}dB,alimiter=limit=0.75:level=false:attack=3:release=60`, tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart'];
run(['-loglevel', 'error', '-i', joined, '-af', af, '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18', '-maxrate', '16M', '-bufsize', '32M', '-g', String(fps), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', ...tags, base + '-1080p.mp4']);
run(['-loglevel', 'error', '-i', base + '-1080p.mp4', '-an', '-c:v', 'copy', '-movflags', '+faststart', base + '-1080p-silent.mp4']);
// the phone copy: 720p, two passes at a rate that keeps it under 30 MiB
const rate = Math.floor((28.5 * 8 * 1024 / total) - 128), small = ['-i', joined, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-b:v', rate + 'k', '-maxrate', Math.round(rate * 1.6) + 'k', '-bufsize', rate * 2 + 'k', '-g', String(fps), '-pix_fmt', 'yuv420p'];
run(['-loglevel', 'error', ...small, '-pass', '1', '-passlogfile', `${tmp}/p`, '-an', '-f', 'null', '-']);
run(['-loglevel', 'error', ...small, '-pass', '2', '-passlogfile', `${tmp}/p`, '-af', af, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', ...tags, base + '-720p.mp4']);
for (const f of ['-1080p.mp4', '-1080p-silent.mp4', '-720p.mp4']) {
  const p = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate,nb_frames', '-of', 'csv=p=0', base + f], { encoding: 'utf8' }).trim().split('\n').join(' | ');
  console.log(`${base + f}: ${(statSync(base + f).size / 1048576).toFixed(1)} MiB  ${p}`);
}
