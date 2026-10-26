// Recoil and inaccuracy model.
//
// Two separate quantities, as in competitive tactical shooters:
//  1. RECOIL OFFSET (yaw/pitch, degrees): where the barrel points relative to the crosshair.
//     - First N shots follow the weapon's fixed, learnable pattern.
//     - After that, a procedural climb that flattens toward `pitchMax`, plus a seeded
//       horizontal drift that occasionally flips side.
//     - The camera only shows `viewKick` of the offset, so players must pull down.
//     - Recovery: after `recoveryDelay`, the offset decays with `offsetHalfLife` and the
//       spray index rewinds at `recoveryRate` shots/s.
//  2. SPREAD (cone radius, degrees): base + movement + air + spray bloom. Counter-strafing
//     zeroes the movement term the moment velocity drops under the accurate threshold.
//
// All randomness is seeded from (player seed, shot sequence) so prediction == authority.

import { makeRng, hash32 } from '../core/Rng.js';
import { DEG, clamp, lerp } from '../core/MathUtil.js';
export function makeRecoilState() {
  return { idx: 0, yaw: 0, pitch: 0, lastShot: -1e9, drift: 0 };
}

export function resetRecoil(rec) {
  rec.idx = 0;
  rec.yaw = 0;
  rec.pitch = 0;
  rec.drift = 0;
  rec.lastShot = -1e9;
}

export function computeSpread(stats, p, move) {
  const sp = stats.spread;
  const fullyAimed = p.inv.adsT >= 0.98 && p.inv.adsLevel > 0;
  let base = fullyAimed && stats.ads.scoped && sp.scopedBase !== undefined ? sp.scopedBase : sp.base;
  if (fullyAimed) base *= sp.adsMul;
  if (p.crouch > 0.5 && p.onGround) base *= sp.crouchMul;

  let moving = 0;
  const accurate = move.runSpeed * move.accurateSpeedFraction;
  if (!p.onGround) moving = sp.air;
  else if (p.speed > accurate) {
    if (p.speed <= move.walkSpeed) moving = lerp(0, sp.walk, (p.speed - accurate) / (move.walkSpeed - accurate));
    else moving = lerp(sp.walk, sp.run, clamp((p.speed - move.walkSpeed) / (move.runSpeed - move.walkSpeed), 0, 1));
  }

  const k = Math.floor(p.inv.recoil.idx);
  const spray = k >= sp.sprayStart ? Math.min(sp.sprayMax, (k - sp.sprayStart + 1) * sp.sprayGrowth) : 0;
  return base + moving + spray;
}

/**
 * Final shot direction: view angles + full recoil offset + seeded cone sample.
 * Writes into `out` (normalised) and returns it.
 */
export function shotDirection(p, spreadDeg, seed, out) {
  const rec = p.inv.recoil;
  const yaw = p.yaw - rec.yaw * DEG; // recoil yaw is +right; engine yaw is +left
  const pitch = p.pitch + rec.pitch * DEG;
  const rng = makeRng(hash32(seed, p.inv.shotSeq, 911));
  const ang = rng() * Math.PI * 2;
  const rad = Math.sqrt(rng()) * spreadDeg * DEG;
  const ox = Math.cos(ang) * Math.tan(rad);
  const oy = Math.sin(ang) * Math.tan(rad);

  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  // forward, right, up basis of the aim direction
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  const rx = cy, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  let dx = fx + rx * ox + ux * oy;
  let dy = fy + uy * oy;
  let dz = fz + rz * ox + uz * oy;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out[0] = dx / len;
  out[1] = dy / len;
  out[2] = dz / len;
  return out;
}

/** Advance the recoil state after a shot fires. */
export function applyShotRecoil(stats, p, seed) {
  const rec = p.inv.recoil;
  const pattern = stats.recoil.pattern;
  const k = Math.floor(rec.idx);
  let dYaw, dPitch;
  if (k < pattern.length) {
    dYaw = pattern[k][0];
    dPitch = pattern[k][1];
  } else {
    const proc = stats.recoil.procedural;
    const rng = makeRng(hash32(seed, p.inv.shotSeq, 4049));
    if (rec.drift === 0) rec.drift = rng() < 0.5 ? -1 : 1;
    else if (rng() < proc.driftFlipChance) rec.drift = -rec.drift;
    dPitch = proc.pitchPerShot * Math.max(0.12, 1 - rec.pitch / proc.pitchMax);
    dYaw = rec.drift * proc.yawDrift + (rng() * 2 - 1) * proc.yawRandom;
  }
  rec.yaw += dYaw;
  rec.pitch += dPitch;
  rec.idx += 1;
  rec.lastShot = p.clock;
  return { dYaw, dPitch };
}

export function recoverRecoil(stats, p, dt) {
  const rec = p.inv.recoil;
  // Automatic weapons never recover mid-spray: the delay always exceeds one fire interval.
  const delay = stats.fireMode === 'auto' ? Math.max(stats.recoil.recoveryDelay, stats.fireInterval * 1.2) : stats.recoil.recoveryDelay;
  if (p.clock - rec.lastShot <= delay) return;
  rec.idx = Math.max(0, rec.idx - stats.recoil.recoveryRate * dt);
  const decay = Math.pow(0.5, dt / stats.recoil.offsetHalfLife);
  rec.yaw *= decay;
  rec.pitch *= decay;
  if (Math.abs(rec.pitch) < 1e-4) rec.pitch = 0;
  if (Math.abs(rec.yaw) < 1e-4) rec.yaw = 0;
  if (rec.idx === 0) rec.drift = 0;
}
