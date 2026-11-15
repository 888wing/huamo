#!/bin/zsh
# runs the solver A numeric test for each query string given and prints one line per run
cd ~/Projects/huamo
for q in "$@"; do echo "== $q"; node tools/run.mjs dist/t-a.html "$q" --wait=90000 | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=s.indexOf('REPORT ');if(i<0){console.log(s);return}const r=JSON.parse(s.slice(i+7));if(r.error){console.log(r.error);return}console.log(r.fmt,r.n.join('x'),r.mb+'MB','| rest vmax',r.rest?.vmax.toExponential(1),'| pushed resid',r.pushed?.residual.toFixed(4),'divAfter',r.pushed?.divAfter.toExponential(2),'| ke 2s/1s',(r.after2s.kinetic/r.pushed.kinetic).toFixed(3),'| ink',r.pushed.ink.toFixed(1),'->',r.after2s.ink.toFixed(1),'fog',r.rest.fog.toFixed(0),'->',r.after2s.fog.toFixed(0),'| ms',JSON.stringify(r.ms),r.msTotal)})"; done
