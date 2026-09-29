"""Render polished stills at the main visual checkpoints."""
import bpy
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = 960
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.cycles.samples = 48
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.025
scene.cycles.use_denoising = True
for name, frame in [("opening", 30), ("flip", 85), ("assembly", 170),
                    ("solid-lock", 216), ("reflection", 244),
                    ("final", 360)]:
    scene.frame_set(frame)
    scene.render.filepath = str(out / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    print("STILL", name, frame, flush=True)
