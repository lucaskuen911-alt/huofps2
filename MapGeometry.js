// Builds environment geometry from compiled brushes, chunked for frustum culling and split by
// surface only (one texture per draw). Brush tints travel per vertex (TINTED_FLOATS layout), so
// a chunk's differently painted walls, containers and markings are a single draw call. Every
// vertex carries its baked indirect light (sky + bounce + baked lamps).
//
// Faces are tessellated on a ~2 m grid (indirect light is low-frequency; the sun comes from the
// shadow maps), and every sub-cell whose centre sits inside another opaque brush (OCCLUDE) is
// dropped: touching walls, floors under walls and buried brush bottoms never reach the GPU.
// Brushes in a variant group (crane-moved containers) are excluded; they are drawn as dynamic
// models with probe lighting. Brushes can coarsen their tessellation with `tess` (skyline).

import { MeshBuilder } from './gl/MeshBuilder.js';
import { SURFACES, SURFACE_IDS } from '../data/surfaces.js';
import { TEXTURE_SPAN } from './Textures.js';
import { BF } from '../sim/World.js';
import { VERTEX_FLOATS, TINTED_FLOATS } from './gl/GLUtil.js';
export const CHUNK_SIZE = 32;
const CELL = 2.0; // tessellation / bake spacing on tops and sides (m)
const ROW = 1.5; // vertical spacing on sides

