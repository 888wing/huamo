#!/bin/zsh
# One strip of close-up frames from a demo: tools/strip.sh <demo> <name> <start s> <end s> [frames between shots=6] [page] [extra query]
# Writes out/<name>.png. Used to look at a single move frame by frame.
demo=$1; name=$2; a=$3; b=$4; step=${5:-6}; page=${6:-dist/smoke-procedural.html}; q=${7:-}
n=$(( (b - a) * 60 / step )); n=${n%.*}; skip=$(( a * 60 )); skip=${skip%.*}
node tools/capture.mjs "?demo=$demo$q" out/$name --file=$page --frames=$n --every=$step --skip=$skip --size=640x360 --cols=$n --tile=640 --set='{"hud":false,"clear":true}' > /dev/null 2>&1
cols=$(( n > 10 ? 10 : n )); rows=$(( (n + cols - 1) / cols ))
ffmpeg -y -loglevel error -i out/${name}_frames/%04d.png -vf "crop=330:340:155:10,tile=${cols}x${rows}:padding=3:color=white" -frames:v 1 out/$name.png && echo "wrote out/$name.png ($n frames)"
