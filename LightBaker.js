// Offline-style static lighting bake, run once at load.
//
// For every environment vertex we precompute:
//   rgb = indirect irradiance: sky dome visibility + one bounce of sunlight off nearby surfaces
//   a   = sky visibility (0..1), kept for tools and AO-style effects
// Direct sun is NOT baked: it comes from the static + dynamic shadow maps per pixel, so the bake
// only carries soft, low-frequency light and can run on a coarse (~2 m) vertex grid.

import { SURFACES, SURFACE_IDS } from '../data/surfaces.js';
import { BF } from '../sim/World.js';
const LIGHT = BF.LIGHT;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export class LightBaker {
  constructor(map, hf, samples = 10) {
    this.map = map;
    this.hf = hf;
    const env = map.env;
    const d = env.sun.dir;
    const l = Math.hypot(d[0], d[1], d[2]);
    this.sun = [d[0] / l, d[1] / l, d[2] / l];
    this.sunColor = env.sun.color.map((c) => c * env.sun.intensity);
    this.sky = env.sky;
    // Cosine-weighted hemisphere directions in tangent space (z = along normal).
    this.hemi = [];
    for (let i = 0; i < samples; i++) {
      const u = (i + 0.5) / samples;
      const r = Math.sqrt(u);
      const phi = i * GOLDEN;
      this.hemi.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
    }
    // Two jitter offsets around the sun direction for soft penumbrae.
    this.sunRays = [this.sun, this.jitter(this.sun, 0.022, 0), this.jitter(this.sun, 0.022, 2.1)];
    this.albedo = SURFACE_IDS.map((id) => {
      const s = SURFACES[id];
      return s.tint.map((c) => c * s.albedo * 1.35);
    });
    this.rays = 0;
    // Baked point lights (warehouse highbays, office strips): { pos, color, intensity, range }.
    this.lights = (map.lights || []).map((l) => ({ pos: l.pos, color: l.color.map((c) => c * l.intensity), range: l.range || 14 }));
  }

  /** Direct light from the baked point lights at a point (shadowed, windowed inverse square). */
  pointLights(x, y, z, nx, ny, nz, out) {
    for (const L of this.lights) {
      const dx = L.pos[0] - x, dy = L.pos[1] - y, dz = L.pos[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > L.range * L.range) continue;
      const d = Math.sqrt(d2);
      const ndl = nx === undefined ? 1 : (nx * dx + ny * dy + nz * dz) / d;
      if (ndl <= 0) continue;
      const w = 1 - d2 / (L.range * L.range);
      const k = (ndl * w * w) / (1 + d2 * 0.04);
      this.rays++;
      if (this.hf.raycast(x, y, z, dx / d, dy / d, dz / d, d - 0.3, LIGHT)) continue;
      out[0] += L.color[0] * k; out[1] += L.color[1] * k; out[2] += L.color[2] * k;
    }
    return out;
  }

  jitter(d, amount, angle) {
    const t = Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]);
    norm(t);
    const b = cross(d, t);
    const v = [d[0] + (t[0] * Math.cos(angle) + b[0] * Math.sin(angle)) * amount, d[1] + (t[1] * Math.cos(angle) + b[1] * Math.sin(angle)) * amount, d[2] + (t[2] * Math.cos(angle) + b[2] * Math.sin(angle)) * amount];
    return norm(v);
  }

  skyRadiance(dy) {
    const k = Math.pow(Math.max(0, dy), 0.55);
    const s = this.sky;
    const a = s.ambient || 1;
    return [(s.horizon[0] + (s.zenith[0] - s.horizon[0]) * k) * a, (s.horizon[1] + (s.zenith[1] - s.horizon[1]) * k) * a, (s.horizon[2] + (s.zenith[2] - s.horizon[2]) * k) * a];
  }

  sunVisibility(x, y, z) {
    let vis = 0;
    for (const d of this.sunRays) {
      this.rays++;
      if (!this.hf.raycast(x, y, z, d[0], d[1], d[2], 60, LIGHT)) vis++;
    }
    return vis / this.sunRays.length;
  }

  /** Bake one vertex. Returns [r, g, b, sunTerm]. */
  bake(px, py, pz, nx, ny, nz, out) {
    const hf = this.hf;
    const ox = px + nx * 0.04, oy = py + ny * 0.04, oz = pz + nz * 0.04;

    const t = Math.abs(ny) < 0.9 ? cross([nx, ny, nz], [0, 1, 0]) : cross([nx, ny, nz], [1, 0, 0]);
    norm(t);
    const b = cross([nx, ny, nz], t);
    let r = 0, g = 0, bl = 0, open = 0;
    const n = this.hemi.length;
    for (let i = 0; i < n; i++) {
      const h = this.hemi[i];
      const dx = t[0] * h[0] + b[0] * h[1] + nx * h[2];
      const dy = t[1] * h[0] + b[1] * h[1] + ny * h[2];
      const dz = t[2] * h[0] + b[2] * h[1] + nz * h[2];
      this.rays++;
      const hit = hf.raycast(ox, oy, oz, dx, dy, dz, 24, LIGHT);
      if (!hit) {
        const s = this.skyRadiance(dy);
        r += s[0]; g += s[1]; bl += s[2];
        open++;
      } else {
        // One bounce: sunlight + a little sky reflected by the surface we hit.
        const hx = hit.x + hit.nx * 0.04, hy = hit.y + hit.ny * 0.04, hz = hit.z + hit.nz * 0.04;
        const hnx = hit.nx, hny = hit.ny, hnz = hit.nz;
        const alb = this.albedo[hit.surface];
        const hdl = hnx * this.sun[0] + hny * this.sun[1] + hnz * this.sun[2];
        let direct = 0;
        if (hdl > 0) {
          this.rays++;
          direct = hf.raycast(hx, hy, hz, this.sun[0], this.sun[1], this.sun[2], 60, LIGHT) ? 0 : hdl;
        }
        const amb = 0.32 + 0.18 * Math.max(0, hny);
        r += alb[0] * (this.sunColor[0] * direct * 0.32 + this.sky.zenith[0] * amb);
        g += alb[1] * (this.sunColor[1] * direct * 0.32 + this.sky.zenith[1] * amb);
        bl += alb[2] * (this.sunColor[2] * direct * 0.32 + this.sky.zenith[2] * amb);
      }
    }
    out[0] = r / n;
    out[1] = g / n;
    out[2] = bl / n;
    out[3] = open / n;
    if (this.lights.length) this.pointLights(ox, oy, oz, nx, ny, nz, out);
    return out;
  }

  /** Cheap runtime probe for dynamic objects: sun visibility + sky openness at a point. */
  probe(x, y, z, out) {
    out[0] = this.sunVisibility(x, y, z);
    let open = 0;
    const dirs = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];
    for (const d of dirs) if (!this.hf.raycast(x, y, z, d[0], d[1], d[2], 12, LIGHT)) open++;
    out[1] = open / dirs.length;
    // Interiors lit by baked lamps should not leave characters / the viewmodel in the dark.
    if (this.lights.length) {
      const acc = [0, 0, 0];
      this.pointLights(x, y, z, undefined, undefined, undefined, acc);
      out[1] = Math.min(1, out[1] + (acc[0] + acc[1] + acc[2]) * 0.25);
    }
    return out;
  }
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return v;
}
