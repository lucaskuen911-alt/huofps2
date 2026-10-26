// World-space effects: tracers, surface impacts (decal + particles by surface), hit sparks,
// shell casings, bot muzzle flashes, smokes and recon pulses. All pooled; vertex buffers are
// rebuilt each frame into preallocated arrays (no per-frame allocation in steady state).

import { RingPool } from '../core/ObjectPool.js';
import { makeRng } from '../core/Rng.js';
import { VERTEX_FLOATS } from './gl/GLUtil.js';
import { MeshBuilder } from './gl/MeshBuilder.js';
import { decalUV, fxUV } from './Textures.js';
import { SURFACES, SURFACE_IDS } from '../data/surfaces.js';
import { compose, mat4 } from './gl/Mat4.js';
import { buildCasing } from './WeaponModels.js';
const MAX_PARTICLES = 1400;
const MAX_DECALS = 220;
const UV_GLOW = fxUV(0), UV_SMOKE = fxUV(1), UV_SPARK = fxUV(2), UV_STAR = fxUV(3);
const DECAL_INDEX = { chip: 0, scuff: 1, splinter: 2, scorch: 3 };

class QuadBatch {
  constructor(renderer, maxQuads) {
    this.v = new Float32Array(maxQuads * 6 * VERTEX_FLOATS);
    this.n = 0;
    this.max = maxQuads;
    this.mesh = renderer.createMesh(new Float32Array(VERTEX_FLOATS * 6), null, true);
    this.renderer = renderer;
  }
  reset() {
    this.n = 0;
  }
  vert(o, x, y, z, u, v, r, g, b, a) {
    const d = this.v;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 6] = u; d[o + 7] = v;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
  }
  /** Quad from centre + two half-axis vectors. */
  quad(cx, cy, cz, ax, ay, az, bx, by, bz, uv, r, g, b, a) {
    if (this.n >= this.max) return;
    const o = this.n * 6 * VERTEX_FLOATS, F = VERTEX_FLOATS;
    const p0 = [cx - ax - bx, cy - ay - by, cz - az - bz];
    const p1 = [cx + ax - bx, cy + ay - by, cz + az - bz];
    const p2 = [cx + ax + bx, cy + ay + by, cz + az + bz];
    const p3 = [cx - ax + bx, cy - ay + by, cz - az + bz];
    this.vert(o, p0[0], p0[1], p0[2], uv[0], uv[3], r, g, b, a);
    this.vert(o + F, p1[0], p1[1], p1[2], uv[2], uv[3], r, g, b, a);
    this.vert(o + 2 * F, p2[0], p2[1], p2[2], uv[2], uv[1], r, g, b, a);
    this.vert(o + 3 * F, p0[0], p0[1], p0[2], uv[0], uv[3], r, g, b, a);
    this.vert(o + 4 * F, p2[0], p2[1], p2[2], uv[2], uv[1], r, g, b, a);
    this.vert(o + 5 * F, p3[0], p3[1], p3[2], uv[0], uv[1], r, g, b, a);
    this.n++;
  }
  upload() {
    const gl = this.renderer.gl;
    const count = this.n * 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.vbo);
    if (this.v.length > this.mesh.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, this.v.byteLength, gl.DYNAMIC_DRAW);
      this.mesh.capacity = this.v.length;
    }
    if (count) gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.v, 0, count * VERTEX_FLOATS);
    this.mesh.count = count;
    return this.mesh;
  }
}

export class Fx {
  constructor(renderer, hf) {
    this.renderer = renderer;
    this.hf = hf;
    this.rng = makeRng(99);
    this.particles = new RingPool(MAX_PARTICLES, () => ({ life: 0, age: 0 }));
    this.tracers = new RingPool(48, () => ({ life: 0, age: 0 }));
    this.flashes = new RingPool(16, () => ({ life: 0, age: 0 }));
    this.casings = new RingPool(28, () => ({ life: 0, age: 0, model: mat4() }));
    this.pulses = new RingPool(6, () => ({ life: 0, age: 0 }));
    this.decals = [];
    this.decalsDirty = true;
    this.decalMesh = renderer.createMesh(new Float32Array(MAX_DECALS * 4 * VERTEX_FLOATS), new Uint32Array(MAX_DECALS * 6), true);
    this.decalMesh.count = 0;
    this.add = new QuadBatch(renderer, 2600);
    this.alpha = new QuadBatch(renderer, 1600);
    const cb = buildCasing();
    this.casingMesh = renderer.createMesh(cb.vertices(), cb.indices());
    this.smokeCache = new Map();
    this.time = 0;
  }

