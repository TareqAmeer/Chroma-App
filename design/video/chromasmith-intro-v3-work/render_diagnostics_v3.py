"""Render only critical beats before a full motion preview."""
import bpy
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = 640
scene.render.resolution_y = 360
scene.render.resolution_percentage = 100
scene.cycles.samples = 16
scene.cycles.adaptive_threshold = 0.06
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = "PNG"
for frame in (1, 85, 140, 170, 216, 244, 260, 310, 360):
    scene.frame_set(frame)
    scene.render.filepath = str(out / f"diagnostic_{frame:03d}.png")
    bpy.ops.render.render(write_still=True)
    print("DIAGNOSTIC", frame, flush=True)
