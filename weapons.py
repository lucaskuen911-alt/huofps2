"""Hairline weapon models (stylized) -> assets/models/weapons.glb

Run:  python3 art/weapons.py [rifle smg pistol sniper att arms]

Style: chunky profile-driven silhouettes, broad flat chamfers (they catch the engine's edge
highlight), two-tone colour blocking (body / accent roles tinted by skins), emissive channels,
LED ammo pips, and a see-through receiver window on the left (the side the player sees) so the
bolt visibly cycles with every shot.

Node contract (src/render/WeaponModels.js):
  <id>                 group per weapon (rifle, smg, pistol, sniper)
    <id>_body          static receiver mesh, materials named by palette role
    <id>_mag           magazine, origin = magazine pivot
    <id>_mag_ext       extended magazine variant (attachment 'extmag')
    <id>_bolt          parts that slide back on the bolt cue (+Z), origin at rest
    <id>_pip_NN        ammo-counter LEDs, lit rear-to-front as a fraction of the magazine
    socket_<id>_muzzle / _eject / _sight / _magwell / _lefthand / _righthand / _rail / _under
  att_suppressor, att_compensator, att_reflex (+ att_reflex_reticle, socket_att_reflex_sight),
  att_scope (+ socket_att_scope_sight), att_grip     — origin at their mount point
  arm_right, arm_left, arm_left_pistol   gloved hands + sleeves (art/lib/hands.py)

Engine weapon space: metres, barrel along -Z, +Y up, origin at the trigger.
Shared standards so one hand set fits every gun: long-gun grip profile + 16 deg rake
(right hand socket (0, -0.06, 0.01)), handguards ~58 mm wide with the bore at y = 0.03.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import hl  # noqa: E402
import stylized as S  # noqa: E402
from hl import box, cyl, prism, cut, merge, finish, join, assign, assign_faces, box_uv, origin_to, empty, group, tube  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models', 'weapons.glb')
D = math.radians
TEX = 9.0  # texture tiles per metre on weapons
CH = 0.0035  # standard chamfer (m)


# --------------------------------------------------------------------------- shared features

def side(name, pts, width, mat, cx=0.0, bevel=CH, seg=1):
    """Profile-extruded part (z, y profile, extruded along X) with a flat chamfer."""
    p = prism(name, pts, width, cx=cx)
    finish(p, bevel, seg, angle=30)
    return assign(p, mat)


def rail(name, z0, z1, y, mats, width=0.022):
    """Low-profile optic rail: base bar + cross slots. Top surface at y + 0.0105."""
    base = box(name, 0, y + 0.0035, (z0 + z1) / 2, width, 0.007, z1 - z0)
    teeth = []
    n = int((z1 - z0) / 0.012)
    for i in range(n):
        z = z0 + 0.006 + i * 0.012
        teeth.append(finish(box(f'{name}_t{i}', 0, y + 0.0085, z, width + 0.003, 0.004, 0.006), 0.0007, 1))
    out = join(name, [finish(base, 0.0008)] + teeth)
    return assign(out, mats['metal'])


def pip_strip(prefix, count, x, y, z0, z1, mats, size=(0.0065, 0.0042)):
    """Recessed ammo-counter window on the LEFT side (x < 0) with addressable LED pips."""
    win_len = abs(z1 - z0) + 0.014
    frame = box(f'{prefix}_frame', x - 0.0006, y, (z0 + z1) / 2, 0.0024, size[1] + 0.007, win_len)
    finish(frame, 0.0008, 1)
    assign(frame, mats['dark'])
    pips = []
    for i in range(count):
        t = i / max(1, count - 1)
        z = z0 + (z1 - z0) * t
        p = box(f'{prefix}_pip_{i:02d}', x - 0.0019, y, z, 0.0012, size[1], size[0] * 0.78)
        finish(p, 0.0003, 1)
        assign(p, mats['glow'])
        box_uv(p, TEX)
        pips.append(p)
    return frame, pips


def sockets(wid, d, parent):
    for k, v in d.items():
        empty(f'socket_{wid}_{k}', *v, parent=parent)


def finalize(wid, body_parts, mag, mag_ext, bolt, pips, socket_map):
    body = join(f'{wid}_body', body_parts)
    for o in (body, mag, mag_ext, bolt):
        box_uv(o, TEX)
    g = group(wid, [body, mag, mag_ext, bolt] + pips)
    sockets(wid, socket_map, g)
    return g


GRIP = [(-0.006, -0.016), (0.034, -0.016), (0.047, -0.03), (0.066, -0.108), (0.061, -0.122), (0.022, -0.124), (0.008, -0.112), (-0.003, -0.06)]


def std_grip(prefix, m, dz=0.0, dy=0.0):
    """Long-gun pistol grip (16 deg rake), finger grooves, body-coloured caps."""
    pts = [(z + dz, y + dy) for z, y in GRIP]
    g = prism(f'{prefix}_grip', pts, 0.031)
    cut(g, *[cyl(f'{prefix}_fg{i}', 0, y + dy, z + dz, 0.0072, 0.06, 'x', 20) for i, (z, y) in enumerate([(-0.009, -0.055), (-0.0045, -0.078), (0.0005, -0.1)])])
    finish(g, 0.004, 2, angle=30)
    assign(g, m['grip'])
    assign_faces(g, m['body'], lambda x, y, z, nx, ny, nz: y > -0.026 + dy or y < -0.117 + dy)
    return g


def std_guard(prefix, m, z0=-0.104, z1=0.016, top=-0.016):
    """Trigger guard + trigger sized for the standard grip."""
    tg = prism(f'{prefix}_tg', [(z0, top), (z0, top - 0.018), (z0 + 0.012, top - 0.033), (z1 - 0.018, top - 0.033), (z1, top - 0.014), (z1, top)], 0.011)
    cut(tg, prism(f'{prefix}_tgin', [(z0 + 0.008, top + 0.004), (z0 + 0.008, top - 0.016), (z0 + 0.016, top - 0.026), (z1 - 0.022, top - 0.026), (z1 - 0.009, top - 0.012), (z1 - 0.009, top + 0.004)], 0.03))
    trig = prism(f'{prefix}_trig', [(-0.057, top), (-0.048, top), (-0.045, top - 0.013), (-0.049, top - 0.025), (-0.056, top - 0.027), (-0.055, top - 0.014)], 0.006)
    return [assign(finish(tg, 0.0014, 2), m['body']), assign(finish(trig, 0.0009, 1), m['metal'])]


def iron_sights(prefix, m, rear_z, front_z, line_y, base_y_rear, base_y_front):
    """Rear notch + front post whose tips sit on the sight line."""
    rear = merge(box(f'{prefix}_rs', 0, (base_y_rear + line_y - 0.004) / 2, rear_z, 0.028, line_y - 0.004 - base_y_rear, 0.014),
                 box(f'{prefix}_rsL', -0.0085, line_y + 0.0005, rear_z, 0.008, 0.01, 0.012),
                 box(f'{prefix}_rsR', 0.0085, line_y + 0.0005, rear_z, 0.008, 0.01, 0.012))
    front = merge(box(f'{prefix}_fs', 0, (base_y_front + line_y - 0.01) / 2, front_z, 0.016, line_y - 0.01 - base_y_front, 0.016),
                  box(f'{prefix}_post', 0, line_y - 0.005, front_z, 0.003, 0.01, 0.003))
    return [assign(finish(rear, 0.0012), m['metal']), assign(finish(front, 0.0008), m['metal']),
            assign(finish(box(f'{prefix}_dot', 0, line_y - 0.001, front_z + 0.0016, 0.0022, 0.0022, 0.0006), 0.0002), m['glow'])]


def bolt_window(name, z0, z1, y0, y1):
    """Cutter for the left-side receiver window that shows the bolt carrier."""
    return box(name, -0.03, (y0 + y1) / 2, (z0 + z1) / 2, 0.02, y1 - y0, z1 - z0)


# --------------------------------------------------------------------------- HALBERD (rifle)

def curve(p0, p1, bulge, n=6):
    (z0, y0), (z1, y1) = p0, p1
    dz, dy = z1 - z0, y1 - y0
    L = math.hypot(dz, dy)
    nz, ny = -dy / L, dz / L
    return [(z0 + dz * t + nz * bulge * 4 * t * (1 - t), y0 + dy * t + ny * bulge * 4 * t * (1 - t)) for t in [i / (n - 1) for i in range(n)]]


def rifle(m):
    P = []
    # Upper: one chunky shroud from the stock joint to the handguard, sloped nose.
    up = prism('r_upper', [(0.066, 0.04), (0.066, 0.068), (0.03, 0.075), (-0.27, 0.075), (-0.295, 0.066), (-0.295, 0.012), (0.066, 0.012)], 0.05)
    cut(up, bolt_window('r_win', -0.115, -0.045, 0.032, 0.056),
        box('r_port', 0.03, 0.044, -0.085, 0.02, 0.022, 0.07),
        cyl('r_bore', 0, 0.03, -0.25, 0.0125, 0.12, 'z', 24))
    P.append(assign(finish(up, 0.0042, 1, angle=30), m['body']))
    P.append(assign(finish(box('r_winback', -0.006, 0.044, -0.08, 0.003, 0.028, 0.074), 0.0004), m['dark']))
    # Accent spine along the top + a lit seam under it (reads from the hip).
    P.append(side('r_spine', [(0.05, 0.075), (-0.25, 0.075), (-0.262, 0.081), (0.035, 0.081)], 0.03, m['accent'], bevel=0.0018))
    for sx in (1, -1):
        P.append(assign(finish(box(f'r_seam{sx}', sx * 0.0252, 0.064, -0.17, 0.0014, 0.0028, 0.17), 0.0003, 1), m['glow']))
    # Lower + magwell flare.
    lo = prism('r_lower', [(0.046, 0.014), (0.046, -0.016), (-0.098, -0.02), (-0.106, -0.05), (-0.198, -0.055), (-0.212, -0.04), (-0.212, 0.014)], 0.052)
    cut(lo, box('r_well', 0, -0.03, -0.152, 0.03, 0.07, 0.068))
    P.append(assign(finish(lo, 0.004, 1, angle=30), m['body']))
    P.append(std_grip('r', m))
    P += std_guard('r', m)
    P.append(assign(finish(box('r_sel', -0.0275, 0.004, -0.018, 0.004, 0.009, 0.024, rx=D(18)), 0.001), m['accent']))
    P.append(assign(finish(cyl('r_rel', 0.027, -0.006, -0.094, 0.0058, 0.006, 'x', 18), 0.0008), m['metal']))
    # Handguard: tapered, with the "halberd blade" accent panels and vents.
    hg = prism('r_hg', [(-0.29, 0.066), (-0.5, 0.06), (-0.522, 0.048), (-0.522, 0.004), (-0.5, -0.004), (-0.29, -0.006)], 0.058)
    cuts = [cyl('r_hgbore', 0, 0.03, -0.41, 0.0135, 0.3, 'z', 24)]
    for i in range(3):
        z = -0.33 - i * 0.05
        cuts.append(merge(box(f'r_vb{i}', 0, 0.066, z, 0.018, 0.02, 0.024), cyl(f'r_va{i}', 0, 0.066, z - 0.012, 0.009, 0.02, 'y', 16), cyl(f'r_vc{i}', 0, 0.066, z + 0.012, 0.009, 0.02, 'y', 16)))
    cut(hg, cuts)
    P.append(assign(finish(hg, 0.0045, 1, angle=30), m['body']))
    P.append(assign(finish(cyl('r_hgcore', 0, 0.03, -0.39, 0.0138, 0.17, 'z', 20), 0.0002), m['glow']))
    blade = [(-0.3, 0.05), (-0.455, 0.057), (-0.49, 0.03), (-0.458, 0.004), (-0.33, 0.0), (-0.302, 0.022)]
    for sx in (1, -1):
        P.append(side(f'r_blade{sx}', blade, 0.005, m['accent'], cx=sx * 0.0305, bevel=0.0016))
        P.append(assign(finish(box(f'r_bglow{sx}', sx * 0.0334, 0.046, -0.385, 0.0012, 0.0026, 0.13), 0.0003, 1), m['glow']))
    # Barrel + chunky two-port brake.
    P.append(assign(finish(cyl('r_barrel', 0, 0.03, -0.545, 0.0108, 0.05, 'z', 24), 0.0005), m['metal']))
    br = box('r_brake', 0, 0.03, -0.595, 0.032, 0.034, 0.064)
    cut(br, cyl('r_brb', 0, 0.03, -0.595, 0.0072, 0.09, 'z', 18), *[box(f'r_brp{i}{sx}', sx * 0.016, 0.03, -0.578 - i * 0.022, 0.012, 0.022, 0.012) for i in range(2) for sx in (1, -1)])
    P.append(assign(finish(br, 0.003, 1), m['metal']))
    P.append(assign(finish(box('r_brring', 0, 0.03, -0.567, 0.035, 0.037, 0.006), 0.0012), m['accent']))
    # Sights on the y = 0.1 line, optic rail in between.
    P += iron_sights('r', m, -0.005, -0.495, 0.1, 0.081, 0.06)
    P.append(rail('r_rail', -0.24, -0.03, 0.075, m))
    # Stock: angular skeleton, accent cheek riser, rubber pad.
    # Low comb so the stock stays under the sight line at the hip (only its spine shows).
    st = prism('r_stock', [(0.066, 0.06), (0.23, 0.05), (0.258, 0.052), (0.268, 0.046), (0.268, -0.075), (0.244, -0.078), (0.14, -0.024), (0.066, 0.0)], 0.036)
    cut(st, prism('r_sthole', [(0.098, 0.04), (0.21, 0.034), (0.21, -0.045), (0.132, -0.008)], 0.06))
    P.append(assign(finish(st, 0.0045, 1, angle=30), m['body']))
    P.append(side('r_cheek', [(0.12, 0.052), (0.2, 0.047), (0.204, 0.054), (0.124, 0.059)], 0.026, m['accent'], bevel=0.0018))
    P.append(assign(finish(box('r_pad', 0, -0.012, 0.274, 0.04, 0.122, 0.014), 0.005, 2), m['grip']))
    P.append(assign(finish(tube('r_sling', 0, -0.062, 0.228, 0.008, 0.0045, 0.007, 'x', 20), 0.0006), m['metal']))
    # Ammo counter on the left of the upper.
    frame, pips = pip_strip('rifle', 10, -0.0252, 0.052, -0.14, -0.265, m)
    P.append(frame)

    def mag(name, extra):
        bot = -0.155 - extra
        front = curve((-0.184, -0.014), (-0.21 - extra * 0.35, bot), -0.007, 7)
        back = curve((-0.12, -0.014), (-0.143 - extra * 0.35, bot + 0.002), -0.007, 7)
        body = prism(name, back + front[::-1], 0.028)
        pieces = [assign(finish(body, 0.003, 1, angle=30), m['body'])]
        for i in range(3):
            t = 0.5 + i * 0.17
            k = int(t * 6)
            yz = (front[k][1] + back[k][1]) / 2
            zc = (front[k][0] + back[k][0]) / 2
            for sx in (1, -1):
                pieces.append(assign(finish(box(f'{name}_rib{i}{sx}', sx * 0.0145, yz, zc, 0.003, 0.005, 0.054, rx=D(-12)), 0.0009, 1), m['accent'] if i == 1 else m['body']))
        plate = box(f'{name}_plate', 0, bot - 0.002, (front[-1][0] + back[-1][0]) / 2, 0.034, 0.012, 0.076, rx=D(-10))
        pieces.append(assign(finish(plate, 0.003, 1), m['grip']))
        pieces.append(assign(finish(box(f'{name}_lips', 0, -0.009, -0.152, 0.022, 0.008, 0.058), 0.0009), m['metal']))
        pieces.append(assign(finish(cyl(f'{name}_round', 0.003, -0.004, -0.152, 0.0046, 0.046, 'z', 16), 0.0004), m['brass']))
        out = join(name, pieces)
        origin_to(out, 0, -0.01, -0.15)
        return out

    # Bolt carrier (visible in the left window) + charging knob on the right.
    carrier = box('r_carrier', -0.008, 0.044, -0.08, 0.022, 0.022, 0.07)
    cut(carrier, box('r_carr_g', -0.02, 0.044, -0.08, 0.004, 0.006, 0.05))
    knob = merge(cyl('r_knob', 0.036, 0.058, -0.06, 0.0068, 0.022, 'x', 20), box('r_stem', 0.026, 0.058, -0.06, 0.014, 0.006, 0.01))
    bolt = join('rifle_bolt', [assign(finish(carrier, 0.0012), m['metal']), assign(finish(knob, 0.0016), m['accent']),
                               assign(finish(box('r_carr_glow', -0.0192, 0.05, -0.08, 0.001, 0.003, 0.05), 0.0002), m['glow'])])
    return finalize('rifle', P, mag('rifle_mag', 0.0), mag('rifle_mag_ext', 0.05), bolt, pips, {
        'muzzle': (0, 0.03, -0.628), 'eject': (0.03, 0.05, -0.08), 'sight': (0, 0.1, -0.005),
        'magwell': (0, -0.01, -0.15), 'lefthand': (0, -0.006, -0.39), 'righthand': (0, -0.06, 0.01),
        'rail': (0, 0.0855, -0.13), 'under': (0, -0.006, -0.4),
    })


# --------------------------------------------------------------------------- HORNET (smg)

def smg(m):
    P = []
    rc = prism('s_rc', [(0.036, 0.074), (0.016, 0.09), (-0.232, 0.09), (-0.25, 0.08), (-0.25, -0.004), (-0.205, -0.016), (0.036, -0.016)], 0.05)
    cut(rc, bolt_window('s_win', -0.13, -0.06, 0.036, 0.06), box('s_port', 0.03, 0.05, -0.1, 0.02, 0.02, 0.06),
        box('s_wellhole', 0, -0.02, -0.17, 0.03, 0.06, 0.046), cyl('s_bore', 0, 0.035, -0.24, 0.012, 0.05, 'z', 18))
    P.append(assign(finish(rc, 0.0048, 1, angle=30), m['body']))
    P.append(assign(finish(box('s_winback', -0.006, 0.048, -0.095, 0.003, 0.028, 0.074), 0.0004), m['dark']))
    # Hornet stripes: accent chevrons on the receiver flank.
    for i, z in enumerate([-0.165, -0.2]):
        P.append(side(f's_chev{i}', [(z, 0.084), (z - 0.016, 0.084), (z - 0.034, 0.05), (z - 0.018, 0.05)], 0.052, m['accent'], bevel=0.0014))
    well = box('s_well', 0, -0.022, -0.17, 0.04, 0.026, 0.06)
    cut(well, box('s_wellin', 0, -0.022, -0.17, 0.029, 0.05, 0.047))
    P.append(assign(finish(well, 0.0035, 1), m['body']))
    P.append(std_grip('s', m))
    P += std_guard('s', m, z0=-0.12, z1=0.016)
    P.append(assign(finish(box('s_sel', -0.0265, 0.02, -0.03, 0.004, 0.009, 0.022, rx=D(-15)), 0.001), m['accent']))
    # Hex shroud with accent bands and glowing core visible through the vents.
    sh = cyl('s_sh', 0, 0.035, -0.31, 0.034, 0.12, 'z', 6, rz=D(30))
    cut(sh, cyl('s_shb', 0, 0.035, -0.31, 0.02, 0.14, 'z', 18),
        *[box(f's_vent{i}{sx}', sx * 0.03, 0.04, -0.27 - i * 0.02, 0.012, 0.03, 0.009) for i in range(4) for sx in (1, -1)])
    P.append(assign(finish(sh, 0.0035, 1), m['body']))
    for z in (-0.256, -0.364):
        P.append(assign(finish(cyl(f's_band{z}', 0, 0.035, z, 0.0365, 0.012, 'z', 6, rz=D(30)), 0.0018, 1), m['accent']))
    P.append(assign(finish(cyl('s_core', 0, 0.035, -0.31, 0.02, 0.1, 'z', 16), 0.0002), m['glow']))
    # Stinger muzzle.
    P.append(assign(finish(cyl('s_sting', 0, 0.035, -0.395, 0.017, 0.05, 'z', 18, r2=0.0095), 0.0015), m['metal']))
    P.append(assign(finish(cyl('s_tip', 0, 0.035, -0.425, 0.0095, 0.012, 'z', 18), 0.001), m['accent']))
    P += iron_sights('s', m, -0.02, -0.236, 0.108, 0.09, 0.09)
    P.append(rail('s_rail', -0.21, -0.04, 0.09, m, width=0.02))
    # Folding stock: bold single loop + pad.
    P.append(assign(finish(box('s_hinge', 0, 0.035, 0.044, 0.046, 0.044, 0.024), 0.004, 2), m['accent']))
    # Collapsed wire stock: short rods, slim pad (stays out of the hip view).
    for sx in (1, -1):
        P.append(assign(finish(cyl(f's_rod{sx}', sx * 0.016, 0.046, 0.1, 0.0055, 0.12, 'z', 16), 0.0006), m['metal']))
        P.append(assign(finish(cyl(f's_rodlo{sx}', sx * 0.016, 0.01, 0.1, 0.0048, 0.12, 'z', 16, rx=D(-15)), 0.0006), m['metal']))
    P.append(assign(finish(box('s_butt', 0, 0.026, 0.163, 0.042, 0.082, 0.014), 0.004, 2), m['grip']))
    frame, pips = pip_strip('smg', 10, -0.025, 0.074, -0.02, -0.15, m)
    P.append(frame)

    def mag(name, extra):
        bot = -0.155 - extra
        body = prism(name, [(-0.193, 0.0), (-0.147, 0.0), (-0.142, bot + 0.008), (-0.19, bot + 0.006)], 0.027)
        pieces = [assign(finish(body, 0.003, 1), m['body'])]
        for i in range(4 + int(extra > 0) * 2):
            for sx in (1, -1):
                pieces.append(assign(finish(box(f'{name}_g{i}{sx}', sx * 0.0135, -0.045 - i * 0.02, -0.167, 0.002, 0.009, 0.034), 0.0007, 1), m['grip']))
        pieces.append(assign(finish(box(f'{name}_plate', 0, bot - 0.001, -0.166, 0.032, 0.013, 0.058), 0.003, 1), m['accent']))
        pieces.append(assign(finish(box(f'{name}_lips', 0, 0.004, -0.17, 0.02, 0.008, 0.042), 0.0008), m['metal']))
        out = join(name, pieces)
        origin_to(out, 0, 0.0, -0.17)
        return out

    bolt = join('smg_bolt', [assign(finish(box('s_carrier', -0.008, 0.048, -0.095, 0.022, 0.02, 0.06), 0.001), m['metal']),
                             assign(finish(merge(box('s_ch', 0, 0.097, 0.014, 0.012, 0.012, 0.02), box('s_chT', 0, 0.097, 0.026, 0.05, 0.012, 0.01)), 0.002, 1), m['accent']),
                             assign(finish(box('s_carr_glow', -0.0192, 0.052, -0.095, 0.001, 0.003, 0.04), 0.0002), m['glow'])])
    return finalize('smg', P, mag('smg_mag', 0.0), mag('smg_mag_ext', 0.05), bolt, pips, {
        'muzzle': (0, 0.035, -0.432), 'eject': (0.03, 0.055, -0.1), 'sight': (0, 0.108, -0.02),
        'magwell': (0, 0.0, -0.17), 'lefthand': (0, 0.001, -0.31), 'righthand': (0, -0.06, 0.01),
        'rail': (0, 0.1005, -0.12), 'under': (0, 0.001, -0.31),
    })


# --------------------------------------------------------------------------- WREN (pistol)

def pistol(m):
    P = []
    fr = prism('p_frame', [(0.014, 0.034), (-0.168, 0.034), (-0.168, 0.006), (-0.15, 0.0), (0.014, 0.0)], 0.03)
    cut(fr, *[box(f'p_rail{i}', 0, 0.002, -0.152 + i * 0.012, 0.034, 0.004, 0.005) for i in range(4)])
    P.append(assign(finish(fr, 0.003, 1, angle=30), m['body']))
    for sx in (1, -1):
        P.append(assign(finish(box(f'p_glow{sx}', sx * 0.0152, 0.018, -0.12, 0.0012, 0.0028, 0.07), 0.0003, 1), m['glow']))
    grip = prism('p_grip', [(-0.022, 0.004), (0.022, 0.004), (0.037, -0.012), (0.052, -0.1), (0.046, -0.111), (0.008, -0.111), (0.0, -0.099), (-0.012, -0.03)], 0.031)
    cut(grip, cyl('p_fg0', 0, -0.046, -0.017, 0.0062, 0.05, 'x', 20), cyl('p_fg1', 0, -0.067, -0.013, 0.0062, 0.05, 'x', 20))
    finish(grip, 0.0042, 2, angle=30)
    assign(grip, m['grip'])
    assign_faces(grip, m['body'], lambda x, y, z, nx, ny, nz: y > -0.008 or abs(nx) < 0.5)
    P.append(grip)
    P += std_guard('p', m, z0=-0.072, z1=-0.004, top=0.004)
    P.append(assign(finish(box('p_slidestop', -0.016, 0.03, -0.02, 0.0028, 0.006, 0.026), 0.0008), m['accent']))
    P.append(assign(finish(box('p_hood', 0, 0.056, -0.06, 0.018, 0.016, 0.03), 0.0008), m['metal']))
    P.append(assign(finish(cyl('p_barrel', 0, 0.05, -0.13, 0.0074, 0.12, 'z', 20), 0.0005), m['metal']))
    frame, pips = pip_strip('pistol', 6, -0.0152, 0.022, -0.06, -0.11, m, size=(0.0058, 0.0036))
    P.append(frame)

    def mag(name, extra):
        body = box(name, 0, -0.05 - extra * 0.5, 0.006, 0.022, 0.1 + extra, 0.034, rx=D(14))
        plate = box(f'{name}_plate', 0, -0.103 - extra, 0.019 + extra * 0.25, 0.031, 0.011, 0.046, rx=D(14))
        out = join(name, [assign(finish(body, 0.0014), m['metal']), assign(finish(plate, 0.003, 1), m['accent'])])
        origin_to(out, 0, -0.05, 0.005)
        return out

    # Slide (bolt part): accent, deep chamfers, three lightening windows, serrations.
    sl = prism('p_slide', [(0.02, 0.034), (0.02, 0.064), (0.008, 0.07), (-0.178, 0.07), (-0.19, 0.06), (-0.19, 0.034)], 0.03)
    sc = [box(f'p_ser{i}{sx}', sx * 0.015, 0.052, 0.012 - i * 0.006, 0.004, 0.026, 0.0024) for i in range(6) for sx in (1, -1)]
    sc += [box(f'p_lw{i}', 0, 0.07, -0.11 - i * 0.022, 0.012, 0.014, 0.014) for i in range(3)]
    sc += [box('p_port', 0.008, 0.07, -0.06, 0.02, 0.012, 0.034), cyl('p_slbore', 0, 0.05, -0.19, 0.0078, 0.02, 'z', 18)]
    cut(sl, sc)
    slide = [assign(finish(sl, 0.0035, 1, angle=30), m['accent']),
             assign(finish(box('p_slcore', 0, 0.062, -0.132, 0.014, 0.008, 0.07), 0.0003), m['glow'])]
    rs = merge(box('p_rs', 0, 0.073, 0.002, 0.024, 0.006, 0.01), box('p_rsL', -0.0075, 0.0775, 0.002, 0.009, 0.009, 0.008), box('p_rsR', 0.0075, 0.0775, 0.002, 0.009, 0.009, 0.008))
    slide.append(assign(finish(rs, 0.0008), m['metal']))
    slide.append(assign(finish(box('p_fs', 0, 0.074, -0.174, 0.003, 0.009, 0.006), 0.0005), m['metal']))
    slide.append(assign(finish(box('p_fsdot', 0, 0.0765, -0.1708, 0.0022, 0.0022, 0.001), 0.0002), m['glow']))
    bolt = join('pistol_bolt', slide)
    return finalize('pistol', P, mag('pistol_mag', 0.0), mag('pistol_mag_ext', 0.028), bolt, pips, {
        'muzzle': (0, 0.05, -0.195), 'eject': (0.02, 0.062, -0.06), 'sight': (0, 0.078, 0.0),
        'magwell': (0, -0.05, 0.005), 'lefthand': (-0.025, -0.05, 0.02), 'righthand': (0, -0.04, 0.015),
        'rail': (0, 0.07, -0.07), 'under': (0, 0.0, -0.13),
    })


# --------------------------------------------------------------------------- LONGBOW (sniper)

def sniper(m):
    P = []
    ch = prism('k_ch', [(0.062, 0.062), (0.04, 0.072), (-0.235, 0.072), (-0.252, 0.06), (-0.252, -0.008), (-0.19, -0.016), (0.062, -0.016)], 0.054)
    cut(ch, bolt_window('k_win', -0.1, -0.02, 0.038, 0.062), box('k_port', 0.028, 0.054, -0.05, 0.02, 0.02, 0.08), box('k_wellhole', 0, -0.02, -0.12, 0.036, 0.06, 0.08),
        cyl('k_bore', 0, 0.03, -0.24, 0.014, 0.05, 'z', 18))
    P.append(assign(finish(ch, 0.0048, 1, angle=30), m['body']))
    P.append(assign(finish(box('k_winback', -0.008, 0.05, -0.06, 0.003, 0.028, 0.084), 0.0004), m['dark']))
    P.append(std_grip('k', m))
    P += std_guard('k', m, z0=-0.09, z1=0.026)
    # Long octagonal handguard with slots, accent rings and glow channels.
    hg = cyl('k_hg', 0, 0.03, -0.425, 0.036, 0.35, 'z', 8, rz=D(22.5))
    cuts = [cyl('k_hgb', 0, 0.03, -0.425, 0.021, 0.37, 'z', 18)]
    for i in range(5):
        z = -0.3 - i * 0.055
        for sx in (1, -1):
            cuts.append(merge(box(f'k_sl{i}{sx}', sx * 0.034, 0.03, z, 0.012, 0.009, 0.02), cyl(f'k_sla{i}{sx}', sx * 0.034, 0.03, z - 0.01, 0.0045, 0.012, 'x', 14), cyl(f'k_slb{i}{sx}', sx * 0.034, 0.03, z + 0.01, 0.0045, 0.012, 'x', 14)))
    cut(hg, cuts)
    P.append(assign(finish(hg, 0.0035, 1), m['body']))
    P.append(assign(finish(cyl('k_core', 0, 0.03, -0.425, 0.021, 0.33, 'z', 16), 0.0002), m['glow']))
    for z in (-0.262, -0.588):
        P.append(assign(finish(cyl(f'k_ring{z}', 0, 0.03, z, 0.0385, 0.014, 'z', 8, rz=D(22.5)), 0.002, 1), m['accent']))
    for sx in (1, -1):
        P.append(assign(finish(cyl(f'k_leg{sx}', sx * 0.012, -0.016, -0.42, 0.0055, 0.2, 'z', 12), 0.0006), m['metal']))
        P.append(assign(finish(box(f'k_foot{sx}', sx * 0.012, -0.016, -0.322, 0.014, 0.008, 0.012), 0.002, 1), m['grip']))
    P.append(assign(finish(box('k_bipodbase', 0, -0.009, -0.53, 0.04, 0.012, 0.03), 0.002), m['metal']))
    # Fluted barrel, big brake.
    br = cyl('k_barrel', 0, 0.03, -0.74, 0.0138, 0.3, 'z', 32)
    cut(br, *[box(f'k_flute{i}', math.cos(a) * 0.0142, 0.03 + math.sin(a) * 0.0142, -0.735, 0.005, 0.005, 0.22, rz=a) for i, a in enumerate([D(k * 60) for k in range(6)])])
    P.append(assign(finish(br, 0.0006), m['metal']))
    mb = box('k_brake', 0, 0.03, -0.92, 0.038, 0.034, 0.06)
    cut(mb, *[box(f'k_mbp{i}{sx}', sx * 0.019, 0.03, -0.902 - i * 0.017, 0.012, 0.022, 0.009) for i in range(3) for sx in (1, -1)], cyl('k_mbb', 0, 0.03, -0.92, 0.008, 0.08, 'z', 16))
    P.append(assign(finish(mb, 0.003, 1), m['metal']))
    # Integral scope on the y = 0.115 line.
    sc = [cyl('k_tube', 0, 0.115, -0.1, 0.019, 0.3, 'z', 32), cyl('k_obj', 0, 0.115, -0.29, 0.032, 0.06, 'z', 32), cyl('k_objcone', 0, 0.115, -0.246, 0.032, 0.03, 'z', 32, r2=0.019),
          cyl('k_eye', 0, 0.115, 0.075, 0.026, 0.04, 'z', 32), cyl('k_eyecone', 0, 0.115, 0.045, 0.019, 0.022, 'z', 32, r2=0.026)]
    P.append(assign(finish(join('k_scope', [finish(x, 0.0012) for x in sc]), 0), m['body']))
    P.append(assign(finish(cyl('k_turretT', 0, 0.143, -0.09, 0.013, 0.018, 'y', 24), 0.0015), m['accent']))
    P.append(assign(finish(cyl('k_turretR', 0.027, 0.115, -0.09, 0.012, 0.016, 'x', 24), 0.0015), m['accent']))
    P.append(assign(finish(cyl('k_objring', 0, 0.115, -0.318, 0.0335, 0.008, 'z', 32), 0.0015), m['accent']))
    for i, z in enumerate([-0.17, -0.01]):
        ring = box(f'k_mnt{i}', 0, 0.086, z, 0.03, 0.03, 0.022)
        cut(ring, cyl(f'k_mntin{i}', 0, 0.115, z, 0.0187, 0.04, 'z', 32))
        P.append(assign(finish(merge(ring, tube(f'k_mntt{i}', 0, 0.115, z, 0.0228, 0.0187, 0.022, 'z', 32)), 0.0015), m['metal']))
    P.append(assign(finish(cyl('k_lensF', 0, 0.115, -0.321, 0.029, 0.002, 'z', 32), 0.0002), m['lens']))
    P.append(assign(finish(cyl('k_lensR', 0, 0.115, 0.096, 0.022, 0.002, 'z', 32), 0.0002), m['lens']))
    # Bow-shaped stock: two sweeping arms meeting at the pad.
    st = prism('k_stock', [(0.062, 0.062), (0.2, 0.05), (0.325, 0.058), (0.338, 0.05), (0.338, -0.085), (0.31, -0.088), (0.2, -0.05), (0.062, -0.006)], 0.044)
    cut(st, prism('k_sthole', curve((0.105, 0.03), (0.3, 0.034), 0.012, 6) + curve((0.3, -0.06), (0.14, -0.012), 0.01, 6), 0.08))
    P.append(assign(finish(st, 0.0048, 1, angle=30), m['body']))
    P.append(side('k_cheek', [(0.13, 0.058), (0.26, 0.054), (0.27, 0.074), (0.14, 0.078)], 0.034, m['accent'], bevel=0.0035))
    P.append(assign(finish(box('k_pad', 0, -0.016, 0.346, 0.048, 0.146, 0.02), 0.006, 2), m['grip']))
    frame, pips = pip_strip('sniper', 5, -0.027, 0.05, -0.12, -0.21, m, size=(0.012, 0.005))
    P.append(frame)

    def mag(name, extra):
        body = box(name, 0, -0.03 - extra * 0.5, -0.12, 0.034, 0.06 + extra, 0.074)
        plate = box(f'{name}_plate', 0, -0.063 - extra, -0.12, 0.04, 0.009, 0.08)
        rnd = cyl(f'{name}_round', 0, 0.0, -0.12, 0.0062, 0.07, 'z', 18)
        out = join(name, [assign(finish(body, 0.0025, 1), m['body']), assign(finish(plate, 0.003, 1), m['accent']), assign(finish(rnd, 0.0005), m['brass'])])
        origin_to(out, 0, -0.01, -0.12)
        return out

    bolt_parts = [assign(finish(cyl('k_boltbody', -0.006, 0.05, -0.06, 0.011, 0.09, 'z', 24), 0.0008), m['metal']),
                  assign(finish(box('k_bglow', -0.017, 0.05, -0.06, 0.001, 0.003, 0.06), 0.0002), m['glow'])]
    bolt_parts.append(assign(finish(cyl('k_handle', 0.036, 0.046, 0.02, 0.0048, 0.05, 'x', 16, rz=D(-20)), 0.0008), m['metal']))
    bolt_parts.append(assign(finish(cyl('k_knob', 0.061, 0.037, 0.02, 0.012, 0.022, 'x', 24), 0.004, 2), m['accent']))
    bolt = join('sniper_bolt', bolt_parts)
    return finalize('sniper', P, mag('sniper_mag', 0.0), mag('sniper_mag_ext', 0.03), bolt, pips, {
        'muzzle': (0, 0.03, -0.952), 'eject': (0.03, 0.06, -0.06), 'sight': (0, 0.115, 0.1),
        'magwell': (0, -0.01, -0.12), 'lefthand': (0, -0.006, -0.42), 'righthand': (0, -0.06, 0.01),
        'rail': (0, 0.072, -0.12), 'under': (0, -0.006, -0.42),
    })


# --------------------------------------------------------------------------- attachments

def attachments(m):
    out = []
    # Suppressor: origin at the muzzle, extends to -Z. Hex-flat can with accent bands.
    sp = cyl('a_sup', 0, 0, -0.085, 0.023, 0.16, 'z', 12)
    body = join('att_suppressor', [assign(finish(sp, 0.003, 1), m['body']),
                                   assign(finish(cyl('a_supcap', 0, 0, -0.17, 0.021, 0.012, 'z', 32), 0.003, 2), m['metal']),
                                   assign(finish(cyl('a_supmount', 0, 0, -0.004, 0.017, 0.014, 'z', 6), 0.001), m['metal'])]
                + [assign(finish(cyl(f'a_band{i}', 0, 0, -0.03 - i * 0.012, 0.0238, 0.005, 'z', 12), 0.001), m['accent']) for i in range(2)]
                + [assign(finish(box(f'a_sglow{sx}', sx * 0.0228, 0, -0.11, 0.0012, 0.003, 0.06), 0.0003), m['glow']) for sx in (1, -1)])
    box_uv(body, TEX)
    out.append(body)
    empty('socket_att_suppressor_muzzle', 0, 0, -0.176)
    cp = box('att_compensator', 0, 0, -0.035, 0.032, 0.032, 0.07)
    cut(cp, *[box(f'a_cport{i}', 0, 0.015, -0.02 - i * 0.017, 0.022, 0.012, 0.008) for i in range(3)], cyl('a_cbore', 0, 0, -0.035, 0.007, 0.09, 'z', 16))
    assign(finish(cp, 0.003, 1), m['metal'])
    box_uv(cp, TEX)
    out.append(cp)
    empty('socket_att_compensator_muzzle', 0, 0, -0.072)
    base = box('a_rbase', 0, 0.006, 0.0, 0.032, 0.012, 0.06)
    hood = box('a_rhood', 0, 0.03, -0.012, 0.038, 0.042, 0.014)
    cut(hood, box('a_rhoodin', 0, 0.031, -0.012, 0.029, 0.033, 0.03))
    rf = join('att_reflex', [assign(finish(base, 0.0025, 1), m['body']), assign(finish(hood, 0.003, 1), m['accent']),
                             assign(finish(box('a_rglass', 0, 0.031, -0.012, 0.029, 0.033, 0.0015), 0.0002), m['lens']),
                             assign(finish(cyl('a_rknob', 0.019, 0.012, 0.01, 0.006, 0.006, 'x', 16), 0.0008), m['metal'])])
    box_uv(rf, TEX)
    out.append(rf)
    dot = box('att_reflex_reticle', 0, 0.031, -0.0135, 0.0026, 0.0026, 0.0008)
    assign(dot, m['glow'])
    box_uv(dot, TEX)
    out.append(dot)
    empty('socket_att_reflex_sight', 0, 0.031, 0.05)
    tubes = [cyl('a_stube', 0, 0.05, -0.04, 0.017, 0.22, 'z', 32), cyl('a_sobj', 0, 0.05, -0.17, 0.025, 0.05, 'z', 32), cyl('a_seye', 0, 0.05, 0.08, 0.021, 0.035, 'z', 32)]
    rings = []
    for i, z in enumerate([-0.09, 0.02]):
        r = box(f'a_sring{i}', 0, 0.02, z, 0.026, 0.04, 0.018)
        cut(r, cyl(f'a_sringin{i}', 0, 0.05, z, 0.0172, 0.04, 'z', 32))
        rings.append(assign(finish(merge(r, tube(f'a_sringt{i}', 0, 0.05, z, 0.021, 0.0172, 0.018, 'z', 32)), 0.0014), m['metal']))
    scope = join('att_scope', [assign(finish(t, 0.0012), m['body']) for t in tubes] + rings
                 + [assign(finish(cyl('a_sturret', 0, 0.074, -0.04, 0.011, 0.016, 'y', 24), 0.0012), m['accent']),
                    assign(finish(cyl('a_sacc', 0, 0.05, -0.192, 0.0262, 0.008, 'z', 32), 0.0012), m['accent']),
                    assign(finish(cyl('a_slensF', 0, 0.05, -0.196, 0.023, 0.002, 'z', 32), 0.0002), m['lens']),
                    assign(finish(cyl('a_slensR', 0, 0.05, 0.098, 0.019, 0.002, 'z', 32), 0.0002), m['lens'])])
    box_uv(scope, TEX)
    out.append(scope)
    empty('socket_att_scope_sight', 0, 0.05, 0.12)
    gr = prism('att_grip', [(-0.017, 0.0), (0.017, 0.0), (0.015, -0.075), (0.009, -0.081), (-0.012, -0.081), (-0.017, -0.074)], 0.029)
    cut(gr, *[box(f'a_gr{i}', 0, -0.024 - i * 0.016, 0.0, 0.05, 0.003, 0.05) for i in range(3)])
    finish(gr, 0.004, 2)
    assign(gr, m['grip'])
    assign_faces(gr, m['accent'], lambda x, y, z, nx, ny, nz: y > -0.008)
    box_uv(gr, TEX)
    out.append(gr)
    empty('socket_att_grip_hand', 0, -0.055, 0.0)
    return out


WEAPONS = {'rifle': rifle, 'smg': smg, 'pistol': pistol, 'sniper': sniper}


def weapon_materials():
    return {
        'body': hl.material('body', S.m_polymer(), 'polymer'),
        'accent': hl.material('accent', S.m_cerakote(), 'cerakote'),
        'metal': hl.material('metal', S.m_metal(), 'steel'),
        'grip': hl.material('grip', S.m_grip(), 'rubber'),
        'glow': hl.material('glow', S.m_glow(), 'glow', emissive=(1, 1, 1), emissive_strength=4.0),
        'brass': hl.material('fixed_brass', S.m_brass(), 'brass'),
        'lens': hl.material('fixed_lens', S.m_lens(), 'lens'),
        'dark': hl.material('fixed_dark', S.m_dark(seed=17), 'darksteel'),
        'glove': hl.material('glove', S.m_leather(), 'glove'),
        'sleeve': hl.material('sleeve', S.m_fabric(seed=23), 'ripstop'),
        'gear': hl.material('gear', S.m_polymer(seed=25), 'gearpoly'),
    }


def main(only=None):
    hl.reset()
    m = weapon_materials()
    for wid, fn in WEAPONS.items():
        if only and wid not in only:
            continue
        fn(m)
        print(wid, 'tris so far', hl.stats())
    if not only or 'att' in only:
        attachments(m)
    if not only or 'arms' in only:
        import hands
        hands.build_arms(m)
    print('total tris', hl.stats())
    hl.export_glb(os.path.abspath(OUT))


if __name__ == '__main__':
    args = [a for a in sys.argv[sys.argv.index('--') + 1:]] if '--' in sys.argv else sys.argv[1:]
    main(set(args) if args else None)
