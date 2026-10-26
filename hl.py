"""Hairline art kit: hard-surface modelling helpers for Blender (bpy), headless or interactive.

Authoring convention
--------------------
All helpers take ENGINE coordinates (metres): +X right, +Y up, -Z forward (barrel direction).
They are converted to Blender's Z-up space on creation, and the glTF exporter (+Y up) converts
back, so a value typed here ends up at exactly the same place in the game. Socket empties use
the same convention, which is why socket numbers in these scripts match WeaponModels.js.

    engine (x, y, z)  ->  blender (x, -z, y)

Workflow for one part
---------------------
    p = box('receiver', cx, cy, cz, sx, sy, sz)       # primitive (engine coords + size)
    cut(p, box(...), cyl(...))                         # boolean cutouts (EXACT solver)
    finish(p, bevel=0.0012)                            # bevel + weighted normals, applied
    assign(p, mats['body'])                            # material by palette role
    part = join('body', [p, q, r])                     # one mesh per animated part
    box_uv(part, texel=8.0)                            # world-scale box-projected UVs

Materials are generated PBR sets (textures.py) baked into packed images; the glTF exporter
embeds them as WebP. Material names are the contract with the engine: role materials
(body/accent/metal/grip/glow/...) are tinted at runtime by the weapon palette or agent variant.
"""

import math
import os
import sys
import warnings

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

warnings.filterwarnings('ignore', category=DeprecationWarning)
sys.path.insert(0, os.path.dirname(__file__))
import textures as T  # noqa: E402


# --------------------------------------------------------------------------- scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'


def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def E(x, y, z):
    """Engine point -> Blender vector."""
    return Vector((x, -z, y))


def _from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


# --------------------------------------------------------------------------- primitives
# Rotations (rx, ry, rz) are radians about the ENGINE axes, applied X then Y then Z,
# matching Mat4.compose in the engine.

def _place(ob, cx, cy, cz, rx=0.0, ry=0.0, rz=0.0):
    # Engine rotation about +X == blender +X; engine +Y == blender +Z; engine +Z == blender -Y.
    R = Matrix.Rotation(rz, 4, Vector((0, -1, 0))) @ Matrix.Rotation(ry, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X')
    ob.matrix_world = Matrix.Translation(E(cx, cy, cz)) @ R
    return ob


def box(name, cx, cy, cz, sx, sy, sz, rx=0.0, ry=0.0, rz=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    return _place(_from_bm(name, bm), cx, cy, cz, rx, ry, rz)


def cyl(name, cx, cy, cz, r, length, axis='z', seg=24, r2=None, rx=0.0, ry=0.0, rz=0.0):
    """Cylinder (or cone when r2 is given) centred at c, along an ENGINE axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
    ob = _from_bm(name, bm)  # along blender Z == engine Y
    pre = {'y': Matrix.Identity(4), 'z': Matrix.Rotation(math.pi / 2, 4, 'X'), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y')}[axis]
    ob.data.transform(pre)
    return _place(ob, cx, cy, cz, rx, ry, rz)


def tube(name, cx, cy, cz, r_out, r_in, length, axis='z', seg=32, **rot):
    outer = cyl(name, cx, cy, cz, r_out, length, axis, seg, **rot)
    inner = cyl(name + '_in', cx, cy, cz, r_in, length * 1.2, axis, seg, **rot)
    cut(outer, inner)
    return outer


def prism(name, pts, depth, axis='x', cx=0.0, cy=0.0, cz=0.0, **rot):
    """Extrude a 2D polygon. pts are (u, v) in the plane perpendicular to `axis`:
    axis 'x': (z, y) profile extruded along x — side profiles of stocks, grips, triggers.
    axis 'y': (x, z) footprint extruded up."""
    bm = bmesh.new()
    vs = []
    for (u, v) in pts:
        if axis == 'x':
            vs.append(bm.verts.new(E(-depth / 2, v, u)))
        elif axis == 'y':
            vs.append(bm.verts.new(E(u, -depth / 2, v)))
        else:
            vs.append(bm.verts.new(E(u, v, -depth / 2)))
    f = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[f])
    d = {'x': Vector((depth, 0, 0)), 'y': Vector((0, 0, depth)), 'z': Vector((0, depth, 0))}[axis]
    ext = bmesh.ops.extrude_face_region(bm, geom=[f], use_keep_orig=True)  # keep the start cap
    bmesh.ops.translate(bm, vec=d, verts=[e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _from_bm(name, bm)
    return _place(ob, cx, cy, cz, **rot)


def torus(name, cx, cy, cz, R, r, axis='z', seg=32, ring=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=ring)
    ob = bpy.context.active_object
    ob.name = name
    pre = {'y': Matrix.Identity(4), 'z': Matrix.Rotation(math.pi / 2, 4, 'X'), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y')}[axis]
    ob.data.transform(pre)
    ob.location = E(cx, cy, cz)
    return ob


def array(ob, count, dx=0.0, dy=0.0, dz=0.0):
    """Duplicate `ob` count-1 times at engine offsets; returns all copies (including ob)."""
    out = [ob]
    for i in range(1, count):
        c = ob.copy()
        c.data = ob.data.copy()
        c.matrix_world = Matrix.Translation(Vector((dx * i, -dz * i, dy * i))) @ ob.matrix_world
        link(c)
        out.append(c)
    return out


# --------------------------------------------------------------------------- operations

def apply(ob):
    """Bake modifiers and object transform into the mesh."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    me.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    return ob


def _flatten(objs):
    out = []
    for o in objs:
        if isinstance(o, (list, tuple)):
            out.extend(_flatten(o))
        elif o is not None:
            out.append(o)
    return out


def cut(target, *cutters, union=False):
    cutters = _flatten(cutters)
    if not cutters:
        return target
    # One boolean per cutter: overlapping cutters joined into a single object are not a valid
    # solid and make the EXACT solver drop geometry.
    for tool in cutters:
        apply(tool)
        m = target.modifiers.new('bool', 'BOOLEAN')
        m.operation = 'UNION' if union else 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = tool
        apply(target)
        bpy.data.objects.remove(tool)
    return target


def merge(target, *others):
    return cut(target, *others, union=True)


def finish(ob, bevel=0.001, segments=2, angle=35, harden=True):
    """Hard-surface finish: angle-limited bevel + weighted normals, then applied."""
    if bevel <= 0.0008:
        segments = min(segments, 1)  # sub-millimetre bevels: one segment catches the highlight
    if bevel > 0:
        b = ob.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = segments
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(angle)
        b.miter_outer = 'MITER_ARC'
        b.use_clamp_overlap = True
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(angle))
    if harden:
        w = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        w.keep_sharp = True
        w.mode = 'FACE_AREA'
    apply(ob)
    return ob


def smooth(ob, levels=1, angle=40):
    """Subdivision for organic parts (gloves, padding) with creased hard edges kept sharp."""
    s = ob.modifiers.new('sub', 'SUBSURF')
    s.levels = levels
    s.render_levels = levels
    apply(ob)
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(angle))
    return ob


