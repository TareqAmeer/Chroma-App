"""Render a 24 fps Cycles review cut, skipping frames already completed."""
import bpy
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = 480
scene.render.resolution_y = 270
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.cycles.samples = 12
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.06
scene.cycles.use_denoising = True
for frame in range(scene.frame_start, scene.frame_end + 1):
    path = out / f"frame_{frame:03d}.png"
    if path.exists():
        continue
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if frame % 24 == 0 or frame == scene.frame_end:
        print(f"PREVIEW_PROGRESS {frame}/{scene.frame_end}", flush=True)
