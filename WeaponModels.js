// Procedural viewmodel meshes built from a resolved presentation profile.
// Parts that animate independently (magazine, bolt/slide, reticle, arms) are separate meshes.
// Weapon space: metres, barrel along -Z, +Y up, origin near the trigger.
// In production these are authored skeletal meshes; the socket names are the contract the
// animation code relies on (muzzle, eject, sightY, magWell, leftHand).

import { MeshBuilder } from './gl/MeshBuilder.js';
import { compose, mat4 } from './gl/Mat4.js';
import { DEG } from '../core/MathUtil.js';
const ARMS = { sleeve: [0.045, 0.05, 0.07], glove: [0.035, 0.035, 0.04], cuff: [0.42, 0.13, 0.03] };

function col(c, glow = 0) {
  return [c[0], c[1], c[2], glow];
}

function limb(b, from, to, w, h, color) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const f = [dx / len, dy / len, dz / len];
  let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]; // f x up
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const m = mat4();
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
  m[4] = u[0]; m[5] = u[1]; m[6] = u[2];
  m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
  m[12] = (from[0] + to[0]) / 2; m[13] = (from[1] + to[1]) / 2; m[14] = (from[2] + to[2]) / 2;
  b.matrix = m;
  b.box(0, 0, 0, w, h, len, color);
  b.matrix = null;
}

function rotated(b, x, y, z, rx, ry, rz, fn) {
  b.matrix = compose(mat4(), x, y, z, rx, ry, rz);
  fn();
  b.matrix = null;
}

