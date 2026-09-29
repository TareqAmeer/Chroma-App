from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).parent / "diagnostics"
frames = sorted(root.glob("diagnostic_*.png"))
sheet = Image.new("RGB", (640 * 4, 390 * 4), "#111111")
draw = ImageDraw.Draw(sheet)
for index, path in enumerate(frames):
    x, y = (index % 4) * 640, (index // 4) * 390
    with Image.open(path) as frame:
        sheet.paste(frame.convert("RGB"), (x, y))
    draw.text((x + 10, y + 362), path.stem, fill="white")
sheet.save(root / "contact.png")
