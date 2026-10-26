// Authored level models (glTF props placed by map data) and the Dockside 9 yard crane.
//
// Static props are flattened into world space at load, light-baked per vertex with the same
// baker as the brushes (sky + sun + one bounce), then merged per 16 m chunk x material x tint so
// a whole container stack costs one draw. Collision never comes from these meshes: map data
// places hull brushes, so artists can rework a prop freely.
//
// The crane view draws the movable container stacks and the RTG crane that re-stacks them in
// the barrier phase. The authority switches collision at round start (players cannot move yet);
// this class only animates what changed, then parks the crane where the layout's leg collision is.

import { VERTEX_FLOATS, TINTED_FLOATS } from './gl/GLUtil.js';
import { LightBaker } from './LightBaker.js';
import { compose, mat4, multiply } from './gl/Mat4.js';
import { clamp, easeInOutCubic } from '../core/MathUtil.js';

const CHUNK = 32;
const ONE = [1, 1, 1];
const CW = 2.438, CH = 2.591;
const PAINT_DEFAULT = [0.55, 0.55, 0.55];
// Material roles an instance tint applies to (everything else is fixed colour).
const TINTABLE = new Set(['paint']);

/** Find the asset that defines node `id` (several model files can feed one map). */
function assetFor(assets, id) {
  for (const a of Object.values(assets)) if (a && a.has(id)) return a;
  return null;
}

/**
 * @returns {{ items: Array, verts: number, missing: string[] }}
 * items are renderer static-prop draws: { mesh, material, tint, min, max }.
 */
