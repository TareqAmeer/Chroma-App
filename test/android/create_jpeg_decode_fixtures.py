"""Small asymmetric JPEGs for native/browser decode and all EXIF orientations."""
from pathlib import Path
from PIL import Image, ImageCms

out = Path(__file__).parent / 'out' / 'jpeg-orientation'
out.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (257, 131))
image.putdata([((x * 3 + y * 5) % 256, (x + 2 * y) % 256, (x * 11 + y * 2) % 256)
               for y in range(131) for x in range(257)])
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
for orientation in range(1, 9):
    exif = Image.Exif()
    exif[274] = orientation
    image.save(out / f'{orientation}.jpg', quality=100, subsampling=0, exif=exif, icc_profile=icc)
