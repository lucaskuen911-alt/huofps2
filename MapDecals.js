// Static painted decals: plant-zone hatching and letters, wayfinding signs, elevation
// markers with hazard stripes. Built once into two meshes (decal atlas + text atlas).

import { MeshBuilder } from './gl/MeshBuilder.js';
import { decalUV, buildTextAtlas } from './Textures.js';
const HATCH = 4;
const SOLID = 5;
const INK_NONE = [0, 0, 0, 1]; // use the texture's own colours

export function buildMapDecals(map) {
  const paint = new MeshBuilder(512);
  const text = [];

  // ---- plant zones: hatched border + big floor letter + faint fill
  for (const key of Object.keys(map.zones)) {
    const z = map.zones[key];
    const y = (z.floorY || 0) + 0.012;
    const w = 0.32;
    const strips = [
      [z.x0, z.z0, z.x1, z.z0 + w],
      [z.x0, z.z1 - w, z.x1, z.z1],
      [z.x0, z.z0 + w, z.x0 + w, z.z1 - w],
      [z.x1 - w, z.z0 + w, z.x1, z.z1 - w],
    ];
    for (const [ax, az, bx, bz] of strips) {
      const len = Math.max(bx - ax, bz - az);
      const uv = decalUV(HATCH);
      const reps = Math.max(1, Math.round(len / 1.3));
      const along = bx - ax > bz - az;
      for (let k = 0; k < reps; k++) {
        const t0 = k / reps, t1 = (k + 1) / reps;
        const p0 = along ? [ax + (bx - ax) * t0, y, bz] : [ax, y, az + (bz - az) * t1];
        const p1 = along ? [ax + (bx - ax) * t1, y, bz] : [bx, y, az + (bz - az) * t1];
        const p2 = along ? [ax + (bx - ax) * t1, y, az] : [bx, y, az + (bz - az) * t0];
        const p3 = along ? [ax + (bx - ax) * t0, y, az] : [ax, y, az + (bz - az) * t0];
        paint.quad(p0, p1, p2, p3, [0, 1, 0], INK_NONE, uv);
      }
    }
    paint.quad([z.x0 + w, y, z.z1 - w], [z.x1 - w, y, z.z1 - w], [z.x1 - w, y, z.z0 + w], [z.x0 + w, y, z.z0 + w], [0, 1, 0], [0.93, 0.8, 0.74, 0.55], decalUV(SOLID));
    text.push({ text: key, big: true, floor: true, center: [(z.x0 + z.x1) / 2, y + 0.002, (z.z0 + z.z1) / 2], size: Math.min(3.6, (z.x1 - z.x0) * 0.4), color: [0.62, 0.16, 0.08] });
  }

  // ---- painted floor stencils (slot ids, berth numbers), rotated by yaw
  for (const t of map.floorText || []) text.push({ text: t.text, big: t.size > 1.5, floor: true, center: t.pos, size: t.size, color: t.color, yaw: t.yaw || 0 });

  // ---- wall signs
  for (const s of map.signs) text.push({ text: s.text, big: s.size > 1.5, pos: s.pos, normal: s.normal, size: s.size, color: s.color });

  // ---- elevation markers: hazard stripe along the lip + optional "+2.5 m" label
  for (const m of map.elevationMarkers) {
    const n = m.normal;
    const rx = n[2], rz = -n[0];
    const half = (m.width || 2) / 2;
    const top = m.stripeY !== undefined ? m.stripeY : m.pos[1] / 0.55;
    const y0 = top - 0.22, y1 = top - 0.02;
    const [cx, , cz] = m.pos;
    paint.quad([cx - rx * half, y0, cz - rz * half], [cx + rx * half, y0, cz + rz * half], [cx + rx * half, y1, cz + rz * half], [cx - rx * half, y1, cz - rz * half], n, INK_NONE, decalUV(HATCH));
    if (m.text) text.push({ text: m.text, big: false, pos: m.pos, normal: n, size: 0.42, color: [0.08, 0.09, 0.1] });
  }

  // ---- text mesh
  const atlas = buildTextAtlas(text);
  const tb = new MeshBuilder(256);
  text.forEach((t, k) => {
    const r = atlas.rects[k];
    const hgt = t.size;
    const wid = hgt * r.aspect;
    const ink = [t.color[0], t.color[1], t.color[2], 1];
    const uv = [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0];
    if (t.floor) {
      // Lying on the floor, readable when facing north from the attacker side.
      const [x, y, z] = t.center;
      const c = Math.cos(t.yaw || 0), s = Math.sin(t.yaw || 0);
      // Local (u right, v toward the reader) rotated by yaw about +Y.
      const P = (u, v) => [x + u * c + v * s, y, z - u * s + v * c];
      tb.quad(P(-wid / 2, hgt / 2), P(wid / 2, hgt / 2), P(wid / 2, -hgt / 2), P(-wid / 2, -hgt / 2), [0, 1, 0], ink, uv);
    } else {
      const n = t.normal;
      const rx = n[2], rz = -n[0]; // right = up x normal
      const [x, y, z] = t.pos;
      tb.quad(
        [x - rx * wid / 2, y - hgt / 2, z - rz * wid / 2],
        [x + rx * wid / 2, y - hgt / 2, z + rz * wid / 2],
        [x + rx * wid / 2, y + hgt / 2, z + rz * wid / 2],
        [x - rx * wid / 2, y + hgt / 2, z - rz * wid / 2],
        n,
        ink,
        uv,
      );
    }
  });

  return [
    { vertices: paint.vertices().slice(), indices: paint.indices().slice(), textureCanvas: null },
    { vertices: tb.vertices().slice(), indices: tb.indices().slice(), textureCanvas: atlas.canvas },
  ];
}