const MODELS = {
  rifle(b, P) {
    b.box(0, 0.03, -0.1, 0.052, 0.07, 0.3, col(P.body));
    b.box(0, 0.074, -0.11, 0.044, 0.02, 0.28, col(P.metal));
    b.box(0, 0.09, -0.1, 0.026, 0.012, 0.22, col(P.metal));
    b.box(0, 0.028, -0.36, 0.058, 0.064, 0.22, col(P.accent));
    b.box(0, 0.062, -0.36, 0.05, 0.008, 0.2, col(P.body));
    for (let k = 0; k < 4; k++) b.box(0, 0.006, -0.29 - k * 0.045, 0.06, 0.012, 0.02, col(P.body));
    b.box(0.0295, 0.03, -0.36, 0.004, 0.012, 0.16, col(P.glow, 1));
    b.box(-0.0295, 0.03, -0.36, 0.004, 0.012, 0.16, col(P.glow, 1));
    b.cylinderZ(0, 0.03, -0.47, -0.62, 0.011, 10, col(P.metal));
    b.box(0, 0.085, -0.45, 0.008, 0.03, 0.01, col(P.metal));
    // Rear sight: two ears with a notch so the sight line (y = 0.1) stays clear.
    b.box(0, 0.093, -0.005, 0.03, 0.006, 0.012, col(P.metal));
    b.box(0.011, 0.101, -0.005, 0.006, 0.014, 0.012, col(P.metal));
    b.box(-0.011, 0.101, -0.005, 0.006, 0.014, 0.012, col(P.metal));
    b.box(0, 0.02, 0.15, 0.04, 0.065, 0.2, col(P.body));
    b.box(0, 0.015, 0.255, 0.046, 0.095, 0.018, col(P.grip));
    rotated(b, 0, -0.055, 0.005, 14 * DEG, 0, 0, () => b.box(0, 0, 0, 0.034, 0.1, 0.045, col(P.grip)));
    b.box(0, -0.012, -0.05, 0.01, 0.006, 0.06, col(P.metal));
    return { muzzle: [0, 0.03, -0.625], eject: [0.03, 0.05, -0.08], sightY: 0.1, sightZ: -0.005, magWell: [0, -0.01, -0.15], leftHand: [0, -0.01, -0.37], rightHand: [0, -0.06, 0.01], magPivot: [0, -0.01, -0.15] };
  },
  smg(b, P) {
    b.box(0, 0.035, -0.12, 0.05, 0.08, 0.26, col(P.body));
    b.box(0, 0.083, -0.12, 0.026, 0.012, 0.2, col(P.metal));
    b.box(0, 0.03, -0.3, 0.056, 0.064, 0.11, col(P.accent));
    b.box(0.0285, 0.05, -0.15, 0.004, 0.012, 0.18, col(P.glow, 1));
    b.cylinderZ(0, 0.03, -0.355, -0.44, 0.01, 10, col(P.metal));
    b.box(0, 0.09, -0.02, 0.026, 0.006, 0.012, col(P.metal));
    b.box(0.01, 0.098, -0.02, 0.006, 0.012, 0.012, col(P.metal));
    b.box(-0.01, 0.098, -0.02, 0.006, 0.012, 0.012, col(P.metal));
    b.box(0, 0.087, -0.24, 0.006, 0.02, 0.008, col(P.metal));
    b.box(0.017, 0.035, 0.08, 0.008, 0.008, 0.16, col(P.metal));
    b.box(-0.017, 0.035, 0.08, 0.008, 0.008, 0.16, col(P.metal));
    b.box(0, 0.02, 0.165, 0.04, 0.07, 0.014, col(P.grip));
    rotated(b, 0, -0.05, -0.01, 12 * DEG, 0, 0, () => b.box(0, 0, 0, 0.032, 0.095, 0.042, col(P.grip)));
    return { muzzle: [0, 0.03, -0.445], eject: [0.03, 0.05, -0.1], sightY: 0.097, sightZ: -0.02, magWell: [0, 0.0, -0.17], leftHand: [0, -0.008, -0.3], rightHand: [0, -0.055, -0.005], magPivot: [0, 0.0, -0.17] };
  },
  pistol(b, P) {
    b.box(0, 0.022, -0.07, 0.03, 0.024, 0.17, col(P.body));
    rotated(b, 0, -0.035, 0.0, 12 * DEG, 0, 0, () => b.box(0, 0, 0, 0.032, 0.1, 0.05, col(P.grip)));
    b.box(0, -0.002, -0.05, 0.008, 0.006, 0.045, col(P.metal));
    b.box(0.016, 0.022, -0.1, 0.003, 0.008, 0.08, col(P.glow, 1));
    return { muzzle: [0, 0.05, -0.19], eject: [0.02, 0.06, -0.06], sightY: 0.078, sightZ: 0.0, magWell: [0, -0.05, 0.005], leftHand: [-0.025, -0.05, 0.02], rightHand: [0, -0.04, 0.015], magPivot: [0, -0.05, 0.005] };
  },
  sniper(b, P) {
    b.box(0, 0.03, -0.08, 0.05, 0.07, 0.32, col(P.body));
    b.box(0, 0.03, -0.37, 0.062, 0.066, 0.3, col(P.accent));
    b.box(0.032, 0.03, -0.37, 0.004, 0.012, 0.22, col(P.glow, 1));
    b.cylinderZ(0, 0.035, -0.52, -0.86, 0.013, 12, col(P.metal));
    b.box(0, 0.035, -0.875, 0.034, 0.03, 0.05, col(P.metal));
    b.box(0, 0.005, 0.18, 0.045, 0.09, 0.26, col(P.body));
    b.box(0, 0.06, 0.16, 0.035, 0.03, 0.14, col(P.accent));
    b.box(0, 0.005, 0.315, 0.05, 0.11, 0.02, col(P.grip));
    rotated(b, 0, -0.055, 0.02, 14 * DEG, 0, 0, () => b.box(0, 0, 0, 0.034, 0.1, 0.045, col(P.grip)));
    // Integral scope
    b.cylinderZ(0, 0.11, 0.05, -0.27, 0.021, 14, col(P.metal));
    b.cylinderZ(0, 0.11, -0.27, -0.33, 0.032, 14, col(P.body));
    b.cylinderZ(0, 0.11, 0.09, 0.05, 0.026, 14, col(P.body));
    b.box(0, 0.08, -0.02, 0.03, 0.04, 0.02, col(P.metal));
    b.box(0, 0.08, -0.2, 0.03, 0.04, 0.02, col(P.metal));
    return { muzzle: [0, 0.035, -0.9], eject: [0.03, 0.06, -0.06], sightY: 0.11, sightZ: 0.09, magWell: [0, -0.01, -0.12], leftHand: [0, -0.01, -0.4], rightHand: [0, -0.06, 0.03], magPivot: [0, -0.01, -0.12] };
  },
};

function buildMag(b, model, P, extended) {
  const ext = extended ? 1.35 : 1;
  if (model === 'rifle') rotated(b, 0, -0.07 * ext + 0.01, 0.0, 12 * DEG, 0, 0, () => b.box(0, 0, 0, 0.032, 0.12 * ext, 0.06, col(P.metal)));
  else if (model === 'smg') b.box(0, -0.075 * ext + 0.005, 0, 0.028, 0.14 * ext, 0.042, col(P.metal));
  else if (model === 'pistol') b.box(0, -0.06 * ext + 0.05, 0.0, 0.026, 0.1 * ext, 0.04, col(P.metal));
  else b.box(0, -0.035 * ext, 0, 0.04, 0.07 * ext, 0.08, col(P.metal));
}

