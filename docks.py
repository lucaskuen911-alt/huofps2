"""Hairline Dockside 9 prop kit -> assets/models/docks.glb

Run:  python3 art/docks.py

Every prop is a root node with its origin at ground level, centred, "front" toward -Z.
Collision is NOT taken from these meshes: map data places brushes (src/data/maps/dockside9.js),
so artists can rework a prop freely without touching gameplay. Static props are light-baked
per vertex at load; crane-moved containers and the RTG crane are drawn dynamically.

Material roles (engine tints per placed instance):
  paint      weathered painted steel (container colour, crane yellow, ...)
  fixed_*    never tinted: dark steel, rubber, wood, concrete, glass, markings
  glow       emissive (floodlights, beacons, cab displays)

Animated RTG crane nodes (see src/render/CraneView.js):
  rtg_frame  legs + girders (moves along Z on its tyres)
  rtg_trolley  moves along X on the girders
  rtg_spreader hangs below the trolley; rtg_cable is a 1 m cable scaled in Y by the engine
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import hl  # noqa: E402
import stylized as S  # noqa: E402
from hl import box, cyl, prism, cut, merge, finish, join, assign, assign_faces, box_uv, empty, group, tube, origin_to  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models', 'docks.glb')
D = math.radians
T = hl.T
TEX = 0.5  # tiles per metre on big props (512 px texture over 2 m)

# ISO container dimensions (m)
CW, CH = 2.438, 2.591
C40, C20 = 12.192, 6.058


def materials():
    """Stylized painted sets (art/lib/stylized.py). Role 'paint' is tinted per instance."""
    return {
        'paint': hl.material('paint', S.m_paint(), 'paintsteel'),
        'dark': hl.material('fixed_dark', S.m_dark(seed=81), 'darksteel2'),
        'steel': hl.material('fixed_steel', S.m_metal(seed=83), 'brightsteel', base_tint=(0.75, 0.76, 0.78)),
        'rubber': hl.material('fixed_rubber', S.m_rubber(seed=85), 'tyre'),
        'wood': hl.material('fixed_wood', S.m_wood(), 'planks'),
        'concrete': hl.material('fixed_concrete', S.m_concrete(), 'precast'),
        'glass': hl.material('fixed_glass', S.m_glass(), 'glass'),
        'glow': hl.material('glow', S.m_glow(), 'lamp', emissive=(1, 0.92, 0.8), emissive_strength=6.0),
        'yellow': hl.material('fixed_hazard', S.m_paint(seed=87), 'hazard', base_tint=(0.95, 0.68, 0.08)),
    }


def marking_texture(text_lines, w=512, h=256):
    """White stencil text on transparent (alpha-tested decal)."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', 44)
        small = ImageFont.truetype('DejaVuSans-Bold.ttf', 28)
    except OSError:
        font = small = ImageFont.load_default()
    y = 16
    for i, line in enumerate(text_lines):
        f = font if i == 0 else small
        d.text((18, y), line, font=f, fill=(245, 245, 240, 255))
        y += 58 if i == 0 else 38
    a = np.asarray(img).astype(np.float32) / 255.0
    return a


# --------------------------------------------------------------------------- containers

def corrugated_outline(length, width, pitch=0.278, depth=0.036):
    """Top-view outline (x, z) of a container shell with trapezoidal corrugation on the long sides."""
    n = int(length / pitch)
    pitch = length / n
    half = width / 2
    right, left = [], []
    for i in range(n):
        z0 = -length / 2 + i * pitch
        # flat - ramp out - flat (outer) - ramp in
        for t, out in [(0.0, 0), (0.18, 1), (0.5, 1), (0.68, 0)]:
            z = z0 + pitch * t
            right.append((half - depth + depth * out, z))
            left.append((-half + depth - depth * out, z))
    right.append((half - depth, length / 2))
    left.append((-half + depth, length / 2))
    return right + left[::-1]


