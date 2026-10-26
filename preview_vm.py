"""Viewmodel preview: a weapon + hands assembled like the engine does, rendered in Cycles.

python3 art/preview_vm.py <weapons.glb> <out.png> <weapon id> [--view eye|left|right|top|under|front] [--palette stock]

Arms are placed at the weapon's sockets (arm_right at socket_<id>_righthand, arm_left /
arm_left_pistol at socket_<id>_lefthand). 'eye' approximates the in-game hip view.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from preview import PALETTES, tint_materials  # noqa: E402

args = sys.argv[1:]
view = 'eye'
pal = 'stock'
if '--view' in args:
    i = args.index('--view'); view = args[i + 1]; del args[i:i + 2]
if '--palette' in args:
    i = args.index('--palette'); pal = args[i + 1]; del args[i:i + 2]
src, out, wid = args[0], args[1], args[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = {o.name: o for o in bpy.context.scene.objects}


def E(x, y, z):
    return Vector((x, -z, y))


def sock(name):
    return objs[f'socket_{wid}_{name}'].matrix_world.translation.copy()


left = 'arm_left_pistol' if wid == 'pistol' else 'arm_left'
keep = {wid, 'arm_right', left}
# Drop everything not under the kept roots, and alternate mags.
for o in list(bpy.context.scene.objects):
    r = o
    while r.parent is not None:
        r = r.parent
    if r.name not in keep or '_ext' in o.name:
        bpy.data.objects.remove(o)
objs = {o.name: o for o in bpy.context.scene.objects}
objs['arm_right'].location = sock('righthand')
objs[left].location = sock('lefthand')
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        try:
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception:
            pass
        o.data.shade_smooth()
        o.data.set_sharp_from_angle(angle=math.radians(35))
tint_materials(PALETTES[pal])
# Arm roles (the engine tints these).
for m in bpy.data.materials:
    tints = {'glove': (0.05, 0.05, 0.058), 'sleeve': (0.06, 0.08, 0.14), 'gear': (0.11, 0.11, 0.12)}
    if m.name in tints and m.node_tree:
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        mix = m.node_tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        link = next((l for l in m.node_tree.links if l.to_socket == bsdf.inputs['Base Color']), None)
        if link:
            m.node_tree.links.new(link.from_socket, mix.inputs['A'])
            mix.inputs['B'].default_value = (*tints[m.name], 1)
            m.node_tree.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
bpy.context.scene.collection.objects.link(cam)
HIP = {'rifle': (0.15, -0.172, -0.5), 'smg': (0.145, -0.164, -0.46), 'pistol': (0.1, -0.13, -0.42), 'sniper': (0.155, -0.176, -0.53)}
HIP_YAW = {'rifle': 0.12, 'smg': 0.12, 'pistol': 0.34, 'sniper': 0.1}
if view == 'eye':
    # Match the engine's hip pose: weapon = T(hip) * Rx(0.035 + 0.012 sway) * Ry(yaw) * Rz(-0.07)
    # relative to the eye. We invert it: keep the weapon at the origin, move the camera.
    from mathutils import Matrix
    hx, hy, hz = HIP[wid]
    # Engine compose order: X then Y then Z rotations (Mat4.compose), translation last.
    Rx = Matrix.Rotation(0.035, 4, Vector((1, 0, 0)))
    Ry = Matrix.Rotation(HIP_YAW[wid], 4, Vector((0, 0, 1)))  # engine +Y = blender +Z
    Rz = Matrix.Rotation(-0.07, 4, Vector((0, -1, 0)))       # engine +Z = blender -Y
    Wm = Matrix.Translation(E(hx, hy, hz)) @ Rz @ Ry @ Rx
    cam.matrix_world = Wm.inverted() @ Matrix.Rotation(math.pi / 2, 4, 'X')
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(56)
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = (int(os.environ.get('EW', 1280)), int(os.environ.get('EH', 720)))
else:
    tgt = os.environ.get('TARGET')
    c = sock(tgt) if tgt else E(0, 0.0, -0.15)
    dist = float(os.environ.get('DIST', '1.4'))
    d = {'left': Vector((-1, -0.15, 0.25)), 'right': Vector((1, -0.1, 0.2)), 'top': Vector((-0.05, -0.2, 1)), 'under': Vector((-0.2, -0.1, -1)), 'front': Vector((-0.4, -1, 0.15))}[view].normalized()
    cam.location = c + d * dist
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
cam.data.clip_start = 0.01
bpy.context.scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.5
sun.data.angle = math.radians(4)
sun.rotation_euler = (math.radians(50), math.radians(-25), math.radians(-30))
bpy.context.scene.collection.objects.link(sun)
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
bpy.context.scene.world = w
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = int(os.environ.get('SAMPLES', '32'))
sc.cycles.use_denoising = True
if view != 'eye':
    sc.render.resolution_x, sc.render.resolution_y = (960, 540)
sc.view_settings.view_transform = 'AgX'
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
