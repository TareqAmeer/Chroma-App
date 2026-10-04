#!/bin/sh
# finish.sh — encode frames + score. No grade, grain, weave or vignette in post: brand colours stay exact,
# and the only grain in the film is the app's own (baked by bake.mjs).
FF=${FFMPEG:-ffmpeg}; OUT=${1:-chromasmith-ep1-v11.mp4}
$FF -hide_banner -loglevel warning -y -framerate 24 -i frames/%04d.png -i ../public/music/ep1-v11.wav \
 -filter_complex "[1:a]loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[a]" -map 0:v -map "[a]" \
 -c:v libx264 -preset slow -crf 16 -tune animation -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 24 \
 -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
echo "$OUT"
