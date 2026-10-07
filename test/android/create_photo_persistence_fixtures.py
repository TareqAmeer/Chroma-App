from pathlib import Path
from PIL import Image
from PIL.TiffImagePlugin import IFDRational as R

out = Path(__file__).parent / 'out' / 'photo-persistence'
out.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (63, 37))
image.putdata([((x * 7 + y * 3) % 256, (y * 11) % 256, (x * 5) % 256)
               for y in range(37) for x in range(63)])
exif = Image.Exif()
exif[34853] = {1: 'N', 2: (R(51), R(30), R(0)), 3: 'W', 4: (R(0), R(7), R(0))}
image.save(out / 'gps.jpg', quality=99, exif=exif)
image.save(out / 'photo.png')
image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(out / 'different.jpg', quality=99)
(out / 'broken.jpg').write_bytes(b'not a JPEG')

import shutil
shutil.copyfile(Path(__file__).parent.parent / 'fixtures' / 'video_tiny.mp4', out / 'movie.mp4')
