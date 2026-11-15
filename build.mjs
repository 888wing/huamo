// Bundles src/main.js into one self-contained dist/index.html and reports where the bytes go.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const readable = process.argv.includes('--readable');
const proceduralSmoke = process.argv.includes('--procedural-smoke');
const entry = process.argv.find(a => a.startsWith('--entry='))?.slice(8) ?? 'src/main.js';
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? (proceduralSmoke ? 'dist/smoke-procedural.html' : 'dist/index.html');

// .wgsl files become strings; comments and spare whitespace are stripped so shaders cost few bytes
const wgsl = {
  name: 'wgsl',
  setup(b) {
    b.onLoad({ filter: /\.wgsl$/ }, args => {
      let s = readFileSync(args.path, 'utf8');
      if (!readable) {
        s = s.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ')
          .replace(/ ?([{}()\[\];,:=+\-*\/<>&|!?]) ?/g, '$1').trim();
        // "a- -b" and "a+ +b" must keep their space; the pass above never creates them from valid code
      }
      return { contents: 'export default ' + JSON.stringify(s), loader: 'js' };
    });
  },
};

const r = await build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: !readable, target: 'es2022',
  write: false, metafile: true, plugins: [wgsl], legalComments: 'none', loader: { '.jpg': 'dataurl' },
  define: { DEV: JSON.stringify(process.argv.includes('--dev')), PROCEDURAL_SMOKE: JSON.stringify(proceduralSmoke) },
});
const js = r.outputFiles[0].text;
const html = readFileSync('src/template.html', 'utf8').replace('/*SCRIPT*/', () => js.replace(/<\/script/g, '<\\/script'));
mkdirSync('dist', { recursive: true });
writeFileSync(out, html);

const o = Object.values(r.metafile.outputs)[0];
let three = 0, own = 0;
for (const [f, v] of Object.entries(o.inputs)) (f.includes('node_modules') ? (three += v.bytesInOutput) : (own += v.bytesInOutput));
const kb = n => (n / 1024).toFixed(1) + ' KB';
const sizes = { file: out, raw: html.length, gzip: gzipSync(html).length, brotli: brotliCompressSync(html).length, threeRaw: three, ownRaw: own };
console.log(`${out}: ${kb(sizes.raw)} raw, ${kb(sizes.gzip)} gzip, ${kb(sizes.brotli)} brotli | three.js ${kb(three)} raw, own code ${kb(own)} raw`);
writeFileSync(out.replace(/\.html$/, '.size.json'), JSON.stringify(sizes));
