// PROP KIT: render-only environment models, baked with the level.
//
// Brushes carry collision and the big surfaces; props add the hardware that makes a blockout
// read as a place: stair treads, railings, container doors and castings, gantry cranes, light
// fixtures, pipes, bollards, fenders, cable runs, the accelerator ring and blast-door frames.
// Props never collide (map data adds clip brushes where needed) and bake with fewer rays.
//
// Each prop type is a function (desc, pb). `pb.use(surface, tint, glow, group)` hands out a
// MeshBuilder for one material, so every MeshBuilder primitive (bevel boxes, cylinders,
// extrusions) is available here. Coordinates are world metres.

import { MeshBuilder } from './gl/MeshBuilder.js';
import { compose, mat4 } from './gl/Mat4.js';
import { SURFACES, SURFACE_IDS } from '../data/surfaces.js';

const W = [1, 1, 1];

export class PropBatch {
  constructor() {
    this.map = new Map();
  }
  use(surface, tint = null, glow = 0, group = null) {
    const t = tint || SURFACES[surface].tint;
    const key = `${surface}|${t.map((x) => x.toFixed(3)).join(',')}|${glow}|${group || ''}`;
    let e = this.map.get(key);
    if (!e) {
      e = { surface, tint: t, glow, group, b: new MeshBuilder(512) };
      this.map.set(key, e);
    }
    return e.b;
  }
  entries() {
    return this.map.values();
  }
}

/** Run `fn` with builder `b` transformed to (x, y, z) rotated by yaw. */
function at(b, x, y, z, yaw, fn) {
  const prev = b.matrix;
  b.matrix = compose(mat4(), x, y, z, 0, yaw, 0);
  fn();
  b.matrix = prev;
}

/** Box spanning two points (a thick line segment) with square-ish cross-section w x h. */
function beam(b, p, q, w, h) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const f = [dx / len, dy / len, dz / len];
  const ref = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let r = [ref[1] * f[2] - ref[2] * f[1], ref[2] * f[0] - ref[0] * f[2], ref[0] * f[1] - ref[1] * f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const m = mat4();
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
  m[4] = u[0]; m[5] = u[1]; m[6] = u[2];
  m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
  m[12] = (p[0] + q[0]) / 2; m[13] = (p[1] + q[1]) / 2; m[14] = (p[2] + q[2]) / 2;
  const prev = b.matrix;
  b.matrix = m;
  b.box(0, 0, 0, w, h, len, W);
  b.matrix = prev;
}

/** Open lattice girder between two points: 4 chords + zig-zag diagonals. */
function lattice(b, p, q, w, h, bay, chord = 0.12, web = 0.06) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const len = Math.hypot(dx, dy, dz);
  const f = [dx / len, dy / len, dz / len];
  const ref = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let r = [ref[1] * f[2] - ref[2] * f[1], ref[2] * f[0] - ref[0] * f[2], ref[0] * f[1] - ref[1] * f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const P = (t, sr, su) => [p[0] + dx * t + r[0] * sr * w / 2 + u[0] * su * h / 2, p[1] + dy * t + r[1] * sr * w / 2 + u[1] * su * h / 2, p[2] + dz * t + r[2] * sr * w / 2 + u[2] * su * h / 2];
  for (const [sr, su] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) beam(b, P(0, sr, su), P(1, sr, su), chord, chord);
  const n = Math.max(1, Math.round(len / bay));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const zig = i % 2 === 0;
    for (const [s0, s1] of [[[1, 1], [1, -1]], [[-1, 1], [-1, -1]], [[1, 1], [-1, 1]], [[1, -1], [-1, -1]]]) {
      beam(b, P(zig ? t0 : t1, s0[0], s0[1]), P(zig ? t1 : t0, s1[0], s1[1]), web, web);
    }
    beam(b, P(t0, 1, 1), P(t0, 1, -1), web, web);
    beam(b, P(t0, -1, 1), P(t0, -1, -1), web, web);
  }
}

// ------------------------------------------------------------------ brush-attached detail

export function brushDetail(br, pb) {
  if (br.stairs) stairsDetail(br, pb);
  if (br.prop === 'container') containerDetail(br, pb);
  if (br.prop === 'crate') crateDetail(br, pb);
}

