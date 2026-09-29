"""Build the editable Chromasmith studio ident in Blender 4.5+.

Run with: blender -b --python build_scene.py -- <output directory>
The plate positions and proportions come from design/logo/chromasmith-logo-dark.svg.
"""

import bpy
import bisect
import math
import os
import sys
from pathlib import Path
from mathutils import Vector


ROOT = Path(os.environ.get("CHROMA_ROOT", Path(__file__).resolve().parents[3]))
OUT = Path(sys.argv[sys.argv.index("--") + 1]).resolve() if "--" in sys.argv else Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)
FONT = ROOT / "Gramatika Font" / "GramatikaRegular.otf"
LOGO = ROOT / "design" / "logo" / "chromasmith-logo-dark.svg"
SOUND = ROOT / "design" / "video" / "chromasmith-intro" / "soundtrack.wav"
assert FONT.exists(), FONT
assert LOGO.exists(), LOGO
assert SOUND.exists(), SOUND

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for block in list(datablocks):
        datablocks.remove(block)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 96
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 360
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.35
scene.render.use_sequencer = False
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.world.color = (0, 0, 0)
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0


def material(name, color, metallic=0, roughness=0.35):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Coat Weight"].default_value = 0.28
    p.inputs["Coat Roughness"].default_value = 0.18
    return mat


ivory = material("Ivory enamel · front", (0.88, 0.865, 0.825), 0.08, 0.34)
black = material("Black graphite · white reverse", (0.028, 0.034, 0.045), 0.20, 0.44)
orange = material("Vermilion enamel · front", (0.92, 0.085, 0.025), 0.09, 0.32)
orange_back = material("Oxide red · orange reverse", (0.28, 0.035, 0.022), 0.14, 0.40)
edge_white = material("Titanium plate edges", (0.20, 0.22, 0.23), 0.68, 0.24)
edge_orange = material("Burnished copper plate edges", (0.27, 0.055, 0.025), 0.66, 0.25)
letter_mat = material("Warm silver lettering", (0.90, 0.91, 0.88), 0.12, 0.28)
letter_p = letter_mat.node_tree.nodes.get("Principled BSDF")
letter_p.inputs["Emission Color"].default_value = (0.55, 0.57, 0.57, 1)
letter_p.inputs["Emission Strength"].default_value = 0.32

# The orange plate remains a single flat vermilion during flight. Only after
# landing does the diagonal middle reflection reveal within the overlap.
on = orange.node_tree.nodes
ol = orange.node_tree.links
op = on.get("Principled BSDF")
coords = on.new("ShaderNodeTexCoord")
split = on.new("ShaderNodeSeparateXYZ")
ol.new(coords.outputs["Generated"], split.inputs["Vector"])

def mathnode(operation, a, b):
    n = on.new("ShaderNodeMath")
    n.operation = operation
    for i, value in enumerate((a, b)):
        if hasattr(value, "node"):
            ol.new(value, n.inputs[i])
        else:
            n.inputs[i].default_value = value
    return n.outputs[0]

inside_x = mathnode("LESS_THAN", split.outputs["X"], 0.767)
inside_z = mathnode("GREATER_THAN", split.outputs["Z"], 0.267)
inside = mathnode("MULTIPLY", inside_x, inside_z)
reflection_reveal = on.new("ShaderNodeValue")
reflection_reveal.name = "Middle reflection · reveal after landing"
for frame, value in [(1, 0), (228, 0), (233, 0.08),
                     (244, 0.85), (360, 0.85)]:
    reflection_reveal.outputs[0].default_value = value
    reflection_reveal.outputs[0].keyframe_insert(data_path="default_value", frame=frame)
reflection_mask = mathnode("MULTIPLY", inside, reflection_reveal.outputs[0])
u = mathnode("DIVIDE", split.outputs["X"], 0.767)
v = mathnode("DIVIDE", mathnode("SUBTRACT", split.outputs["Z"], 0.267), 0.733)
diagonal = mathnode("GREATER_THAN", u, v)
glow = mathnode("MULTIPLY", mathnode("ADD", u, v), 0.5)

