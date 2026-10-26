"""Top-down render of a compiled map (dev tool). Reads tools/mapcheck.mjs output.

python3 tools/mapviz.py shots/map.json shots/map.png [variant]

Brushes are drawn lowest first, shaded by height; hulls (authored props), rails and clips get
outlines; the walk graph is a faint tint so unreachable pockets stand out; hostile posts show
their hold direction; plant zones, callouts and the first route set are overlaid.
"""
import json
import math
import sys

from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
vi = int(sys.argv[3]) if len(sys.argv) > 3 else 0
R = json.load(open(src))
b = R['bounds']
PX = 9  # pixels per metre
W, H = int((b['maxX'] - b['minX']) * PX), int((b['maxZ'] - b['minZ']) * PX)
img = Image.new('RGB', (W, H), (18, 22, 28))
d = ImageDraw.Draw(img, 'RGBA')


def P(x, z):
    return ((x - b['minX']) * PX, (z - b['minZ']) * PX)


try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
except Exception:
    font = small = ImageFont.load_default()

COLLIDE, SHOT, SIGHT, RENDER = 1, 2, 4, 8
variant = R['variants'][vi]
enabled = set(variant['groups'])
brs = [x for x in R['brushes'] if not x['group'] or x['group'] in enabled]
brs.sort(key=lambda x: x['maxY'])
WATER = 9
for br in brs:
    pts = [P(x, z) for x, z in br['poly']]
    top = br['maxY']
    fl = br['flags']
    if br['surface'] == WATER:
        d.polygon(pts, fill=(22, 52, 66))
        continue
    if not fl & COLLIDE and fl & RENDER and top > 9:
        continue  # roofs: skip so interiors stay readable
    if fl == COLLIDE:  # clip
        d.polygon(pts, outline=(255, 80, 200, 200))
        continue
    if fl & COLLIDE and not fl & SHOT:  # rail
        d.line(pts + [pts[0]], fill=(120, 220, 255, 230), width=2)
        continue
    if not fl & COLLIDE:
        continue  # detail
    k = max(0.0, min(1.0, (top + 0.5) / 9.0))
    base = (int(60 + 150 * k), int(66 + 140 * k), int(76 + 120 * k))
    if top <= 0.05:
        base = (54, 58, 64)
    t = br.get('tint')
    if t and top > 0.05:
        base = tuple(int(min(255, base[i] * 0.55 + 255 * min(1, t[i] * 1.2) * 0.45)) for i in range(3))
    d.polygon(pts, fill=base + (255,), outline=(10, 12, 16, 255) if top > 0.05 else None)

# walk graph tint: green ground, blue upper floors
for x, z, y in variant['walk']:
    px, pz = P(x, z)
    c = (90, 255, 140, 34) if y < 0.6 else (90, 170, 255, 70)
    d.rectangle([px - PX * 0.25, pz - PX * 0.25, px + PX * 0.25, pz + PX * 0.25], fill=c)

for key, z in R['zones'].items():
    a, c = P(z['x0'], z['z0']), P(z['x1'], z['z1'])
    col = (255, 120, 40) if key == 'A' else (40, 230, 220)
    d.rectangle([a, c], outline=col + (255,), width=3, fill=col + (40,))
    d.text(((a[0] + c[0]) / 2 - 6, (a[1] + c[1]) / 2 - 8), key, fill=col, font=font)

for h in R['spawns']['hostiles']:
    x, y, z = h['pos']
    px, pz = P(x, z)
    yaw = h['yaw']
    fx, fz = -math.sin(yaw), -math.cos(yaw)
    d.ellipse([px - 6, pz - 6, px + 6, pz + 6], fill=(255, 60, 60))
    d.line([px, pz, px + fx * 40, pz + fz * 40], fill=(255, 60, 60, 200), width=2)
    if y > 0.5:
        d.text((px + 7, pz - 6), f'+{y:.1f}', fill=(255, 200, 200), font=small)
sp = R['spawns']['player']['pos']
px, pz = P(sp[0], sp[2])
d.ellipse([px - 8, pz - 8, px + 8, pz + 8], fill=(80, 255, 120))

for c in R['callouts']:
    px, pz = P(c['x'], c['z'])
    d.text((px - 20, pz - 5), c['name'], fill=(235, 235, 225, 230), font=small)

colors = [(255, 220, 60), (255, 140, 255), (120, 255, 255), (255, 255, 255)]
for i, (k, pts) in enumerate(list(variant['paths'].items())[:4]):
    d.line([P(x, z) for x, z in pts], fill=colors[i] + (180,), width=2)

y = 8
d.rectangle([4, 4, 330, 20 + 15 * len(variant['times'])], fill=(0, 0, 0, 170))
d.text((10, y), f"{R['map']}  ·  {variant['name']}", fill=(255, 255, 255), font=font)
for k, t in variant['times'].items():
    y += 15
    d.text((10, y), f'{k}: {t}{" s" if isinstance(t, (int, float)) else ""}', fill=(220, 220, 220), font=small)
# 10 m scale bar
d.line([W - 20 - 10 * PX, H - 16, W - 20, H - 16], fill=(255, 255, 255), width=3)
d.text((W - 20 - 10 * PX, H - 32), '10 m', fill=(255, 255, 255), font=small)
img.save(dst)
print('wrote', dst, img.size)
