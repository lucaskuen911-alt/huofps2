"""Stylized world surface textures -> assets/textures/<surface>.webp (+ art/previews/world_textures.png)

Run: python3 art/world_textures.py
The engine uses these instead of its procedural fallbacks (src/render/Textures.js) for any
surface id that has a file. Brush tints (data/surfaces.js, map data) multiply them.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import stylized as S  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets', 'textures')
os.makedirs(OUT, exist_ok=True)
tiles = []
for name, fn in S.WORLD.items():
    a = fn()
    img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    path = os.path.join(OUT, f'{name}.webp')
    img.save(path, 'WEBP', quality=86, method=6)
    tiles.append((name, img))
    print(f'{name:12s} {img.size} {os.path.getsize(path) / 1024:.0f} KB')
cols = 5
cell = 200
sheet = Image.new('RGB', (cols * cell, ((len(tiles) + cols - 1) // cols) * (cell + 18)), (20, 22, 26))
d = ImageDraw.Draw(sheet)
for i, (name, img) in enumerate(tiles):
    x, y = (i % cols) * cell, (i // cols) * (cell + 18)
    t = img.resize((cell // 2, cell // 2))
    for dx in (0, 1):
        for dy in (0, 1):
            sheet.paste(t, (x + dx * cell // 2, y + dy * cell // 2))
    d.text((x + 4, y + cell + 2), name, fill=(230, 230, 230))
sheet.save(os.path.join(ROOT, 'art', 'previews', 'world_textures.png'))
