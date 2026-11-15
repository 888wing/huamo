// Prints when each step of the moves demo (or the shift demo) starts: node tools/moves-times.mjs [shift]
import { MOVE_SEQ, SHIFT_SEQ } from '../src/demos.js';
let t = 0; const out = [];
for (const [name, d] of process.argv[2] === 'shift' ? SHIFT_SEQ : MOVE_SEQ) { if (name !== '-' && name !== 'home' && name !== 'face') out.push(`${name}@${t.toFixed(2)}`); t += d; }
console.log(out.join('  ')); console.log('total', t.toFixed(1), 's');