def container(name, length, m, ident):
    parts = []
    L = length
    inner_y0, inner_y1 = 0.16, CH - 0.11
    shell = prism(f'{name}_shell', corrugated_outline(L - 0.3, CW - 0.04), inner_y1 - inner_y0, axis='y', cy=(inner_y0 + inner_y1) / 2)
    parts.append(assign(finish(shell, 0.0, harden=True), m['paint']))
    # Roof with shallow pressed ribs.
    roof = box(f'{name}_roof', 0, CH - 0.06, 0, CW - 0.06, 0.05, L - 0.3)
    parts.append(assign(finish(roof, 0.01, 1), m['paint']))
    for i in range(int(L / 0.9)):
        z = -L / 2 + 0.45 + i * 0.9
        parts.append(assign(finish(box(f'{name}_rr{i}', 0, CH - 0.03, z, CW - 0.3, 0.012, 0.32), 0.004, 1), m['paint']))
    # Frame: top and bottom side rails, corner posts, corner castings, cross members.
    for sx in (1, -1):
        parts.append(assign(finish(box(f'{name}_trail{sx}', sx * (CW / 2 - 0.05), CH - 0.07, 0, 0.1, 0.12, L - 0.2), 0.012, 1), m['paint']))
        parts.append(assign(finish(box(f'{name}_brail{sx}', sx * (CW / 2 - 0.08), 0.12, 0, 0.16, 0.2, L - 0.2), 0.012, 1), m['paint']))
    for sx in (1, -1):
        for sz in (1, -1):
            parts.append(assign(finish(box(f'{name}_post{sx}{sz}', sx * (CW / 2 - 0.08), CH / 2, sz * (L / 2 - 0.08), 0.16, CH - 0.2, 0.16), 0.012, 1), m['paint']))
            for y in (0.06, CH - 0.06):
                cc = box(f'{name}_cc{sx}{sz}{y}', sx * (CW / 2 - 0.09), y, sz * (L / 2 - 0.09), 0.178, 0.118, 0.162)
                cut(cc, box(f'{name}_cch{sx}{sz}{y}', sx * (CW / 2), y, sz * (L / 2 - 0.09), 0.06, 0.05, 0.1))
                parts.append(assign(finish(cc, 0.008, 1), m['dark']))
    for i in range(int(L / 1.2)):
        z = -L / 2 + 0.6 + i * 1.2
        parts.append(assign(finish(box(f'{name}_xm{i}', 0, 0.06, z, CW - 0.2, 0.12, 0.08), 0.0, 1), m['dark']))
    # Fork pockets (20 ft) / gooseneck tunnel hint (40 ft).
    if L < 7:
        for sz in (1, -1):
            for sx in (1, -1):
                parts.append(assign(finish(box(f'{name}_fp{sx}{sz}', sx * (CW / 2 - 0.01), 0.12, sz * 1.0, 0.03, 0.12, 0.36), 0.0, 1), m['dark']))
    # Front end wall (-Z): horizontally ribbed panel.
    fw = box(f'{name}_front', 0, CH / 2, -L / 2 + 0.06, CW - 0.32, CH - 0.32, 0.04)
    parts.append(assign(finish(fw, 0.004, 1), m['paint']))
    for i in range(6):
        parts.append(assign(finish(box(f'{name}_fr{i}', 0, 0.45 + i * 0.32, -L / 2 + 0.03, CW - 0.4, 0.13, 0.04), 0.01, 1), m['paint']))
    # Doors (+Z): two leaves, 4 locking bars with cams, handles, hinges, gasket.
    for sx in (1, -1):
        leaf = box(f'{name}_door{sx}', sx * (CW / 4 - 0.05), CH / 2, L / 2 - 0.05, CW / 2 - 0.18, CH - 0.32, 0.04)
        parts.append(assign(finish(leaf, 0.004, 1), m['paint']))
        for k in range(4):
            y = 0.4 + k * 0.48
            parts.append(assign(finish(box(f'{name}_dp{sx}{k}', sx * (CW / 4 - 0.05), y, L / 2 - 0.025, CW / 2 - 0.3, 0.12, 0.03), 0.008, 1), m['paint']))
        for k, x in enumerate([0.3, 0.75]):
            bx = sx * x
            parts.append(assign(finish(cyl(f'{name}_bar{sx}{k}', bx, CH / 2, L / 2 + 0.01, 0.018, CH - 0.25, 'y', 12), 0.0), m['steel']))
            for y in (0.2, CH - 0.2):
                parts.append(assign(finish(box(f'{name}_cam{sx}{k}{y}', bx, y, L / 2 + 0.02, 0.07, 0.09, 0.05), 0.006, 1), m['steel']))
            parts.append(assign(finish(box(f'{name}_hdl{sx}{k}', bx + sx * 0.08, 1.15, L / 2 + 0.05, 0.2, 0.03, 0.03), 0.006, 1), m['steel']))
        for k in range(4):
            parts.append(assign(finish(cyl(f'{name}_hinge{sx}{k}', sx * (CW / 2 - 0.14), 0.4 + k * 0.6, L / 2 - 0.02, 0.03, 0.12, 'y', 12), 0.0), m['dark']))
    parts.append(assign(finish(box(f'{name}_gasket', 0, CH / 2, L / 2 - 0.08, 0.03, CH - 0.32, 0.03), 0.0), m['rubber']))
    # Stencilled ID / owner markings on the right leaf and both long sides.
    owner, number = ident
    tex = marking_texture([number, owner, 'MAX GROSS 30,480 KG'])
    mk = hl.material(f'fixed_marking_{name}', dict(base=tex, orm=T.pack_orm(np.ones(tex.shape[:2]), np.full(tex.shape[:2], 0.7), np.zeros(tex.shape[:2])), normal=T.rgb([0.5, 0.5, 1], *tex.shape[:2])))
    door = box(f'{name}_mkdoor', CW / 4 - 0.05, 2.0, L / 2 + 0.002, 0.9, 0.45, 0.002)
    parts.append(assign(door, mk))
    for sx in (1, -1):
        side = box(f'{name}_mkside{sx}', sx * (CW / 2 + 0.002), 1.95, L / 2 - 2.2, 0.002, 0.5, 1.0)
        parts.append(assign(side, mk))
    out = join(name, parts)
    box_uv(out, TEX)
    # Marking quads need 0..1 UVs, not box projection.
    me = out.data
    uv = me.uv_layers.active.data
    mk_index = [mm.name for mm in me.materials].index(mk.name)
    for p in me.polygons:
        if p.material_index != mk_index:
            continue
        n = p.normal
        vs = [me.vertices[me.loops[li].vertex_index].co for li in p.loop_indices]
        if abs(n.x) > 0.5:
            us = [v.y for v in vs]
        else:
            us = [v.x for v in vs]
        ws = [v.z for v in vs]
        u0, u1, w0, w1 = min(us), max(us), min(ws), max(ws)
        flip = (n.x < 0) if abs(n.x) > 0.5 else (n.y > 0)
        for li, v in zip(p.loop_indices, vs):
            uu = ((v.y if abs(n.x) > 0.5 else v.x) - u0) / max(1e-6, u1 - u0)
            if flip:
                uu = 1 - uu
            uv[li].uv = (uu, (v.z - w0) / max(1e-6, w1 - w0))
    return out


