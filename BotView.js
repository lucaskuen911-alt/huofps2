// Character rendering for bots: three meshes per variant (upper body, left leg, right leg),
// procedural strafe/death animation, hit flash, light probes, x-ray reveal silhouettes.

import { MeshBuilder } from './gl/MeshBuilder.js';
import { VERTEX_FLOATS, TINTED_FLOATS } from './gl/GLUtil.js';
import { compose, mat4 } from './gl/Mat4.js';
import { DEG, clamp } from '../core/MathUtil.js';
const VARIANTS = {
  hostile: { armor: [0.32, 0.07, 0.11], cloth: [0.1, 0.1, 0.12], accent: [0.85, 0.3, 0.12], helmet: [0.16, 0.16, 0.19], visor: [2.6, 0.35, 0.18], gear: [0.06, 0.065, 0.07], skin: [0.3, 0.22, 0.18] },
  dummy: { armor: [0.78, 0.55, 0.08], cloth: [0.28, 0.27, 0.25], accent: [0.12, 0.12, 0.13], helmet: [0.75, 0.72, 0.66], visor: [0.15, 0.6, 0.9], gear: [0.2, 0.2, 0.21], skin: [0.3, 0.22, 0.18] },
};

/**
 * Authored agent (assets/models/agent.glb): same three-part rig. All painted roles of a part are
 * merged into ONE mesh with per-vertex role colours (shading with the cloth texture set), and the
 * emissive visor stays its own draw: ~4 draws per bot instead of one per material.
 */
const FIXED_TINT = { fixed_dark: [0.12, 0.12, 0.13] };
function buildAuthored(renderer, asset, v) {
  const up = (name) => {
    const prims = asset.part(name);
    const items = [];
    const merge = [];
    for (const p of prims) {
      const role = p.material.name;
      if (role === 'visor') {
        items.push({ mesh: renderer.createMesh(p.vertices, p.indices), material: renderer.material(asset, p.material), tint: [0, 0, 0], emit: v.visor });
      } else merge.push({ p, tint: v[role] || FIXED_TINT[role] || [1, 1, 1] });
    }
    if (merge.length) {
      const nv = merge.reduce((s, m) => s + m.p.vertices.length / VERTEX_FLOATS, 0);
      const ni = merge.reduce((s, m) => s + m.p.indices.length, 0);
      const verts = new Float32Array(nv * TINTED_FLOATS);
      const idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const { p, tint } of merge) {
        const n = p.vertices.length / VERTEX_FLOATS;
        for (let k = 0; k < n; k++) {
          verts.set(p.vertices.subarray(k * VERTEX_FLOATS, (k + 1) * VERTEX_FLOATS), (vo + k) * TINTED_FLOATS);
          const o = (vo + k) * TINTED_FLOATS + 12;
          verts[o] = tint[0]; verts[o + 1] = tint[1]; verts[o + 2] = tint[2];
        }
        for (let k = 0; k < p.indices.length; k++) idx[io + k] = p.indices[k] + vo;
        vo += n;
        io += p.indices.length;
      }
      const base = (prims.find((p) => p.material.name === 'cloth') || merge[0].p).material;
      items.unshift({ mesh: renderer.createMesh(verts, idx, false, TINTED_FLOATS), material: renderer.material(asset, base) });
    }
    return items;
  };
  return { authored: true, upper: up('agent_upper'), leg: up('agent_leg'), visor: v.visor };
}

function limb(b, from, to, w, color) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const f = [dx / len, dy / len, dz / len];
  let r = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const m = mat4();
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
  m[4] = u[0]; m[5] = u[1]; m[6] = u[2];
  m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
  m[12] = (from[0] + to[0]) / 2; m[13] = (from[1] + to[1]) / 2; m[14] = (from[2] + to[2]) / 2;
  b.matrix = m;
  b.box(0, 0, 0, w, w, len, color);
  b.matrix = null;
}

function buildVariant(renderer, v) {
  const c = (x, g = 0) => [x[0], x[1], x[2], g];
  // Upper body, origin at the feet (yaw pivot), facing -Z.
  const up = new MeshBuilder(1024);
  up.box(0, 0.93, 0, 0.38, 0.16, 0.24, c(v.cloth));
  up.box(0, 1.18, 0, 0.42, 0.52, 0.25, c(v.armor));
  up.box(0, 1.22, -0.135, 0.34, 0.3, 0.04, c(v.accent));
  up.box(0, 1.2, 0.165, 0.3, 0.36, 0.1, c(v.cloth));
  up.box(0.27, 1.37, 0, 0.15, 0.14, 0.2, c(v.armor));
  up.box(-0.27, 1.37, 0, 0.15, 0.14, 0.2, c(v.armor));
  up.box(0, 1.47, 0, 0.12, 0.08, 0.12, c(v.cloth));
  up.box(0, 1.61, 0, 0.25, 0.27, 0.27, c(v.helmet));
  up.box(0, 1.625, -0.135, 0.21, 0.065, 0.02, c(v.visor, 1));
  limb(up, [0.27, 1.34, 0], [0.22, 1.12, -0.2], 0.1, c(v.cloth));
  limb(up, [0.22, 1.12, -0.2], [0.07, 1.14, -0.4], 0.09, c(v.armor));
  limb(up, [-0.27, 1.34, 0], [-0.2, 1.15, -0.24], 0.1, c(v.cloth));
  limb(up, [-0.2, 1.15, -0.24], [-0.02, 1.16, -0.55], 0.09, c(v.armor));
  up.box(0.03, 1.17, -0.42, 0.06, 0.09, 0.78, c([0.06, 0.06, 0.07]));
  up.box(0.03, 1.1, -0.3, 0.04, 0.12, 0.06, c([0.06, 0.06, 0.07]));
  up.box(0.03, 1.2, -0.62, 0.065, 0.02, 0.3, c(v.accent));
  // Leg, origin at the hip joint, extending down.
  const leg = new MeshBuilder(256);
  leg.box(0, -0.22, 0, 0.17, 0.44, 0.19, c(v.cloth));
  leg.box(0, -0.4, -0.1, 0.15, 0.14, 0.04, c(v.armor));
  leg.box(0, -0.64, 0.01, 0.15, 0.42, 0.17, c(v.cloth));
  leg.box(0, -0.84, -0.04, 0.17, 0.09, 0.27, c([0.06, 0.06, 0.07]));
  return {
    upper: renderer.createMesh(up.vertices(), up.indices()),
    leg: renderer.createMesh(leg.vertices(), leg.indices()),
    visor: v.visor,
  };
}

