"""Stylized ("painted") tileable texture sets — the Hairline look.

Rules of the style (Valorant-like readability):
  * big flat colour zones; value variation is LOW frequency (soft painted blotches, +-6 %)
  * form detail is painted, not photographic: seams are a dark line with a lit lip beside it,
    edges get a light wear band, grime pools in a gradient toward the bottom of a panel
  * almost no high-frequency noise: textures must read at 30 m and not shimmer in motion
  * role textures (paint, polymer, cerakote) stay near-white so the engine tints them

Every function returns float32 arrays in [0, 1]. World surfaces return an albedo (H, W, 3);
material sets return dict(base, orm, normal) packed like glTF (ORM: occlusion, roughness, metal).
All patterns wrap seamlessly.
"""

import numpy as np

from textures import fbm, blur, normalize, normal_from_height, pack_orm, rng, cells


def grid(size):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    return xx, yy


def soft(size, seed, base=3, amp=0.05):
    """Low-frequency painted value variation centred on 1."""
    return 1.0 + (fbm(size, seed, 3, base, 0.55) - 0.5) * 2 * amp


def strokes(size, seed, angle=0.0, amp=0.03, length=24.0):
    """Directional brush strokes: noise stretched along `angle` (radians)."""
    r = rng(seed)
    n = r.standard_normal((size, size)).astype(np.float32)
    # Anisotropic blur in the frequency domain.
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    c, s = np.cos(angle), np.sin(angle)
    u = fx * c + fy * s
    v = -fx * s + fy * c
    k = np.exp(-2 * (np.pi ** 2) * ((u * length) ** 2 + (v * 2.0) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * k))
    out = (normalize(out) - 0.5) * 2 * amp
    return 1.0 + out.astype(np.float32)


def seam_lines(coord, period, width=0.006, lip=0.012):
    """Painted seam along a repeating coordinate: returns (dark, light) masks in [0, 1]."""
    f = (coord / period) % 1.0
    d = np.minimum(f, 1 - f) * period
    dark = np.clip(1 - d / width, 0, 1)
    light = np.clip(1 - np.abs(f * period - (width + lip * 0.5)) / max(lip * 0.5, 1e-6), 0, 1) if lip > 0 else np.zeros_like(f)
    return dark.astype(np.float32), light.astype(np.float32)


def shade(base, *mods):
    out = base.copy()
    for m in mods:
        out = out * (m[..., None] if m.ndim == 2 else m)
    return np.clip(out, 0, 1)


def rgb(c, size):
    return np.broadcast_to(np.array(c, np.float32), (size, size, 3)).copy()


def mix(a, b, t):
    t = t[..., None] if t.ndim == 2 else t
    return a * (1 - t) + b * t


# =========================================================================== world surfaces
# Albedo only (the world shader is a texture fetch). Colours are sRGB-encoded; most are
# near-neutral so data/surfaces.js tints do the colour work per brush.

def quay(size=512, seed=101):
    """Concrete quay slabs, 2 m (two slabs per 4 m tile), painted joints and soft stains."""
    xx, yy = grid(size)
    v = soft(size, seed, 2, 0.035) * strokes(size, seed + 1, 0.3, 0.02)
    dkx, ltx = seam_lines(xx, 0.5, 0.004, 0.008)
    dky, lty = seam_lines(yy, 0.5, 0.004, 0.008)
    stains = blur(np.clip((fbm(size, seed + 2, 3, 3) - 0.6) * 2.5, 0, 1), 3) * 0.06
    v = v * (1 - 0.32 * np.maximum(dkx, dky)) * (1 + 0.06 * np.maximum(ltx, lty)) * (1 - stains)
    # Per-slab tone so the grid reads from distance.
    sid = np.floor(xx * 2) + np.floor(yy * 2) * 3
    v = v * (0.96 + 0.05 * ((sid * 0.618) % 1.0))
    return shade(rgb([0.86, 0.84, 0.8], size), v)


def asphalt(size=512, seed=111):
    v = soft(size, seed, 2, 0.04) * strokes(size, seed + 1, 1.2, 0.02)
    patch = np.clip((fbm(size, seed + 2, 3, 2) - 0.58) * 3, 0, 1)
    patch = blur(patch, 4)
    v = v * (1 - 0.06 * patch)
    tire = np.exp(-((((xx_ := grid(size)[0]) * 2) % 1.0 - 0.5) ** 2) / 0.02) * 0.04
    v = v * (1 - tire)
    return shade(rgb([0.5, 0.5, 0.52], size), v)


