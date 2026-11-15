#!/bin/zsh
# Packs the 12 smoke photographs into one greyscale atlas (4 x 3 cells of 512 px) that the build embeds in the page.
# Cell order: puff_01..06 (0-5), wisp_01..03 (6-8), sheet_01..02 (9-10), detail_01 (11).
cd ~/Projects/huamo/assets
ins=(); for f in puff_01 puff_02 puff_03 puff_04 puff_05 puff_06 wisp_01 wisp_02 wisp_03 sheet_01 sheet_02 detail_01; do ins+=(-i smoke/$f.png); done
ffmpeg -y -loglevel error $ins -filter_complex "[0][1][2][3][4][5][6][7][8][9][10][11]concat=n=12:v=1:a=0,scale=512:512,format=gray,tile=4x3" -frames:v 1 -q:v 4 smoke_atlas.jpg
ls -la smoke_atlas.jpg | awk '{print $5, $9}'
