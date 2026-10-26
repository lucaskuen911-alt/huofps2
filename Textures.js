// Procedural texture assets. Generated once at load into canvases and uploaded as sRGB
// mipmapped textures. In a production pipeline these are authored files; the IDs used here
// (tile, plaster, concrete, metal, wood, range) match data/surfaces.js `texture` keys.

import { makeRng } from '../core/Rng.js';
import { SURFACE_IDS } from '../data/surfaces.js';
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Tileable value noise in [0,1]. */
function noiseField(size, cells, seed) {
  const rng = makeRng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(size, seed, octaves = [[4, 0.5], [16, 0.3], [64, 0.2]]) {
  const out = new Float32Array(size * size);
  octaves.forEach(([cells, amp], k) => {
    const n = noiseField(size, cells, seed + k * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
  });
  return out;
}

/** Fill a canvas from a per-pixel shader function returning [r,g,b] in 0..255 sRGB. */
function paint(size, fn) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x, y);
      const o = (y * size + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const S = 256;

export function buildSurfaceTextures() {
  const n1 = fbm(S, 11);
  const n2 = fbm(S, 23, [[8, 0.6], [32, 0.4]]);
  const speck = noiseField(S, 128, 77);

  const tile = paint(S, (x, y) => {
    // 2 m texture span, 1 m tiles, 4 px grout.
    const gx = x % 128, gy = y % 128;
    const grout = gx < 3 || gy < 3;
    const tileId = (x >> 7) + (y >> 7) * 2;
    const tone = 0.92 + ((tileId * 37) % 7) * 0.018;
    const v = (0.84 + n1[y * S + x] * 0.22 - (speck[y * S + x] > 0.93 ? 0.12 : 0)) * tone;
    const k = grout ? 0.62 : v;
    return [235 * k, 228 * k, 214 * k];
  });

  const plaster = paint(S, (x, y) => {
    const v = 0.86 + n1[y * S + x] * 0.16 + Math.sin(y * 0.09 + n2[y * S + x] * 6) * 0.015;
    const seam = x < 2 ? 0.78 : 1;
    const k = v * seam;
    return [246 * k, 240 * k, 236 * k];
  });

  const concrete = paint(S, (x, y) => {
    let v = 0.8 + n1[y * S + x] * 0.24 + (speck[y * S + x] > 0.9 ? -0.08 : 0);
    if (y % 128 < 2 || x < 2) v *= 0.75; // formwork seams
    // Tie holes on the formwork grid
    for (const [hx, hy] of [[32, 32], [96, 32], [32, 96], [96, 96]]) {
      const dx = (x % 128) - hx, dy = (y % 128) - hy;
      const d = dx * dx + dy * dy;
      if (d < 20) v *= 0.45;
      else if (d < 40) v *= 0.85;
    }
    return [232 * v, 232 * v, 230 * v];
  });

  const metal = paint(S, (x, y) => {
    const rib = 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 2 * 16);
    const streak = n2[(y * S + x) % (S * S)] * 0.18;
    const v = 0.72 + rib * 0.26 - streak + (speck[y * S + x] > 0.96 ? 0.1 : 0);
    const edge = y < 3 || y > S - 4 ? 0.7 : 1;
    const k = v * edge;
    return [240 * k, 244 * k, 244 * k];
  });

  const wood = paint(S, (x, y) => {
    const border = x < 18 || x > S - 19 || y < 18 || y > S - 19;
    const brace = Math.abs(x - y) < 12 || Math.abs(x - (S - y)) < 12;
    const plank = Math.floor(y / 40);
    const grain = Math.sin(x * 0.05 + n2[y * S + x] * 8 + plank * 3) * 0.06;
    let v = 0.82 + grain + n1[y * S + x] * 0.12 + (plank % 2) * 0.04;
    if (!border && y % 40 < 2) v *= 0.6;
    if (border || brace) v = 0.95 + grain + n1[y * S + x] * 0.06;
    if (border && (x < 2 || y < 2 || x > S - 3 || y > S - 3)) v *= 0.55;
    return [240 * v, 232 * v, 220 * v];
  });

  // Range wall: 1 m span, 10 cm grid, bold 50 cm lines (matches the in-world signage).
  const range = paint(S, (x, y) => {
    let v = 0.94 + n1[y * S + x] * 0.06;
    const fine = x % 25.6 < 1.2 || y % 25.6 < 1.2;
    const bold = x % 128 < 2.5 || y % 128 < 2.5;
    if (bold) v *= 0.35;
    else if (fine) v *= 0.75;
    return [246 * v, 244 * v, 240 * v];
  });

  // Quay asphalt: aggregate, patch repairs and hairline cracks.
  const crack = noiseField(S, 24, 91);
  const asphalt = paint(S, (x, y) => {
    const i = y * S + x;
    let v = 0.74 + n1[i] * 0.2 + (speck[i] > 0.86 ? 0.1 : speck[i] < 0.08 ? -0.12 : 0);
    const c = Math.abs(crack[i] - 0.5);
    if (c < 0.006) v *= 0.55;
    const patch = n2[i] > 0.68 ? 0.9 : 1;
    v *= patch;
    return [205 * v, 205 * v, 208 * v];
  });

  // Steel bar grating (catwalks, stair treads): 32 px pitch bearing bars, cross bars, dark gaps.
  const grate = paint(S, (x, y) => {
    const bx = x % 16, by = y % 64;
    const bar = bx < 4;
    const cross = by < 5;
    let v = bar || cross ? 0.9 + n1[y * S + x] * 0.1 : 0.16;
    if (bar && bx === 0) v *= 0.75;
    return [236 * v, 238 * v, 240 * v];
  });

  // Painted structural steel: panel seams every 1 m, rivet rows, chipped paint.
  const steel = paint(S, (x, y) => {
    const i = y * S + x;
    let v = 0.86 + n1[i] * 0.1;
    if (x % 128 < 2 || y % 128 < 2) v *= 0.7;
    const rx = (x % 128) - 6, ry = (y % 32) - 16;
    if ((rx * rx + ry * ry < 5) || (((x % 128) - 122) ** 2 + ry * ry < 5)) v *= 0.72;
    if (speck[i] > 0.965) v *= 0.55;
    const drip = n2[(i + S * 7) % (S * S)] > 0.72 ? 0.9 : 1;
    v *= drip;
    return [242 * v, 242 * v, 244 * v];
  });

  // Harbour water: dark, wind ripples (static: the plane is far below the quay lip).
  const water = paint(S, (x, y) => {
    const i = y * S + x;
    const r = Math.sin(x * 0.11 + n2[i] * 9) * 0.5 + Math.sin(y * 0.07 + n1[i] * 7) * 0.5;
    const v = 0.72 + r * 0.12 + n1[i] * 0.12;
    return [200 * v, 225 * v, 228 * v];
  });

  const out = { tile, plaster, concrete, metal, wood, range, asphalt, grate, steel, water };
  // Surfaces without a procedural recipe get a neutral painted fill until an authored texture
  // (assets/textures/<id>.webp) replaces it.
  for (const id of SURFACE_IDS) if (!out[id]) out[id] = paint(64, (x, y) => { const v = 0.86 + n1[(y * 4) * S + x * 4] * 0.1; return [235 * v, 235 * v, 235 * v]; });
  return out;
}

// UV metres per texture repeat for each surface (world-planar mapping).
export const TEXTURE_SPAN = { tile: 2, plaster: 2, concrete: 4, metal: 2, wood: 2, range: 1, asphalt: 6, grate: 1, steel: 2, water: 8, corrugated: 2, paint: 2, hazard: 1, deck: 4, epoxy: 4, shutter: 2, glass: 2, quay: 4 };

/**
 * Decal atlas (multiply-blended, white = no change): 4x4 grid of 128 px cells.
 * 0 chip, 1 scuff, 2 splinter, 3 scorch, 4 hatch stripe, 5 solid paint, 6 ring
 */
export function buildDecalAtlas() {
  const c = canvas(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 512, 512);
  const rng = makeRng(5);
  const cell = (i) => [(i % 4) * 128, Math.floor(i / 4) * 128];

  // 0: bullet chip on stone — dark core, cracked rim.
  {
    const [ox, oy] = cell(0);
    const g = ctx.createRadialGradient(ox + 64, oy + 64, 2, ox + 64, oy + 64, 60);
    g.addColorStop(0, '#1a1714');
    g.addColorStop(0.18, '#3b3530');
    g.addColorStop(0.32, '#9a928a');
    g.addColorStop(0.6, '#e6e1dc');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 128, 128);
    ctx.strokeStyle = 'rgba(60,52,46,0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(ox + 64 + Math.cos(a) * 12, oy + 64 + Math.sin(a) * 12);
      ctx.lineTo(ox + 64 + Math.cos(a + 0.2) * (30 + rng() * 22), oy + 64 + Math.sin(a + 0.2) * (30 + rng() * 22));
      ctx.stroke();
    }
  }
  // 1: metal scuff — tight dark hole with bright-ish ring (still multiply ≤ 1)
  {
    const [ox, oy] = cell(1);
    const g = ctx.createRadialGradient(ox + 64, oy + 64, 1, ox + 64, oy + 64, 46);
    g.addColorStop(0, '#0d0d0d');
    g.addColorStop(0.2, '#2a2a2a');
    g.addColorStop(0.28, '#d8d8d8');
    g.addColorStop(0.45, '#9c9c9c');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 128, 128);
  }
  // 2: wood splinter
  {
    const [ox, oy] = cell(2);
    const g = ctx.createRadialGradient(ox + 64, oy + 64, 2, ox + 64, oy + 64, 50);
    g.addColorStop(0, '#1d120a');
    g.addColorStop(0.25, '#5a3a20');
    g.addColorStop(0.5, '#d9c4ad');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 128, 128);
    ctx.strokeStyle = 'rgba(70,40,15,0.75)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const y = oy + 50 + rng() * 28;
      ctx.beginPath();
      ctx.moveTo(ox + 64, y);
      ctx.lineTo(ox + 20 + rng() * 90, y + (rng() - 0.5) * 10);
      ctx.stroke();
    }
  }
  // 3: scorch
  {
    const [ox, oy] = cell(3);
    const g = ctx.createRadialGradient(ox + 64, oy + 64, 4, ox + 64, oy + 64, 64);
    g.addColorStop(0, '#2d2a28');
    g.addColorStop(0.5, '#8c8781');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 128, 128);
  }
  // 4: hatch stripe for plant-zone borders (site paint)
  {
    const [ox, oy] = cell(4);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, 128, 128);
    ctx.clip();
    ctx.fillStyle = '#e9a28c';
    ctx.fillRect(ox, oy, 128, 128);
    ctx.fillStyle = '#c4422a';
    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(ox + i, oy);
      ctx.lineTo(ox + i + 16, oy);
      ctx.lineTo(ox + i + 16 + 128, oy + 128);
      ctx.lineTo(ox + i + 128, oy + 128);
      ctx.fill();
    }
    ctx.restore();
  }
  // 5: solid paint (tinted by vertex colour)
  {
    const [ox, oy] = cell(5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, 128, 128);
  }
  // 6: ring (ability impact)
  {
    const [ox, oy] = cell(6);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(ox + 64, oy + 64, 50, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

export function decalUV(index) {
  const u0 = (index % 4) * 0.25, v0 = Math.floor(index / 4) * 0.25;
  const e = 0.004;
  return [u0 + e, v0 + 0.25 - e, u0 + 0.25 - e, v0 + 0.25 - e, u0 + 0.25 - e, v0 + e, u0 + e, v0 + e];
}

/**
 * FX atlas (additive / alpha sprites), 2x2 cells of 128 px, alpha in the A channel:
 * 0 soft glow, 1 smoke puff, 2 spark streak, 3 muzzle star
 */
export function buildFxAtlas() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  // 0 glow
  {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  // 1 smoke puff: lumpy noise disc
  {
    const n = noiseField(128, 8, 9);
    const img = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = (x - 64) / 64, dy = (y - 64) / 64;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = Math.max(0, 1 - d) * (0.55 + n[y * 128 + x] * 0.6);
        const o = (y * 128 + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = Math.min(255, a * a * 255 * 1.6);
      }
    }
    ctx.putImageData(img, 128, 0);
  }
  // 2 spark streak
  {
    const g = ctx.createLinearGradient(0, 128, 0, 256);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(48, 128, 32, 128);
  }
  // 3 muzzle star
  {
    ctx.save();
    ctx.translate(192, 192);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(62, 0);
      ctx.lineTo(0, 8);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return c;
}

export function fxUV(index) {
  const u0 = (index % 2) * 0.5, v0 = Math.floor(index / 2) * 0.5;
  return [u0, v0, u0 + 0.5, v0 + 0.5];
}

/** Text atlas for signage and elevation markers (multiply-blended: white background). */
export function buildTextAtlas(entries) {
  const W = 1024, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const rects = [];
  let x = 0, y = 0, rowH = 0;
  for (const e of entries) {
    const fontPx = e.big ? 220 : 64;
    ctx.font = `800 ${fontPx}px "Big Shoulders Display", "Arial Narrow", Impact, sans-serif`;
    const w = Math.ceil(ctx.measureText(e.text).width) + 24;
    const h = Math.ceil(fontPx * 1.15);
    if (x + w > W) {
      x = 0;
      y += rowH + 8;
      rowH = 0;
    }
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'middle';
    ctx.fillText(e.text, x + 12, y + h / 2 + fontPx * 0.04);
    rects.push({ u0: x / W, v0: y / H, u1: (x + w) / W, v1: (y + h) / H, aspect: w / h });
    x += w + 8;
    rowH = Math.max(rowH, h);
  }
  return { canvas: c, rects };
}