def ramp(colors):
    n = on.new("ShaderNodeValToRGB")
    ol.new(glow, n.inputs["Fac"])
    cr = n.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*colors[0], 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (*colors[1], 1)
    return n.outputs["Color"]

red_gradient = ramp(((0.42, 0.022, 0.012), (1.0, 0.38, 0.18)))
orange_gradient = ramp(((0.76, 0.07, 0.025), (1.0, 0.61, 0.37)))
tri_mix = on.new("ShaderNodeMixRGB")
ol.new(diagonal, tri_mix.inputs[0])
ol.new(red_gradient, tri_mix.inputs[1])
ol.new(orange_gradient, tri_mix.inputs[2])
base_mix = on.new("ShaderNodeMixRGB")
ol.new(mathnode("MULTIPLY", reflection_mask, 0.32), base_mix.inputs[0])
base_mix.inputs[1].default_value = (0.92, 0.085, 0.025, 1)
ol.new(tri_mix.outputs[0], base_mix.inputs[2])
ol.new(base_mix.outputs[0], op.inputs["Base Color"])
coat_roughness = mathnode("SUBTRACT", 0.32,
                          mathnode("MULTIPLY", reflection_mask, 0.23))
coat_metallic = mathnode("ADD", 0.09,
                        mathnode("MULTIPLY", reflection_mask, 0.42))
ol.new(coat_roughness, op.inputs["Roughness"])
ol.new(coat_metallic, op.inputs["Metallic"])


