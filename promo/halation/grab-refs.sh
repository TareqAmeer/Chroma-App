#!/bin/sh
# grab.sh <youtube-id>... — download (720p), sample frames every 0.5s, tile a contact sheet per video.
F=${FFMPEG:-ffmpeg}
for id in "$@"; do
  python -m yt_dlp -q -f "bv*[height<=720][ext=mp4]+ba/b[height<=720]" --ffmpeg-location "$(dirname "$F")" -o "$id.%(ext)s" "https://www.youtube.com/watch?v=$id" || continue
  v=$(ls $id.* | grep -v png | head -1)
  $F -hide_banner -loglevel error -y -i "$v" -vf "fps=2,scale=384:-1,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.6,tile=8x6:padding=2" -frames:v 3 "$id-sheet-%d.png"
  echo "$id $(ls $id-sheet-*.png | wc -l) sheets"
done