function buildBolt(b, model, P) {
  if (model === 'pistol') {
    b.box(0, 0.05, -0.08, 0.032, 0.036, 0.19, col(P.metal));
    b.box(0, 0.072, -0.002, 0.022, 0.008, 0.01, col(P.body));
    b.box(0, 0.072, -0.165, 0.005, 0.008, 0.008, col(P.body));
  } else if (model === 'sniper') {
    b.box(0.04, 0.05, 0.02, 0.05, 0.012, 0.012, col(P.metal));
    b.cylinderZ(0.07, 0.05, 0.035, 0.005, 0.012, 8, col(P.body));
  } else {
    b.box(0.034, 0.058, -0.06, 0.018, 0.012, 0.03, col(P.metal));
  }
}

/** Attachments modify geometry and sockets. Returns updated sockets + optional reticle mesh. */
function buildAttachments(b, reticle, parts, model, P, s) {
  for (const part of parts) {
    if (part === 'suppressor') {
      b.cylinderZ(s.muzzle[0], s.muzzle[1], s.muzzle[2] + 0.01, s.muzzle[2] - 0.17, 0.022, 14, col(P.body));
      b.cylinderZ(s.muzzle[0], s.muzzle[1], s.muzzle[2] - 0.02, s.muzzle[2] - 0.04, 0.0235, 14, col(P.accent));
      s.muzzle = [s.muzzle[0], s.muzzle[1], s.muzzle[2] - 0.17];
    } else if (part === 'compensator') {
      b.box(s.muzzle[0], s.muzzle[1], s.muzzle[2] - 0.035, 0.03, 0.03, 0.07, col(P.metal));
      for (let k = 0; k < 3; k++) b.box(s.muzzle[0], s.muzzle[1] + 0.016, s.muzzle[2] - 0.015 - k * 0.02, 0.022, 0.004, 0.008, col([0.02, 0.02, 0.02]));
      s.muzzle = [s.muzzle[0], s.muzzle[1], s.muzzle[2] - 0.07];
    } else if (part === 'reflex') {
      const y = model === 'pistol' ? 0.075 : 0.098;
      b.box(0, y + 0.006, -0.1, 0.034, 0.012, 0.06, col(P.body));
      b.box(0.017, y + 0.03, -0.115, 0.004, 0.04, 0.01, col(P.body));
      b.box(-0.017, y + 0.03, -0.115, 0.004, 0.04, 0.01, col(P.body));
      b.box(0, y + 0.051, -0.115, 0.038, 0.004, 0.01, col(P.body));
      reticle.box(0, y + 0.03, -0.116, 0.0028, 0.0028, 0.001, [1, 0.1, 0.05, 1]);
      s.sightY = y + 0.03;
      s.sightZ = -0.05;
    } else if (part === 'scope') {
      b.cylinderZ(0, 0.128, 0.04, -0.2, 0.019, 14, col(P.metal));
      b.cylinderZ(0, 0.128, -0.2, -0.25, 0.027, 14, col(P.body));
      b.box(0, 0.106, -0.04, 0.026, 0.026, 0.018, col(P.metal));
      b.box(0, 0.106, -0.16, 0.026, 0.026, 0.018, col(P.metal));
      s.sightY = 0.128;
      s.sightZ = 0.06;
    } else if (part === 'grip') {
      b.box(s.leftHand[0], s.leftHand[1] - 0.045, s.leftHand[2], 0.026, 0.07, 0.03, col(P.grip));
      s.leftHand = [s.leftHand[0], s.leftHand[1] - 0.06, s.leftHand[2]];
    }
  }
  return s;
}

function buildArms(rightB, leftB, s) {
  const rh = s.rightHand;
  rightB.box(rh[0] + 0.005, rh[1], rh[2], 0.058, 0.075, 0.1, col(ARMS.glove));
  limb(rightB, [rh[0] + 0.03, rh[1] - 0.02, rh[2] + 0.06], [rh[0] + 0.13, rh[1] - 0.2, rh[2] + 0.36], 0.072, 0.072, col(ARMS.sleeve));
  limb(rightB, [rh[0] + 0.03, rh[1] - 0.02, rh[2] + 0.06], [rh[0] + 0.045, rh[1] - 0.045, rh[2] + 0.11], 0.078, 0.078, col(ARMS.cuff));
  // Left arm is built at the origin so it can be animated to the magwell during reloads.
  leftB.box(0, 0, 0, 0.064, 0.058, 0.095, col(ARMS.glove));
  limb(leftB, [-0.02, -0.02, 0.04], [-0.16, -0.2, 0.36], 0.07, 0.07, col(ARMS.sleeve));
  limb(leftB, [-0.02, -0.02, 0.04], [-0.04, -0.04, 0.09], 0.076, 0.076, col(ARMS.cuff));
}