def plate(name, width, height, thickness, mats):
    # Front faces camera at negative Y. Stable mesh indices make the reverse visible in flips.
    w, h, t = width / 2, height / 2, thickness / 2
    verts = [(-w, -t, -h), (w, -t, -h), (w, -t, h), (-w, -t, h),
             (-w, t, -h), (w, t, -h), (w, t, h), (-w, t, h)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.clear()
    for mat in mats:
        mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for idx, poly in enumerate(mesh.polygons):
        poly.material_index = min(idx, 2)
    bevel = obj.modifiers.new("Light-catching physical bevel", "BEVEL")
    bevel.width = 0.038
    bevel.segments = 3
    bevel.affect = "EDGES"
    obj.modifiers.new("Weighted face normals", "WEIGHTED_NORMAL")
    return obj


white = plate("01 · ivory square", 4.8, 4.4, 0.23,
              (ivory, black, edge_white))
red = plate("02 · vermilion square", 4.3, 4.5, 0.25,
            (orange, orange_back, edge_orange))
white.rotation_mode = red.rotation_mode = "XYZ"


def _catmull(points, index, u):
    """Smoothly join path guides without stopping at each guide."""
    p0 = points[max(0, index - 1)]
    p1 = points[index]
    p2 = points[index + 1]
    p3 = points[min(len(points) - 1, index + 2)]
    m1 = (p2 - p0) * 0.5
    m2 = (p3 - p1) * 0.5
    u2, u3 = u * u, u * u * u
    return ((2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1
            + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2)


def _arrival_progress(t):
    """Constant travel rate until the last 12%, then one gentle final ease."""
    if t <= 0.88:
        return t
    u = (t - 0.88) / 0.12
    return 0.88 + 0.12 * (u + u * u - u * u * u)


def animate_travel(obj, guides, start, end, start_angles, end_angles):
    """Arc-length sample a continuous 3D path; spin without waypoint eases."""
    points = [Vector(p) for p in guides]
    samples = [points[0]]
    distances = [0.0]
    for segment in range(len(points) - 1):
        for step in range(1, 65):
            p = _catmull(points, segment, step / 64)
            distances.append(distances[-1] + (p - samples[-1]).length)
            samples.append(p)
    total = distances[-1]

    def key(frame, progress):
        distance = progress * total
        idx = max(1, min(bisect.bisect_left(distances, distance), len(samples) - 1))
        span = distances[idx] - distances[idx - 1]
        f = (distance - distances[idx - 1]) / span if span else 0
        obj.location = samples[idx - 1].lerp(samples[idx], f)
        spin = progress
        obj.rotation_euler = tuple(math.radians(a + (b - a) * spin)
                                   for a, b in zip(start_angles, end_angles))
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)

    if start > 1:
        key(1, 0)
    for frame in range(start, end + 1):
        key(frame, _arrival_progress((frame - start) / (end - start)))
    if end < scene.frame_end:
        key(scene.frame_end, 1)
    for fc in obj.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


# The first graphite reverse is huge because it is physically near the lens.
# Both plates retain their full physical dimensions throughout the shot.
animate_travel(white, [
    (0.15, -13.2, -0.15), (-0.02, -10.0, 0.10),
    (-0.18, -6.7, 0.42), (-0.32, -3.2, 0.64),
    (-0.50, 0.08, 0.70),
], 1, 170, (182, 0, 4), (360, 0, 0))
animate_travel(red, [
    (10.0, -11.6, -2.1), (7.8, -10.0, -1.3),
    (6.0, -8.0, -0.55), (4.7, -5.8, -0.18),
    (2.5, -3.0, -0.34), (0.75, -0.28, -0.45),
], 38, 216, (0, 0, -9), (360, 0, 0))

# Three smaller solid fragments travel on coherent rear paths. They keep
# turning until they are naturally hidden by the two main plates.
satellite_1 = plate("03 · small ivory traveller", 0.90, 0.86, 0.12,
                    (ivory, black, edge_white))
satellite_2 = plate("04 · small vermilion traveller", 0.68, 0.72, 0.11,
                    (orange, orange_back, edge_orange))
satellite_3 = plate("05 · small ivory traveller", 0.54, 0.58, 0.10,
                    (ivory, black, edge_white))
for satellite in (satellite_1, satellite_2, satellite_3):
    satellite.rotation_mode = "XYZ"
animate_travel(satellite_1, [
    (-24.0, 5.5, 2.7), (-5.2, 4.8, 1.9),
    (-2.5, 4.0, 1.2), (-1.8, 3.0, 1.2),
], 60, 232, (180, 0, -20), (360, 0, 0))
animate_travel(satellite_2, [
    (24.0, 5.5, 2.6), (5.0, 4.8, 1.8),
    (2.3, 4.0, 0.8), (0.85, 3.0, -0.3),
], 78, 238, (0, 0, 18), (360, 0, 0))
animate_travel(satellite_3, [
    (-24.0, 5.8, -2.9), (-5.0, 4.9, -1.9),
    (-2.5, 4.2, -1.0), (-1.3, 3.5, -0.5),
], 100, 242, (180, 0, 12), (360, 0, 0))


def point(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.object.camera_add(location=(0.18, -18.0, 0.12))
camera = bpy.context.object
camera.name = "Cinema camera · 31 mm · animated focus"
camera.data.lens = 31
camera.data.sensor_width = 36
camera.data.dof.use_dof = True
camera.data.dof.aperture_fstop = 3.5
scene.camera = camera
for frame, loc, target in [
    (1, (0.18, -18.0, 0.12), (0, 0, -1.10)),
    (100, (0.10, -18.0, 0.06), (0, 0, -1.12)),
    (216, (0, -18.0, 0), (0, 0, -1.15)),
    (360, (0, -18.0, 0), (0, 0, -1.15)),
]:
    camera.location = loc
    point(camera, target)
    for path, thing in [("location", camera), ("rotation_euler", camera)]:
        thing.keyframe_insert(data_path=path, frame=frame)
focus_target = bpy.data.objects.new("Animated focus plane · near to emblem", None)
bpy.context.collection.objects.link(focus_target)
for frame, loc in [(1, (0.15, -13.2, -0.15)),
                   (100, (-0.25, -6.0, 0.40)),
    (170, (-0.50, 0.08, 0.70)),
                   (360, (-0.50, 0.08, 0.70))]:
    focus_target.location = loc
    focus_target.keyframe_insert(data_path="location", frame=frame)
camera.data.dof.focus_object = focus_target


def area(name, loc, power, color, shape, size, size_y, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = shape
    data.size = size
    if shape == "RECTANGLE":
        data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    point(obj, target)
    return obj


silver_key = area("Soft silver key · moving reflection", (-6.0, -5.0, 7.0), 930,
                  (0.72, 0.83, 1.0), "RECTANGLE", 1.7, 4.5, (0, 0, 0))
warm_rim = area("Warm rim · moving reflection", (5.0, -0.7, 4.2), 720,
                (1.0, 0.49, 0.28), "RECTANGLE", 0.8, 3.8, (0, 0, 0))
for obj, poses in [
    (silver_key, [(1, (-6.0, -5.0, 7.0)), (155, (-5.4, -5.6, 6.5)),
                  (228, (-6.2, -5.1, 7.1)), (360, (-6.2, -5.1, 7.1))]),
    (warm_rim, [(1, (5.0, -0.7, 4.2)), (155, (4.5, -1.1, 3.7)),
                (228, (5.1, -0.8, 4.2)), (360, (5.1, -0.8, 4.2))]),
]:
    for frame, loc in poses:
        obj.location = loc
        point(obj, (0, 0, 0))
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
area("White square shadow fill", (-2.8, -6.0, 2.8), 260,
     (1.0, 0.91, 0.78), "DISK", 3.0, 3.0, (0, 0, 0))
area("Opening graphite edge strip", (4.1, -14.0, 3.2), 55,
     (0.74, 0.86, 1.0), "RECTANGLE", 0.32, 4.8, (0, -11, 0))
opening_fill = area("Opening graphite face softbox", (-0.5, -15.5, 4.0), 700,
                    (0.54, 0.65, 0.84), "RECTANGLE", 6.0, 6.0,
                    (0, -13, 0))
for frame, energy in [(1, 700), (60, 700), (105, 0), (360, 0)]:
    opening_fill.data.energy = energy
    opening_fill.data.keyframe_insert(data_path="energy", frame=frame)
orange_reverse_fill = area("Oxide reverse softbox", (6.5, -14.0, 2.5), 300,
                           (1.0, 0.46, 0.29), "RECTANGLE", 4.0, 4.0,
                           (5.0, -8.0, 0))
for frame, energy in [(1, 300), (155, 300), (200, 0), (360, 0)]:
    orange_reverse_fill.data.energy = energy
    orange_reverse_fill.data.keyframe_insert(data_path="energy", frame=frame)

# A genuine backlight, aimed toward the camera. The opaque plates interrupt it.
back = bpy.data.lights.new("Rear projection beam", "SPOT")
back.energy = 45000
back.color = (0.43, 0.60, 1.0)
back.spot_size = math.radians(90)
back.spot_blend = 0.12
back.shadow_soft_size = 0.15
back_obj = bpy.data.objects.new(back.name, back)
bpy.context.collection.objects.link(back_obj)
back_obj.location = (0.0, 4.0, 0.3)
point(back_obj, (0, -18, -1.0))
for frame, energy in [(1, 0), (105, 0), (125, 12000),
                      (150, 45000), (270, 45000), (308, 11000),
                      (326, 0), (360, 0)]:
    back.energy = energy
    back.keyframe_insert(data_path="energy", frame=frame)

# A real, small area light skims the upper right enamel corner immediately
# after the orange plate lands; the material reflection follows afterward.
corner_light = area("Post-lock corner tingle", (2.6, -3.1, 2.8), 0,
                    (1.0, 0.88, 0.71), "DISK", 0.28, 0.28,
                    (1.8, -0.28, 1.7))
for frame, energy in [(1, 0), (216, 0), (222, 430),
                      (228, 105), (236, 0), (360, 0)]:
    corner_light.data.energy = energy
    corner_light.data.keyframe_insert(data_path="energy", frame=frame)

# The luminous point is placed within the mark's camera silhouette. The
# projected camera ray to it must hit a solid plate whenever it is active.
flare_mat = bpy.data.materials.new("Occluded rear lamp filament")
flare_mat.use_nodes = True
fn = flare_mat.node_tree.nodes
fn.clear()
fe = fn.new("ShaderNodeEmission")
fe.inputs["Color"].default_value = (1.0, 0.83, 0.67, 1)
fo = fn.new("ShaderNodeOutputMaterial")
flare_mat.node_tree.links.new(fe.outputs[0], fo.inputs["Surface"])
for frame, strength in [(1, 0), (175, 0), (185, 80),
                        (285, 80), (315, 0), (360, 0)]:
    fe.inputs["Strength"].default_value = strength
    fe.inputs["Strength"].keyframe_insert(data_path="default_value", frame=frame)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.13,
                                     location=(0.0, 3.4, 0.3))
filament = bpy.context.object
filament.name = "Always-occluded bright point · behind mark"
filament.data.materials.append(flare_mat)

scene.use_nodes = True
compositor = scene.node_tree
compositor.nodes.clear()
render_layers = compositor.nodes.new("CompositorNodeRLayers")
glare = compositor.nodes.new("CompositorNodeGlare")
glare.glare_type = "FOG_GLOW"
glare.inputs["Threshold"].default_value = 5.0
glare.inputs["Strength"].default_value = 0.20
glare.inputs["Size"].default_value = 0.28
composite = compositor.nodes.new("CompositorNodeComposite")
compositor.links.new(render_layers.outputs["Image"], glare.inputs["Image"])
compositor.links.new(glare.outputs["Image"], composite.inputs["Image"])

# A faint physical scattering medium behind the emblem reveals the backlight.
fog_mat = bpy.data.materials.new("Sparse atmospheric haze")
fog_mat.use_nodes = True
nodes = fog_mat.node_tree.nodes
nodes.clear()
vol = nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Color"].default_value = (0.19, 0.28, 0.60, 1)
vol.inputs["Density"].default_value = 0.010
vol.inputs["Anisotropy"].default_value = 0.72
output = nodes.new("ShaderNodeOutputMaterial")
fog_mat.node_tree.links.new(vol.outputs["Volume"], output.inputs["Volume"])
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, -5, 0))
fog = bpy.context.object
fog.name = "Backlight scattering volume"
fog.scale = (15, 10, 9)
fog.data.materials.append(fog_mat)
for frame, density in [(1, 0.002), (220, 0.025),
                       (308, 0.012), (326, 0), (360, 0)]:
    vol.inputs["Density"].default_value = density
    vol.inputs["Density"].keyframe_insert(data_path="default_value", frame=frame)
