"""Tileable PBR texture synthesis (numpy only, no Blender dependency).

Every generator returns float32 arrays in [0, 1] shaped (H, W) or (H, W, C). All noise is built
in the frequency domain or with wrap-around drawing, so every map tiles seamlessly. Texture sets
are "material-scale" detail (polymer stipple, machined steel, knurled rubber, painted metal);
form detail comes from the geometry (bevels, cutouts, weighted normals).

Packing follows glTF:
    baseColor   RGB (sRGB)            ORM: R occlusion, G roughness, B metalness (linear)
    normal      tangent space, +Y up (OpenGL convention, which glTF uses)
"""

import numpy as np


def rng(seed):
    return np.random.default_rng(seed)


def fbm(size, seed, octaves=5, base=4, gain=0.5, lacunarity=2.0):
    """Tileable fractal noise in [0, 1]. `base` = cycles across the tile at octave 0."""
    r = rng(seed)
    fy = np.fft.fftfreq(size)[:, None] * size
    fx = np.fft.fftfreq(size)[None, :] * size
    rad = np.sqrt(fx * fx + fy * fy)
    out = np.zeros((size, size), np.float64)
    amp, freq, total = 1.0, float(base), 0.0
    for _ in range(octaves):
        spec = np.fft.fft2(r.standard_normal((size, size)))
        band = np.exp(-((rad - freq) ** 2) / (2 * (freq * 0.5) ** 2))
        layer = np.real(np.fft.ifft2(spec * band))
        layer /= layer.std() + 1e-9
        out += layer * amp
        total += amp
        amp *= gain
        freq *= lacunarity
    out /= total
    return normalize(out)


def normalize(a):
    lo, hi = np.percentile(a, 0.5), np.percentile(a, 99.5)
    return np.clip((a - lo) / (hi - lo + 1e-9), 0, 1).astype(np.float32)


def cells(size, seed, count=60):
    """Tileable Worley distance (F1) in [0, 1] — used for stipple, pitting, paint chips."""
    r = rng(seed)
    pts = r.random((count, 2)) * size
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.full((size, size), 1e9, np.float32)
    for px, py in pts:
        dx = np.abs(xx - px)
        dy = np.abs(yy - py)
        dx = np.minimum(dx, size - dx)
        dy = np.minimum(dy, size - dy)
        d = np.minimum(d, np.sqrt(dx * dx + dy * dy))
    return normalize(d)


def scratches(size, seed, count=140, length=(0.05, 0.25), angle=None, width=1.0):
    """Thin wrap-around line scratches. Returns intensity in [0, 1]."""
    r = rng(seed)
    img = np.zeros((size, size), np.float32)
    for _ in range(count):
        x, y = r.random(2) * size
        a = r.random() * np.pi if angle is None else angle + r.normal(0, 0.08)
        L = r.uniform(*length) * size
        n = int(L * 2)
        t = np.linspace(0, 1, n)
        xs = (x + np.cos(a) * L * t).astype(int) % size
        ys = (y + np.sin(a) * L * t).astype(int) % size
        strength = r.uniform(0.3, 1.0) * np.sin(np.pi * t) ** 0.5
        np.maximum.at(img, (ys, xs), strength)
        if width > 1:
            np.maximum.at(img, ((ys + 1) % size, xs), strength * 0.5)
    return img


def blur(a, radius):
    """Wrap-around gaussian blur via FFT."""
    size = a.shape[0]
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    k = np.exp(-2 * (np.pi * radius) ** 2 * (fx * fx + fy * fy))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * k)).astype(np.float32)
    return np.stack([blur(a[..., i], radius) for i in range(a.shape[2])], -1)


def normal_from_height(h, strength):
    """Tangent-space normal map from a tileable height field (OpenGL / glTF convention)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    # Image rows run top->bottom while UV v runs bottom->top: flip the y slope.
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5], -1).astype(np.float32)


def knurl(size, pitch=24, depth=1.0):
    """Diamond knurl height field (crossed ridges)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    a = np.abs(((xx + yy) * pitch) % 1.0 - 0.5) * 2
    b = np.abs(((xx - yy) * pitch) % 1.0 - 0.5) * 2
    return (np.minimum(a, b) * depth).astype(np.float32)


def rgb(c, h, w):
    return np.broadcast_to(np.array(c, np.float32), (h, w, 3)).copy()


