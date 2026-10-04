#!/bin/sh
# finish.sh — encode frames + score. Grain is rendered in-scene; no weave, flicker or vignette (they read as shake).
FF=${FFMPEG:-ffmpeg}; OUT=${1:-chromasmith-ep1-v10.mp4}
$FF -hide_banner -loglevel warning -y -framerate 24 -i frames/%04d.png -i ../public/music/ep1-v10.wav \
 -filter_complex "[1:a]loudnorm=I=-12.6:TP=-1:LRA=11,aresample=48000[a]" -map 0:v -map "[a]" \
 -c:v libx264 -preset slow -crf 17 -maxrate 25M -bufsize 50M -tune grain -pix_fmt yuv420p -r 24 -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
echo "$OUT"