# --------------------------------------------------------------------------- cranes

def girder(name, x0, y0, z0, x1, y1, z1, w, h, m, mat='paint'):
    """Box beam between two points (axis-aligned runs only)."""
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    sx = abs(x1 - x0) or w
    sy = abs(y1 - y0) or h
    sz = abs(z1 - z0) or w
    return assign(finish(box(name, cx, cy, cz, sx, sy, sz), 0.03, 1), m[mat])


def lattice(name, p0, p1, depth, h, bays, m):
    """Truss between p0 and p1 (horizontal along X or Z): two chords + diagonals."""
    parts = []
    (x0, y0, z0), (x1, y1, z1) = p0, p1
    along_x = abs(x1 - x0) > abs(z1 - z0)
    L = abs(x1 - x0) if along_x else abs(z1 - z0)
    for k, yy in enumerate((y0, y0 + h)):
        if along_x:
            parts.append(girder(f'{name}_ch{k}', x0, yy, z0, x1, yy, z0, depth, 0.18, m))
        else:
            parts.append(girder(f'{name}_ch{k}', x0, yy, z0, x0, yy, z1, depth, 0.18, m))
    for i in range(bays):
        t0, t1 = i / bays, (i + 1) / bays
        a = (x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0)
        b = (x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1)
        seg = L / bays
        ang = math.atan2(h, seg) * (1 if i % 2 else -1)
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        dl = math.hypot(seg, h)
        if along_x:
            parts.append(assign(finish(box(f'{name}_d{i}', mx, y0 + h / 2, mz, dl, 0.1, depth * 0.6, rz=ang), 0.0), m['paint']))
        else:
            parts.append(assign(finish(box(f'{name}_d{i}', mx, y0 + h / 2, mz, depth * 0.6, 0.1, dl, rx=-ang), 0.0), m['paint']))
        if along_x:
            parts.append(assign(finish(box(f'{name}_v{i}', a[0], y0 + h / 2, a[1], 0.1, h, depth * 0.6), 0.0), m['paint']))
        else:
            parts.append(assign(finish(box(f'{name}_v{i}', a[0], y0 + h / 2, a[1], depth * 0.6, h, 0.1), 0.0), m['paint']))
    return parts


