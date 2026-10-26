// Hitboxes, ray-vs-entity tests and damage resolution. Server-authoritative: clients may run
// traceEntities for instant hit effects, but only the server's applyDamage changes health.

import { HITBOX, ROUND } from '../data/rules.js';
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return -1;
    } else {
      let t1 = (lo[a] - o[a]) / d[a];
      let t2 = (hi[a] - o[a]) / d[a];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** Height scale for crouching targets. */
function scaleFor(e) {
  return 1 - (1 - HITBOX.crouchScale) * (e.crouch || 0);
}

/**
 * Nearest entity hit along a ray. `poses` optionally overrides positions (lag compensation).
 * Returns { entity, zone, t } or null.
 */
export function traceEntities(ox, oy, oz, dx, dy, dz, maxDist, entities, poses) {
  let best = null;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.alive) continue;
    const pose = poses ? poses[i] : e;
    if (!pose) continue;
    const px = pose.pos[0], py = pose.pos[1], pz = pose.pos[2];
    const s = scaleFor(pose);
    // Broad phase: skip entities far from the ray.
    const lx = px - ox, lz = pz - oz;
    const along = lx * dx + lz * dz;
    if (along < -1) continue;

    let t = raySphere(ox, oy, oz, dx, dy, dz, px, py + HITBOX.head.y * s, pz, HITBOX.head.r);
    let zone = 'head';
    if (t < 0 || t > maxDist) {
      const bh = HITBOX.body.half;
      t = rayBox(ox, oy, oz, dx, dy, dz, px - bh, py + HITBOX.body.y0 * s, pz - bh, px + bh, py + HITBOX.body.y1 * s, pz + bh);
      zone = 'body';
      if (t < 0 || t > maxDist) {
        const lh = HITBOX.legs.half;
        t = rayBox(ox, oy, oz, dx, dy, dz, px - lh, py + HITBOX.legs.y0 * s, pz - lh, px + lh, py + HITBOX.legs.y1 * s, pz + lh);
        zone = 'legs';
        if (t < 0 || t > maxDist) continue;
      }
    }
    if (!best || t < best.t) best = { entity: e, index: i, zone, t };
  }
  return best;
}

export function damageFor(stats, zone, dist) {
  let dmg = stats.damage[zone];
  for (const f of stats.falloff) if (dist > f.range) dmg = Math.round(stats.damage[zone] * f.mul);
  return dmg;
}

/** Armor absorbs a share of each hit until depleted. Returns { dealt, killed, armorBroke }. */
export function applyDamage(target, amount) {
  const hadArmor = target.armor > 0;
  const absorbed = Math.min(target.armor, Math.round(amount * ROUND.armorAbsorb));
  target.armor -= absorbed;
  const dealt = Math.min(target.health, amount - absorbed);
  target.health -= dealt;
  const killed = target.health <= 0;
  if (killed) {
    target.health = 0;
    target.alive = false;
  }
  return { dealt: dealt + absorbed, killed, armorBroke: hadArmor && target.armor <= 0 };
}

export function raySmokeBlocked(ax, ay, az, bx, by, bz, smokes) {
  if (!smokes.length) return false;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const ux = dx / len, uy = dy / len, uz = dz / len;
  for (const s of smokes) {
    // Segment-vs-sphere: closest point on segment within radius.
    const lx = s.pos[0] - ax, ly = s.pos[1] - ay, lz = s.pos[2] - az;
    let t = lx * ux + ly * uy + lz * uz;
    t = t < 0 ? 0 : t > len ? len : t;
    const cx = ax + ux * t - s.pos[0], cy = ay + uy * t - s.pos[1], cz = az + uz * t - s.pos[2];
    if (cx * cx + cy * cy + cz * cz < s.radius * s.radius * 0.8) return true;
  }
  return false;
}