def skin(name, points, edges, radii, levels=2, root=0):
    """Organic tube mesh from a joint skeleton (Skin + Subdivision modifiers), applied.
    points: ENGINE coords; radii: per point, scalar or (rx, ry) in the skin's local frame."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([E(*p) for p in points], edges, [])
    ob = link(bpy.data.objects.new(name, me))
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = (r, r) if isinstance(r, (int, float)) else r
    sv[root].use_root = True
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = levels
    sub.render_levels = levels
    apply(ob)
    ob.data.shade_smooth()
    return ob


def join(name, objs):
    objs = _flatten(objs)
    for o in objs:
        apply(o)
    bm = bmesh.new()
    mats = []
    for o in objs:
        me = o.data
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        tmp = bmesh.new()
        tmp.from_mesh(me)
        for f in tmp.faces:
            if remap:
                f.material_index = remap[f.material_index] if f.material_index < len(remap) else 0
        me2 = bpy.data.meshes.new('_t')
        tmp.to_mesh(me2)
        tmp.free()
        bm.from_mesh(me2)
        bpy.data.meshes.remove(me2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    # Keep authored custom normals by re-deriving per-object: we joined through bmesh, which
    # drops custom split normals, so harden again with weighted normals.
    for o in objs:
        bpy.data.objects.remove(o)
    ob = link(bpy.data.objects.new(name, me))
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    w = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    w.keep_sharp = True
    apply(ob)
    return ob


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.material_index = 0
    return ob


def assign_faces(ob, mat, pred):
    """Give faces whose centre (ENGINE coords) satisfies pred(x, y, z, nx, ny, nz) a material."""
    me = ob.data
    if mat.name not in [m.name for m in me.materials if m]:
        me.materials.append(mat)
    idx = [m.name for m in me.materials].index(mat.name)
    for p in me.polygons:
        c, n = p.center, p.normal
        if pred(c.x, c.z, -c.y, n.x, n.z, -n.y):
            p.material_index = idx
    return ob


def box_uv(ob, texel=6.0):
    """Box-projected UVs at a fixed world scale (texel = tiles per metre)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = l.vert.co
            if ax == 0:
                u, v = p.y * (1 if n.x > 0 else -1), p.z
            elif ax == 1:
                u, v = p.x * (-1 if n.y > 0 else 1), p.z
            else:
                u, v = p.x, p.y * (1 if n.z > 0 else -1)
            l[uv].uv = (u * texel, v * texel)
    bm.to_mesh(me)
    bm.free()
    return ob