/** Treads and risers over a stair ramp brush (collision stays the smooth ramp). */
function stairsDetail(br, pb) {
  const surf = SURFACE_IDS[br.topSurface];
  const b = pb.use(surf, br.topTint || br.tint, 0, br.group);
  const n = br.stairs;
  const along = Math.abs(br.gx) > Math.abs(br.gz) ? 'x' : 'z';
  const g = along === 'x' ? br.gx : br.gz;
  const lo0 = along === 'x' ? br.minX : br.minZ, hi0 = along === 'x' ? br.maxX : br.maxZ;
  const run = hi0 - lo0;
  const yAt = (s) => br.c + g * s + (along === 'x' ? br.gz * br.minZ : br.gx * br.minX);
  const yStart = Math.min(yAt(lo0), yAt(hi0)), yEnd = Math.max(yAt(lo0), yAt(hi0));
  const rise = (yEnd - yStart) / n;
  const asc = g > 0; // height grows with the coordinate
  for (let i = 0; i < n; i++) {
    const s0 = lo0 + (run * i) / n, s1 = lo0 + (run * (i + 1)) / n;
    const k = asc ? i : n - 1 - i;
    const h = yStart + rise * (k + 0.5) + rise * 0.5;
    const top = h, bot = br.y0;
    if (along === 'x') b.box((s0 + s1) / 2, (top + bot) / 2, (br.minZ + br.maxZ) / 2, s1 - s0, top - bot, br.maxZ - br.minZ, W);
    else b.box((br.minX + br.maxX) / 2, (top + bot) / 2, (s0 + s1) / 2, br.maxX - br.minX, top - bot, s1 - s0, W);
  }
  // Nosing strips in hazard yellow.
  const nose = pb.use('hazard', null, 0, br.group);
  for (let i = 0; i < n; i++) {
    const k = asc ? i : n - 1 - i;
    const h = yStart + rise * (k + 1);
    const edge = asc ? lo0 + (run * i) / n : lo0 + (run * (i + 1)) / n;
    if (along === 'x') nose.box(edge + (asc ? 0.04 : -0.04), h + 0.004, (br.minZ + br.maxZ) / 2, 0.08, 0.01, br.maxZ - br.minZ - 0.04, W);
    else nose.box((br.minX + br.maxX) / 2, h + 0.004, edge + (asc ? 0.04 : -0.04), br.maxX - br.minX - 0.04, 0.01, 0.08, W);
  }
}

/** Local frame of a 4-sided brush: centre, long axis u (len), short axis w (wid). */
function frameOf(br) {
  const P = br.poly;
  const e0 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
  const e1 = [P[2][0] - P[1][0], P[2][1] - P[1][1]];
  const l0 = Math.hypot(e0[0], e0[1]), l1 = Math.hypot(e1[0], e1[1]);
  const long = l0 >= l1 ? e0 : e1, ll = Math.max(l0, l1), ws = Math.min(l0, l1);
  const cx = (P[0][0] + P[2][0]) / 2, cz = (P[0][1] + P[2][1]) / 2;
  const yaw = Math.atan2(long[0], long[1]); // local +Z along the long axis
  return { cx, cz, len: ll, wid: ws, yaw };
}

/** ISO container hardware: corner posts, rails, castings, door bars with cams, hinges. */
function containerDetail(br, pb) {
  const f = frameOf(br);
  const tint = br.tint || [0.6, 0.2, 0.15];
  const dark = tint.map((c) => c * 0.55);
  const b = pb.use('paint', dark, 0, br.group);
  const steel = pb.use('steel', [0.22, 0.22, 0.23], 0, br.group);
  const y0 = br.y0, y1 = br.c, h = y1 - y0;
  const hl = f.len / 2, hw = f.wid / 2;
  const doorsAtPlus = br.doors !== 'minus';
  at(b, f.cx, y0, f.cz, f.yaw, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bevelBox(sx * (hw - 0.06), h / 2, sz * (hl - 0.06), 0.15, h, 0.15, 0.015, W);
    for (const sx of [-1, 1]) {
      b.box(sx * (hw + 0.01), h - 0.07, 0, 0.05, 0.14, f.len - 0.25, W);
      b.box(sx * (hw + 0.01), 0.08, 0, 0.05, 0.16, f.len - 0.25, W);
    }
    for (const sz of [-1, 1]) {
      b.box(0, h - 0.08, sz * (hl + 0.005), f.wid - 0.25, 0.16, 0.06, W);
      b.box(0, 0.1, sz * (hl + 0.005), f.wid - 0.25, 0.2, 0.06, W);
    }
  });
  at(steel, f.cx, y0, f.cz, f.yaw, () => {
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) steel.box(sx * (hw - 0.05), sy ? h - 0.07 : 0.07, sz * (hl - 0.05), 0.18, 0.14, 0.18, W);
    const dz = (doorsAtPlus ? 1 : -1) * (hl + 0.04);
    // Door seam, four locking bars with cam keepers and handles.
    steel.box(0, h / 2, dz, 0.03, h - 0.35, 0.02, W);
    for (const bx of [-0.82, -0.36, 0.36, 0.82].map((v) => v * (hw / 1.22))) {
      steel.cylinder([bx, 0.18, dz + Math.sign(dz) * 0.04], [bx, h - 0.18, dz + Math.sign(dz) * 0.04], 0.022, 6, W, true, true);
      for (const yy of [0.22, h - 0.22]) steel.box(bx, yy, dz + Math.sign(dz) * 0.03, 0.08, 0.1, 0.05, W);
      steel.box(bx + 0.08, 1.05, dz + Math.sign(dz) * 0.08, 0.18, 0.05, 0.04, W);
    }
    for (const sx of [-1, 1]) for (const yy of [0.5, 1.3, 2.1].map((v) => v * (h / 2.59))) steel.box(sx * (hw - 0.02), yy, dz + Math.sign(dz) * 0.03, 0.08, 0.14, 0.06, W);
  });
}

