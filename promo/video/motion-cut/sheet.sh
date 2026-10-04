#!/bin/sh
# sheet.sh <dir> <out.png> [cols] — tiles numbered frames into a contact sheet
FF=${FFMPEG:-ffmpeg}; D=$1; O=$2; C=${3:-4}; N=$(ls $D/*.png | wc -l); R=$(( (N + C - 1) / C ))
$FF -loglevel error -y -framerate 1 -i "$D/%04d.png" -vf "scale=640:-2,drawtext=fontfile=tex/GramatikaBold.otf:text='%{frame_num}':start_number=0:x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6,tile=${C}x${R}:padding=4:color=0x777777" -frames:v 1 "$O"