def pack_orm(occ, rough, metal):
    return np.stack([occ, rough, metal], -1).astype(np.float32)


# --------------------------------------------------------------------------- material sets
# Each returns dict(base=(H,W,3), orm=(H,W,3), normal=(H,W,3)). Colours are sRGB-encoded.
# Role materials (body/accent/grip) are near-white so the engine palette tints them.

def set_polymer(size=512, seed=1):
    stip = cells(size, seed, 900)
    grain = fbm(size, seed + 1, 5, 24)
    h = (1 - stip) ** 3 * 0.7 + grain * 0.3
    base = rgb([0.82, 0.82, 0.83], size, size) * (0.94 + 0.06 * grain)[..., None]
    rough = 0.62 + 0.14 * grain - 0.1 * scratches(size, seed + 2, 60, (0.02, 0.08))
    return dict(base=base, orm=pack_orm(np.ones_like(h), np.clip(rough, 0, 1), np.zeros_like(h)), normal=normal_from_height(blur(h, 0.8), 1.6))


def set_cerakote(size=512, seed=3):
    """Ceramic-coated metal: fine orange peel, edge-worn scratches, mid roughness."""
    peel = fbm(size, seed, 4, 40)
    scr = scratches(size, seed + 1, 220, (0.03, 0.2))
    base = rgb([0.86, 0.86, 0.87], size, size) * (0.95 + 0.05 * peel)[..., None]
    base = base * (1 - scr[..., None] * 0.18) + scr[..., None] * 0.18 * 0.95
    rough = np.clip(0.48 + 0.1 * peel - scr * 0.22, 0, 1)
    metal = np.clip(0.35 + scr * 0.6, 0, 1)
    return dict(base=base, orm=pack_orm(np.ones_like(peel), rough, metal), normal=normal_from_height(blur(peel, 1.2) * 0.6 - scr * 0.25, 1.2))


def set_steel(size=512, seed=5):
    """Machined / parkerized steel with directional brushing along U."""
    r = rng(seed)
    streak = blur(r.standard_normal((size, size)).astype(np.float32), 0.6)
    streak = np.repeat(streak.mean(1, keepdims=True), size, 1) * 0.6 + blur(streak, 2) * 0.4
    streak = normalize(streak)
    pits = 1 - cells(size, seed + 1, 300)
    scr = scratches(size, seed + 2, 120, (0.05, 0.3), angle=0.0)
    base = rgb([0.62, 0.63, 0.65], size, size) * (0.9 + 0.1 * streak)[..., None]
    rough = np.clip(0.34 + 0.16 * streak + 0.1 * (pits ** 6) - 0.12 * scr, 0, 1)
    return dict(base=base, orm=pack_orm(np.ones_like(rough), rough, np.full_like(rough, 0.95)), normal=normal_from_height(streak * 0.3 - pits ** 8 * 0.3, 0.9))


def set_rubber(size=512, seed=7):
    k = knurl(size, 28)
    grain = fbm(size, seed, 4, 30)
    h = k * 0.85 + grain * 0.15
    base = rgb([0.8, 0.8, 0.8], size, size) * (0.92 + 0.08 * grain)[..., None]
    rough = np.clip(0.78 + 0.12 * grain - 0.1 * k, 0, 1)
    return dict(base=base, orm=pack_orm(0.85 + 0.15 * k, rough, np.zeros_like(k)), normal=normal_from_height(h, 3.0))