/** Wooden crate trims: frame boards on every face edge. */
function crateDetail(br, pb) {
  const f = frameOf(br);
  const b = pb.use('wood', (br.tint || [0.62, 0.35, 0.13]).map((c) => c * 0.8), 0, br.group);
  const h = br.c - br.y0;
  at(b, f.cx, br.y0, f.cz, f.yaw, () => {
    const t = 0.06;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (f.wid / 2 - t / 2 + 0.01), h / 2, sz * (f.len / 2 - t / 2 + 0.01), t, h + 0.01, t, W);
    for (const yy of [t / 2, h - t / 2]) {
      for (const sx of [-1, 1]) b.box(sx * (f.wid / 2 + 0.005), yy, 0, t / 2, t, f.len, W);
      for (const sz of [-1, 1]) b.box(0, yy, sz * (f.len / 2 + 0.005), f.wid, t, t / 2, W);
    }
  });
}

// ------------------------------------------------------------------ standalone props

export function buildProps(map, pb) {
  for (const p of map.props) {
    const fn = PROPS[p.type];
    if (!fn) throw new Error(`Unknown prop type '${p.type}'`);
    fn(p, pb);
  }
  for (const L of map.lights) if (L.fixture) FIXTURES[L.fixture](L, pb);
}

const PROPS = {
  /** Posts + top rail + mid rail along a polyline at height y. */
  railing(p, pb) {
    const b = pb.use(p.surface || 'paint', p.tint || [0.85, 0.62, 0.12]);
    const h = p.h || 1.05, step = p.post || 1.5;
    const pts = p.path;
    const segs = p.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const ya = Array.isArray(p.y) ? p.y[i] : p.y, yc = Array.isArray(p.y) ? p.y[(i + 1) % pts.length] : p.y;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) {
        if (k === n && i < segs - 1) continue;
        const t = k / n;
        const x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t, y = ya + (yc - ya) * t;
        b.cylinder([x, y, z], [x, y + h, z], 0.03, 6, W, false, true);
      }
      b.cylinder([a[0], ya + h, a[1]], [c[0], yc + h, c[1]], 0.032, 6, W, true, true);
      b.cylinder([a[0], ya + h * 0.5, a[1]], [c[0], yc + h * 0.5, c[1]], 0.022, 6, W, true, true);
      if (p.kick !== false) beam(b, [a[0], ya + 0.06, a[1]], [c[0], yc + 0.06, c[1]], 0.012, 0.12);
    }
  },

  /** Rubber-tyred gantry crane straddling a container block (legs come from brushes). */
  rtg(p, pb) {
    const b = pb.use('paint', p.tint || [0.92, 0.64, 0.12]);
    const dark = pb.use('steel', [0.18, 0.18, 0.2]);
    const { x0, x1, z0, z1, h } = p;
    const cx = (x0 + x1) / 2;
    for (const z of [z0, z1]) {
      b.bevelBox(cx, h - 0.6, z, x1 - x0 + 1.6, 1.2, 1.3, 0.08, W);
      b.box(cx, h + 0.15, z, x1 - x0 + 1.2, 0.3, 0.9, W);
    }
    for (const x of [x0, x1]) {
      b.bevelBox(x, h - 0.4, (z0 + z1) / 2, 1.4, 0.8, z1 - z0 + 1.4, 0.06, W);
      beam(b, [x, 1.2, z0], [x, h - 1.2, (z0 + z1) / 2], 0.35, 0.35);
      beam(b, [x, 1.2, z1], [x, h - 1.2, (z0 + z1) / 2], 0.35, 0.35);
      for (const z of [z0, z1]) {
        dark.box(x, 0.55, z - 0.9, 0.7, 1.1, 0.5, W);
        dark.box(x, 0.55, z + 0.9, 0.7, 1.1, 0.5, W);
        b.box(x, 1.2, z, 1.2, 0.5, 2.6, W);
      }
    }
    // Trolley, cab and hoist.
    const tx = p.trolley ?? cx;
    b.bevelBox(tx, h + 0.7, (z0 + z1) / 2, 3.2, 1.1, z1 - z0 - 1, 0.06, W);
    const cab = pb.use('glass', [0.25, 0.4, 0.45]);
    b.bevelBox(tx + 1.6, h - 1.4, z0 + 1.6, 1.8, 2.0, 2.0, 0.08, W);
    cab.box(tx + 1.6, h - 1.2, z0 + 0.58, 1.6, 1.0, 0.04, W);
    for (const s of [-1, 1]) dark.cylinder([tx + s * 0.8, h + 0.2, (z0 + z1) / 2], [tx + s * 0.8, p.hookY ?? h - 6, (z0 + z1) / 2], 0.03, 5, W, false, false);
    dark.box(tx, (p.hookY ?? h - 6) - 0.2, (z0 + z1) / 2, 2.6, 0.4, 6.2, W);
  },

  /** Ship-to-shore quay crane: portal + boom out over the water (legs are brushes). */
  stsCrane(p, pb) {
    const b = pb.use('paint', p.tint || [0.15, 0.36, 0.58]);
    const w = pb.use('paint', [0.88, 0.88, 0.86]);
    const dark = pb.use('steel', [0.16, 0.16, 0.18]);
    const { x0, x1, zFront, zBack, h } = p;
    // Portal beams and sill beams.
    for (const z of [zFront, zBack]) b.bevelBox((x0 + x1) / 2, h, z, x1 - x0 + 1.8, 1.6, 1.8, 0.1, W);
    for (const x of [x0, x1]) {
      b.bevelBox(x, h, (zFront + zBack) / 2, 1.8, 1.6, zBack - zFront + 1.8, 0.1, W);
      b.bevelBox(x, 7.5, (zFront + zBack) / 2, 1.2, 1.0, zBack - zFront, 0.08, W);
      beam(b, [x, 8, zFront], [x, h - 0.8, zBack], 0.5, 0.5);
      for (const z of [zFront, zBack]) {
        dark.box(x, 0.6, z, 1.6, 1.2, 3.6, W);
        for (const s of [-1, 1]) dark.cylinder([x - 0.85, 0.45, z + s * 1.1], [x + 0.85, 0.45, z + s * 1.1], 0.42, 10, W);
      }
    }
    // Boom: lattice girders out over the ship, backstay to the A-frame.
    const boomY = h + 6, reach = p.reach || 34;
    const zTip = zFront - reach, zTail = zBack + 14;
    for (const x of [x0 + 1.5, x1 - 1.5]) {
      lattice(b, [x, boomY, zTail], [x, boomY, zTip], 1.4, 2.4, 3.2, 0.2, 0.08);
      beam(b, [x, h + 0.8, zFront], [x, boomY + 7, (zFront + zBack) / 2], 0.6, 0.6);
      beam(b, [x, h + 0.8, zBack], [x, boomY + 7, (zFront + zBack) / 2], 0.6, 0.6);
      beam(dark, [x, boomY + 7, (zFront + zBack) / 2], [x, boomY + 1.2, zTip + 6], 0.1, 0.1);
      beam(dark, [x, boomY + 7, (zFront + zBack) / 2], [x, boomY + 1.2, zTail], 0.1, 0.1);
    }
    for (let z = zTail; z > zTip; z -= 6) beam(b, [x0 + 1.5, boomY - 1.2, z], [x1 - 1.5, boomY - 1.2, z], 0.3, 0.3);
    b.bevelBox((x0 + x1) / 2, boomY + 7.2, (zFront + zBack) / 2, x1 - x0 - 1, 0.8, 1.2, 0.06, W);
    // Machinery house, operator cab, trolley.
    w.bevelBox((x0 + x1) / 2, h + 2.4, zBack + 4, x1 - x0 - 2, 3.2, 7, 0.12, W);
    const tz = p.trolleyZ ?? zFront - 10;
    w.bevelBox((x0 + x1) / 2 + 2, boomY - 3.2, tz, 2.4, 2.6, 2.6, 0.1, W);
    pb.use('glass', [0.2, 0.33, 0.38]).box((x0 + x1) / 2 + 2, boomY - 3.0, tz - 1.32, 2.0, 1.4, 0.04, W);
    b.bevelBox((x0 + x1) / 2, boomY - 1.8, tz - 3, x1 - x0 - 4, 0.8, 4, 0.06, W);
    for (const s of [-1, 1]) dark.cylinder([(x0 + x1) / 2 + s, boomY - 2.2, tz - 3], [(x0 + x1) / 2 + s, p.hookY ?? 9, tz - 3], 0.035, 5, W, false, false);
    dark.box((x0 + x1) / 2, (p.hookY ?? 9) - 0.25, tz - 3, 2.4, 0.5, 6.1, W);
  },

  /** Overhead bridge crane inside the warehouse, with an optional hanging load. */
  bridgeCrane(p, pb) {
    const b = pb.use('paint', p.tint || [0.95, 0.68, 0.1]);
    const dark = pb.use('steel', [0.17, 0.17, 0.19]);
    const { x0, x1, z, y } = p;
    for (const s of [-1, 1]) b.bevelBox((x0 + x1) / 2, y, z + s * 0.9, x1 - x0, 1.1, 0.5, 0.04, W);
    for (const x of [x0 + 0.6, x1 - 0.6]) b.bevelBox(x, y + 0.2, z, 1.2, 0.8, 2.8, 0.05, W);
    const hx = p.hoistX ?? (x0 + x1) / 2;
    b.bevelBox(hx, y + 0.9, z, 2.4, 0.9, 2.4, 0.05, W);
    const hookY = p.hookY ?? y - 2;
    for (const s of [-1, 1]) dark.cylinder([hx + s * 0.4, y + 0.5, z], [hx + s * 0.4, hookY + 0.4, z], 0.025, 5, W, false, false);
    dark.box(hx, hookY + 0.2, z, 1.4, 0.4, 0.6, W);
    // Hazard warning stripes on the girder ends.
    const hz = pb.use('hazard');
    for (const x of [x0 + 1.6, x1 - 1.6]) for (const s of [-1, 1]) hz.box(x, y, z + s * 1.17, 1.2, 1.0, 0.02, W);
  },

  /** Steel pipe run with flanges every few metres. */
  pipe(p, pb) {
    const b = pb.use(p.surface || 'paint', p.tint || [0.55, 0.57, 0.58], p.glow || 0);
    const r = p.r || 0.15;
    const pts = p.path;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      b.cylinder(a, c, r, 10, W, false, false);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const n = Math.max(1, Math.floor(len / (p.flange || 4)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const q = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
        const d = [(c[0] - a[0]) / len * 0.04, (c[1] - a[1]) / len * 0.04, (c[2] - a[2]) / len * 0.04];
        b.cylinder([q[0] - d[0], q[1] - d[1], q[2] - d[2]], [q[0] + d[0], q[1] + d[1], q[2] + d[2]], r * 1.35, 10, W, true, true);
      }
    }
  },

  bollard(p, pb) {
    const b = pb.use('paint', p.tint || [0.12, 0.12, 0.13]);
    const [x, y, z] = p.pos;
    b.cylinder([x, y, z], [x, y + 0.45, z], 0.22, 12, W, false, false);
    b.cylinder([x, y + 0.45, z], [x, y + 0.62, z], 0.3, 12, W, true, true);
    b.box(x, y + 0.04, z, 0.7, 0.08, 0.7, W);
  },

  /** Truck-tyre fenders hung on the quay edge facing `n` ([nx, nz]). */
  fenders(p, pb) {
    const b = pb.use('rubber');
    const chain = pb.use('steel', [0.2, 0.18, 0.16]);
    for (const [x, y, z] of p.at) {
      const nx = p.n[0], nz = p.n[1];
      const c = [x + nx * 0.25, y - 0.7, z + nz * 0.25];
      b.tube([c[0] - nx * 0.18, c[1], c[2] - nz * 0.18], [c[0] + nx * 0.18, c[1], c[2] + nz * 0.18], 0.55, 0.3, 12, W);
      chain.cylinder([c[0], c[1] + 0.5, c[2]], [x, y + 0.02, z], 0.02, 4, W, false, false);
    }
  },

  /** Oil drums: clusters of cylinders with rims. */
  barrels(p, pb) {
    const b = pb.use('paint', p.tint || [0.15, 0.32, 0.55]);
    for (const [x, y, z] of p.at) {
      b.cylinder([x, y, z], [x, y + 0.88, z], 0.29, 14, W, false, true);
      for (const yy of [0.02, 0.3, 0.58, 0.86]) b.cylinder([x, y + yy, z], [x, y + yy + 0.03, z], 0.305, 14, W, false, false);
    }
  },

  /** Wooden pallet stacks (render detail on top of a crate brush or free-standing). */
  pallets(p, pb) {
    const b = pb.use('wood', p.tint || [0.55, 0.38, 0.22]);
    for (const [x, y, z, yaw = 0, n = 1] of p.at) {
      at(b, x, y, z, yaw, () => {
        for (let k = 0; k < n; k++) {
          const yy = k * 0.15;
          for (const s of [-0.5, 0, 0.5]) b.box(s, yy + 0.05, 0, 0.1, 0.1, 1.2, W);
          for (const s of [-0.5, -0.25, 0, 0.25, 0.5]) b.box(0, yy + 0.125, s, 1.0, 0.025, 0.14, W);
        }
      });
    }
  },

  /** Vertical ladder (decorative). */
  ladder(p, pb) {
    const b = pb.use('paint', p.tint || [0.85, 0.62, 0.12]);
    const [x, y, z] = p.pos;
    at(b, x, y, z, p.yaw || 0, () => {
      for (const s of [-0.22, 0.22]) b.box(s, p.h / 2, 0, 0.05, p.h, 0.06, W);
      for (let yy = 0.3; yy < p.h; yy += 0.3) b.cylinder([-0.22, yy, 0], [0.22, yy, 0], 0.017, 5, W, false, false);
    });
  },

  /** Hanging cable / power line with sag. */
  cable(p, pb) {
    const b = pb.use('rubber');
    const [a, c] = [p.from, p.to];
    const n = 10, sag = p.sag ?? 0.6;
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const q = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (c[2] - a[2]) * t];
      b.cylinder(prev, q, p.r || 0.025, 4, W, false, false);
      prev = q;
    }
  },

  /** Concrete jersey barrier profile extruded along a segment. */
  jersey(p, pb) {
    const b = pb.use('concrete', p.tint || [0.62, 0.62, 0.6]);
    const stripe = pb.use('hazard');
    const [x0, z0, x1, z1] = p.seg;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.16, 0.3], [0.1, 0.81], [-0.1, 0.81], [-0.16, 0.3], [-0.3, 0.08]];
    // extrudeX runs along local X; turn it so the barrier follows the segment.
    const prev = b.matrix;
    b.matrix = compose(mat4(), (x0 + x1) / 2, p.y || 0, (z0 + z1) / 2, 0, yaw + Math.PI / 2, 0);
    b.extrudeX(prof, -len / 2, len / 2, W);
    b.matrix = prev;
    at(stripe, (x0 + x1) / 2, p.y || 0, (z0 + z1) / 2, yaw, () => {
      for (const s of [-1, 1]) stripe.box(s * 0.135, 0.55, 0, 0.01, 0.12, len * 0.9, W);
    });
  },

  /** Particle accelerator ring: segmented beam pipe, dipole magnets, glowing beam window. */
  acceleratorRing(p, pb) {
    const pipe = pb.use('steel', [0.55, 0.57, 0.6]);
    const mag = pb.use('paint', p.magnet || [0.12, 0.3, 0.7]);
    const coil = pb.use('paint', [0.75, 0.42, 0.12]);
    const glow = pb.use('light', p.glowColor || [0.35, 0.8, 1.0], p.glow ?? 3.5);
    const hanger = pb.use('steel', [0.2, 0.2, 0.22]);
    const n = p.segments || 48;
    const { cx, cz, r, y } = p;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const P0 = [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r];
      const P1 = [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r];
      pipe.cylinder(P0, P1, p.tube || 0.35, 12, W, false, false);
      const am = (a0 + a1) / 2;
      const M = [cx + Math.cos(am) * r, y, cz + Math.sin(am) * r];
      if (i % 2 === 0) {
        // Dipole magnet block straddling the pipe, rotated to the ring tangent.
        const prev = mag.matrix;
        mag.matrix = compose(mat4(), M[0], M[1], M[2], 0, -am, 0);
        mag.bevelBox(0, 0, 0, 1.3, 1.25, 1.6, 0.08, W);
        mag.matrix = prev;
        const pc = coil.matrix;
        coil.matrix = compose(mat4(), M[0], M[1], M[2], 0, -am, 0);
        for (const s of [-1, 1]) coil.bevelBox(0, s * 0.68, 0, 1.0, 0.16, 1.75, 0.04, W);
        coil.matrix = pc;
      } else {
        // Exposed beam window: emissive band.
        const prev = glow.matrix;
        glow.matrix = compose(mat4(), M[0], M[1], M[2], 0, -am, 0);
        glow.box(0, 0, 0, (p.tube || 0.35) * 2.15, 0.12, 0.9, W);
        glow.matrix = prev;
      }
      if (p.hangTo && i % 4 === 0) {
        hanger.cylinder([M[0], y + 0.6, M[2]], [M[0], p.hangTo, M[2]], 0.06, 6, W, false, false);
      }
    }
  },

  /** Heavy blast door: two thick leaves slid open, frame, hazard edges, piston rams. */
  blastDoor(p, pb) {
    const frame = pb.use('steel', [0.3, 0.31, 0.33]);
    const leaf = pb.use('panel', [0.42, 0.44, 0.46]);
    const hz = pb.use('hazard');
    const lamp = pb.use('light', p.lamp || [1.0, 0.25, 0.1], 3);
    const { x, z, yaw, w, h, open } = p;
    at(frame, x, p.y || 0, z, yaw, () => {
      for (const s of [-1, 1]) frame.bevelBox(s * (w / 2 + 0.35), h / 2, 0, 0.7, h, 1.4, 0.06, W);
      frame.bevelBox(0, h + 0.4, 0, w + 1.4, 0.8, 1.4, 0.06, W);
    });
    // Leaves recessed into the walls by `open` metres each side.
    at(leaf, x, p.y || 0, z, yaw, () => {
      for (const s of [-1, 1]) leaf.bevelBox(s * (w / 4 + open), h / 2, -0.85, w / 2, h - 0.1, 0.5, 0.05, W);
    });
    at(hz, x, p.y || 0, z, yaw, () => {
      for (const s of [-1, 1]) hz.box(s * (open + 0.03), h / 2, -0.85, 0.07, h - 0.2, 0.52, W);
      hz.box(0, 0.01, 0, w, 0.02, 1.2, W);
    });
    at(lamp, x, p.y || 0, z, yaw, () => {
      for (const s of [-1, 1]) lamp.box(s * (w / 2 + 0.35), h + 0.4, 0.72, 0.3, 0.3, 0.06, W);
    });
  },

  /** Wall-mounted extract fan housing (visual only). */
  fan(p, pb) {
    const b = pb.use('steel', [0.3, 0.31, 0.33]);
    const [x, y, z] = p.pos;
    const n = p.n; // facing [nx, nz]
    const c = [x + n[0] * 0.15, y, z + n[1] * 0.15];
    b.tube([x, y, z], [c[0], y, c[2]], p.r || 0.8, (p.r || 0.8) - 0.08, 20, W);
    const blades = pb.use('steel', [0.15, 0.15, 0.16]);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tx = -n[1], tz = n[0];
      const d = [Math.cos(a) * tx, Math.sin(a), Math.cos(a) * tz];
      beam(blades, [c[0] - n[0] * 0.05, y, c[2] - n[1] * 0.05], [c[0] - n[0] * 0.05 + d[0] * (p.r || 0.8) * 0.9, y + d[1] * (p.r || 0.8) * 0.9, c[2] - n[1] * 0.05 + d[2] * (p.r || 0.8) * 0.9], 0.18, 0.02);
    }
  },

  /** Cable tray along a polyline (ceiling services). */
  tray(p, pb) {
    const b = pb.use('steel', [0.4, 0.42, 0.44]);
    const cab = pb.use('rubber', [0.12, 0.12, 0.13]);
    for (let i = 0; i < p.path.length - 1; i++) {
      const a = p.path[i], c = p.path[i + 1];
      beam(b, a, c, 0.6, 0.04);
      beam(cab, [a[0], a[1] + 0.06, a[2]], [c[0], c[1] + 0.06, c[2]], 0.45, 0.08);
    }
  },

  /** Generic structural I-beam between two points. */
  ibeam(p, pb) {
    const b = pb.use(p.surface || 'steel', p.tint || [0.35, 0.36, 0.38]);
    const h = p.h || 0.4, w = p.w || 0.25;
    const [a, c] = [p.from, p.to];
    const up = Math.abs(c[1] - a[1]) > Math.abs(c[0] - a[0]) + Math.abs(c[2] - a[2]);
    if (up) {
      beam(b, a, c, w, h);
      return;
    }
    beam(b, [a[0], a[1] + h / 2 - 0.02, a[2]], [c[0], c[1] + h / 2 - 0.02, c[2]], w, 0.04);
    beam(b, [a[0], a[1] - h / 2 + 0.02, a[2]], [c[0], c[1] - h / 2 + 0.02, c[2]], w, 0.04);
    beam(b, a, c, 0.03, h);
  },

  /** Ship bridge windows / portholes as emissive panes. */
  windows(p, pb) {
    const b = pb.use('glass', p.tint || [0.25, 0.35, 0.4], p.glow || 0);
    for (const [x, y, z, w, h, nx, nz] of p.at) {
      const yaw = Math.atan2(nx, nz);
      at(b, x, y, z, yaw, () => b.box(0, 0, 0.01, w, h, 0.03, W));
    }
  },

  /** Glowing reactor column for The Core's hub. */
  reactor(p, pb) {
    const shell = pb.use('steel', [0.35, 0.37, 0.4]);
    const core = pb.use('light', p.glowColor || [0.3, 0.85, 1.0], p.glow ?? 4.5);
    const rib = pb.use('paint', [0.12, 0.13, 0.15]);
    const { x, z, y0, y1, r } = p;
    core.cylinder([x, y0, z], [x, y1, z], r * 0.62, 20, W, false, false);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      rib.box(x + Math.cos(a) * r * 0.85, (y0 + y1) / 2, z + Math.sin(a) * r * 0.85, 0.22, y1 - y0, 0.22, W);
    }
    for (let y = y0; y <= y1; y += (y1 - y0) / 6) shell.tube([x, y - 0.18, z], [x, y + 0.18, z], r, r * 0.6, 24, W);
    shell.cylinder([x, y1, z], [x, y1 + 0.8, z], r * 1.1, 24, W, true, true);
    shell.cylinder([x, y0 - 0.4, z], [x, y0, z], r * 1.2, 24, W, true, false);
  },
};