  // ------------------------------------------------------------ spawners
  tracer(from, to, color, width = 0.022) {
    const t = this.tracers.next();
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return;
    t.from = from.slice();
    t.dir = [dx / len, dy / len, dz / len];
    t.len = len;
    t.age = 0;
    t.life = len / 900 + 0.05;
    t.color = color;
    t.width = width;
  }

  particle(pos, vel, life, size0, size1, color, alpha, opts = {}) {
    const p = this.particles.next();
    p.pos = pos.slice();
    p.vel = vel.slice();
    p.age = 0;
    p.life = life;
    p.size0 = size0;
    p.size1 = size1;
    p.color = color;
    p.alpha = alpha;
    p.gravity = opts.gravity || 0;
    p.drag = opts.drag || 0;
    p.additive = !!opts.additive;
    p.uv = opts.uv || (p.additive ? UV_GLOW : UV_SMOKE);
    p.stretch = opts.stretch || 0;
    p.rot = this.rng() * 6.28;
    p.bounce = !!opts.bounce;
  }

  /** Surface impact: decal + surface-specific particles + optional skin extra. */
  impact(pos, normal, surfaceIndex, extra) {
    const surf = SURFACES[SURFACE_IDS[surfaceIndex]] || SURFACES.tile;
    this.addDecal(pos, normal, DECAL_INDEX[surf.decal] ?? 0, 0.05 + this.rng() * 0.03);
    const r = this.rng;
    const n = normal;
    const rnd = (s) => [(r() - 0.5) * s, (r() - 0.5) * s, (r() - 0.5) * s];
    if (surf.particles === 'sparks') {
      for (let i = 0; i < 9; i++) {
        const j = rnd(4);
        this.particle(pos, [n[0] * 4 + j[0], n[1] * 4 + j[1] + 1, n[2] * 4 + j[2]], 0.18 + r() * 0.2, 0.03, 0.01, [2.4, 1.6, 0.7], 1, { additive: true, gravity: 9, stretch: 0.035, uv: UV_SPARK });
      }
      this.particle(pos, [0, 0, 0], 0.06, 0.18, 0.3, [1.6, 1.3, 0.9], 0.8, { additive: true });
    }
    if (surf.particles === 'dust' || surf.particles === 'chips') {
      const d = surf.dust;
      for (let i = 0; i < 3; i++) {
        const j = rnd(0.8);
        this.particle(pos, [n[0] * (0.9 + r()) + j[0], n[1] * (0.9 + r()) + j[1] + 0.2, n[2] * (0.9 + r()) + j[2]], 0.55 + r() * 0.4, 0.07, 0.42, [d[0] * 1.15, d[1] * 1.15, d[2] * 1.15], 0.55, { drag: 3.2, gravity: -0.15 });
      }
      for (let i = 0; i < 5; i++) {
        const j = rnd(3);
        this.particle(pos, [n[0] * 3 + j[0], n[1] * 3 + j[1] + 1.5, n[2] * 3 + j[2]], 0.5 + r() * 0.3, 0.018, 0.012, surf.particles === 'chips' ? [0.35, 0.22, 0.1] : [d[0] * 0.6, d[1] * 0.6, d[2] * 0.6], 1, { gravity: 9.8, uv: UV_GLOW, bounce: true });
      }
    }
    if (extra) this.skinExtra(pos, n, extra);
  }

  skinExtra(pos, n, kind) {
    const r = this.rng;
    if (kind === 'frost') {
      for (let i = 0; i < 7; i++) this.particle(pos, [n[0] * 1.5 + (r() - 0.5) * 2, n[1] * 1.5 + r() * 1.2, n[2] * 1.5 + (r() - 0.5) * 2], 0.6 + r() * 0.4, 0.04, 0.0, [0.5, 1.2, 1.9], 1, { additive: true, drag: 2, gravity: 0.6, uv: UV_STAR });
    } else if (kind === 'embers') {
      for (let i = 0; i < 8; i++) this.particle(pos, [n[0] * 2.5 + (r() - 0.5) * 3, n[1] * 2.5 + r() * 2.5, n[2] * 2.5 + (r() - 0.5) * 3], 0.7 + r() * 0.6, 0.03, 0.01, [2.4, 0.8, 0.15], 1, { additive: true, gravity: 5, stretch: 0.02, uv: UV_SPARK, bounce: true });
    }
  }