export function buildStaticModels(map, assets, levelBaker, renderer) {
  // Props bake with fewer hemisphere rays than the brushes (they are small and shared-cached).
  const baker = new LightBaker(map, levelBaker.hf, 6);
  const parts = new Map();
  const missing = new Set();
  const groups = new Map();
  const cache = new Map();
  const out4 = [0, 0, 0, 0];
  const m = mat4();
  let baked = 0, verts = 0;

  const bakeVertex = (x, y, z, nx, ny, nz, dst, o) => {
    // Indirect light varies slowly: share bakes between vertices in the same 0.6 m cell with a
    // similar normal (corrugation and bevel vertices collapse to a handful of samples).
    const key = `${Math.round(x / 0.9)},${Math.round(y / 0.9)},${Math.round(z / 0.9)}|${Math.round(nx * 1.6)},${Math.round(ny * 1.6)},${Math.round(nz * 1.6)}`;
    let c = cache.get(key);
    if (!c) {
      baker.bake(x, y, z, nx, ny, nz, out4);
      c = [out4[0], out4[1], out4[2], out4[3]];
      cache.set(key, c);
      baked++;
    }
    dst[o + 8] = c[0]; dst[o + 9] = c[1]; dst[o + 10] = c[2]; dst[o + 11] = c[3];
  };

  const saved = [...baker.hf.groups];
  baker.hf.setGroups([]); // static level only (movable stacks get probes)
  for (const inst of map.models) {
    if (inst.group) continue;
    const asset = assetFor(assets, inst.id);
    if (!asset) { missing.add(inst.id); continue; }
    let prims = parts.get(inst.id);
    if (!prims) { prims = asset.part(inst.id); parts.set(inst.id, prims); }
    const s = inst.scale || 1;
    compose(m, inst.pos[0], inst.pos[1], inst.pos[2], 0, inst.yaw || 0, 0);
    const c = Math.cos(inst.yaw || 0), sn = Math.sin(inst.yaw || 0);
    // `aim`: a line prop (hawser, cable, pipe) authored along +Z from its origin, stretched to
    // reach the target point. Basis: f = direction, r = up x f, u = f x r.
    let A = null;
    if (inst.aim) {
      const dx = inst.aim[0] - inst.pos[0], dy = inst.aim[1] - inst.pos[1], dz = inst.aim[2] - inst.pos[2];
      const len = Math.hypot(dx, dy, dz);
      const f = [dx / len, dy / len, dz / len];
      let r = [f[2], 0, -f[0]];
      const rl = Math.hypot(r[0], r[2]) || 1;
      r = [r[0] / rl, 0, r[2] / rl];
      const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
      A = { f, r, u, len, sag: inst.sag || 0 };
    }
    const cx = Math.floor(inst.pos[0] / CHUNK), cz = Math.floor(inst.pos[2] / CHUNK);
    for (const p of prims) {
      const role = p.material.name;
      const tint = TINTABLE.has(role) ? inst.tint || PAINT_DEFAULT : ONE;
      const key = `${cx},${cz}|${asset.id}:${p.material.index}`;
      let g = groups.get(key);
      if (!g) {
        g = { asset, material: p.material, v: [], i: [], count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        groups.set(key, g);
      }
      const src = p.vertices;
      const n = src.length / VERTEX_FLOATS;
      const dst = new Float32Array(n * TINTED_FLOATS);
      for (let k = 0; k < n; k++) {
        const o = k * VERTEX_FLOATS;
        const od = k * TINTED_FLOATS;
        const lx = src[o] * s, ly = src[o + 1] * s, lz = src[o + 2] * s;
        let x, y, z, nx, ny, nz;
        if (A) {
          // Stretch along the line; a catenary-ish sag drops the middle.
          const t = src[o + 2];
          const sag = A.sag * 4 * t * (1 - t);
          x = inst.pos[0] + A.r[0] * lx + A.u[0] * ly + A.f[0] * t * A.len;
          y = inst.pos[1] + A.r[1] * lx + A.u[1] * ly + A.f[1] * t * A.len - sag;
          z = inst.pos[2] + A.r[2] * lx + A.u[2] * ly + A.f[2] * t * A.len;
          const n0 = src[o + 3], n1 = src[o + 4], n2 = src[o + 5];
          nx = A.r[0] * n0 + A.u[0] * n1 + A.f[0] * n2;
          ny = A.r[1] * n0 + A.u[1] * n1 + A.f[1] * n2;
          nz = A.r[2] * n0 + A.u[2] * n1 + A.f[2] * n2;
        } else {
          // compose(): yaw about +Y, then translate. Same convention as the sim.
          x = lx * c + lz * sn + inst.pos[0]; y = ly + inst.pos[1]; z = -lx * sn + lz * c + inst.pos[2];
          const nx0 = src[o + 3], nz0 = src[o + 5];
          nx = nx0 * c + nz0 * sn; ny = src[o + 4]; nz = -nx0 * sn + nz0 * c;
        }
        dst[od] = x; dst[od + 1] = y; dst[od + 2] = z;
        dst[od + 3] = nx; dst[od + 4] = ny; dst[od + 5] = nz;
        dst[od + 6] = src[o + 6]; dst[od + 7] = src[o + 7];
        bakeVertex(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, nx, ny, nz, dst, od);
        dst[od + 12] = tint[0]; dst[od + 13] = tint[1]; dst[od + 14] = tint[2];
        if (x < g.min[0]) g.min[0] = x; if (y < g.min[1]) g.min[1] = y; if (z < g.min[2]) g.min[2] = z;
        if (x > g.max[0]) g.max[0] = x; if (y > g.max[1]) g.max[1] = y; if (z > g.max[2]) g.max[2] = z;
      }
      g.v.push(dst);
      g.i.push({ idx: p.indices, base: g.count });
      g.count += n;
      verts += n;
    }
  }
  baker.hf.setGroups(saved);

  const items = [];
  for (const g of groups.values()) {
    const vertices = new Float32Array(g.count * TINTED_FLOATS);
    let o = 0;
    for (const v of g.v) { vertices.set(v, o); o += v.length; }
    const total = g.i.reduce((a, x) => a + x.idx.length, 0);
    const indices = new Uint32Array(total);
    let q = 0;
    for (const { idx, base } of g.i) for (let k = 0; k < idx.length; k++) indices[q++] = idx[k] + base;
    items.push({ mesh: renderer.createMesh(vertices, indices, false, TINTED_FLOATS), material: renderer.material(g.asset, g.material), tint: null, min: g.min, max: g.max });
  }
  return { items, verts, baked, missing: [...missing] };
}

// --------------------------------------------------------------------------- yard crane

export class CraneView {
  /**
   * @param def    map.crane: { x, span, wheelbase, park, slots, objects, layouts }
   * @param assets model assets (containers + rtg)
   */
  constructor(renderer, baker, def, assets, rules = {}) {
    this.def = def;
    this.baker = baker;
    this.renderer = renderer;
    const up = (asset, name) =>
      asset.part(name).map((p) => ({ mesh: renderer.createMesh(p.vertices, p.indices), material: renderer.material(asset, p.material), role: p.material.name }));
    // Containers: merge every opaque role into the 'paint' draw (fixed roles keep their colour
    // as a per-vertex tint); stencil markings stay separate (alpha-tested). 2 draws per box.
    const FIXED = { fixed_dark: [0.16, 0.16, 0.17], fixed_steel: [0.5, 0.5, 0.52], fixed_rubber: [0.1, 0.1, 0.1], glow: [1, 1, 1] };
    const upMerged = (asset, name) => {
      const prims = asset.part(name);
      const keep = prims.filter((p) => p.material.name.startsWith('fixed_marking'));
      const merge = prims.filter((p) => !p.material.name.startsWith('fixed_marking'));
      const nv = merge.reduce((s, p) => s + p.vertices.length / VERTEX_FLOATS, 0);
      const ni = merge.reduce((s, p) => s + p.indices.length, 0);
      const verts = new Float32Array(nv * TINTED_FLOATS);
      const idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const p of merge) {
        const t = p.material.name === 'paint' ? ONE : FIXED[p.material.name] || ONE;
        const n = p.vertices.length / VERTEX_FLOATS;
        for (let k = 0; k < n; k++) {
          verts.set(p.vertices.subarray(k * VERTEX_FLOATS, (k + 1) * VERTEX_FLOATS), (vo + k) * TINTED_FLOATS);
          const o = (vo + k) * TINTED_FLOATS + 12;
          verts[o] = t[0]; verts[o + 1] = t[1]; verts[o + 2] = t[2];
        }
        for (let k = 0; k < p.indices.length; k++) idx[io + k] = p.indices[k] + vo;
        vo += n;
        io += p.indices.length;
      }
      const paint = merge.find((p) => p.material.name === 'paint') || merge[0];
      return [{ mesh: renderer.createMesh(verts, idx, false, TINTED_FLOATS), material: renderer.material(asset, paint.material), role: 'paint' },
        ...keep.map((p) => ({ mesh: renderer.createMesh(p.vertices, p.indices), material: renderer.material(asset, p.material), role: p.material.name }))];
    };
    const docks = assetFor(assets, 'container40');
    const rtg = assetFor(assets, 'rtg_frame');
    this.ok = !!(docks && rtg);
    if (!this.ok) return;
    this.meshes = {
      c40: upMerged(docks, 'container40'),
      c20: upMerged(docks, 'container20'),
      frame: up(rtg, 'rtg_frame'),
      trolley: up(rtg, 'rtg_trolley'),
      spreader: up(rtg, 'rtg_spreader'),
      cable: up(rtg, 'rtg_cable'),
    };
    this.hoistY = rtg.socket('rtg_trolley')[1];
    this.duration = Math.max(2, (rules.barrierTime || 3) - 1.2);
    // Object state: current position (x, z, y lift) and the slot it rests in.
    this.objects = {};
    for (const [id, o] of Object.entries(def.objects)) this.objects[id] = { id, ...o, x: 0, y: 0, z: 0, slot: null, probe: [1, 1] };
    this.crane = { z: def.park[def.layouts[0].park], tx: 0, spreaderY: this.hoistY - 3, spreaderYaw: 0, spreaderLen: 1 };
    this.moves = [];
    this.parkFrom = this.crane.z;
    this.parkTo = this.crane.z;
    this.t0 = -1e9;
    this.mats = new Map();
    this.place(0);
  }

  slotTop(o) {
    return CH * o.tints.length;
  }

  /** Snap every object to layout `v` (first round, debug views). */
  place(v) {
    const L = this.def.layouts[v];
    for (const [id, sl] of Object.entries(L.at)) {
      const o = this.objects[id], s = this.def.slots[sl];
      o.x = s.x; o.z = s.z; o.y = 0; o.slot = sl;
      this.probeObject(o);
    }
    this.crane.z = this.def.park[L.park];
    this.crane.tx = 0;
    this.moves = [];
    this.parkFrom = this.parkTo = this.crane.z;
  }

  probeObject(o) {
    const out = [0, 0];
    this.baker.probe(o.x, this.slotTop(o) + 0.3, o.z, out);
    o.probe = [0.35 + out[0] * 0.65, Math.max(0.3, out[1])];
  }

  /** Authority switched layouts: plan the moves (only objects whose slot changed). */
  onVariant(v, prev, now) {
    if (!this.ok) return;
    if (prev === undefined || prev === v || this.t0 < -1e8) {
      this.place(v);
      this.t0 = now;
      return;
    }
    // Finish any running animation instantly before planning the next one.
    this.place(prev);
    const next = this.def.layouts[v].at;
    const occupied = new Map(Object.values(this.objects).map((o) => [o.slot, o.id]));
    const pending = Object.values(this.objects).filter((o) => o.slot !== next[o.id]);
    const order = [];
    while (pending.length) {
      // Prefer a move whose destination is free; otherwise break the cycle through the air.
      let k = pending.findIndex((o) => !occupied.has(next[o.id]));
      if (k < 0) k = 0;
      const o = pending.splice(k, 1)[0];
      occupied.delete(o.slot);
      occupied.set(next[o.id], o.id);
      order.push({ o, from: this.def.slots[o.slot], to: this.def.slots[next[o.id]], toSlot: next[o.id] });
    }
    this.moves = order;
    this.t0 = now;
    this.parkFrom = this.crane.z;
    this.parkTo = this.def.park[this.def.layouts[v].park];
  }

  update(now) {
    if (!this.ok) return;
    const t = now - this.t0;
    const n = this.moves.length;
    const per = n ? Math.min(1.6, (this.duration - 0.8) / n) : 0;
    const c = this.crane;
    const X0 = this.def.x;
    const carryY = 8.6;
    let i = n ? Math.floor(t / per) : 0;
    if (n && i < n && t >= 0) {
      const mv = this.moves[i];
      const u = (t - i * per) / per;
      const o = mv.o;
      const top = this.slotTop(o);
      const seg = (a, b) => clamp((u - a) / (b - a), 0, 1);
      // 0-0.22 travel to source, 0.22-0.34 lower, 0.34-0.5 lift, 0.5-0.76 carry, 0.76-0.9 lower, 0.9-1 release.
      const prevZ = i === 0 ? this.parkFrom : this.moves[i - 1].to.z;
      const prevX = i === 0 ? 0 : this.moves[i - 1].to.x - X0;
      const a = easeInOutCubic(seg(0, 0.22));
      const carry = easeInOutCubic(seg(0.5, 0.76));
      c.z = u < 0.5 ? prevZ + (mv.from.z - prevZ) * a : mv.from.z + (mv.to.z - mv.from.z) * carry;
      c.tx = u < 0.5 ? prevX + (mv.from.x - X0 - prevX) * a : mv.from.x - X0 + (mv.to.x - mv.from.x) * carry;
      const lower = easeInOutCubic(seg(0.22, 0.34)), lift = easeInOutCubic(seg(0.34, 0.5)), drop = easeInOutCubic(seg(0.76, 0.9)), rel = easeInOutCubic(seg(0.9, 1));
      const high = this.hoistY - 3;
      let liftY = 0;
      if (u < 0.34) c.spreaderY = high + (top - high) * lower;
      else if (u < 0.76) { liftY = (carryY - 0) * lift; c.spreaderY = top + liftY; }
      else if (u < 0.9) { liftY = carryY * (1 - drop); c.spreaderY = top + liftY; }
      else c.spreaderY = top + (high - top) * rel;
      c.spreaderYaw = o.axis === 'z' ? 0 : Math.PI / 2;
      c.spreaderLen = o.size === 40 ? 1 : 0.5;
      if (u >= 0.34 && u < 0.9) {
        o.x = c.tx + X0; o.z = c.z; o.y = liftY;
        o.probe = [1, 1];
      }
      // Earlier moves are done: settle them in their destination slots.
      for (let k = 0; k < i; k++) this.settle(this.moves[k]);
      if (u >= 0.9) this.settle(mv);
    } else if (n && t >= n * per) {
      for (const mv of this.moves) this.settle(mv);
      // Park at the layout's leg-collision position.
      const pk = easeInOutCubic(clamp((t - n * per) / 0.7, 0, 1));
      const lastZ = this.moves[n - 1].to.z, lastX = this.moves[n - 1].to.x - X0;
      c.z = lastZ + (this.parkTo - lastZ) * pk;
      c.tx = lastX * (1 - pk);
      c.spreaderY = this.hoistY - 3;
    } else if (!n) {
      const pk = easeInOutCubic(clamp(t / 1.2, 0, 1));
      c.z = this.parkFrom + (this.parkTo - this.parkFrom) * pk;
    }
  }

  settle(mv) {
    const o = mv.o;
    if (o.slot === mv.toSlot && o.y === 0) return;
    o.x = mv.to.x; o.z = mv.to.z; o.y = 0; o.slot = mv.toSlot;
    this.probeObject(o);
  }

  mat(key) {
    let m = this.mats.get(key);
    if (!m) { m = mat4(); this.mats.set(key, m); }
    return m;
  }

  /** Append draw items (dynamic PBR, probe-lit, shadow casters). */
  collect(lit) {
    if (!this.ok) return;
    const push = (prims, model, tint, probe, radius = 7) => {
      for (const p of prims) {
        const it = { mesh: p.mesh, material: p.material, model, probe, castShadow: true, radius };
        if (p.role === 'paint') it.tint = tint;
        lit.push(it);
      }
    };
    for (const o of Object.values(this.objects)) {
      const yaw = o.axis === 'z' ? 0 : Math.PI / 2;
      o.tints.forEach((tint, k) => {
        const m = compose(this.mat(`${o.id}${k}`), o.x, o.y + k * CH, o.z, 0, yaw + (k % 2 ? Math.PI : 0), 0);
        push(o.size === 40 ? this.meshes.c40 : this.meshes.c20, m, tint, o.probe);
      });
    }
    const c = this.crane;
    const X0 = this.def.x;
    const P = [1, 1];
    const yellow = [0.85, 0.55, 0.03];
    push(this.meshes.frame, compose(this.mat('frame'), X0, 0, c.z, 0, 0, 0), yellow, P, 22);
    push(this.meshes.trolley, compose(this.mat('trolley'), X0 + c.tx, this.hoistY, c.z, 0, 0, 0), yellow, P, 6);
    const sp = compose(this.mat('sp'), X0 + c.tx, c.spreaderY, c.z, 0, c.spreaderYaw, 0);
    if (c.spreaderLen !== 1) {
      const s = mat4();
      s[10] = c.spreaderLen;
      multiply(sp, sp, s);
    }
    push(this.meshes.spreader, sp, yellow, P);
    const top = this.hoistY - 0.2, bot = c.spreaderY + 1.2;
    const cm = compose(this.mat('cable'), X0 + c.tx, (top + bot) / 2, c.z, 0, 0, 0);
    const s2 = mat4();
    s2[5] = Math.max(0.05, top - bot);
    multiply(cm, cm, s2);
    push(this.meshes.cable, cm, yellow, P, 0);
  }
}