def rtg(m, span=28.0, height=20.0, wheelbase=7.0):
    """Rubber-tyred gantry crane. Frame origin at ground centre; X = span, Z = travel."""
    half = span / 2
    fr = []
    for sx in (1, -1):
        x = sx * half
        for sz in (1, -1):
            z = sz * wheelbase / 2
            fr.append(girder(f'rtg_leg{sx}{sz}', x, 1.2, z, x, height - 1.2, z, 1.0, 1, m))
            for k in (-0.7, 0.7):
                fr.append(assign(finish(cyl(f'rtg_tyre{sx}{sz}{k}', x, 0.62, z + k, 0.62, 0.5, 'x', 24), 0.04, 2), m['rubber']))
            fr.append(assign(finish(box(f'rtg_bogie{sx}{sz}', x, 1.15, z, 1.1, 0.8, 2.6), 0.05, 1), m['paint']))
        # Sill beam joining the legs at the bottom, knee braces, top girder along travel.
        fr.append(girder(f'rtg_sill{sx}', x, 1.6, -wheelbase / 2, x, 1.6, wheelbase / 2, 1.1, 1.2, m))
        fr.append(assign(finish(box(f'rtg_knee{sx}', x, height - 3.5, 0, 0.6, 0.6, wheelbase * 0.8, rx=0), 0.03, 1), m['paint']))
        fr += lattice(f'rtg_brace{sx}', (x, 3.0, -wheelbase / 2), (x, 3.0, wheelbase / 2), 0.4, height - 6.5, 3, m)
        fr.append(assign(finish(box(f'rtg_engine{sx}', x + sx * 1.2, 2.6, wheelbase / 2 - 1.2, 1.6, 1.8, 2.2), 0.05, 1), m['paint']))
    for sz in (1, -1):
        z = sz * wheelbase / 2
        fr.append(girder(f'rtg_beam{sz}', -half - 0.6, height - 0.6, z, half + 0.6, height - 0.6, z, 1.2, 1.4, m))
        fr.append(assign(finish(box(f'rtg_railtop{sz}', 0, height + 0.12, z, span, 0.12, 0.25), 0.0), m['dark']))
        fr += lattice(f'rtg_truss{sz}', (-half, height - 3.2, z), (half, height - 3.2, z), 0.5, 2.0, 8, m)
    # Operator cab hanging from the frame + beacons + floodlights.
    cab = box('rtg_cab', -half + 2.2, height - 3.4, -wheelbase / 2 - 1.3, 2.0, 2.2, 1.8)
    fr.append(assign(finish(cab, 0.06, 2), m['paint']))
    fr.append(assign(finish(box('rtg_cabglass', -half + 2.2, height - 3.2, -wheelbase / 2 - 2.21, 1.8, 1.2, 0.02), 0.0), m['glass']))
    for sx in (1, -1):
        for sz in (1, -1):
            fr.append(assign(finish(cyl(f'rtg_beacon{sx}{sz}', sx * (half + 0.3), height + 0.45, sz * wheelbase / 2, 0.14, 0.3, 'y', 12), 0.02), m['glow']))
            fr.append(assign(finish(box(f'rtg_flood{sx}{sz}', sx * (half - 1.5), height - 1.4, sz * (wheelbase / 2 + 0.7), 0.8, 0.3, 0.12), 0.02), m['glow']))
    frame = join('rtg_frame', fr)
    box_uv(frame, TEX)
    # Trolley (moves along X on top of the beams).
    tr = [assign(finish(box('rtg_tr_body', 0, height + 0.9, 0, 3.6, 1.6, wheelbase + 1.2), 0.06, 2), m['paint']),
          assign(finish(box('rtg_tr_house', 0.6, height + 2.2, 0, 2.2, 1.2, 3.0), 0.05, 2), m['paint'])]
    for sx in (1, -1):
        for sz in (1, -1):
            tr.append(assign(finish(cyl(f'rtg_tr_wh{sx}{sz}', sx * 1.4, height + 0.25, sz * wheelbase / 2, 0.3, 0.3, 'x', 16), 0.02), m['dark']))
        tr.append(assign(finish(cyl(f'rtg_drum{sx}', sx * 0.8, height + 0.6, 0, 0.45, 3.4, 'z', 20), 0.02), m['dark']))
    tr.append(assign(finish(box('rtg_tr_glow', 0, height + 0.15, 0, 2.6, 0.06, 0.06), 0.0), m['glow']))
    trolley = join('rtg_trolley', tr)
    origin_to(trolley, 0, height, 0)
    box_uv(trolley, TEX)
    # Spreader: telescopic frame that locks onto the container's top castings. Origin at its
    # underside centre (= container top when engaged).
    sp = [assign(finish(box('rtg_sp_main', 0, 0.35, 0, 1.2, 0.5, C40 - 1.5), 0.04, 1), m['yellow'])]
    for sz in (1, -1):
        sp.append(assign(finish(box(f'rtg_sp_end{sz}', 0, 0.2, sz * (C40 / 2 - 0.3), CW, 0.36, 0.5), 0.04, 1), m['yellow']))
        for sx in (1, -1):
            sp.append(assign(finish(box(f'rtg_sp_flip{sx}{sz}', sx * (CW / 2 - 0.05), 0.05, sz * (C40 / 2 - 0.1), 0.12, 0.6, 0.4), 0.02, 1), m['dark']))
    sp.append(assign(finish(box('rtg_sp_head', 0, 0.9, 0, 1.6, 0.6, 2.4), 0.04, 1), m['yellow']))
    spreader = join('rtg_spreader', sp)
    box_uv(spreader, TEX)
    cable = assign(finish(cyl('rtg_cable', 0, -0.5, 0, 0.035, 1.0, 'y', 8), 0.0), m['dark'])
    box_uv(cable, TEX)
    g = group('rtg', [frame, trolley, spreader, cable])
    empty('socket_rtg_hoist', 0, height, 0, g)
    return g