def epoxy(size=512, seed=121):
    """Warehouse floor: green-grey epoxy, 4 m bays, scuffed paths, soft sheen variation."""
    xx, yy = grid(size)
    v = soft(size, seed, 2, 0.03) * strokes(size, seed + 1, 0.0, 0.025, 40)
    dk, lt = seam_lines(xx, 1.0, 0.003, 0.006)
    dk2, lt2 = seam_lines(yy, 1.0, 0.003, 0.006)
    scuff = blur(np.clip(fbm(size, seed + 2, 3, 3) - 0.6, 0, 1), 3) * 0.15
    v = v * (1 - 0.3 * np.maximum(dk, dk2)) * (1 - scuff)
    return shade(rgb([0.82, 0.88, 0.85], size), v)


def corrugated(size=512, seed=131):
    """Corrugated cladding: 10 ribs per tile (2 m), painted light/shadow faces on each rib,
    long vertical rain streaks."""
    xx, yy = grid(size)
    f = (xx * 10) % 1.0
    # Trapezoid profile: crest, slope (lit), trough, slope (shadow).
    prof = np.where(f < 0.35, 1.0, np.where(f < 0.5, 1.12, np.where(f < 0.85, 0.9, 0.78))).astype(np.float32)
    prof = blur(prof, 0.6)
    streak = strokes(size, seed, np.pi / 2, 0.05, 60)
    grime = 1 - np.clip(yy * 0.0, 0, 1)
    v = prof * streak * soft(size, seed + 2, 2, 0.05) * grime
    dk, lt = seam_lines(yy, 1.0, 0.004, 0.008)  # horizontal panel lap every 2 m
    v = v * (1 - 0.35 * dk) * (1 + 0.08 * lt)
    return shade(rgb([0.9, 0.9, 0.9], size), v)


def paint(size=512, seed=141):
    """Painted steel panel: 1 m panels, soft blotches, light edge-wear lips at seams."""
    xx, yy = grid(size)
    v = soft(size, seed, 2, 0.035) * strokes(size, seed + 1, np.pi / 2, 0.025, 30)
    dkx, ltx = seam_lines(xx, 0.5, 0.004, 0.01)
    dky, lty = seam_lines(yy, 0.5, 0.004, 0.01)
    v = v * (1 - 0.3 * np.maximum(dkx, dky)) * (1 + 0.1 * np.maximum(ltx, lty))
    return shade(rgb([0.9, 0.9, 0.9], size), v)


def hazard(size=256, seed=151):
    """Yellow / near-black 45 degree stripes, chipped a little at stripe edges."""
    xx, yy = grid(size)
    f = ((xx + yy) * 4) % 1.0
    m = (f < 0.5).astype(np.float32)
    m = blur(m, 0.5)
    y = np.array([0.96, 0.72, 0.1], np.float32)
    k = np.array([0.1, 0.1, 0.11], np.float32)
    out = mix(rgb(k, size), rgb(y, size), m)
    return shade(out, soft(size, seed, 2, 0.06))


def deck(size=512, seed=161):
    """Ship deck: oxide-red non-slip paint, weld seams every 2 m, scuffed walk paths."""
    xx, yy = grid(size)
    v = soft(size, seed, 2, 0.04) * strokes(size, seed + 1, 0.0, 0.025, 50)
    dk, lt = seam_lines(yy, 0.5, 0.003, 0.008)
    wear = blur(np.clip(fbm(size, seed + 2, 3, 3) - 0.58, 0, 1), 3) * 0.7
    base = mix(rgb([0.62, 0.24, 0.16], size), rgb([0.48, 0.42, 0.38], size), wear)
    v = v * (1 - 0.3 * dk) * (1 + 0.08 * lt)
    return shade(base, v)


def shutter(size=256, seed=171):
    """Roller shutter: 10 cm slats with a painted highlight on each top lip."""
    xx, yy = grid(size)
    f = (yy * 20) % 1.0
    v = np.where(f < 0.12, 0.7, np.where(f < 0.25, 1.1, 1.0)).astype(np.float32)
    v = blur(v, 0.5) * soft(size, seed, 2, 0.05)
    return shade(rgb([0.86, 0.86, 0.84], size), v)


def glass(size=256, seed=181):
    """Office glazing: dark teal glass with a painted diagonal sky reflection band."""
    xx, yy = grid(size)
    band = np.exp(-((((xx * 0.7 + yy) % 1.0) - 0.5) ** 2) / 0.01) * 0.35
    mull = np.maximum(seam_lines(xx, 0.5, 0.012, 0.0)[0], seam_lines(yy, 1.0, 0.012, 0.0)[0])
    base = rgb([0.22, 0.34, 0.4], size) * (1 + band)[..., None]
    base = mix(base, rgb([0.82, 0.84, 0.84], size), mull)
    return np.clip(base, 0, 1)