export class BotView {
  constructor(renderer, baker, asset = null) {
    this.baker = baker;
    const build = (v) => (asset ? buildAuthored(renderer, asset, v) : buildVariant(renderer, v));
    this.variants = { hostile: build(VARIANTS.hostile), dummy: build(VARIANTS.dummy) };
    this.state = new Map(); // per-bot presentation state
    this.probeTmp = [0, 0];
  }

  flash(id, headshot) {
    const s = this.state.get(id);
    if (s) s.flash = headshot ? 1.6 : 1;
  }

  /** Append draw items for interpolated bots. */
  collect(bots, serverTime, dt, out) {
    for (const b of bots) {
      let s = this.state.get(b.id);
      if (!s) {
        s = { phase: 0, flash: 0, probe: [1, 1], mats: [mat4(), mat4(), mat4()], probeTick: 0 };
        this.state.set(b.id, s);
      }
      const V = this.variants[b.kind];
      const deadFor = b.alive ? -1 : serverTime - b.deathTime;
      if (!b.alive && deadFor > 2.6) continue;
      s.flash = Math.max(0, s.flash - dt * 8);
      const speed = Math.hypot(b.vel[0], b.vel[2]);
      s.phase += speed * dt * 3.2;
      if (s.probeTick-- <= 0) {
        this.baker.probe(b.pos[0], b.pos[1] + 1.2, b.pos[2], this.probeTmp);
        s.probe[0] += (this.probeTmp[0] - s.probe[0]) * 0.5;
        s.probe[1] += (this.probeTmp[1] - s.probe[1]) * 0.5;
        s.probeTick = 3;
      }
      // Lateral velocity drives a side-step gait.
      const sw = Math.sin(s.phase) * clamp(speed / 4, 0, 1) * 0.45;
      const crouchDrop = b.crouch * 0.32;
      let fall = 0, sink = 0;
      if (deadFor >= 0) {
        const t = clamp(deadFor / 0.55, 0, 1);
        fall = t * t * 88 * DEG; // topple backwards
        sink = clamp((deadFor - 1.6) / 1, 0, 1) * 0.9;
      }
      const yaw = b.yaw;
      const [mU, mL, mR] = s.mats;
      const lean = clamp(-(b.vel[0] * Math.cos(yaw) - b.vel[2] * Math.sin(yaw)) * 0.02, -0.08, 0.08);
      compose(mU, b.pos[0], b.pos[1] - crouchDrop - sink, b.pos[2], fall + b.pitch * 0.25, yaw, lean);
      const hipY = 0.88 - crouchDrop;
      const legScaleY = 1 - b.crouch * 0.36;
      // Legs share the body's yaw; hip offset applied in local space.
      const cy = Math.cos(yaw), syw = Math.sin(yaw);
      const hx = 0.11 * cy, hz = -0.11 * syw;
      compose(mL, b.pos[0] - hx, b.pos[1] + hipY - sink, b.pos[2] - hz, fall + sw, yaw, sw * 0.3, 1, legScaleY, 1);
      compose(mR, b.pos[0] + hx, b.pos[1] + hipY - sink, b.pos[2] + hz, fall - sw, yaw, -sw * 0.3, 1, legScaleY, 1);
      const emissive = s.flash > 0 ? [s.flash * 0.9, s.flash * 0.9, s.flash * 0.9] : null;
      if (V.authored) {
        const parts = [[V.upper, mU], [V.leg, mL], [V.leg, mR]];
        for (const [list, model] of parts) for (const it of list) out.push({ ...it, model, probe: s.probe, emissive, castShadow: true });
        if (b.alive && b.revealedUntil > serverTime) {
          const pulse = 0.45 + 0.2 * Math.sin(serverTime * 14);
          for (const [list, model] of parts) for (const it of list) out.push({ mesh: it.mesh, material: it.material, model, xray: true, tint4: [1, 0.18, 0.12, pulse], castShadow: false });
        }
        continue;
      }
      const common = { probe: s.probe, emissive, glow: V.visor, castShadow: true };
      out.push({ mesh: V.upper, model: mU, ...common });
      out.push({ mesh: V.leg, model: mL, ...common });
      out.push({ mesh: V.leg, model: mR, ...common });
      if (b.alive && b.revealedUntil > serverTime) {
        const pulse = 0.45 + 0.2 * Math.sin(serverTime * 14);
        const xr = { xray: true, tint: [1, 0.18, 0.12, pulse], castShadow: false };
        out.push({ mesh: V.upper, model: mU, ...xr });
        out.push({ mesh: V.leg, model: mL, ...xr });
        out.push({ mesh: V.leg, model: mR, ...xr });
      }
    }
  }
}
