// CPU-side geometry builder producing interleaved vertices for GLUtil.createMesh.
// Layout per vertex: position(3) normal(3) uv(2) color(4).

import { VERTEX_FLOATS } from './GLUtil.js';
import { transformPoint, transformDir } from './Mat4.js';
const tp = [0, 0, 0];
const tn = [0, 0, 0];

export class MeshBuilder {
  constructor(initial = 1024) {
    this.v = new Float32Array(initial * VERTEX_FLOATS);
    this.i = new Uint32Array(initial * 2);
    this.vc = 0;
    this.ic = 0;
    this.matrix = null; // optional transform applied to subsequent geometry
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  ensure(nv, ni) {
    if ((this.vc + nv) * VERTEX_FLOATS > this.v.length) {
      const n = new Float32Array(Math.max(this.v.length * 2, (this.vc + nv) * VERTEX_FLOATS));
      n.set(this.v);
      this.v = n;
    }
    if (this.ic + ni > this.i.length) {
      const n = new Uint32Array(Math.max(this.i.length * 2, this.ic + ni));
      n.set(this.i);
      this.i = n;
    }
  }

  vertex(x, y, z, nx, ny, nz, u, v, r, g, b, a) {
    if (this.matrix) {
      transformPoint(this.matrix, x, y, z, tp);
      transformDir(this.matrix, nx, ny, nz, tn);
      const l = Math.hypot(tn[0], tn[1], tn[2]) || 1;
      x = tp[0]; y = tp[1]; z = tp[2];
      nx = tn[0] / l; ny = tn[1] / l; nz = tn[2] / l;
    }
    const o = this.vc * VERTEX_FLOATS;
    const d = this.v;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz;
    d[o + 6] = u; d[o + 7] = v;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
    return this.vc++;
  }

  tri(a, b, c) {
    this.i[this.ic++] = a;
    this.i[this.ic++] = b;
    this.i[this.ic++] = c;
  }

  /** Quad from 4 corners (counter-clockwise when viewed from the normal side). */
  quad(p0, p1, p2, p3, n, color, uv = null) {
    this.ensure(4, 6);
    const c = color;
    const a = c[3] === undefined ? 0 : c[3];
    const u = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    const i0 = this.vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], u[0], u[1], c[0], c[1], c[2], a);
    const i1 = this.vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], u[2], u[3], c[0], c[1], c[2], a);
    const i2 = this.vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], u[4], u[5], c[0], c[1], c[2], a);
    const i3 = this.vertex(p3[0], p3[1], p3[2], n[0], n[1], n[2], u[6], u[7], c[0], c[1], c[2], a);
    this.tri(i0, i1, i2);
    this.tri(i0, i2, i3);
  }

  /** Axis-aligned box centred at (cx,cy,cz) with full size (sx,sy,sz). color[3] = emissive weight. */
  box(cx, cy, cz, sx, sy, sz, color) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], color);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color);
  }

  /** Cylinder along Z from z0 to z1. */
  cylinderZ(cx, cy, z0, z1, radius, segments, color, cap = true) {
    const a = color[3] || 0;
    this.ensure(segments * 4 + 4, segments * 12);
    for (let s = 0; s < segments; s++) {
      const t0 = (s / segments) * Math.PI * 2;
      const t1 = ((s + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const i0 = this.vertex(cx + c0 * radius, cy + s0 * radius, z0, c0, s0, 0, 0, 0, color[0], color[1], color[2], a);
      const i1 = this.vertex(cx + c1 * radius, cy + s1 * radius, z0, c1, s1, 0, 1, 0, color[0], color[1], color[2], a);
      const i2 = this.vertex(cx + c1 * radius, cy + s1 * radius, z1, c1, s1, 0, 1, 1, color[0], color[1], color[2], a);
      const i3 = this.vertex(cx + c0 * radius, cy + s0 * radius, z1, c0, s0, 0, 0, 1, color[0], color[1], color[2], a);
      this.tri(i0, i2, i1);
      this.tri(i0, i3, i2);
      if (cap) {
        const zc = Math.min(z0, z1);
        const k0 = this.vertex(cx, cy, zc, 0, 0, -1, 0, 0, color[0], color[1], color[2], a);
        const k1 = this.vertex(cx + c0 * radius, cy + s0 * radius, zc, 0, 0, -1, 0, 0, color[0], color[1], color[2], a);
        const k2 = this.vertex(cx + c1 * radius, cy + s1 * radius, zc, 0, 0, -1, 0, 0, color[0], color[1], color[2], a);
        this.tri(k0, k2, k1);
      }
    }
  }

  vertices() {
    return this.v.subarray(0, this.vc * VERTEX_FLOATS);
  }

  indices() {
    return this.i.subarray(0, this.ic);
  }

  bounds() {
    return { min: this.min.slice(), max: this.max.slice() };
  }
}