/**
 * @returns {{ meshes: {body, mag, bolt, reticle?, armR, armL}, sockets }}
 * Mesh entries are CPU builders; the Viewmodel uploads them.
 */
export function buildWeaponModel(profile) {
  const P = profile.palette;
  const model = profile.model.id;
  const body = new MeshBuilder(2048);
  const mag = new MeshBuilder(256);
  const bolt = new MeshBuilder(256);
  const reticle = new MeshBuilder(32);
  const armR = new MeshBuilder(256);
  const armL = new MeshBuilder(256);
  const sockets = MODELS[model](body, P);
  buildAttachments(body, reticle, profile.model.parts, model, P, sockets);
  buildMag(mag, model, P, profile.model.parts.includes('extmag'));
  buildBolt(bolt, model, P);
  buildArms(armR, armL, sockets);
  return { meshes: { body, mag, bolt, reticle: reticle.vc ? reticle : null, armR, armL }, sockets };
}

/** Small brass casing (shared by all weapons). */
export function buildCasing() {
  const b = new MeshBuilder(64);
  b.cylinderZ(0, 0, 0.012, -0.012, 0.0045, 6, [0.85, 0.6, 0.22, 0]);
  return b;
}

// --------------------------------------------------------------------------- authored models
// The same contract as the procedural builder above, sourced from assets/models/weapons.glb
// (art/weapons.py). Sockets come from socket_<model>_* empties; attachments are placed at
// their mount sockets and update the sockets they move (muzzle, sight, left hand).

const id3 = (a) => [a[0], a[1], a[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * @returns {{ parts: { body, mag, bolt, reticle, armR, armL, pips: [] }, sockets, authored: true }}
 * Each part is an array of { vertices, indices, material } primitives (one per material).
 */
export function buildAuthoredWeaponModel(profile, asset) {
  const model = profile.model.id;
  const S = (k) => asset.socket(`socket_${model}_${k}`);
  const sight = S('sight');
  const s = {
    muzzle: S('muzzle'),
    eject: S('eject'),
    sightY: sight[1],
    sightZ: sight[2],
    magWell: S('magwell'),
    leftHand: S('lefthand'),
    rightHand: S('righthand'),
    magPivot: asset.localOrigin(`${model}_mag`),
  };
  const rail = S('rail');
  const under = S('under');
  const parts = model === 'pistol' ? profile.model.parts.filter((p) => p !== 'scope') : profile.model.parts;
  const body = asset.part(`${model}_body`);
  let reticle = null;
  for (const part of parts) {
    if (part === 'suppressor' || part === 'compensator') {
      body.push(...asset.part(`att_${part}`, { offset: s.muzzle }));
      s.muzzle = add3(s.muzzle, asset.socket(`socket_att_${part}_muzzle`));
    } else if (part === 'reflex' || part === 'scope') {
      body.push(...asset.part(`att_${part}`, { offset: rail }));
      const sp = add3(rail, asset.socket(`socket_att_${part}_sight`));
      s.sightY = sp[1];
      s.sightZ = sp[2];
      if (part === 'reflex') reticle = asset.part('att_reflex_reticle', { offset: rail });
    } else if (part === 'grip') {
      body.push(...asset.part('att_grip', { offset: under }));
      s.leftHand = add3(under, asset.socket('socket_att_grip_hand'));
    }
  }
  const pips = [];
  for (let i = 0; asset.has(`${model}_pip_${String(i).padStart(2, '0')}`); i++) pips.push(asset.part(`${model}_pip_${String(i).padStart(2, '0')}`, { world: true }));
  return {
    authored: true,
    parts: {
      body,
      mag: asset.part(profile.model.parts.includes('extmag') ? `${model}_mag_ext` : `${model}_mag`),
      bolt: asset.part(`${model}_bolt`),
      reticle,
      armR: asset.part('arm_right', { offset: id3(s.rightHand) }),
      armL: asset.part(model === 'pistol' && asset.has('arm_left_pistol') ? 'arm_left_pistol' : 'arm_left'),
      pips,
    },
    sockets: s,
  };
}