def plaster(size=512, seed=191):
    """Office walls: smooth painted render, 2 m panel joints, soft vertical streaking."""
    xx, yy = grid(size)
    v = soft(size, seed, 2, 0.05) * strokes(size, seed + 1, np.pi / 2, 0.03, 50)
    dk, lt = seam_lines(xx, 1.0, 0.003, 0.008)
    v = v * (1 - 0.25 * dk) * (1 + 0.06 * lt)
    return shade(rgb([0.94, 0.92, 0.88], size), v)


def grate(size=256, seed=201):
    """Bar grating for catwalks: readable bars, dark (not black) gaps."""
    xx, yy = grid(size)
    bx = ((xx * 16) % 1.0) < 0.28
    by = ((yy * 4) % 1.0) < 0.12
    v = np.where(bx | by, 1.0, 0.32).astype(np.float32)
    v = blur(v, 0.4) * soft(size, seed, 2, 0.05)
    return shade(rgb([0.86, 0.87, 0.88], size), v)


def steel(size=256, seed=211):
    v = soft(size, seed, 3, 0.06) * strokes(size, seed + 1, 0.0, 0.03, 30)
    return shade(rgb([0.88, 0.88, 0.9], size), v)


def concrete(size=512, seed=221):
    xx, yy = grid(size)
    v = soft(size, seed, 2, 0.04) * strokes(size, seed + 1, 0.2, 0.02)
    dk, lt = seam_lines(yy, 1.0, 0.004, 0.008)
    v = v * (1 - 0.25 * dk) * (1 + 0.05 * lt)
    return shade(rgb([0.86, 0.86, 0.84], size), v)


def water(size=256, seed=231):
    v = soft(size, seed, 4, 0.1) * strokes(size, seed + 1, 0.4, 0.06, 20)
    return shade(rgb([0.75, 0.9, 0.92], size), v)


WORLD = {
    'quay': quay, 'asphalt': asphalt, 'epoxy': epoxy, 'corrugated': corrugated, 'paint': paint,
    'hazard': hazard, 'deck': deck, 'shutter': shutter, 'glass': glass, 'plaster': plaster,
    'grate': grate, 'steel': steel, 'concrete': concrete, 'water': water,
}


# =========================================================================== material sets
# For glTF models (weapons, props). Normal maps are gentle: form comes from geometry.

def _set(base, rough, metal=0.0, height=None, strength=1.0, occ=None):
    s = base.shape[0]
    r = rough if isinstance(rough, np.ndarray) else np.full((s, s), rough, np.float32)
    m = metal if isinstance(metal, np.ndarray) else np.full((s, s), metal, np.float32)
    o = occ if occ is not None else np.ones((s, s), np.float32)
    n = normal_from_height(height, strength) if height is not None else rgb([0.5, 0.5, 1.0], s)
    return dict(base=np.clip(base, 0, 1).astype(np.float32), orm=pack_orm(o, np.clip(r, 0, 1), np.clip(m, 0, 1)), normal=n.astype(np.float32))


def m_paint(size=512, seed=301):
    """Painted steel (containers, cranes): near-white for tinting; soft streaks, light worn
    edges painted as low-frequency lighter zones, no rust speckle."""
    xx, yy = grid(size)
    v = soft(size, seed, 3, 0.05) * strokes(size, seed + 1, np.pi / 2, 0.04, 40)
    wear = np.clip((fbm(size, seed + 2, 3, 4) - 0.7) * 3, 0, 1) * 0.15
    grime = (1 - yy) ** 3 * 0.08
    base = rgb([0.92, 0.92, 0.92], size) * (v * (1 + wear) * (1 - grime))[..., None]
    rough = 0.62 + 0.1 * (fbm(size, seed + 3, 3, 4) - 0.5)
    return _set(base, rough, 0.05, height=fbm(size, seed + 4, 3, 8) * 0.2, strength=0.8)


def m_polymer(size=512, seed=311):
    """Weapon polymer: smooth satin, faint low-frequency mottling, no stipple noise."""
    v = soft(size, seed, 3, 0.04)
    base = rgb([0.86, 0.86, 0.87], size) * v[..., None]
    return _set(base, 0.55 + (fbm(size, seed + 1, 3, 4) - 0.5) * 0.08, 0.0, height=fbm(size, seed + 2, 3, 24) * 0.15, strength=0.6)


