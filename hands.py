"""First-person gloved hands + sleeves, posed on the shared weapon standards.

Construction
------------
Each hand is a small anatomical rig (wrist, palm, 4 fingers x 3 phalanges, thumb x 3) with real
proportions. Skin volumes are metaball capsules along every bone: joints blend into knuckles,
while every finger is its own metaball family, so neighbouring fingers never web together. The
metaballs are converted to meshes, smoothed and decimated, then the glove hardware is added as
hard-surface parts: knuckle guard, back-of-hand panel, cuff strap, sleeve with folds.

Poses (engine weapon space: -Z forward, +Y up, origin at the trigger)
  arm_right        firing hand on the long-gun grip (16 deg rake), index on the trigger.
                   Origin = right-hand socket (0, -0.06, 0.01); the engine places it there.
  arm_left         support hand under a ~58 mm handguard (bore y = 0.03), C-grip: thumb along the
                   near (left) side, fingers over the far side. Origin = palm contact point.
  arm_left_pistol  support hand cupping the pistol grip from the left.

Hand-local basis: A = wrist -> knuckles, L = thumb side, N = palm normal (N = L x A).
"""

import math

import bpy
import bmesh
from mathutils import Matrix, Vector, Quaternion

import hl
from hl import box, cyl, finish, join, assign, box_uv, apply

D = math.radians
VIS = 0.672  # visible radius / metaball radius at stiffness 2, threshold 0.6


def v(*a):
    return Vector(a)


def rot(axis, ang, vec):
    return Matrix.Rotation(ang, 3, axis) @ vec


class Hand:
    """Joint positions for one posed hand, in engine coordinates."""

    def __init__(self, wrist, A, L, N, scale=1.0):
        self.W, self.A, self.L, self.N, self.s = Vector(wrist), Vector(A).normalized(), Vector(L).normalized(), Vector(N).normalized(), scale

    def p(self, a, l, n):
        s = self.s
        return self.W + self.A * (a * s) + self.L * (l * s) + self.N * (n * s)

    def finger(self, base, lengths, flex, spread=0.0, twist=0.0):
        """Chain from a knuckle: `flex` = (mcp, pip, dip) bend toward the palm (deg),
        `spread` rotates the finger about N (deg, + toward the thumb)."""
        A = rot(self.N, D(spread), self.A)
        L = rot(self.N, D(spread), self.L)
        if twist:
            A2 = rot(A, D(twist), A)
            L = rot(A, D(twist), L)
            A = A2
        Nf = L.cross(A).normalized()
        pts = [base]
        ang = 0.0
        for ln, f in zip(lengths, flex):
            ang += D(f)
            d = A * math.cos(ang) + Nf * math.sin(ang)
            pts.append(pts[-1] + d * ln * self.s)
        return pts


