"""Cycles preview renders of exported .glb assets (for review; not used by the game).

python3 art/preview.py <file.glb> <out.png> [node_prefix ...] [--view left|right|front|top|three]
Only nodes whose names start with one of the prefixes (and their children) are shown.
"""
import math
import os
import sys

import bpy
from mathutils import Vector


PALETTES = {
    'stock': {'body': (0.07, 0.075, 0.09), 'accent': (0.5, 0.17, 0.05), 'metal': (0.15, 0.155, 0.17), 'grip': (0.06, 0.06, 0.07), 'glow': (1.4, 0.55, 0.18)},
    'glacier': {'body': (0.78, 0.86, 0.92), 'accent': (0.1, 0.55, 0.85), 'metal': (0.15, 0.155, 0.17), 'grip': (0.06, 0.06, 0.07), 'glow': (0.35, 0.85, 1.6)},
    'ember': {'body': (0.05, 0.05, 0.06), 'accent': (0.9, 0.28, 0.05), 'metal': (0.15, 0.155, 0.17), 'grip': (0.06, 0.06, 0.07), 'glow': (2.2, 0.7, 0.15)},
    'docks': {'paint': (0.55, 0.08, 0.05)},
    'docksblue': {'paint': (0.05, 0.16, 0.4)},
    'crane': {'paint': (0.8, 0.5, 0.02)},
    'hostile': {'armor': (0.32, 0.07, 0.11), 'cloth': (0.1, 0.1, 0.12), 'accent': (0.85, 0.3, 0.12), 'helmet': (0.16, 0.16, 0.19), 'visor': (2.6, 0.35, 0.18), 'glove': (0.05, 0.05, 0.06), 'sleeve': (0.06, 0.07, 0.08), 'gear': (0.09, 0.09, 0.1)},
}


def tint_materials(pal):
    """Mimic the engine: role-named materials have their base colour multiplied by the palette."""
    for m in bpy.data.materials:
        role = m.name
        if role not in pal or not m.node_tree:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None:
            continue
        c = pal[role]
        if role in ('glow', 'visor'):
            bsdf.inputs['Emission Color'].default_value = (*[min(1, x / max(c)) for x in c], 1)
            bsdf.inputs['Emission Strength'].default_value = max(c) * 3
            continue
        link = next((l for l in nt.links if l.to_socket == bsdf.inputs['Base Color']), None)
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[7].default_value = (*c, 1)
        if link:
            nt.links.new(link.from_socket, mix.inputs[6])
            nt.links.remove(link)
        else:
            mix.inputs[6].default_value = bsdf.inputs['Base Color'].default_value
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    view = 'left'
    if '--view' in args:
        i = args.index('--view')
        view = args[i + 1]
        del args[i:i + 2]
    size = (1100, 620)
    if '--size' in args:
        i = args.index('--size')
        size = tuple(int(v) for v in args[i + 1].split('x'))
        del args[i:i + 2]
    palette = None
    if '--palette' in args:
        i = args.index('--palette')
        palette = PALETTES[args[i + 1]]
        del args[i:i + 2]
    src, out, prefixes = args[0], args[1], args[2:]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    def shown(o):
        # Alternate parts (extended mags) share a pivot with the default part; show them only
        # when asked for explicitly.
        if '_ext' in o.name and not any('_ext' in p for p in prefixes):
            return False
        while o is not None:
            if not prefixes or any(o.name.startswith(p) for p in prefixes):
                return True
            o = o.parent
        return False

    # The glTF importer's custom normals on large concave n-gon caps shade black in Cycles;
    # the exported data is fine (checked), so rebuild preview shading from face angles.
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            me = o.data
            try:
                with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                    bpy.ops.mesh.customdata_custom_splitnormals_clear()
            except Exception:
                pass
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(35))
    if palette:
        tint_materials(palette)
    if os.environ.get('CLAY'):
        clay = bpy.data.materials.new('clay')
        clay.use_nodes = True
        for o in bpy.context.scene.objects:
            if o.type == 'MESH':
                for i in range(len(o.data.materials)):
                    o.data.materials[i] = clay
    if os.environ.get('NONORMAL'):
        for m in bpy.data.materials:
            if m.node_tree:
                for l in list(m.node_tree.links):
                    if l.to_socket.name == 'Normal' and l.to_node.type == 'BSDF_PRINCIPLED':
                        m.node_tree.links.remove(l)
    meshes = []
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH':
            if shown(o):
                meshes.append(o)
            else:
                bpy.data.objects.remove(o)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    radius = (hi - lo).length / 2
    dirs = {
        'left': Vector((-1, -0.25, 0.35)), 'right': Vector((1, -0.25, 0.3)), 'front': Vector((-0.3, -1, 0.3)),
        'top': Vector((-0.2, -0.1, 1)), 'three': Vector((-0.8, 0.6, 0.45)), 'back': Vector((-0.35, 1, 0.35)),
    }
    d = dirs[view].normalized()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = 70
    cam.location = center + d * radius * 3.3
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    cam.data.clip_start = radius * 0.05
    cam.data.clip_end = radius * 50

    def area(name, loc, energy, sz, color=(1, 1, 1)):
        l = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
        l.data.energy = energy * radius * radius * 40
        l.data.size = sz * radius
        l.data.color = color
        l.location = center + Vector(loc) * radius * 3
        l.rotation_euler = (center - l.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(l)

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), math.radians(-18), math.radians(-35))
    bpy.context.scene.collection.objects.link(sun)
    area('fill', (1.2, -1.0, 0.6), 2.5, 3.0, (0.75, 0.85, 1))
    area('rim', (0.4, 1.4, 0.9), 6, 1.2, (1, 0.92, 0.85))
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes['Background'].inputs[0].default_value = (0.5, 0.6, 0.78, 1)
    nt.nodes['Background'].inputs[1].default_value = 0.9
    bpy.context.scene.world = w
    # Ground catcher
    bpy.ops.mesh.primitive_plane_add(size=radius * 40, location=(center.x, center.y, lo.z - radius * 0.02))
    g = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.165, 0.18, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    g.data.materials.append(gm)

    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(os.environ.get('SAMPLES', '48'))
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('rendered', out)


if __name__ == "__main__":
    main()