  /** Energy sparks when a bullet hits a character (no gore). */
  hitSpark(pos, dir, headshot) {
    const r = this.rng;
    const c = headshot ? [2.6, 2.2, 1.6] : [2.2, 0.5, 0.65];
    for (let i = 0; i < (headshot ? 14 : 8); i++) {
      this.particle(pos, [-dir[0] * 2 + (r() - 0.5) * 3, -dir[1] * 2 + (r() - 0.5) * 3 + 0.8, -dir[2] * 2 + (r() - 0.5) * 3], 0.16 + r() * 0.16, 0.035, 0.0, c, 1, { additive: true, gravity: 6, stretch: 0.03, uv: UV_SPARK });
    }
    this.particle(pos, [0, 0, 0], 0.08, headshot ? 0.32 : 0.2, headshot ? 0.5 : 0.3, c, 0.9, { additive: true });
  }

  muzzleFlash(pos, color, size = 0.35) {
    const f = this.flashes.next();
    f.pos = pos.slice();
    f.color = color;
    f.size = size;
    f.age = 0;
    f.life = 0.05;
    f.rot = this.rng() * 6.28;
  }

  casing(pos, vel) {
    const c = this.casings.next();
    c.pos = pos.slice();
    c.vel = vel.slice();
    c.rot = [this.rng() * 6, this.rng() * 6, 0];
    c.spin = [(this.rng() - 0.5) * 40, (this.rng() - 0.5) * 30, 0];
    c.age = 0;
    c.life = 2.2;
    c.bounced = 0;
    c.onLand = null;
  }

  pulse(pos, radius) {
    const p = this.pulses.next();
    p.pos = pos.slice();
    p.radius = radius;
    p.age = 0;
    p.life = 1.1;
  }

  addDecal(pos, normal, index, size) {
    if (this.decals.length >= MAX_DECALS) this.decals.shift();
    this.decals.push({ pos: pos.slice(), normal: normal.slice(), index, size, rot: this.rng() * 6.28, born: this.time });
    this.decalsDirty = true;
  }

  clearDecals() {
    this.decals.length = 0;
    this.decalsDirty = true;
  }

