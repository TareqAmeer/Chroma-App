#!/bin/sh
# finish.sh [frames-dir] [out.mp4] — the film pass + mix for Ep1Film.
# Gate weave, exposure flicker, halation (red bleed from highlights), clumped grain, film toe/shoulder, vignette.
FF=${FFMPEG:-ffmpeg}
IN=${1:-out/ep1/frames}; OUT=${2:-out/ep1/ep1-reddit-16x9.mp4}
$FF -hide_banner -loglevel warning -y -framerate 24 -i "$IN/element-%03d.png" -i public/music/ep1-film.wav -filter_complex "
[0:v]format=gbrp,split[base][h];
[h]colorlevels=rimin=0.86:gimin=0.86:bimin=0.86,gblur=sigma=9,colorchannelmixer=rr=1:gg=0.32:bb=0.12[halo];
[base][halo]blend=all_mode=screen:all_opacity=0.22,
curves=r='0/0.03 0.25/0.245 0.75/0.775 1/0.99':g='0/0.026 0.25/0.24 0.75/0.765 1/0.98':b='0/0.04 0.25/0.245 0.75/0.75 1/0.955',
eq=brightness='0.007*sin(n*2.1)+0.004*sin(n*5.3)':eval=frame,
vignette=angle=PI/14:mode=forward,
scale=1940:1092:flags=bicubic,crop=1920:1080:x='10+1.3*sin(n*0.71)+0.7*sin(n*2.3+1.0)':y='6+1.1*sin(n*0.53+2.0)+0.6*sin(n*1.7)',
format=yuv444p,noise=c0s=9:c0f=t+u:c1s=3:c1f=t:c2s=3:c2f=t,gblur=sigma=0.55,unsharp=5:5:0.35,
format=yuv420p[v];
[1:a]loudnorm=I=-12.5:TP=-1:LRA=11,aresample=48000[a]" \
-map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 15 -tune grain -profile:v high -pix_fmt yuv420p -r 24 \
-c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
echo "$OUT"