for light_obj in [obj for obj in bpy.data.objects if obj.type == "LIGHT"
                  and obj != back_obj]:
    bpy.ops.object.select_all(action="DESELECT")
    fog.select_set(True)
    bpy.context.view_layer.objects.active = light_obj
    bpy.ops.object.light_linking_receivers_link(link_state="EXCLUDE")


# The completed wordmark flies as one mesh-bearing text object.
font = bpy.data.fonts.load(str(FONT))


def text_obj(name, body, size, spacing, depth, mat):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.font = font
    curve.size = size
    curve.space_character = spacing
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = depth
    curve.bevel_depth = 0.006
    curve.bevel_resolution = 2
    curve.materials.append(mat)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(90), 0, 0)
    return obj


word = text_obj("CHRO-MA-SMITH · single flying wordmark", "CHRO-MA-SMITH",
                1.2, 1.06, 0.025, letter_mat)
# The whole title starts close to the camera, large and below the mark,
# then retreats into its resting plane without any scale animation.
for frame in [1, 243] + list(range(244, 281)) + [360]:
    t = 0 if frame < 244 else min(1, (frame - 244) / (280 - 244))
    p = _arrival_progress(t)
    y = -11.0 + 11.0 * p
    distance = 18.0 + y
    z = -1.15 + (-4.45 + 1.15) * distance / 18.0
    z -= 1.6 * (1 - min(1.0, t * 4)) * distance / 18.0
    word.location = (0, y, z)
    word.keyframe_insert(data_path="location", frame=frame)