def sts(m):
    """Ship-to-shore quay crane: portal legs on quay rails (X span 20 m), boom out over water (+X)."""
    parts = []
    span, gauge, h = 20.0, 16.0, 44.0
    for sx in (-1, 1):
        x = sx * span / 2
        for sz in (-1, 1):
            z = sz * gauge / 2
            parts.append(girder(f'sts_leg{sx}{sz}', x, 2.0, z, x, h - 6, z, 1.6, 1, m))
            parts.append(assign(finish(box(f'sts_bogie{sx}{sz}', x, 1.0, z, 1.8, 2.0, 5.0), 0.06, 1), m['paint']))
            for k in range(4):
                parts.append(assign(finish(cyl(f'sts_wh{sx}{sz}{k}', x, 0.4, z - 1.8 + k * 1.2, 0.4, 0.5, 'x', 16), 0.02), m['dark']))
        parts.append(girder(f'sts_sill{sx}', x, 10.0, -gauge / 2, x, 10.0, gauge / 2, 1.4, 1.6, m))
        parts += lattice(f'sts_portal{sx}', (x, 12.0, -gauge / 2), (x, 12.0, gauge / 2), 0.6, h - 20, 4, m)
    for sz in (-1, 1):
        z = sz * gauge / 2
        parts.append(girder(f'sts_portalbeam{sz}', -span / 2, h - 6, z, span / 2, h - 6, z, 1.6, 2.0, m))
    # Boom (out over water) and girder (back-reach), A-frame apex, stays.
    parts += lattice('sts_boomL', (-span / 2 - 18, h - 4, -2.2), (span / 2 + 52, h - 4, -2.2), 0.8, 3.0, 24, m)
    parts += lattice('sts_boomR', (-span / 2 - 18, h - 4, 2.2), (span / 2 + 52, h - 4, 2.2), 0.8, 3.0, 24, m)
    for i in range(0, 70, 6):
        parts.append(assign(finish(box(f'sts_boomx{i}', -span / 2 - 18 + i + 3, h - 4, 0, 0.3, 0.3, 4.4), 0.0), m['paint']))
    for sx in (-1, 1):
        parts.append(girder(f'sts_apex{sx}', sx * 3.0, h - 1, -2.4, sx * 3.0, h + 14, -2.4, 1.0, 1, m))
        parts.append(girder(f'sts_apexb{sx}', sx * 3.0, h - 1, 2.4, sx * 3.0, h + 14, 2.4, 1.0, 1, m))
    parts.append(assign(finish(box('sts_apextop', 0, h + 14.5, 0, 7.0, 1.0, 5.8), 0.05, 1), m['paint']))
    for i, (x, d) in enumerate([(span / 2 + 40, 1), (-span / 2 - 16, -1)]):
        dx, dy = x - 0, (h - 2.5) - (h + 14)
        L = math.hypot(dx, dy)
        ang = math.atan2(dy, dx)
        for sz in (-1, 1):
            parts.append(assign(finish(box(f'sts_stay{i}{sz}', x / 2, (h + 14 + h - 2.5) / 2, sz * 2.4, L, 0.22, 0.22, rz=ang), 0.0), m['steel']))
    parts.append(assign(finish(box('sts_machinery', -span / 2 - 10, h + 1.0, 0, 12, 5, 7), 0.08, 2), m['paint']))
    parts.append(assign(finish(box('sts_cab', span / 2 + 6, h - 8.5, 0, 3, 3, 3), 0.06, 2), m['paint']))
    parts.append(assign(finish(box('sts_cabglass', span / 2 + 6, h - 8.4, -1.51, 2.6, 1.8, 0.02), 0.0), m['glass']))
    parts.append(assign(finish(box('sts_trolley', span / 2 + 6, h - 2.0, 0, 5, 2.0, 5), 0.05, 1), m['paint']))
    for i in range(6):
        parts.append(assign(finish(cyl(f'sts_beacon{i}', -span / 2 - 18 + i * 14, h - 1.8, 0, 0.18, 0.4, 'y', 12), 0.02), m['glow']))
    for sx in (-1, 1):
        parts.append(assign(finish(box(f'sts_flood{sx}', sx * span / 2, h - 6.8, -gauge / 2 - 1.0, 1.4, 0.4, 0.2), 0.02), m['glow']))
    out = join('sts_crane', parts)
    box_uv(out, TEX * 0.5)
    return out


