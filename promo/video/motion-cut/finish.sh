#!/bin/sh
# finish.sh — delivers the 48fps frames as-is (two-subframe blending ghosted text on fast moves; 48fps is smoother),
# explicit bt709 matrix so the brand colours decode exactly, and two-pass loudnorm to -14 LUFS / -1 dBTP.
# No grade, post grain, weave or vignette: the only grain in the film is the app's own.
FF=${FFMPEG:-ffmpeg}; OUT=${1:-chromasmith-ep1-v12.mp4}; WAV=../public/music/ep1-v12.wav
M=$($FF -hide_banner -i $WAV -af loudnorm=I=-14:TP=-1:LRA=11:print_format=summary -f null - 2>&1)
v() { echo "$M" | grep "$1" | head -1 | awk '{print $(NF-1)}'; }
LN="loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(v 'Input Integrated'):measured_TP=$(v 'Input True Peak'):measured_LRA=$(v 'Input LRA'):measured_thresh=$(v 'Input Threshold'):offset=$(v 'Target Offset'):linear=true"
$FF -hide_banner -loglevel warning -y -framerate 48 -i frames/%04d.png -i $WAV \
 -filter_complex "[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];[1:a]$LN,aresample=48000[a]" \
 -map "[v]" -map "[a]" -r 48 -c:v libx264 -preset slow -crf 16 -tune animation -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
 -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
echo "$OUT"