def origin_to(ob, x, y, z):
    """Move the object's origin to an ENGINE point (pivot for animated parts)."""
    p = E(x, y, z)
    ob.data.transform(Matrix.Translation(-p))
    ob.matrix_world = Matrix.Translation(p) @ ob.matrix_world
    return ob


def empty(name, x, y, z, parent=None):
    e = link(bpy.data.objects.new(name, None), parent)
    e.empty_display_size = 0.01
    e.location = E(x, y, z)
    return e


def group(name, children):
    g = link(bpy.data.objects.new(name, None))
    for c in _flatten(children):
        mw = c.matrix_world.copy()
        c.parent = g
        c.matrix_world = mw
    return g


# --------------------------------------------------------------------------- materials

_IMG = {}


def _image(name, arr, non_color):
    if name in _IMG:
        return _IMG[name]
    h, w = arr.shape[:2]
    has_alpha = arr.shape[2] == 4
    img = bpy.data.images.new(name, w, h, alpha=has_alpha)
    # Colour space first: changing it later reloads the generated image and wipes the pixels.
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    alpha = arr[..., 3:4] if has_alpha else np.ones((h, w, 1), np.float32)
    rgba = np.concatenate([arr[..., :3], alpha], -1)[::-1]
    img.pixels.foreach_set(np.ascontiguousarray(rgba, np.float32).ravel())
    img.pack()
    _IMG[name] = img
    return img


def material(name, texset, tex_key=None, emissive=None, emissive_strength=1.0, base_tint=None):
    """Principled material from a generated texture set. Node layout matches what the glTF
    exporter recognises: image -> Base Color, image -> Separate Color (G rough, B metal),
    image -> Normal Map, optional emission."""
    key = tex_key or name
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    base = texset['base'] if base_tint is None else np.clip(texset['base'] * np.array(base_tint, np.float32), 0, 1)
    tb = nt.nodes.new('ShaderNodeTexImage')
    tb.image = _image(f'{key}_base' if base_tint is None else f'{name}_base', base, False)
    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    if base.shape[2] == 4:
        # Alpha-tested decal (stencilled markings): exported as alphaMode MASK.
        nt.links.new(tb.outputs['Alpha'], bsdf.inputs['Alpha'])
        try:
            mat.surface_render_method = 'DITHERED'
        except Exception:
            pass
        mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
    to = nt.nodes.new('ShaderNodeTexImage')
    to.image = _image(f'{key}_orm', texset['orm'], True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = _image(f'{key}_nrm', texset['normal'], True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emissive is not None:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1)
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    return mat


def standard_materials():
    """The shared weapon/agent material library, keyed by engine role."""
    pol = T.set_polymer()
    cer = T.set_cerakote()
    stl = T.set_steel()
    rub = T.set_rubber()
    return {
        'body': material('body', pol, 'polymer'),
        'accent': material('accent', cer, 'cerakote'),
        'metal': material('metal', stl, 'steel'),
        'grip': material('grip', rub, 'rubber'),
        'glow': material('glow', T.set_glow(), 'glow', emissive=(1, 1, 1), emissive_strength=4.0),
        'brass': material('fixed_brass', T.set_brass(), 'brass'),
        'lens': material('fixed_lens', T.set_lens(), 'lens'),
        'dark': material('fixed_dark', T.set_steel(seed=17), 'darksteel', base_tint=(0.18, 0.18, 0.2)),
    }


# --------------------------------------------------------------------------- export

def export_glb(path, objects=None):
    path = os.environ.get('HL_OUT', path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if objects is not None:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_image_format=os.environ.get('HL_IMG', 'WEBP'),
        export_image_quality=88,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        use_selection=objects is not None,
    )
    raw = os.path.getsize(path)
    if os.environ.get('HL_NOPACK') is None:
        import glbpack
        glbpack.pack(path)
    print(f'wrote {path} ({raw / 1024:.0f} KB raw -> {os.path.getsize(path) / 1024:.0f} KB packed)')


def stats():
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    return tris