# --------------------------------------------------------------------------- quay + yard kit

def bollard(m):
    b = cyl('bollard_post', 0, 0.35, 0, 0.18, 0.7, 'y', 24)
    cap = cyl('bollard_cap', 0, 0.72, 0, 0.27, 0.1, 'y', 24)
    horn = box('bollard_horn', 0, 0.5, 0, 0.7, 0.12, 0.12)
    base = box('bollard_base', 0, 0.04, 0, 0.6, 0.08, 0.6)
    out = join('bollard', [assign(finish(x, 0.02, 2), m['dark']) for x in (b, cap, horn)] + [assign(finish(base, 0.02, 1), m['steel'])])
    box_uv(out, 2)
    return out


def fender(m):
    body = cyl('fender_body', 0, -1.4, 0, 0.55, 1.6, 'y', 24)
    cut(body, cyl('fender_bore', 0, -1.4, 0, 0.28, 2.0, 'y', 20))
    plate = box('fender_plate', 0, -1.4, 0.6, 1.4, 2.0, 0.12)
    out = join('fender', [assign(finish(body, 0.04, 2), m['rubber']), assign(finish(plate, 0.02, 1), m['dark'])])
    box_uv(out, 1.5)
    return out


def light_mast(m, h=24.0):
    parts = [assign(finish(cyl('mast_pole', 0, h / 2, 0, 0.32, h, 'y', 16, r2=0.18), 0.02), m['steel']),
             assign(finish(box('mast_base', 0, 0.3, 0, 1.2, 0.6, 1.2), 0.04, 1), m['concrete']),
             assign(finish(box('mast_ring', 0, h - 0.3, 0, 3.4, 0.3, 3.4), 0.03, 1), m['steel'])]
    for i in range(6):
        a = i / 6 * math.pi * 2
        x, z = math.cos(a) * 1.4, math.sin(a) * 1.4
        head = box(f'mast_head{i}', x, h + 0.25, z, 0.9, 0.55, 0.35, ry=-a + math.pi / 2, rx=D(-30))
        parts.append(assign(finish(head, 0.03, 1), m['dark']))
        lens = box(f'mast_lens{i}', x * 1.05, h + 0.1, z * 1.05, 0.78, 0.04, 0.26, ry=-a + math.pi / 2, rx=D(-30))
        parts.append(assign(finish(lens, 0.0), m['glow']))
    out = join('light_mast', parts)
    box_uv(out, 1)
    return out


def jersey(m):
    prof = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.08), (0.15, 0.33), (0.1, 0.81), (-0.1, 0.81), (-0.15, 0.33), (-0.3, 0.08)]
    body = prism('jersey_body', [(x, y) for (x, y) in prof], 3.0, axis='z')
    out = assign(finish(body, 0.02, 2), m['concrete'])
    out.name = 'jersey'
    box_uv(out, 0.8)
    return out


def crate(m, name='crate', s=1.1):
    b = box(f'{name}_core', 0, s / 2, 0, s, s, s)
    parts = [assign(finish(b, 0.01, 1), m['wood'])]
    for sx in (1, -1):
        for sz in (1, -1):
            parts.append(assign(finish(box(f'{name}_edge{sx}{sz}', sx * (s / 2 - 0.04), s / 2, sz * (s / 2 - 0.04), 0.1, s, 0.1), 0.01, 1), m['wood']))
        parts.append(assign(finish(box(f'{name}_brace{sx}', sx * (s / 2 + 0.01), s / 2, 0, 0.03, s * 1.15, 0.12, rx=D(45)), 0.005, 1), m['wood']))
    for y in (0.06, s - 0.06):
        parts.append(assign(finish(box(f'{name}_band{y}', 0, y, 0, s + 0.02, 0.1, s + 0.02), 0.005, 1), m['wood']))
    out = join(name, parts)
    box_uv(out, 0.9)
    return out


def pallet_stack(m):
    parts = []
    for k in range(3):
        y = k * 0.15
        for i in range(5):
            parts.append(assign(finish(box(f'pal_top{k}{i}', -0.48 + i * 0.24, y + 0.135, 0, 0.14, 0.022, 1.2), 0.0), m['wood']))
        for sx in (-1, 0, 1):
            parts.append(assign(finish(box(f'pal_blk{k}{sx}', sx * 0.5, y + 0.06, 0, 0.1, 0.1, 1.2), 0.0), m['wood']))
    sacks = box('pal_load', 0, 0.45 + 0.42, 0, 1.0, 0.84, 1.1)
    parts.append(assign(finish(sacks, 0.08, 3), m['concrete']))
    parts.append(assign(finish(box('pal_wrap', 0, 0.87, 0, 1.04, 0.86, 1.14), 0.06, 2), m['glass']))
    out = join('pallet_stack', parts)
    box_uv(out, 1)
    return out