// Fixtures auto-placed for baked lights with `fixture` set.
const FIXTURES = {
  /** Floodlight mast for the port. */
  mast(L, pb) {
    const b = pb.use('paint', [0.6, 0.62, 0.64]);
    const lamp = pb.use('light', L.color, 2.5);
    const [x, y, z] = L.pos;
    const base = L.base ?? 0;
    b.cylinder([x, base, z], [x, y - 0.3, z], 0.18, 10, W, true, false, 0.12);
    b.box(x, y - 0.25, z, 2.4, 0.12, 0.2, W);
    for (const s of [-0.8, 0, 0.8]) {
      b.bevelBox(x + s, y, z, 0.6, 0.45, 0.35, 0.03, W);
      lamp.box(x + s, y - 0.08, z + 0.18, 0.5, 0.32, 0.02, W);
    }
  },
  /** High-bay pendant lamp. */
  highbay(L, pb) {
    const b = pb.use('steel', [0.25, 0.26, 0.28]);
    const lamp = pb.use('light', L.color, 3);
    const [x, y, z] = L.pos;
    b.cylinder([x, y + 0.3, z], [x, L.hangFrom ?? y + 2, z], 0.015, 4, W, false, false);
    b.cylinder([x, y, z], [x, y + 0.3, z], 0.42, 14, W, false, true, 0.18);
    lamp.cylinder([x, y - 0.01, z], [x, y + 0.01, z], 0.4, 14, W, true, false);
  },
  /** Linear strip light against a wall or ceiling. */
  strip(L, pb) {
    const b = pb.use('steel', [0.25, 0.26, 0.28]);
    const lamp = pb.use('light', L.color, L.glow ?? 3);
    const [x, y, z] = L.pos;
    const len = L.len || 2;
    const along = L.along || 'x';
    const sx = along === 'x' ? len : 0.16, sz = along === 'z' ? len : 0.16;
    b.box(x, y + 0.05, z, sx + 0.06, 0.08, sz + 0.06, W);
    lamp.box(x, y - 0.01, z, sx, 0.04, sz, W);
  },
  /** Caged bulkhead lamp on a wall facing n. */
  bulkhead(L, pb) {
    const b = pb.use('steel', [0.2, 0.2, 0.22]);
    const lamp = pb.use('light', L.color, 3);
    const [x, y, z] = L.pos;
    const n = L.n || [0, 1];
    b.box(x - n[0] * 0.08, y, z - n[1] * 0.08, n[0] ? 0.06 : 0.36, 0.26, n[1] ? 0.06 : 0.36, W);
    lamp.box(x, y, z, n[0] ? 0.12 : 0.28, 0.18, n[1] ? 0.12 : 0.28, W);
  },
};
