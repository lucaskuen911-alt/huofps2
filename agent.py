"""Hairline agent (bot) model -> assets/models/agent.glb

Run:  python3 art/agent.py

Rig contract with src/render/BotView.js (procedural animation, no skinning):
  agent_upper   origin at the feet (yaw pivot), facing -Z: pelvis, torso, arms, head, carried rifle
  agent_leg     origin at the hip joint, extending down (used for both legs, mirrored by position)
Material roles (tinted per variant: hostile / dummy):
  armor, cloth, accent, helmet, gear, skin, visor (emissive), fixed_dark
Hitboxes live in src/data/rules.js and are independent of this mesh.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import hl  # noqa: E402
from hl import box, cyl, prism, cut, merge, finish, skin, join, assign, assign_faces, box_uv  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models', 'agent.glb')
D = math.radians
T = hl.T


def materials():
    return {
        'armor': hl.material('armor', T.set_cerakote(seed=31), 'plate'),
        'cloth': hl.material('cloth', T.set_fabric(seed=33), 'ripstop'),
        'accent': hl.material('accent', T.set_polymer(seed=35), 'accentpoly'),
        'helmet': hl.material('helmet', T.set_cerakote(seed=37), 'shell'),
        'gear': hl.material('gear', T.set_fabric(seed=39), 'webbing'),
        'skin': hl.material('skin', T.set_polymer(seed=41), 'skinpoly'),
        'visor': hl.material('visor', T.set_glow(), 'visorglow', emissive=(1, 1, 1), emissive_strength=4.0),
        'dark': hl.material('fixed_dark', T.set_steel(seed=43), 'gunsteel', base_tint=(0.16, 0.16, 0.18)),
    }


def upper(m):
    parts = []
    # Body underlay: pelvis -> spine -> neck, shoulders, arms holding a rifle (skin modifier).
    pts = [
        (0, 0.9, 0.0), (0, 1.12, 0.01), (0, 1.32, 0.0), (0, 1.47, 0.0),    # 0 pelvis 1 belly 2 chest 3 neck
        (0.2, 1.36, 0.0), (0.24, 1.14, -0.17), (0.08, 1.13, -0.38),       # 4 R shoulder 5 elbow 6 hand
        (-0.2, 1.36, 0.0), (-0.21, 1.15, -0.22), (-0.03, 1.15, -0.52),    # 7 L shoulder 8 elbow 9 hand
    ]
    edges = [(0, 1), (1, 2), (2, 3), (2, 4), (4, 5), (5, 6), (2, 7), (7, 8), (8, 9)]
    rad = [(0.17, 0.12), (0.15, 0.11), (0.18, 0.12), 0.055, 0.075, 0.058, 0.045, 0.075, 0.058, 0.045]
    body = skin('ag_body', pts, edges, rad, 2, root=0)
    parts.append(assign(body, m['cloth']))
    # Gloves over the hands.
    for i, h in enumerate([pts[6], pts[9]]):
        parts.append(assign(skin(f'ag_glove{i}', [h, (h[0], h[1] - 0.01, h[2] - 0.05)], [(0, 1)], [0.05, 0.042], 2), m['gear']))
    # Plate carrier: front and back plates, cummerbund, shoulder straps, pouches.
    front = box('ag_front', 0, 1.26, -0.115, 0.32, 0.36, 0.07)
    cut(front, box('ag_neckcut', 0, 1.45, -0.12, 0.14, 0.08, 0.2))
    parts.append(assign(finish(front, 0.012, 3), m['armor']))
    back = box('ag_back', 0, 1.26, 0.12, 0.32, 0.38, 0.07)
    parts.append(assign(finish(back, 0.012, 3), m['armor']))
    parts.append(assign(finish(box('ag_cummer', 0, 1.06, 0.0, 0.38, 0.12, 0.26), 0.02, 3), m['gear']))
    for sx in (1, -1):
        parts.append(assign(finish(box(f'ag_strap{sx}', sx * 0.1, 1.42, 0.0, 0.06, 0.03, 0.27), 0.008, 2), m['gear']))
        parts.append(assign(finish(box(f'ag_pad{sx}', sx * 0.235, 1.37, 0.0, 0.11, 0.07, 0.17, rz=D(-sx * 22)), 0.02, 3), m['armor']))
    for i, x in enumerate([-0.1, 0.0, 0.1]):
        parts.append(assign(finish(box(f'ag_mag{i}', x, 1.17, -0.165, 0.075, 0.12, 0.05), 0.01, 2), m['gear']))
    parts.append(assign(finish(box('ag_chestglow', 0, 1.33, -0.152, 0.16, 0.022, 0.01), 0.003, 2), m['visor']))
    parts.append(assign(finish(box('ag_radio', 0.08, 1.3, 0.175, 0.1, 0.16, 0.06), 0.01, 2), m['accent']))
    parts.append(assign(finish(cyl('ag_antenna', 0.11, 1.5, 0.18, 0.006, 0.26, 'y', 8), 0.0), m['dark']))
    # Belt + holster.
    parts.append(assign(finish(box('ag_belt', 0, 0.93, 0.0, 0.36, 0.06, 0.25), 0.012, 2), m['gear']))
    parts.append(assign(finish(box('ag_holster', -0.19, 0.86, 0.02, 0.05, 0.16, 0.11), 0.012, 2), m['accent']))
    # Head, balaclava neck, helmet shell with visor, ear protection.
    parts.append(assign(skin('ag_head', [(0, 1.5, 0.0), (0, 1.62, -0.01)], [(0, 1)], [0.06, 0.1], 2), m['skin']))
    helm = cyl('ag_helm', 0, 1.66, 0.0, 0.145, 0.2, 'y', 32, r2=0.11)
    cut(helm, box('ag_helmcut', 0, 1.6, -0.12, 0.3, 0.12, 0.14))
    parts.append(assign(finish(helm, 0.012, 3), m['helmet']))
    visor = box('ag_visor', 0, 1.615, -0.118, 0.2, 0.06, 0.03)
    parts.append(assign(finish(visor, 0.012, 3), m['visor']))
    for sx in (1, -1):
        parts.append(assign(finish(cyl(f'ag_ear{sx}', sx * 0.13, 1.6, 0.0, 0.045, 0.04, 'x', 20), 0.01, 3), m['accent']))
    parts.append(assign(finish(box('ag_nvg', 0, 1.77, -0.09, 0.06, 0.04, 0.05), 0.008, 2), m['dark']))
    # Carried rifle (simplified Halberd silhouette, origin at the bot's hands).
    rifle = [box('ag_r_rc', 0.03, 1.18, -0.43, 0.045, 0.08, 0.42), box('ag_r_hg', 0.03, 1.18, -0.75, 0.052, 0.056, 0.24),
             cyl('ag_r_bar', 0.03, 1.18, -0.95, 0.011, 0.18, 'z', 12), box('ag_r_st', 0.03, 1.16, -0.16, 0.04, 0.1, 0.16),
             box('ag_r_mag', 0.03, 1.08, -0.52, 0.03, 0.12, 0.06, rx=D(-12)), box('ag_r_grip', 0.03, 1.09, -0.36, 0.03, 0.09, 0.04, rx=D(14))]
    parts.append(assign(join('ag_rifle', [finish(r, 0.004, 2) for r in rifle]), m['dark']))
    parts.append(assign(finish(box('ag_r_glow', 0.056, 1.2, -0.75, 0.003, 0.008, 0.2), 0.001, 1), m['visor']))
    out = join('agent_upper', parts)
    box_uv(out, 4.0)
    return out


def leg(m):
    # Origin at the hip joint (engine y = 0 is the hip), knee slightly forward.
    pts = [(0, 0.0, 0.0), (0, -0.42, -0.02), (0, -0.8, 0.02)]
    body = skin('ag_leg', pts, [(0, 1), (1, 2)], [(0.09, 0.095), (0.065, 0.07), (0.055, 0.06)], 2)
    parts = [assign(body, m['cloth'])]
    parts.append(assign(finish(box('ag_knee', 0, -0.42, -0.08, 0.13, 0.12, 0.05), 0.02, 3), m['armor']))
    parts.append(assign(finish(box('ag_thighpouch', 0.085, -0.2, 0.0, 0.05, 0.13, 0.12), 0.012, 2), m['gear']))
    boot = prism('ag_boot', [(0.07, -0.79), (-0.03, -0.79), (-0.13, -0.84), (-0.16, -0.87), (-0.16, -0.9), (0.09, -0.9), (0.09, -0.83)], 0.12)
    parts.append(assign(finish(boot, 0.015, 3), m['gear']))
    parts.append(assign(finish(box('ag_sole', 0, -0.895, -0.035, 0.125, 0.012, 0.26), 0.004, 2), m['dark']))
    out = join('agent_leg', parts)
    box_uv(out, 4.0)
    return out


def main():
    hl.reset()
    m = materials()
    upper(m)
    leg(m)
    print('agent tris', hl.stats())
    hl.export_glb(os.path.abspath(OUT))


if __name__ == '__main__':
    main()