def barrels(m):
    parts = []
    for i, (x, z) in enumerate([(-0.32, -0.3), (0.32, -0.3), (0, 0.28), (0.62, 0.32)]):
        b = cyl(f'barrel{i}', x, 0.44, z, 0.29, 0.88, 'y', 24)
        parts.append(assign(finish(b, 0.015, 2), m['paint']))
        for y in (0.3, 0.6):
            parts.append(assign(finish(cyl(f'barrel_r{i}{y}', x, y, z, 0.3, 0.03, 'y', 24), 0.0), m['paint']))
        parts.append(assign(finish(cyl(f'barrel_lid{i}', x, 0.885, z, 0.27, 0.01, 'y', 24), 0.0), m['dark']))
    out = join('barrels', parts)
    box_uv(out, 1.2)
    return out


def forklift(m):
    p = [assign(finish(box('fl_body', 0, 0.75, 0.3, 1.2, 0.9, 2.0), 0.08, 2), m['yellow']),
         assign(finish(box('fl_counter', 0, 0.75, 1.25, 1.2, 0.9, 0.5), 0.1, 3), m['dark']),
         assign(finish(box('fl_seat', 0, 1.35, 0.6, 0.5, 0.3, 0.5), 0.05, 2), m['rubber'])]
    for sx in (1, -1):
        p.append(assign(finish(box(f'fl_cagepost{sx}', sx * 0.55, 1.6, 0.0, 0.08, 1.4, 0.08), 0.01, 1), m['dark']))
        p.append(assign(finish(box(f'fl_cagepostb{sx}', sx * 0.55, 1.6, 1.0, 0.08, 1.4, 0.08), 0.01, 1), m['dark']))
        p.append(assign(finish(box(f'fl_mast{sx}', sx * 0.35, 1.5, -0.75, 0.12, 2.6, 0.15), 0.01, 1), m['dark']))
        p.append(assign(finish(box(f'fl_fork{sx}', sx * 0.3, 0.12, -1.35, 0.12, 0.05, 1.2), 0.01, 1), m['steel']))
        for z in (-0.4, 0.95):
            p.append(assign(finish(cyl(f'fl_wh{sx}{z}', sx * 0.55, 0.3, z, 0.3, 0.25, 'x', 20), 0.03, 2), m['rubber']))
    p.append(assign(finish(box('fl_roof', 0, 2.32, 0.5, 1.2, 0.06, 1.2), 0.02, 1), m['dark']))
    p.append(assign(finish(box('fl_carriage', 0, 0.45, -0.85, 1.0, 0.6, 0.08), 0.01, 1), m['dark']))
    p.append(assign(finish(cyl('fl_beacon', 0, 2.42, 0.9, 0.08, 0.14, 'y', 12), 0.0), m['glow']))
    out = join('forklift', p)
    box_uv(out, 1)
    return out


def booth(m):
    shell = box('booth_shell', 0, 1.35, 0, 2.4, 2.7, 2.0)
    cut(shell, box('booth_win', 0, 1.6, -1.0, 1.9, 1.0, 0.2), box('booth_winR', 1.2, 1.6, 0, 0.2, 1.0, 1.5), box('booth_door', -1.2, 1.05, 0.2, 0.2, 2.1, 0.9),
        box('booth_in', 0, 1.35, 0, 2.2, 2.5, 1.8))
    parts = [assign(finish(shell, 0.02, 1), m['paint']),
             assign(finish(box('booth_roof', 0, 2.78, 0, 2.8, 0.16, 2.4), 0.03, 1), m['dark']),
             assign(finish(box('booth_glass', 0, 1.6, -0.97, 1.9, 1.0, 0.02), 0.0), m['glass']),
             assign(finish(box('booth_glassR', 1.17, 1.6, 0, 0.02, 1.0, 1.5), 0.0), m['glass']),
             assign(finish(box('booth_desk', 0, 0.95, -0.6, 2.0, 0.08, 0.6), 0.01, 1), m['dark']),
             assign(finish(box('booth_screen', 0.3, 1.25, -0.6, 0.5, 0.32, 0.03), 0.0), m['glow'])]
    out = join('booth', parts)
    box_uv(out, 1)
    return out