  // ------------------------------------------------------------ update/build
  update(dt, onCasingLand) {
    this.time += dt;
    const hf = this.hf;
    this.particles.forEach((p) => {
      if (p.age >= p.life) return;
      p.age += dt;
      p.vel[1] -= p.gravity * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vel[0] *= k; p.vel[1] *= k; p.vel[2] *= k;
      }
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;
      if (p.bounce) {
        const g = hf.groundBelow(p.pos[0], p.pos[1] + 0.3, p.pos[2]);
        if (p.pos[1] < g && p.vel[1] < 0) {
          p.pos[1] = g;
          p.vel[1] *= -0.3;
          p.vel[0] *= 0.5;
          p.vel[2] *= 0.5;
        }
      }
    });
    this.tracers.forEach((t) => {
      if (t.age < t.life) t.age += dt;
    });
    this.flashes.forEach((f) => {
      if (f.age < f.life) f.age += dt;
    });
    this.pulses.forEach((p) => {
      if (p.age < p.life) p.age += dt;
    });
    this.casings.forEach((c) => {
      if (c.age >= c.life) return;
      c.age += dt;
      c.vel[1] -= 9.8 * dt;
      c.pos[0] += c.vel[0] * dt;
      c.pos[1] += c.vel[1] * dt;
      c.pos[2] += c.vel[2] * dt;
      c.rot[0] += c.spin[0] * dt;
      c.rot[1] += c.spin[1] * dt;
      const g = hf.groundBelow(c.pos[0], c.pos[1] + 0.3, c.pos[2]);
      if (c.pos[1] < g + 0.005 && c.vel[1] < 0) {
        c.pos[1] = g + 0.005;
        if (c.bounced < 2 && onCasingLand) onCasingLand(c.pos, hf.groundSurface, c.bounced);
        c.vel[1] *= -0.35;
        c.vel[0] *= 0.45;
        c.vel[2] *= 0.45;
        c.spin[0] *= 0.5;
        c.spin[1] *= 0.5;
        c.bounced++;
      }
      compose(c.model, c.pos[0], c.pos[1], c.pos[2], c.rot[0], c.rot[1], 0);
    });
  }

  /** Build this frame's sprite buffers. cam: { pos, right, up }. */
  build(cam, smokes, serverTime) {
    const add = this.add, alpha = this.alpha;
    add.reset();
    alpha.reset();
    const R = cam.right, U = cam.up, C = cam.pos;

    this.particles.forEach((p) => {
      if (p.age >= p.life) return;
      const t = p.age / p.life;
      const size = p.size0 + (p.size1 - p.size0) * t;
      const a = p.alpha * (1 - t) * (p.additive ? 1 : Math.min(1, t * 6 + 0.2));
      const batch = p.additive ? add : alpha;
      if (p.stretch) {
        this.stretched(batch, p.pos, p.vel, p.stretch, size, cam, p.uv, p.color, a);
      } else {
        const c = Math.cos(p.rot + t), s = Math.sin(p.rot + t);
        const ax = (R[0] * c + U[0] * s) * size, ay = (R[1] * c + U[1] * s) * size, az = (R[2] * c + U[2] * s) * size;
        const bx = (U[0] * c - R[0] * s) * size, by = (U[1] * c - R[1] * s) * size, bz = (U[2] * c - R[2] * s) * size;
        batch.quad(p.pos[0], p.pos[1], p.pos[2], ax, ay, az, bx, by, bz, p.uv, p.color[0], p.color[1], p.color[2], a);
      }
    });

    this.tracers.forEach((t) => {
      if (t.age >= t.life) return;
      const head = Math.min(t.len, t.age * 900 + 3);
      const tail = Math.max(0, head - 7);
      const mid = (head + tail) / 2;
      const half = (head - tail) / 2;
      const c = [t.from[0] + t.dir[0] * mid, t.from[1] + t.dir[1] * mid, t.from[2] + t.dir[2] * mid];
      const fade = 1 - t.age / t.life;
      this.beam(add, c, t.dir, half, t.width, cam, t.color, 0.85 * fade);
    });

    this.flashes.forEach((f) => {
      if (f.age >= f.life) return;
      const s = f.size * (1 - f.age / f.life * 0.5);
      const c = Math.cos(f.rot), sn = Math.sin(f.rot);
      add.quad(f.pos[0], f.pos[1], f.pos[2], (R[0] * c + U[0] * sn) * s, (R[1] * c + U[1] * sn) * s, (R[2] * c + U[2] * sn) * s, (U[0] * c - R[0] * sn) * s, (U[1] * c - R[1] * sn) * s, (U[2] * c - R[2] * sn) * s, UV_STAR, f.color[0], f.color[1], f.color[2], 1);
    });

    // Recon pulse: a ring of glints expanding along the floor.
    this.pulses.forEach((p) => {
      if (p.age >= p.life) return;
      const t = p.age / p.life;
      const rad = p.radius * (0.15 + 0.85 * Math.sqrt(t));
      const n = 40;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = p.pos[0] + Math.cos(a) * rad, z = p.pos[2] + Math.sin(a) * rad;
        const y = Math.max(this.hf.groundBelow(x, p.pos[1] + 1.5, z), p.pos[1] - 3) + 0.4;
        const s = 0.45;
        add.quad(x, y, z, R[0] * s, R[1] * s, R[2] * s, U[0] * s, U[1] * s, U[2] * s, UV_GLOW, 0.4, 1.6, 2.2, (1 - t) * 0.9);
      }
    });

    // Smokes: seeded puff clusters, sorted back to front with everything else alpha.
    const puffs = [];
    for (const s of smokes) {
      let cluster = this.smokeCache.get(s.id);
      if (!cluster) {
        const rng = makeRng(s.id * 31 + 7);
        cluster = [];
        for (let i = 0; i < 26; i++) {
          const a = rng() * 6.28, el = (rng() - 0.35) * 1.6, rr = Math.sqrt(rng());
          cluster.push({ off: [Math.cos(a) * rr * 0.75, el * 0.55, Math.sin(a) * rr * 0.75], size: 0.55 + rng() * 0.35, rot: rng() * 6.28, spin: (rng() - 0.5) * 0.2, shade: 0.85 + rng() * 0.15 });
        }
        this.smokeCache.set(s.id, cluster);
      }
      const age = serverTime - s.born;
      const grow = Math.min(1, age / 0.7);
      const fade = Math.min(1, (s.until - serverTime) / 1.4);
      const scale = s.radius * (0.4 + 0.6 * grow);
      for (const q of cluster) {
        const pos = [s.pos[0] + q.off[0] * scale, s.pos[1] + q.off[1] * scale, s.pos[2] + q.off[2] * scale];
        const d = (pos[0] - C[0]) ** 2 + (pos[1] - C[1]) ** 2 + (pos[2] - C[2]) ** 2;
        puffs.push({ pos, d, size: q.size * scale, rot: q.rot + age * q.spin, shade: q.shade, a: 0.82 * fade * grow });
      }
    }
    puffs.sort((a, b) => b.d - a.d);
    for (const p of puffs) {
      const c = Math.cos(p.rot), s = Math.sin(p.rot), z = p.size;
      alpha.quad(p.pos[0], p.pos[1], p.pos[2], (R[0] * c + U[0] * s) * z, (R[1] * c + U[1] * s) * z, (R[2] * c + U[2] * s) * z, (U[0] * c - R[0] * s) * z, (U[1] * c - R[1] * s) * z, (U[2] * c - R[2] * s) * z, UV_SMOKE, 0.78 * p.shade, 0.76 * p.shade, 0.82 * p.shade, p.a);
    }

    return { add: add.upload(), alpha: alpha.upload(), decals: this.buildDecals() };
  }

  stretched(batch, pos, vel, stretch, width, cam, uv, color, a) {
    const sp = Math.hypot(vel[0], vel[1], vel[2]) || 1;
    const dir = [vel[0] / sp, vel[1] / sp, vel[2] / sp];
    this.beam(batch, pos, dir, Math.max(width, sp * stretch), width, cam, color, a, uv);
  }

  beam(batch, center, dir, halfLen, width, cam, color, a, uv = UV_SPARK) {
    const tc = [cam.pos[0] - center[0], cam.pos[1] - center[1], cam.pos[2] - center[2]];
    let sx = dir[1] * tc[2] - dir[2] * tc[1], sy = dir[2] * tc[0] - dir[0] * tc[2], sz = dir[0] * tc[1] - dir[1] * tc[0];
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx = (sx / sl) * width; sy = (sy / sl) * width; sz = (sz / sl) * width;
    // UV_SPARK is vertical in the atlas: b axis = along the beam.
    batch.quad(center[0], center[1], center[2], sx, sy, sz, dir[0] * halfLen, dir[1] * halfLen, dir[2] * halfLen, uv, color[0], color[1], color[2], a);
  }

  buildDecals() {
    if (!this.decalsDirty) return this.decalMesh;
    this.decalsDirty = false;
    const b = new MeshBuilder(this.decals.length * 4 + 4);
    for (const d of this.decals) {
      const n = d.normal;
      let t = Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0];
      const tl = Math.hypot(t[0], t[1], t[2]);
      t = [t[0] / tl, t[1] / tl, t[2] / tl];
      const bt = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      const c = Math.cos(d.rot), s = Math.sin(d.rot);
      const ax = [(t[0] * c + bt[0] * s) * d.size, (t[1] * c + bt[1] * s) * d.size, (t[2] * c + bt[2] * s) * d.size];
      const bx = [(bt[0] * c - t[0] * s) * d.size, (bt[1] * c - t[1] * s) * d.size, (bt[2] * c - t[2] * s) * d.size];
      const p = [d.pos[0] + n[0] * 0.006, d.pos[1] + n[1] * 0.006, d.pos[2] + n[2] * 0.006];
      b.quad(
        [p[0] - ax[0] - bx[0], p[1] - ax[1] - bx[1], p[2] - ax[2] - bx[2]],
        [p[0] + ax[0] - bx[0], p[1] + ax[1] - bx[1], p[2] + ax[2] - bx[2]],
        [p[0] + ax[0] + bx[0], p[1] + ax[1] + bx[1], p[2] + ax[2] + bx[2]],
        [p[0] - ax[0] + bx[0], p[1] - ax[1] + bx[1], p[2] - ax[2] + bx[2]],
        n,
        [0, 0, 0, 1],
        decalUV(d.index),
      );
    }
    const gl = this.renderer.gl;
    const m = this.decalMesh;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.vertices());
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, b.indices());
    m.count = b.ic;
    return m;
  }

  casingDraws(out) {
    this.casings.forEach((c) => {
      if (c.age < c.life) out.push({ mesh: this.casingMesh, model: c.model, probe: [1, 1], tint: [1, 1, 1, 1] });
    });
  }
}
