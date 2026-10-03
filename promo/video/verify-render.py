from pathlib import Path
from PIL import Image,ImageDraw
import json,subprocess
root=Path(__file__).resolve().parent
video=root/'out/promo-16x9.mp4'
probe=subprocess.check_output(['/usr/local/bin/ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels','-of','json',str(video)],text=True)
print(probe)
subprocess.run(['/usr/local/bin/ffmpeg','-v','error','-i',str(video),'-f','null','-'],check=True)
subprocess.run(['/usr/local/bin/ffmpeg','-hide_banner','-i',str(video),'-vn','-af','volumedetect','-f','null','-'],check=True)
# Recreate the opening proof from the finished export, so its pixels/audio agree.
subprocess.run(['/usr/local/bin/ffmpeg','-v','error','-y','-i',str(video),'-t','17','-c:v','libx264','-crf','20','-c:a','aac','-movflags','+faststart',str(root/'out/redesign/motion-proof.mp4')],check=True)
frames=[145,248,320,410,670,900,1040,1200,1460,1608,1640,1799]
sheet=Image.new('RGB',(1440,1168),'#e1ddd4');draw=ImageDraw.Draw(sheet)
for i,f in enumerate(frames):
 im=Image.open(root/f'out/redesign/frame-{f:04}.png');im.thumbnail((480,270));x=(i%3)*480;y=(i//3)*292;sheet.paste(im,(x,y));draw.text((x+12,y+274),f'{f/30:.1f}s',fill='#0b0b0a')
sheet.save(root/'out/redesign/storyboard.png')
(root/'out/redesign/media-probe.json').write_text(probe)
print('Decode check passed; proof and storyboard refreshed.')
