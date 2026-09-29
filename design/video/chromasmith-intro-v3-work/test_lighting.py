"""Quick lighting comparisons without replacing the editable scene."""
import bpy
import math
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.resolution_x = 640
scene.render.resolution_y = 360
scene.cycles.samples = 24
scene.render.image_settings.file_format = "PNG"

scene.frame_set(1)
fill = bpy.data.objects["Opening graphite face softbox"]
fill.data.animation_data_clear()
fill.location = (-0.5, -15.5, 4.0)
fill.data.energy = 700
black = bpy.data.materials["Black graphite · white reverse"]
black.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.028, 0.034, 0.045, 1)
scene.render.filepath = str(out / "opening_fill.png")
bpy.ops.render.render(write_still=True)

for name, energy, density in [("beam_mid", 25000, 0.018),
                              ("beam_strong", 50000, 0.030)]:
    scene.frame_set(216)
    back = bpy.data.lights["Rear projection beam"]
    back.animation_data_clear()
    back.energy = energy
    tree = bpy.data.materials["Sparse atmospheric haze"].node_tree
    tree.animation_data_clear()
    volume = tree.nodes.get("Principled Volume")
    volume.inputs["Density"].default_value = density
    fog = bpy.data.objects["Backlight scattering volume"]
    fog.location = (0, -5.0, 0)
    fog.scale = (15, 10, 9)
    scene.render.filepath = str(out / (name + ".png"))
    bpy.ops.render.render(write_still=True)

for light_obj in (o for o in scene.objects if o.type == "LIGHT"
                  and o.name != "Rear projection beam"):
    light_obj.data.animation_data_clear()
    light_obj.data.energy = 0
scene.render.filepath = str(out / "beam_isolated.png")
bpy.ops.render.render(write_still=True)
back.spot_size = math.radians(90)
back.spot_blend = 0.12
back.energy = 50000
volume.inputs["Density"].default_value = 0.025
scene.render.filepath = str(out / "beam_wide_isolated.png")
bpy.ops.render.render(write_still=True)
for name, energy in [("Soft silver key · moving reflection", 930),
                     ("Warm rim · moving reflection", 720),
                     ("White square shadow fill", 260)]:
    bpy.data.objects[name].data.energy = energy
    bpy.ops.object.select_all(action="DESELECT")
    fog.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects[name]
    bpy.ops.object.light_linking_receivers_link(link_state="EXCLUDE")
scene.render.filepath = str(out / "beam_wide_linked.png")
bpy.ops.render.render(write_still=True)