def set_fabric(size=512, seed=9, color=(0.82, 0.82, 0.82)):
    """Ripstop weave: fine twill plus a ripstop grid every ~5 mm."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    weave = (np.sin((xx * 96 + yy * 96) * np.pi * 2) * 0.5 + 0.5) * 0.6 + (np.sin(xx * 192 * np.pi * 2) * 0.5 + 0.5) * 0.4
    grid = np.maximum(np.abs(((xx * 16) % 1) - 0.5) > 0.47, np.abs(((yy * 16) % 1) - 0.5) > 0.47).astype(np.float32)
    mott = fbm(size, seed, 4, 6)
    h = weave * 0.6 + grid * 0.4
    base = rgb(color, size, size) * (0.88 + 0.08 * mott + 0.04 * weave)[..., None]
    rough = np.clip(0.86 + 0.08 * mott, 0, 1)
    return dict(base=base, orm=pack_orm(0.9 + 0.1 * weave, rough, np.zeros_like(h)), normal=normal_from_height(blur(h, 0.5), 2.2))


def set_glow(size=64):
    return dict(base=rgb([1, 1, 1], size, size), orm=pack_orm(np.ones((size, size)), np.full((size, size), 0.3), np.zeros((size, size))), normal=rgb([0.5, 0.5, 1.0], size, size))


def set_brass(size=256, seed=11):
    n = fbm(size, seed, 4, 12)
    base = rgb([0.93, 0.74, 0.42], size, size) * (0.9 + 0.1 * n)[..., None]
    return dict(base=base, orm=pack_orm(np.ones_like(n), 0.28 + 0.15 * n, np.ones_like(n)), normal=rgb([0.5, 0.5, 1.0], size, size))


def set_lens(size=64):
    base = rgb([0.05, 0.08, 0.1], size, size)
    return dict(base=base, orm=pack_orm(np.ones((size, size)), np.full((size, size), 0.05), np.full((size, size), 0.2)), normal=rgb([0.5, 0.5, 1.0], size, size))


def set_painted_steel(size=512, seed=51):
    """Weathered paint over steel: mottling, run streaks from the top edge, chipped edges.
    Near-white so the engine tints it per instance (container / crane colours)."""
    r = rng(seed)
    mott = fbm(size, seed, 5, 6)
    streaks = blur(np.repeat(r.random((1, size)).astype(np.float32), size, 0), 0.8)
    streaks = normalize(streaks) ** 6 * np.linspace(1, 0.2, size, dtype=np.float32)[:, None]
    chips = (cells(size, seed + 2, 70) < 0.03).astype(np.float32) * (fbm(size, seed + 4, 3, 4) > 0.6)
    grime = np.linspace(0.0, 0.18, size, dtype=np.float32)[:, None] * fbm(size, seed + 3, 4, 3)
    v = 0.9 + 0.08 * mott - 0.22 * streaks - grime
    base = rgb([1, 1, 1], size, size) * v[..., None]
    base = base * (1 - chips[..., None]) + chips[..., None] * np.array([0.52, 0.46, 0.42], np.float32)
    rough = np.clip(0.58 + 0.18 * mott + 0.2 * chips + 0.1 * streaks, 0, 1)
    metal = np.clip(chips * 0.8, 0, 1)
    h = mott * 0.3 - chips * 0.5
    return dict(base=np.clip(base, 0, 1), orm=pack_orm(np.ones_like(v), rough, metal), normal=normal_from_height(blur(h, 1.0), 1.5))


def set_wood(size=512, seed=61):
    """Rough-sawn pallet / crate planks (fixed colour)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    n = fbm(size, seed, 5, 8)
    grain = np.sin((yy * 40 + n * 3.0) * np.pi * 2) * 0.5 + 0.5
    plank = np.floor(xx * 4)
    tone = 0.85 + 0.1 * ((plank * 7.3) % 1.0)
    gap = (np.abs((xx * 4) % 1.0 - 0.5) > 0.485).astype(np.float32)
    v = (0.75 + 0.2 * grain * 0.4 + 0.15 * n) * tone * (1 - gap * 0.6)
    base = np.stack([v * 0.78, v * 0.6, v * 0.4], -1)
    rough = np.clip(0.8 + 0.15 * n, 0, 1)
    return dict(base=base.astype(np.float32), orm=pack_orm(1 - gap * 0.4, rough, np.zeros_like(v)), normal=normal_from_height(blur(grain * 0.3 - gap, 0.8), 2.0))


def set_concrete(size=512, seed=71):
    n = fbm(size, seed, 5, 6)
    pores = (cells(size, seed + 1, 500) < 0.06).astype(np.float32)
    v = 0.8 + 0.15 * n - pores * 0.25
    base = rgb([0.72, 0.71, 0.69], size, size) * v[..., None]
    return dict(base=base, orm=pack_orm(np.ones_like(v), np.clip(0.85 + 0.1 * n, 0, 1), np.zeros_like(v)), normal=normal_from_height(blur(n * 0.3 - pores * 0.6, 0.7), 1.6))


def set_glass(size=64):
    base = rgb([0.08, 0.12, 0.14], size, size)
    return dict(base=base, orm=pack_orm(np.ones((size, size)), np.full((size, size), 0.08), np.full((size, size), 0.0)), normal=rgb([0.5, 0.5, 1.0], size, size))