def m_cerakote(size=512, seed=321):
    """Ceramic-coated metal: clean colour panel, satin roughness, faint brush direction."""
    v = soft(size, seed, 3, 0.04) * strokes(size, seed + 1, 0.0, 0.02, 30)
    base = rgb([0.9, 0.9, 0.9], size) * v[..., None]
    return _set(base, 0.42, 0.25, height=strokes(size, seed + 2, 0.0, 0.5, 30) - 1.0, strength=0.25)


def m_metal(size=256, seed=331):
    """Gunmetal: dark-mid steel, brushed lengthwise (U), moderately glossy."""
    st = strokes(size, seed, 0.0, 0.06, 60)
    base = rgb([0.6, 0.61, 0.64], size) * st[..., None]
    return _set(base, 0.36 + (st - 1.0) * 0.6, 0.9, height=st - 1.0, strength=0.4)


def m_grip(size=256, seed=341):
    """Grip texture: large painted diamond pattern (reads as texture, not noise)."""
    xx, yy = grid(size)
    a = np.abs(((xx + yy) * 10) % 1.0 - 0.5) * 2
    b = np.abs(((xx - yy) * 10) % 1.0 - 0.5) * 2
    h = np.minimum(a, b)
    base = rgb([0.8, 0.8, 0.8], size) * (0.9 + 0.12 * h)[..., None]
    return _set(base, 0.8 - 0.1 * h, 0.0, height=h, strength=1.6, occ=0.85 + 0.15 * h)


def m_fabric(size=256, seed=351, color=(0.82, 0.82, 0.82)):
    """Glove / sleeve textile: soft broad weave, painted, gentle normal."""
    xx, yy = grid(size)
    weave = (np.sin((xx + yy) * np.pi * 2 * 24) * 0.5 + 0.5) * 0.5 + (np.sin((xx - yy) * np.pi * 2 * 24) * 0.5 + 0.5) * 0.5
    v = soft(size, seed, 2, 0.05) * (0.95 + 0.06 * weave)
    base = rgb(color, size) * v[..., None]
    return _set(base, 0.86, 0.0, height=weave, strength=0.7)


def m_leather(size=256, seed=361):
    v = soft(size, seed, 3, 0.07)
    base = rgb([0.82, 0.8, 0.78], size) * v[..., None]
    return _set(base, 0.6 + (fbm(size, seed + 1, 3, 5) - 0.5) * 0.2, 0.0, height=fbm(size, seed + 2, 4, 30) * 0.3, strength=0.5)


def m_wood(size=512, seed=371):
    """Painted-look crate planks: four boards per tile, warm tone steps, drawn grain."""
    xx, yy = grid(size)
    board = np.floor(xx * 4)
    tone = 0.9 + 0.08 * ((board * 0.618) % 1.0)
    grain = strokes(size, seed, np.pi / 2, 0.06, 70)
    dk, lt = seam_lines(xx, 0.25, 0.006, 0.01)
    v = tone * grain * (1 - 0.5 * dk) * (1 + 0.08 * lt)
    base = rgb([0.86, 0.62, 0.38], size) * v[..., None]
    return _set(base, 0.78, 0.0, height=grain - 1.0 - dk * 0.5, strength=1.2, occ=1 - dk * 0.4)


def m_concrete(size=512, seed=381):
    base = concrete(size, seed)
    return _set(base, 0.88, 0.0, height=fbm(size, seed + 5, 3, 6) * 0.2, strength=0.6)


def m_rubber(size=256, seed=391):
    v = soft(size, seed, 3, 0.05)
    base = rgb([0.2, 0.2, 0.21], size) * v[..., None]
    return _set(base, 0.85, 0.0)


def m_glass(size=64):
    return _set(rgb([0.1, 0.16, 0.2], size), 0.06, 0.0)


def m_glow(size=64):
    return _set(rgb([1, 1, 1], size), 0.3, 0.0)


def m_brass(size=128, seed=401):
    v = soft(size, seed, 2, 0.05)
    return _set(rgb([0.95, 0.76, 0.42], size) * v[..., None], 0.3, 1.0)


def m_lens(size=64):
    return _set(rgb([0.04, 0.07, 0.1], size), 0.05, 0.2)


def m_dark(size=256, seed=411):
    v = soft(size, seed, 3, 0.05) * strokes(size, seed + 1, 0.0, 0.03, 30)
    return _set(rgb([0.17, 0.17, 0.19], size) * v[..., None], 0.45, 0.6)