def metaball_mesh(name, capsules, ellipsoids=(), res=0.0028):
    """capsules: [(p0, p1, r)], ellipsoids: [(c, (ra, rb, rc), basis3x3)] in ENGINE coords."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    ob = hl.link(bpy.data.objects.new(name, mb))
    for p0, p1, r in capsules:
        a, b = hl.E(*p0), hl.E(*p1)
        el = mb.elements.new(type='CAPSULE')
        d = b - a
        L = d.length
        el.co = (a + b) / 2
        el.radius = r / VIS
        el.size_x = max(L / 2, 1e-4)
        el.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized()) if L > 1e-6 else Quaternion()
        el.stiffness = 2.0
    for c, (ra, rb, rc), basis in ellipsoids:
        el = mb.elements.new(type='ELLIPSOID')
        el.co = hl.E(*c)
        el.radius = 1.0 / VIS
        el.size_x, el.size_y, el.size_z = ra, rb, rc
        # basis: engine-space unit vectors for the ellipsoid's local x, y, z
        bx, by, bz = [hl.E(*b) - hl.E(0, 0, 0) for b in basis]
        M = Matrix((bx, by, bz)).transposed()
        el.rotation = M.to_quaternion()
        el.stiffness = 2.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    out = hl.link(bpy.data.objects.new(name, me))
    return out


def clean(ob, ratio=0.55, smooth_iter=8):
    """Smooth the metaball surface, decimate to a game budget, shade smooth."""
    sm = ob.modifiers.new('sm', 'SMOOTH')
    sm.iterations = smooth_iter
    sm.factor = 0.6
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = ratio
    apply(ob)
    ob.data.shade_smooth()
    return ob


# Proportions (metres, gloved).
FINGERS = {
    # name: (knuckle a, l, n), lengths (prox, mid, dist), radii (prox, mid, dist)
    'index': ((0.091, 0.031, 0.002), (0.043, 0.026, 0.021), (0.0108, 0.0098, 0.0089)),
    'middle': ((0.095, 0.011, 0.002), (0.047, 0.03, 0.022), (0.0111, 0.0101, 0.009)),
    'ring': ((0.091, -0.009, 0.002), (0.044, 0.028, 0.021), (0.0106, 0.0096, 0.0087)),
    'pinky': ((0.083, -0.027, 0.002), (0.035, 0.021, 0.019), (0.0094, 0.0086, 0.0079)),
}
THUMB_LEN = (0.045, 0.033, 0.027)
THUMB_R = (0.0145, 0.0122, 0.0108)


def build_hand(name, H, curls, thumb, mats):
    """curls: {finger: ((mcp, pip, dip), spread)}; thumb: dict(dir=(a, l, n), flex=(f1, f2), roll)."""
    parts = []
    joints = {}
    # Palm volume: heel, upper palm, thenar pad, wrist.
    basis = (tuple(H.A), tuple(H.L), tuple(H.N))
    s = H.s
    ell = [
        (tuple(H.p(0.032, -0.002, 0.0)), (0.034 * s, 0.038 * s, 0.0135 * s), basis),
        (tuple(H.p(0.072, 0.002, 0.0005)), (0.03 * s, 0.045 * s, 0.0125 * s), basis),
        (tuple(H.p(0.036, 0.025, 0.009)), (0.024 * s, 0.016 * s, 0.013 * s), basis),
        (tuple(H.p(-0.004, 0.0, -0.001)), (0.022 * s, 0.03 * s, 0.017 * s), basis),
    ]
    palm = metaball_mesh(f'{name}_palm', [], ell)
    parts.append(palm)
    for fname, (knuckle, lengths, radii) in FINGERS.items():
        flex, spread = curls[fname]
        base = H.p(*knuckle)
        pts = H.finger(base, lengths, flex, spread)
        joints[fname] = pts
        # Proximal starts inside the palm so the knuckle blends.
        caps = [(tuple(H.p(knuckle[0] - 0.012, knuckle[1], knuckle[2])), tuple(pts[1]), radii[0])]
        caps += [(tuple(pts[i]), tuple(pts[i + 1]), radii[i]) for i in range(1, 3)]
        parts.append(metaball_mesh(f'{name}_{fname}', caps))
    # Thumb: from the CMC joint in the thenar, direction in hand-local terms.
    cmc = H.p(0.024, 0.026, 0.006)
    da, dl, dn = thumb['dir']
    d0 = (H.A * da + H.L * dl + H.N * dn).normalized()
    # Bend plane: around an axis perpendicular to the thumb direction (roll picks it).
    axis = d0.cross(H.N).normalized()
    axis = rot(d0, D(thumb.get('roll', 0)), axis)
    tp = [cmc, cmc + d0 * THUMB_LEN[0] * s]
    d = d0
    for ln, f in zip(THUMB_LEN[1:], thumb['flex']):
        d = rot(axis, D(f), d)
        tp.append(tp[-1] + d * ln * s)
    caps = [(tuple(tp[i]), tuple(tp[i + 1]), THUMB_R[i]) for i in range(3)]
    parts.append(metaball_mesh(f'{name}_thumb', caps))
    joints['thumb'] = tp
    glove = join(f'{name}_glove', [clean(p) for p in parts])
    assign(glove, mats['glove'])
    out = [glove]
    # Hard-surface glove hardware on the back of the hand (opposite the palm normal).
    back = -H.N
    kn = [joints[f][0] for f in ('index', 'middle', 'ring', 'pinky')]
    kc = sum(kn, Vector()) / 4 + back * 0.0085 * s - H.A * 0.008 * s
    guard = box(f'{name}_kguard', 0, 0, 0, 0.062 * s, 0.008 * s, 0.02 * s)
    guard.matrix_world = Matrix.Translation(hl.E(*kc)) @ basis_matrix(H.L, back, -H.A)
    out.append(assign(finish(guard, 0.003, 2), mats['gear']))
    pc = H.p(0.05, 0.0, 0.0) + back * 0.0118 * s
    panel = box(f'{name}_panel', 0, 0, 0, 0.05 * s, 0.005 * s, 0.046 * s)
    panel.matrix_world = Matrix.Translation(hl.E(*pc)) @ basis_matrix(H.L, back, -H.A)
    out.append(assign(finish(panel, 0.0025, 2), mats['gear']))
    return out, joints


def basis_matrix(x, y, z):
    """4x4 Blender rotation whose local x/y/z map to ENGINE vectors x, y, z."""
    bx, by, bz = [hl.E(*u) - hl.E(0, 0, 0) for u in (x, y, z)]
    m = Matrix((bx, by, bz)).transposed().to_4x4()
    return m


def sleeve(name, wrist, elbow, H, mats, r0=0.033, r1=0.046):
    """Forearm sleeve from just behind the wrist to past the elbow, with soft folds and a cuff."""
    w, e = Vector(wrist), Vector(elbow)
    axis = (e - w).normalized()
    out = []
    caps = []
    n = 6
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        # Folds: alternating radius bulges read as fabric.
        rr = r0 + (r1 - r0) * (t0 + t1) / 2 + (0.0025 if i % 2 else -0.001)
        caps.append((tuple(w + (e - w) * (0.06 + t0 * 0.94)), tuple(w + (e - w) * (0.06 + t1 * 0.94)), rr))
    sl = metaball_mesh(f'{name}_sleeve', caps, res=0.004)
    out.append(assign(clean(sl, 0.3, 4), mats['sleeve']))
    # Glove cuff over the sleeve end + strap with a buckle plate.
    c0 = w + axis * 0.005
    c1 = w + axis * 0.055
    cuff = metaball_mesh(f'{name}_cuff', [(tuple(c0), tuple(c1), r0 + 0.004)], res=0.003)
    out.append(assign(clean(cuff, 0.4, 3), mats['glove']))
    s0 = w + axis * 0.03
    s1 = w + axis * 0.044
    strap = metaball_mesh(f'{name}_strap', [(tuple(s0), tuple(s1), r0 + 0.0065)], res=0.003)
    out.append(assign(clean(strap, 0.4, 2), mats['gear']))
    bc = w + axis * 0.037 - H.N * (r0 + 0.008)
    buckle = box(f'{name}_buckle', 0, 0, 0, 0.024, 0.005, 0.018)
    side = axis.cross(H.N).normalized()
    buckle.matrix_world = Matrix.Translation(hl.E(*bc)) @ basis_matrix(side, -H.N, axis)
    out.append(assign(finish(buckle, 0.0015, 1), mats['gear']))
    return out


# --------------------------------------------------------------------------- poses

def right_grip(mats):
    """Firing hand on the standard long-gun grip. Built in weapon space, then re-origined to the
    right-hand socket (0, -0.06, 0.01) so the engine can place it per weapon."""
    c, s = math.cos(D(16)), math.sin(D(16))
    Dg = Vector((0, -c, s))        # down the grip
    Fg = Vector((0, -s, -c))       # toward the muzzle, perpendicular to the grip
    # Rotate the hand around the grip axis so the palm wraps the backstrap: knuckles on the
    # right-front, wrist behind and to the right.
    phi = D(-38)
    A = rot(-Dg, phi, Fg)
    Nn = rot(-Dg, phi, Vector((-1, 0, 0)))
    L = -Dg
    knuckle_mid = Vector((0.026, -0.064, 0.032))
    W = knuckle_mid - A * 0.095 - L * 0.011
    H = Hand(W, A, L, Nn)
    curls = {
        'index': ((2, 38, 28), 14),     # forward onto the trigger blade
        'middle': ((22, 92, 62), 0),
        'ring': ((26, 94, 62), -3),
        'pinky': ((30, 92, 58), -6),
    }
    thumb = dict(dir=(0.62, 0.62, 0.48), flex=(18, 22), roll=-20)
    parts, J = build_hand('arm_right', H, curls, thumb, mats)
    elbow = W + (-A * 0.32) + Vector((0.06, -0.16, 0.16))
    parts += sleeve('arm_right', W - A * 0.012, elbow, H, mats)
    out = join('arm_right', parts)
    origin_to_point(out, (0, -0.06, 0.01))
    box_uv(out, 7.0)
    return out


def mirror_x(ob):
    """Mirror a finished mesh across the engine YZ plane (x -> -x), keeping outward normals.
    Left hands are posed as right hands in mirrored space, then mirrored: correct chirality."""
    ob.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    ob.data.flip_normals()
    ob.data.shade_smooth()
    return ob


def left_handguard(mats):
    """Support hand under a ~58 mm handguard (bore y = 0.03), built in mirrored space as a
    right hand: palm up under the handguard, knuckles toward -x, fingers curling up the -x side,
    thumb forward along the +x side. Mirrored, that is the left hand's C-grip with the thumb on
    the near side. Origin = palm contact (0, -0.006, 0) -> socket_<id>_lefthand."""
    # Diagonal cup: knuckles at the far-front corner under the handguard, wrist behind and below
    # on the near side, so the hand never sticks out sideways past the narrow handguard.
    A = Vector((-0.6, 0.16, -0.78)).normalized()      # wrist -> knuckles: far side, forward, a bit up
    N0 = Vector((0.0, 1.0, 0.0))
    Nn = (N0 - A * A.dot(N0)).normalized()            # palm up into the handguard
    L = A.cross(Nn).normalized()                      # right hand: N = L x A  =>  L = A x N
    knuckle_mid = Vector((-0.019, -0.021, -0.026))
    W = knuckle_mid - A * 0.095 - L * 0.011
    H = Hand(W, A, L, Nn)
    curls = {
        'index': ((34, 62, 30), 4),
        'middle': ((36, 66, 32), 0),
        'ring': ((38, 68, 32), -4),
        'pinky': ((40, 68, 34), -8),
    }
    # Thumb lies forward along the near side, just under the handguard's mid line.
    thumb = dict(dir=(0.78, 0.5, 0.36), flex=(12, 10), roll=90)
    parts, J = build_hand('arm_left', H, curls, thumb, mats)
    # Mirrored space: +x here is the player's left after mirroring. Elbow far out to the side so
    # the forearm enters the screen diagonally from the lower left.
    elbow = W + Vector((0.24, -0.2, 0.3))
    parts += sleeve('arm_left', W - A * 0.01, elbow, H, mats)
    out = join('arm_left', parts)
    mirror_x(out)
    origin_to_point(out, (0, -0.006, 0))
    box_uv(out, 7.0)
    return out


def left_pistol(mats):
    """Support hand on a pistol: in mirrored space a right hand wrapping the firing hand on the
    right side of the grip (one firing-hand thickness further out, fingers looser), thumb
    forward along the frame. Mirrored, the left palm presses the grip's left side and its
    fingers wrap the firing hand's fingers; the thumb points forward under the slide."""
    c, s = math.cos(D(18)), math.sin(D(18))
    Dg = Vector((0, -c, s))
    Fg = Vector((0, -s, -c))
    phi = D(-24)
    A = rot(-Dg, phi, Fg)
    Nn = rot(-Dg, phi, Vector((-1, 0, 0)))
    L = -Dg
    knuckle_mid = Vector((0.03, -0.06, 0.004))
    W = knuckle_mid - A * 0.095 - L * 0.011
    H = Hand(W, A, L, Nn)
    curls = {
        'index': ((24, 66, 40), 2),
        'middle': ((26, 70, 44), 0),
        'ring': ((28, 72, 44), -3),
        'pinky': ((30, 70, 42), -6),
    }
    thumb = dict(dir=(0.9, 0.35, 0.18), flex=(4, 2), roll=0)
    parts, J = build_hand('arm_left_pistol', H, curls, thumb, mats)
    elbow = W + (-A * 0.3) + Vector((0.07, -0.16, 0.12))
    parts += sleeve('arm_left_pistol', W - A * 0.012, elbow, H, mats)
    out = join('arm_left_pistol', parts)
    mirror_x(out)
    origin_to_point(out, (-0.025, -0.05, 0.02))
    box_uv(out, 7.0)
    return out


def origin_to_point(ob, p):
    """Express the mesh relative to engine point p (node origin = p, mesh at its built place)."""
    hl.origin_to(ob, *p)
    return ob


def build_arms(mats):
    r = right_grip(mats)
    l = left_handguard(mats)
    lp = left_pistol(mats)
    return [r, l, lp]
