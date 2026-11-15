// Prints when each step of the moves demo starts: node tools/moves-times.mjs
import { MOVE_SEQ } from '../src/demos.js';
let t = 0; const out = [];
for (const [name, d] of MOVE_SEQ) { if (name !== '-' && name !== 'home' && name !== 'face') out.push(`${name}@${t.toFixed(2)}`); t += d; }
console.log(out.join('  ')); console.log('total', t.toFixed(1), 's');