for fc in word.animation_data.action.fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"
for frame, hidden in [(1, True), (243, True), (244, False)]:
    word.hide_render = hidden
    word.keyframe_insert(data_path="hide_render", frame=frame)

rule_mat = bpy.data.materials.new("Ivory rule · faded")
rule_mat.use_nodes = True
rule_nodes = rule_mat.node_tree.nodes
rule_nodes.clear()
em = rule_nodes.new("ShaderNodeEmission")
em.inputs["Color"].default_value = (0.76, 0.76, 0.72, 1)
transparent = rule_nodes.new("ShaderNodeBsdfTransparent")
fade = rule_nodes.new("ShaderNodeMixShader")
out = rule_nodes.new("ShaderNodeOutputMaterial")
rule_mat.node_tree.links.new(transparent.outputs[0], fade.inputs[1])
rule_mat.node_tree.links.new(em.outputs[0], fade.inputs[2])
rule_mat.node_tree.links.new(fade.outputs[0], out.inputs["Surface"])
for frame, strength in [(1, 0), (294, 0), (310, 0.6), (360, 0.6)]:
    fade.inputs[0].default_value = strength
    fade.inputs[0].keyframe_insert(data_path="default_value", frame=frame)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.05, -5.45))
rule = bpy.context.object
rule.name = "Hairline · fades in"
rule.dimensions = (5.8, 0.01, 0.012)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
rule.data.materials.append(rule_mat)