export function buildMapGeometry(map, world, baker, onProgress) {
  const builders = new Map();
  const bakeOut = [0, 0, 0, 0];
  let verts = 0;
  const savedGroups = [...world.groups];
  world.setGroups([]); // bake the static level only

  const builderFor = (x, z, surface) => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}:${surface}`;
    let b = builders.get(key);
    if (!b) {
      b = new MeshBuilder(4096);
      b.surface = surface;
      b.tints = [];
      builders.set(key, b);
    }
    return b;
  };

  const occluded = (br, x, y, z, nx, ny, nz) => world.pointSolid(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, BF.OCCLUDE, br);

  // Emits a bilinear patch p(u, v) with nu x nv cells; cells failing the occlusion test are skipped.
  const patch = (br, surface, tint, glow, nu, nv, pos, nrm, uvOf) => {
    const grid = new Int32Array((nu + 1) * (nv + 1)).fill(-1);
    const c = pos(0.5, 0.5);
    const b = builderFor(c[0], c[2], surface);
    const t = tint || SURFACES[surface].tint;
    const vtx = (i, j) => {
      const k = j * (nu + 1) + i;
      if (grid[k] >= 0) return grid[k];
      const p = pos(i / nu, j / nv);
      const n = nrm(i / nu, j / nv);
      // Inset toward the face centre so bake rays never start exactly on an edge.
      const sx = p[0] + (c[0] - p[0]) * 0.012, sy = p[1] + (c[1] - p[1]) * 0.012, sz = p[2] + (c[2] - p[2]) * 0.012;
      if (glow > 0) { bakeOut[0] = bakeOut[1] = bakeOut[2] = glow; bakeOut[3] = 0; }
      else baker.bake(sx, sy, sz, n[0], n[1], n[2], bakeOut);
      const uv = uvOf(p);
      b.ensure(1, 0);
      grid[k] = b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], bakeOut[0], bakeOut[1], bakeOut[2], bakeOut[3]);
      b.tints.push(t[0], t[1], t[2]);
      verts++;
      return grid[k];
    };
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const q = pos((i + 0.5) / nu, (j + 0.5) / nv);
        const n = nrm((i + 0.5) / nu, (j + 0.5) / nv);
        if (occluded(br, q[0], q[1], q[2], n[0], n[1], n[2])) continue;
        const a = vtx(i, j), bb = vtx(i + 1, j), cc = vtx(i + 1, j + 1), d = vtx(i, j + 1);
        b.ensure(0, 6);
        b.tri(a, bb, cc);
        b.tri(a, cc, d);
      }
    }
  };

  const brushes = map.brushes;
  for (let bi = 0; bi < brushes.length; bi++) {
    const br = brushes[bi];
    if (!(br.flags & BF.RENDER) || br.group) continue;
    const cell = CELL * (br.tess || 1), row = ROW * (br.tess || 1);
    const side = SURFACE_IDS[br.surface];
    const top = SURFACE_IDS[br.topSurface];
    const span = TEXTURE_SPAN[side] / br.uv;
    const tspan = TEXTURE_SPAN[top] / br.uv;
    const hide = br.hide || [];
    const roof = (x, z) => br.c + br.gx * x + br.gz * z;
    const poly = br.poly;
    // Orient polygon counter-clockwise when seen from above (+Y): area sign in XZ.
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b2 = poly[(i + 1) % poly.length];
      area += a[0] * b2[1] - b2[0] * a[1];
    }
    const P = area > 0 ? poly.slice().reverse() : poly;

    // ---- roof (top): fan from vertex 0, each triangle as a degenerate bilinear patch
    if (!hide.includes('top')) {
      const l = Math.hypot(br.gx, 1, br.gz);
      const n = [-br.gx / l, 1 / l, -br.gz / l];
      for (let k = 1; k < P.length - 1; k++) {
        const A = P[0], B = P[k], C = P[k + 1];
        const e = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1]), Math.hypot(C[0] - A[0], C[1] - A[1]), Math.hypot(C[0] - B[0], C[1] - B[1]));
        const nu = Math.max(1, Math.ceil(e / cell));
        // (u, v) -> A + u (B - A) + u v (C - B): a triangle covered by an nu x nu grid.
        const pos = (u, v) => {
          const x = A[0] + u * (B[0] - A[0]) + u * v * (C[0] - B[0]);
          const z = A[1] + u * (B[1] - A[1]) + u * v * (C[1] - B[1]);
          return [x, roof(x, z), z];
        };
        patch(br, top, br.topTint || br.tint, br.glow, nu, nu, pos, () => n, (p) => [p[0] / tspan, p[2] / tspan]);
      }
    }
    // ---- bottom (only when something could see it: overhangs, catwalks, bridges)
    if (!hide.includes('bottom') && br.y0 > map.bounds.minY + 0.05) {
      for (let k = 1; k < P.length - 1; k++) {
        const A = P[0], B = P[k + 1], C = P[k];
        const e = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1]), Math.hypot(C[0] - A[0], C[1] - A[1]));
        const nu = Math.max(1, Math.ceil(e / cell));
        const pos = (u, v) => {
          const x = A[0] + u * (B[0] - A[0]) + u * v * (C[0] - B[0]);
          const z = A[1] + u * (B[1] - A[1]) + u * v * (C[1] - B[1]);
          return [x, br.y0, z];
        };
        patch(br, side, br.tint, br.glow, nu, nu, pos, () => [0, -1, 0], (p) => [p[0] / span, p[2] / span]);
      }
    }
    // ---- sides: one patch per edge from the floor plane to the (possibly sloped) roof
    if (!hide.includes('sides')) {
      for (let k = 0; k < P.length; k++) {
        const A = P[k], B = P[(k + 1) % P.length];
        const dx = B[0] - A[0], dz = B[1] - A[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        // P has negative shoelace area in (x, z), so the outward normal is (-dz, dx) / len.
        const n = [-dz / len, 0, dx / len];
        const hA = roof(A[0], A[1]), hB = roof(B[0], B[1]);
        const hMax = Math.max(hA, hB) - br.y0;
        if (hMax <= 1e-4) continue;
        const nu = Math.max(1, Math.ceil(len / cell));
        const nv = Math.max(1, Math.ceil(hMax / row));
        const pos = (u, v) => {
          const x = A[0] + dx * u, z = A[1] + dz * u;
          const h = hA + (hB - hA) * u;
          return [x, br.y0 + (h - br.y0) * v, z];
        };
        // Texture runs along the edge; v is world height so stacked brushes line up.
        const u0 = A[0] * n[2] - A[1] * n[0];
        patch(br, side, br.tint, br.glow, nu, nv, pos, () => n, (p) => [(u0 + Math.hypot(p[0] - A[0], p[2] - A[1])) / span, -p[1] / span]);
      }
    }
    if (onProgress && bi % 32 === 0) onProgress(bi / brushes.length);
  }
  world.setGroups(savedGroups);

  // Interleave the per-vertex tint: pos3 nrm3 uv2 col4 | tint3.
  const chunks = [];
  for (const b of builders.values()) {
    if (!b.ic) continue;
    const src = b.vertices();
    const n = src.length / VERTEX_FLOATS;
    const out = new Float32Array(n * TINTED_FLOATS);
    for (let k = 0; k < n; k++) {
      out.set(src.subarray(k * VERTEX_FLOATS, (k + 1) * VERTEX_FLOATS), k * TINTED_FLOATS);
      out[k * TINTED_FLOATS + 12] = b.tints[k * 3];
      out[k * TINTED_FLOATS + 13] = b.tints[k * 3 + 1];
      out[k * TINTED_FLOATS + 14] = b.tints[k * 3 + 2];
    }
    chunks.push({ surface: b.surface, floats: TINTED_FLOATS, vertices: out, indices: b.indices().slice(), ...b.bounds() });
  }
  return { chunks, verts, rays: baker.rays };
}
