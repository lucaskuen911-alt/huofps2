"""Hairline Dockside 9 freighter kit -> assets/models/ship.glb

Run:  python3 art/ship.py

The hull and deck are brushes (src/data/maps/dockside9.js: they carry collision and bake with
the level). These models are the hardware on top, placed by the map with collision hulls:
  ship_house   superstructure: accommodation decks, bridge with wings, wheelhouse glazing,
               radar mast, funnel. Origin at deck level, centred; bow toward -Z.
  hatch_cover  ribbed folding hatch cover on its coaming (12 x 7 x 1.6 m)
  deck_crane   pedestal ship crane with a parked jib
  lifeboat     enclosed freefall-style lifeboat in a cradle
  bitts        twin mooring bitts
  mooring_line 1 m hawser segment along +Z (the map scales / aims it)
Materials follow the docks kit: 'paint' is tinted per instance, fixed_* keep their colour.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import hl  # noqa: E402
import stylized as S  # noqa: E402
from hl import box, cyl, prism, cut, finish, join, assign, box_uv  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models', 'ship.glb')
D = math.radians


def materials():
    return {
        'paint': hl.material('paint', S.m_paint(seed=501), 'shippaint'),
        'white': hl.material('fixed_white', S.m_paint(seed=503), 'shipwhite', base_tint=(0.88, 0.87, 0.82)),
        'orange': hl.material('fixed_orange', S.m_paint(seed=505), 'shiporange', base_tint=(0.95, 0.42, 0.08)),
        'dark': hl.material('fixed_dark', S.m_dark(seed=507), 'shipdark'),
        'steel': hl.material('fixed_steel', S.m_metal(seed=509), 'shipsteel', base_tint=(0.72, 0.73, 0.75)),
        'glass': hl.material('fixed_glass', S.m_glass(), 'shipglass'),
        'glow': hl.material('glow', S.m_glow(), 'shiplamp', emissive=(1, 0.9, 0.75), emissive_strength=5.0),
        'rope': hl.material('fixed_rope', S.m_fabric(seed=511, color=(0.78, 0.7, 0.52)), 'rope'),
        'green': hl.material('fixed_green', S.m_paint(seed=513), 'shipgreen', base_tint=(0.2, 0.42, 0.3)),
    }


def rail_run(name, x0, z0, x1, z1, y, m, h=1.0):
    """Ship railing: top rail, mid rail, posts."""
    L = math.hypot(x1 - x0, z1 - z0)
    along_x = abs(x1 - x0) > abs(z1 - z0)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    ax = 'x' if along_x else 'z'
    parts = [assign(finish(cyl(f'{name}_top', cx, y + h, cz, 0.03, L, ax, 8), 0.0), m['white']),
             assign(finish(cyl(f'{name}_mid', cx, y + h * 0.5, cz, 0.022, L, ax, 8), 0.0), m['white'])]
    n = max(1, int(L / 1.4))
    for i in range(n + 1):
        t = i / n
        parts.append(assign(finish(cyl(f'{name}_p{i}', x0 + (x1 - x0) * t, y + h / 2, z0 + (z1 - z0) * t, 0.028, h, 'y', 8), 0.0), m['white']))
    return parts


def ship_house(m):
    """Superstructure 14 (x) x 10 (z) footprint, 4 levels + wheelhouse, funnel aft."""
    p = []
    W, Dp = 14.0, 10.0
    lv = 2.8
    for k in range(4):
        y0 = k * lv
        w = W - k * 0.6
        d = Dp - (0.8 if k == 3 else 0.0)
        blk = box(f'sh_deck{k}', 0, y0 + lv / 2, 0, w, lv, d)
        p.append(assign(finish(blk, 0.04, 1), m['white']))
        # Window band on the forward (-Z) and side faces.
        for i in range(int(w / 1.6)):
            x = -w / 2 + 0.9 + i * 1.6
            p.append(assign(finish(box(f'sh_wf{k}_{i}', x, y0 + 1.6, -d / 2 - 0.02, 0.9, 0.8, 0.06), 0.01, 1), m['glass']))
        for sx in (1, -1):
            for i in range(int(d / 1.8)):
                z = -d / 2 + 1.0 + i * 1.8
                p.append(assign(finish(box(f'sh_ws{k}_{sx}_{i}', sx * (w / 2 + 0.02), y0 + 1.6, z, 0.06, 0.8, 0.9), 0.01, 1), m['glass']))
        # Deck edge lip (painted overhang line).
        p.append(assign(finish(box(f'sh_lip{k}', 0, y0 + lv - 0.08, 0, w + 0.3, 0.16, d + 0.3), 0.02, 1), m['white']))
    # Wheelhouse + bridge wings (full beam) with sloped glazing.
    wy = 4 * lv
    p.append(assign(finish(box('sh_wheel', 0, wy + 1.4, -1.0, 11.0, 2.8, 6.0), 0.05, 1), m['white']))
    p.append(assign(finish(box('sh_wheelglass', 0, wy + 1.75, -4.03, 10.6, 1.3, 0.08, rx=D(-12)), 0.01, 1), m['glass']))
    for sx in (1, -1):
        p.append(assign(finish(box(f'sh_wing{sx}', sx * 7.6, wy - 0.1, -3.2, 4.4, 0.25, 2.2), 0.02, 1), m['white']))
        p += rail_run(f'sh_wrail{sx}', sx * 5.6, -4.3, sx * 9.8, -4.3, wy, m)
        p += rail_run(f'sh_wrailb{sx}', sx * 9.8, -4.3, sx * 9.8, -2.1, wy, m)
    p.append(assign(finish(box('sh_roof', 0, wy + 2.9, -1.0, 11.4, 0.22, 6.4), 0.03, 1), m['white']))
    # Radar mast + scanners.
    p.append(assign(finish(box('sh_mast', 0, wy + 4.6, 0.4, 0.4, 3.4, 0.4), 0.02, 1), m['orange']))
    p.append(assign(finish(box('sh_yard', 0, wy + 5.6, 0.4, 3.6, 0.18, 0.18), 0.01, 1), m['orange']))
    p.append(assign(finish(box('sh_radar', 0, wy + 6.6, 0.4, 3.0, 0.12, 0.3), 0.02, 1), m['white']))
    p.append(assign(finish(cyl('sh_dome', 1.6, wy + 3.4, 1.5, 0.45, 0.6, 'y', 16), 0.05, 2), m['white']))
    p.append(assign(finish(cyl('sh_lamp', 0, wy + 6.4, 0.4, 0.12, 0.24, 'y', 12), 0.02), m['glow']))
    # Funnel aft with company band.
    fz = 3.2
    fun = cyl('sh_funnel', 0, wy + 1.6, fz, 1.6, 5.0, 'y', 24)
    fun.scale = (1.4, 1.0, 1.0)
    p.append(assign(finish(fun, 0.04, 1), m['orange']))
    p.append(assign(finish(cyl('sh_band', 0, wy + 2.8, fz, 1.62, 0.7, 'y', 24), 0.02), m['white']))
    p[-1].scale = (1.4, 1.0, 1.0)
    p.append(assign(finish(cyl('sh_cap', 0, wy + 4.2, fz, 1.64, 0.35, 'y', 24), 0.02), m['dark']))
    p[-1].scale = (1.4, 1.0, 1.0)
    # Exterior ladders (stair stringers) on the sides.
    for sx in (1, -1):
        for k in range(3):
            st = box(f'sh_ladder{sx}{k}', sx * (W / 2 - k * 0.3 + 0.5), k * lv + lv / 2, 3.0, 0.9, 0.12, 3.6, rx=D(-38))
            p.append(assign(finish(st, 0.01, 1), m['steel']))
    out = join('ship_house', p)
    box_uv(out, 0.5)
    return out


def hatch_cover(m):
    """Folding hatch cover: four panels with transverse ribs, on a coaming."""
    p = [assign(finish(box('hc_coaming', 0, 0.45, 0, 12.0, 0.9, 7.0), 0.03, 1), m['paint'])]
    for i in range(4):
        x = -4.5 + i * 3.0
        p.append(assign(finish(box(f'hc_panel{i}', x, 1.2, 0, 2.94, 0.6, 7.1), 0.04, 1), m['green']))
        for k in range(5):
            z = -2.8 + k * 1.4
            p.append(assign(finish(box(f'hc_rib{i}{k}', x, 1.55, z, 2.7, 0.14, 0.18), 0.02, 1), m['green']))
        p.append(assign(finish(cyl(f'hc_hinge{i}', x + 1.47, 1.2, 0, 0.12, 7.2, 'z', 12), 0.01), m['dark']))
    for sx in (1, -1):
        for sz in (1, -1):
            p.append(assign(finish(box(f'hc_cleat{sx}{sz}', sx * 5.6, 0.95, sz * 3.6, 0.3, 0.3, 0.4), 0.02, 1), m['dark']))
    out = join('hatch_cover', p)
    box_uv(out, 0.5)
    return out


def deck_crane(m):
    p = [assign(finish(cyl('dc_ped', 0, 3.5, 0, 1.4, 7.0, 'y', 24), 0.04, 1), m['paint']),
         assign(finish(box('dc_house', 0, 8.0, 0.4, 3.6, 2.4, 4.6), 0.06, 2), m['paint']),
         assign(finish(box('dc_cab', -1.6, 8.0, -1.6, 1.4, 1.8, 1.4), 0.04, 1), m['white']),
         assign(finish(box('dc_cabglass', -1.6, 8.3, -2.32, 1.2, 0.8, 0.04), 0.0), m['glass'])]
    jib = box('dc_jib', 0, 13.0, -9.0, 0.9, 0.9, 20.0, rx=D(-28))
    p.append(assign(finish(jib, 0.03, 1), m['paint']))
    p.append(assign(finish(cyl('dc_wire', 0, 11.5, -6.0, 0.03, 12.0, 'z', 6, rx=D(-16)), 0.0), m['dark']))
    out = join('deck_crane', p)
    box_uv(out, 0.5)
    return out


def lifeboat(m):
    hull = cyl('lb_hull', 0, 1.0, 0, 1.2, 7.0, 'z', 20)
    hull.scale = (1.0, 0.8, 1.0)
    p = [assign(finish(hull, 0.05, 2), m['orange']),
         assign(finish(box('lb_top', 0, 1.9, 0.4, 1.6, 0.5, 4.0), 0.1, 2), m['orange'])]
    for i in range(3):
        p.append(assign(finish(box(f'lb_win{i}', 0.82, 1.6, -1.0 + i * 1.0, 0.05, 0.35, 0.5), 0.01), m['glass']))
    for sz in (1, -1):
        p.append(assign(finish(box(f'lb_cradle{sz}', 0, 0.4, sz * 2.4, 2.6, 0.8, 0.3), 0.02, 1), m['steel']))
    out = join('lifeboat', p)
    box_uv(out, 1)
    return out


def bitts(m):
    p = [assign(finish(box('bt_base', 0, 0.1, 0, 0.8, 0.2, 2.0), 0.02, 1), m['dark'])]
    for sz in (1, -1):
        p.append(assign(finish(cyl(f'bt_post{sz}', 0, 0.55, sz * 0.6, 0.26, 0.9, 'y', 16), 0.02, 1), m['dark']))
        p.append(assign(finish(cyl(f'bt_cap{sz}', 0, 1.02, sz * 0.6, 0.34, 0.06, 'y', 16), 0.01), m['dark']))
    out = join('bitts', p)
    box_uv(out, 2)
    return out


def mooring_line(m):
    out = assign(finish(cyl('mooring_line', 0, 0, 0.5, 0.05, 1.0, 'z', 8), 0.0), m['rope'])
    box_uv(out, 2)
    return out


def main():
    hl.reset()
    m = materials()
    ship_house(m)
    hatch_cover(m)
    deck_crane(m)
    lifeboat(m)
    bitts(m)
    mooring_line(m)
    print('ship tris', hl.stats())
    hl.export_glb(os.path.abspath(OUT))


if __name__ == '__main__':
    main()