submat = bpy.data.materials.new("Production byline · faded")
submat.use_nodes = True
sn = submat.node_tree.nodes
sn.clear()
se = sn.new("ShaderNodeEmission")
se.inputs["Color"].default_value = (0.61, 0.62, 0.61, 1)
st = sn.new("ShaderNodeBsdfTransparent")
sf = sn.new("ShaderNodeMixShader")
so = sn.new("ShaderNodeOutputMaterial")
submat.node_tree.links.new(st.outputs[0], sf.inputs[1])
submat.node_tree.links.new(se.outputs[0], sf.inputs[2])
submat.node_tree.links.new(sf.outputs[0], so.inputs["Surface"])
for frame, strength in [(1, 0), (294, 0), (310, 0.65), (360, 0.65)]:
    sf.inputs[0].default_value = strength
    sf.inputs[0].keyframe_insert(data_path="default_value", frame=frame)
subtitle = text_obj("A MAD MACHINE PRODUCTION · fades in", "A MAD MACHINE PRODUCTION",
                    0.33, 1.2, 0.001, submat)
subtitle.location = (0, -0.04, -5.98)

# The background is a real matte surface. Its material reaches literal zero at the end.
bg_mat = bpy.data.materials.new("Deep blue black cyclorama · fades to black")
bg_mat.use_nodes = True
bn = bg_mat.node_tree.nodes
bn.clear()
be = bn.new("ShaderNodeEmission")
be.inputs["Color"].default_value = (0.012, 0.024, 0.042, 1)
bo = bn.new("ShaderNodeOutputMaterial")
bg_mat.node_tree.links.new(be.outputs["Emission"], bo.inputs["Surface"])
for frame, strength in [(1, 0.18), (270, 0.22), (310, 0.06),
                        (326, 0), (360, 0)]:
    be.inputs["Strength"].default_value = strength
    be.inputs["Strength"].keyframe_insert(data_path="default_value", frame=frame)
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 80.0, -0.5))
bg = bpy.context.object
bg.name = "Physical background · fades to complete black"
bg.rotation_euler = (math.radians(90), 0, 0)
bg.scale = (200, 200, 1)
bg.data.materials.append(bg_mat)

# Keep the scene ready for frame inspection and package the font into the blend.
scene.sequence_editor_create().strips.new_sound("Original 8.8-second soundtrack",
                                                str(SOUND), channel=1, frame_start=1)
scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "chromasmith-studio-intro-v3.blend"))
print("SCENE_READY", OUT / "chromasmith-studio-intro.blend")
