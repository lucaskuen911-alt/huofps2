// Electromagnetic pulse fields (The Core). Pure and deterministic: the authority derives the
// EMP state from round time and seed, replicates it in the round snapshot, and both sides use
// the same containment test, so ability lock-outs predict correctly.
//
// map.emp = {
//   zones:   [{ id, name, shape: 'box', x0, z0, x1, z1, y0, y1 } | { id, name, shape: 'circle', cx, cz, r, y0, y1 }],
//   firstAt: seconds into the live phase before the first cycle,
//   period:  seconds per cycle, warn: warning seconds, duration: active seconds
// }

import { hash32 } from '../core/Rng.js';

export function empZoneContains(z, p) {
  if (p[1] < z.y0 || p[1] > z.y1) return false;
  if (z.shape === 'circle') {
    const dx = p[0] - z.cx, dz = p[2] - z.cz;
    return dx * dx + dz * dz <= z.r * z.r;
  }
  return p[0] >= z.x0 && p[0] <= z.x1 && p[2] >= z.z0 && p[2] <= z.z1;
}

/** EMP state for a live round `elapsed` seconds in. Returns null or { state, zone, until, cycle }. */
export function empStateAt(emp, seed, roundNumber, liveAt, time) {
  if (!emp) return null;
  const e = time - liveAt - emp.firstAt;
  if (e < 0) return null;
  const k = Math.floor(e / emp.period);
  const ph = e - k * emp.period;
  const zone = emp.zones[hash32(seed, roundNumber * 131 + k, 5309) % emp.zones.length];
  const cycleStart = liveAt + emp.firstAt + k * emp.period;
  if (ph < emp.warn) return { state: 'warn', zone: zone.id, until: cycleStart + emp.warn, cycle: k };
  if (ph < emp.warn + emp.duration) return { state: 'active', zone: zone.id, until: cycleStart + emp.warn + emp.duration, cycle: k };
  return null;
}

/** True when the replicated `roundEmp` state disables electronics at `pos`. */
export function empActiveAt(emp, roundEmp, pos) {
  if (!emp || !roundEmp || roundEmp.state !== 'active') return false;
  const z = emp.zones.find((q) => q.id === roundEmp.zone);
  return !!z && empZoneContains(z, pos);
}
