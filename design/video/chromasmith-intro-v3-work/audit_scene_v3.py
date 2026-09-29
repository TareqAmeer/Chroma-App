"""Check photographed motion, readable flips, and rear-source occlusion."""
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

scene = bpy.context.scene
camera = scene.camera
plates = [bpy.data.objects.get(prefix) for prefix in
          ("01 · ivory square", "02 · vermilion square")]
lamp = bpy.data.objects["Always-occluded bright point · behind mark"]

for obj, start, end in [(plates[0], 1, 170), (plates[1], 38, 216)]:
    xs, edge_frames, face_changes = [], [], []
    prev_sign = None
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(depsgraph)
        p = world_to_camera_view(scene, camera, evaluated.matrix_world.translation)
        xs.append(p.x)
        front = evaluated.matrix_world.to_3x3() @ Vector((0, -1, 0))
        to_camera = (camera.location - evaluated.matrix_world.translation).normalized()
        facing = front.dot(to_camera)
        if abs(facing) < 0.15:
            edge_frames.append(frame)
        sign = facing > 0
        if prev_sign is not None and sign != prev_sign:
            face_changes.append(frame)
        prev_sign = sign
    dx = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)]
    direction_changes = [start + i + 1 for i in range(1, len(dx))
                         if abs(dx[i]) > 0.0002 and abs(dx[i - 1]) > 0.0002
                         and dx[i] * dx[i - 1] < 0]
    print("MOTION", obj.name, "screen_x", round(xs[0], 3),
          round(xs[-1], 3), "reversals", direction_changes,
          "edge_frames", edge_frames, "face_changes", face_changes)

misses = []
for frame in range(106, 326):
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    covered = False
    for obj in plates:
        evaluated = obj.evaluated_get(depsgraph)
        inverse = evaluated.matrix_world.inverted()
        origin = inverse @ camera.location
        target = inverse @ lamp.location
        direction = target - origin
        hit, *_ = evaluated.ray_cast(origin, direction.normalized(),
                                     distance=direction.length - 0.01)
        covered |= hit
    if not covered:
        misses.append(frame)
print("LAMP_OCCLUSION_MISSES", misses)