def boom_gate(m):
    p = [assign(finish(box('gate_post', 0, 0.6, 0, 0.4, 1.2, 0.4), 0.03, 1), m['paint'])]
    for i in range(6):
        p.append(assign(finish(box(f'gate_arm{i}', 0.45 + i * 0.7 + 0.35, 1.0, 0, 0.7, 0.09, 0.07), 0.01, 1), m['paint'] if i % 2 else m['yellow']))
    p.append(assign(finish(cyl('gate_lamp', 0, 1.3, 0, 0.08, 0.12, 'y', 12), 0.0), m['glow']))
    out = join('boom_gate', p)
    box_uv(out, 1)
    return out


def roof_truss(m, span=44.0, h=2.2):
    parts = lattice('truss', (-span / 2, 0.0, 0), (span / 2, 0.0, 0), 0.25, h, 14, m)
    out = join('roof_truss', parts)
    box_uv(out, 0.5)
    return out


def rack(m, length=6.0, h=4.2, d=1.1):
    p = []
    for x in (-length / 2, 0, length / 2):
        for z in (-d / 2, d / 2):
            p.append(assign(finish(box(f'rk_up{x}{z}', x, h / 2, z, 0.09, h, 0.09), 0.006, 1), m['yellow'] if False else m['paint']))
    for y in (0.15, 1.5, 2.85):
        for z in (-d / 2, d / 2):
            p.append(assign(finish(box(f'rk_beam{y}{z}', 0, y, z, length, 0.12, 0.06), 0.006, 1), m['yellow']))
        p.append(assign(finish(box(f'rk_deck{y}', 0, y + 0.07, 0, length, 0.03, d), 0.0), m['steel']))
        for i in range(4):
            x = -length / 2 + 0.75 + i * 1.5
            p.append(assign(finish(box(f'rk_box{y}{i}', x, y + 0.6, 0, 1.2, 1.0 - (i % 2) * 0.25, 0.95), 0.03, 1), m['wood'] if (i + int(y)) % 3 else m['concrete']))
    out = join('rack', p)
    box_uv(out, 1)
    return out


def highbay(m):
    p = [assign(finish(cyl('hb_shade', 0, -0.25, 0, 0.42, 0.5, 'y', 24, r2=0.14), 0.01), m['dark']),
         assign(finish(cyl('hb_lens', 0, -0.5, 0, 0.38, 0.02, 'y', 24), 0.0), m['glow']),
         assign(finish(cyl('hb_rod', 0, 0.6, 0, 0.02, 1.2, 'y', 8), 0.0), m['steel'])]
    out = join('highbay', p)
    box_uv(out, 2)
    return out


def gangway(m, L=13.0, w=1.6):
    p = [assign(finish(box('gw_deck', 0, 0.05, 0, w, 0.1, L), 0.0), m['steel'])]
    for i in range(int(L / 0.4)):
        p.append(assign(finish(box(f'gw_tread{i}', 0, 0.12, -L / 2 + 0.2 + i * 0.4, w - 0.1, 0.04, 0.05), 0.0), m['dark']))
    for sx in (1, -1):
        p.append(assign(finish(cyl(f'gw_rail{sx}', sx * w / 2, 1.05, 0, 0.03, L, 'z', 8), 0.0), m['steel']))
        p.append(assign(finish(cyl(f'gw_mid{sx}', sx * w / 2, 0.55, 0, 0.022, L, 'z', 8), 0.0), m['steel']))
        for i in range(int(L / 1.5) + 1):
            p.append(assign(finish(cyl(f'gw_post{sx}{i}', sx * w / 2, 0.55, -L / 2 + i * 1.5, 0.025, 1.1, 'y', 8), 0.0), m['steel']))
    out = join('gangway', p)
    box_uv(out, 1)
    return out


def lifebuoy(m):
    t = hl.torus('lifebuoy_ring', 0, 0.0, 0, 0.32, 0.08, 'z', 24, 10)
    hl.apply(t)
    out = assign(t, m['yellow'])
    out.name = 'lifebuoy'
    box_uv(out, 2)
    return out


def main():
    hl.reset()
    m = materials()
    container('container40', C40, m, ('HAIRLINE LOGISTICS', 'HLXU 482910 4'))
    container('container20', C20, m, ('SALTWORKS FREIGHT', 'SWFU 207733 1'))
    rtg(m)
    sts(m)
    bollard(m)
    fender(m)
    light_mast(m)
    jersey(m)
    crate(m, 'crate', 1.1)
    crate(m, 'crate_big', 2.2)
    pallet_stack(m)
    barrels(m)
    forklift(m)
    booth(m)
    boom_gate(m)
    roof_truss(m)
    rack(m)
    highbay(m)
    gangway(m)
    lifebuoy(m)
    print('docks tris', hl.stats())
    hl.export_glb(os.path.abspath(OUT))


if __name__ == '__main__':
    main()
