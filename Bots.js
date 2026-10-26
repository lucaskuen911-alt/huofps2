// Server-side bot brains. Hostiles hold angles, react with human-like delay, counter-strafe
// before shooting in bursts, and turn toward footsteps or gunfire. Dummies strafe forever in
// the spawn range and never shoot. Everything here runs on the authority only.

import { makeRng, hash32 } from '../core/Rng.js';
import { wrapAngle, forwardFromAngles, DEG, approach } from '../core/MathUtil.js';
import { BOT_DIFFICULTY, BOT_WEAPON, ROUND, HITBOX } from '../data/rules.js';
import { MOVEMENT } from '../data/movement.js';
import { raySmokeBlocked, applyDamage } from './Hitscan.js';
const fp = { blocked: false, ground: 0 };
const BOT_EYE = 1.55;

export function createBots(map, hf, seed) {
  const bots = [];
  const rng = makeRng(seed);
  const target = map.spawns.player.pos;
  let id = 100;
  for (const s of map.spawns.hostiles) {
    bots.push(makeBot(id++, 'hostile', s.pos, chooseHoldYaw(hf, s.pos, target), rng));
  }
  for (const s of map.spawns.dummies) {
    bots.push(makeBot(id++, 'dummy', s.pos, Math.atan2(s.pos[0] - target[0], s.pos[2] - target[2]), rng));
  }
  return bots;
}

function makeBot(id, kind, pos, yaw, rng) {
  return {
    id,
    kind,
    spawn: pos.slice(),
    holdYaw: yaw,
    pos: pos.slice(),
    vel: [0, 0, 0],
    yaw,
    pitch: 0,
    crouch: 0,
    alive: true,
    health: 100,
    armor: kind === 'hostile' ? 25 : 0,
    deathTime: 0,
    revealedUntil: 0,
    ai: {
      seenSince: -1,
      reactAt: 0,
      nextShot: 0,
      burstLeft: 0,
      strafeDir: rng() < 0.5 ? -1 : 1,
      strafeUntil: 0,
      lastKnown: null,
      alertUntil: 0,
      scanPhase: rng() * Math.PI * 2,
      crouchBias: rng() < 0.25,
    },
  };
}

/** Pick the most open direction from a spawn, biased toward where attackers come from. */
function chooseHoldYaw(hf, pos, toward) {
  let bestYaw = 0, bestScore = -1e9;
  const eye = pos[1] + BOT_EYE;
  const tdx = toward[0] - pos[0], tdz = toward[2] - pos[2];
  const tl = Math.hypot(tdx, tdz) || 1;
  for (let i = 0; i < 24; i++) {
    const yaw = (i / 24) * Math.PI * 2;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const hit = hf.raycast(pos[0], eye, pos[2], dx, 0, dz, 40);
    const dist = hit ? hit.t : 40;
    const score = dist + 12 * ((dx * tdx + dz * tdz) / tl);
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }
  return bestYaw;
}

export function resetBots(bots, seed) {
  const rng = makeRng(seed);
  for (const b of bots) {
    b.pos = b.spawn.slice();
    b.vel = [0, 0, 0];
    b.yaw = b.holdYaw;
    b.pitch = 0;
    b.alive = true;
    b.health = 100;
    b.armor = b.kind === 'hostile' ? 25 : 0;
    b.revealedUntil = 0;
    b.ai.seenSince = -1;
    b.ai.lastKnown = null;
    b.ai.alertUntil = 0;
    b.ai.burstLeft = 0;
    b.ai.strafeDir = rng() < 0.5 ? -1 : 1;
  }
}

/** Notify bots of a sound (footstep, gunshot) so nearby ones turn toward it. */
export function hearSound(bots, pos, radius, time) {
  for (const b of bots) {
    if (!b.alive || b.kind !== 'hostile') continue;
    const d = Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[2]);
    if (d < radius && b.ai.seenSince < 0) {
      b.ai.lastKnown = pos.slice();
      b.ai.alertUntil = time + 3.5;
    }
  }
}

export function alertBot(b, pos, time) {
  if (b.kind !== 'hostile') return;
  b.ai.lastKnown = pos.slice();
  b.ai.alertUntil = time + 4;
}

/**
 * @param world { time, hf, bots, player, smokes, difficulty, roundLive, events, onPlayerKilled }
 */
export function tickBots(world, dt) {
  const diff = BOT_DIFFICULTY[world.difficulty] || BOT_DIFFICULTY.veteran;
  for (const b of world.bots) {
    if (!b.alive) {
      if (b.kind === 'dummy' && world.time - b.deathTime > ROUND.respawnDummyAfter) {
        b.alive = true;
        b.health = 100;
        b.pos = b.spawn.slice();
      }
      continue;
    }
    if (b.kind === 'dummy') tickDummy(world, b, dt);
    else tickHostile(world, b, dt, diff);
  }
}

function moveBot(world, b, vx, vz, dt) {
  const nx = b.pos[0] + vx * dt;
  const nz = b.pos[2] + vz * dt;
  world.hf.footprint(nx, nz, MOVEMENT.radius, b.pos[1], MOVEMENT.stepHeight, MOVEMENT.standHeight, fp);
  if (fp.blocked) return false;
  // Never walk off a ledge: bots hold their elevation.
  if (Math.abs(fp.ground - b.pos[1]) > 0.3) return false;
  b.pos[0] = nx;
  b.pos[2] = nz;
  b.pos[1] = fp.ground;
  return true;
}

function tickDummy(world, b, dt) {
  const speed = 3.6;
  const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
  const off = (b.pos[0] - b.spawn[0]) * rx + (b.pos[2] - b.spawn[2]) * rz;
  if ((off > 2.2 && b.ai.strafeDir > 0) || (off < -2.2 && b.ai.strafeDir < 0)) b.ai.strafeDir *= -1;
  const v = b.ai.strafeDir * speed;
  if (!moveBot(world, b, rx * v, rz * v, dt)) b.ai.strafeDir *= -1;
  b.vel[0] = rx * v;
  b.vel[2] = rz * v;
}

function tickHostile(world, b, dt, diff) {
  const ai = b.ai;
  const pl = world.player;
  const t = world.time;
  const rng = makeRng(hash32(b.id, world.tick, 31));
  let wantYaw = b.holdYaw + Math.sin(t * 0.35 + ai.scanPhase) * 22 * DEG;
  let wantPitch = 0;
  let visible = false;
  let dist = 1e9;

  if (pl && pl.alive && world.roundLive) {
    const ex = b.pos[0], ey = b.pos[1] + BOT_EYE * (1 - 0.3 * b.crouch), ez = b.pos[2];
    const dx = pl.pos[0] - ex, dz = pl.pos[2] - ez;
    dist = Math.hypot(dx, dz);
    if (dist < BOT_WEAPON.range) {
      const toYaw = Math.atan2(-dx, -dz);
      const fovOk = Math.abs(wrapAngle(toYaw - b.yaw)) < (diff.fov / 2) * DEG || t < ai.alertUntil || ai.seenSince >= 0;
      if (fovOk) {
        const headY = pl.pos[1] + HITBOX.head.y * (1 - 0.28 * pl.crouch);
        const chestY = pl.pos[1] + 1.1 * (1 - 0.28 * pl.crouch);
        const seesHead = world.hf.lineOfSight(ex, ey, ez, pl.pos[0], headY, pl.pos[2]) && !raySmokeBlocked(ex, ey, ez, pl.pos[0], headY, pl.pos[2], world.smokes);
        const seesChest = seesHead || (world.hf.lineOfSight(ex, ey, ez, pl.pos[0], chestY, pl.pos[2]) && !raySmokeBlocked(ex, ey, ez, pl.pos[0], chestY, pl.pos[2], world.smokes));
        visible = seesHead || seesChest;
        if (visible) {
          wantYaw = toYaw;
          wantPitch = Math.atan2((seesHead ? headY : chestY) - ey, dist);
        }
      }
    }
  }

  if (visible) {
    if (ai.seenSince < 0) {
      ai.seenSince = t;
      ai.reactAt = t + diff.reaction[0] + rng() * (diff.reaction[1] - diff.reaction[0]);
      ai.burstLeft = diff.burst;
    }
    ai.lastKnown = pl.pos.slice();
    ai.alertUntil = t + 3;
  } else {
    ai.seenSince = -1;
    if (ai.lastKnown && t < ai.alertUntil) {
      wantYaw = Math.atan2(-(ai.lastKnown[0] - b.pos[0]), -(ai.lastKnown[2] - b.pos[2]));
    }
  }

  // Aim: fast turn when engaged, slow scan when holding.
  const turnRate = (visible || t < ai.alertUntil ? 520 : 70) * DEG;
  const err = wrapAngle(wantYaw - b.yaw);
  b.yaw = wrapAngle(b.yaw + Math.max(-turnRate * dt, Math.min(turnRate * dt, err)));
  b.pitch = approach(b.pitch, wantPitch, 3 * dt);

  // Movement: peek-strafe while not firing, plant feet (counter-strafe) to shoot.
  const firing = visible && t >= ai.reactAt && Math.abs(err) < 7 * DEG && ai.burstLeft > 0;
  let vx = 0, vz = 0;
  if (!firing && (visible || t < ai.alertUntil)) {
    if (t > ai.strafeUntil) {
      ai.strafeDir = rng() < 0.5 ? -1 : 1;
      ai.strafeUntil = t + 0.25 + rng() * 0.45;
    }
    const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
    const off = (b.pos[0] - b.spawn[0]) * rx + (b.pos[2] - b.spawn[2]) * rz;
    if (Math.abs(off) > 1.8 && Math.sign(off) === ai.strafeDir) ai.strafeDir *= -1;
    vx = rx * ai.strafeDir * 4.2;
    vz = rz * ai.strafeDir * 4.2;
    if (!moveBot(world, b, vx, vz, dt)) ai.strafeDir *= -1;
  }
  b.vel[0] = vx;
  b.vel[2] = vz;
  b.crouch = approach(b.crouch, firing && ai.crouchBias ? 1 : 0, dt / 0.15);

  if (firing && t >= ai.nextShot) {
    shootAtPlayer(world, b, diff, dist, rng);
    ai.burstLeft--;
    ai.nextShot = t + 60 / BOT_WEAPON.rpm;
    if (ai.burstLeft <= 0) {
      ai.nextShot = t + 0.38 + rng() * 0.4;
      ai.burstLeft = diff.burst;
      ai.reactAt = ai.nextShot;
    }
  }
}

function shootAtPlayer(world, b, diff, dist, rng) {
  const pl = world.player;
  let chance = diff.hitChance * Math.exp(-dist * diff.rangeFalloff);
  if (pl.speed > 3) chance *= 0.6;
  if (!pl.onGround) chance *= 0.5;
  const hit = rng() < chance;
  const zone = hit ? (rng() < diff.headChance ? 'head' : rng() < 0.85 ? 'body' : 'legs') : null;
  const muzzle = [b.pos[0], b.pos[1] + 1.35 * (1 - 0.25 * b.crouch), b.pos[2]];
  const targetY = pl.pos[1] + (zone === 'head' ? HITBOX.head.y : zone === 'legs' ? 0.5 : 1.1) * (1 - 0.28 * pl.crouch);
  let tx = pl.pos[0], ty = targetY, tz = pl.pos[2];
  if (!hit) {
    // Miss close enough to crack past the player's head.
    tx += (rng() - 0.5) * 1.6;
    ty += 0.3 + rng() * 0.9;
    tz += (rng() - 0.5) * 1.6;
  }
  const dx = tx - muzzle[0], dy = ty - muzzle[1], dz = tz - muzzle[2];
  const len = Math.hypot(dx, dy, dz);
  const dir = [dx / len, dy / len, dz / len];
  const wall = world.hf.raycast(muzzle[0], muzzle[1], muzzle[2], dir[0], dir[1], dir[2], len + 25);
  const end = hit ? [tx, ty, tz] : wall ? [wall.x, wall.y, wall.z] : [muzzle[0] + dir[0] * 60, muzzle[1] + dir[1] * 60, muzzle[2] + dir[2] * 60];
  const impact = !hit && wall ? { pos: end, normal: [wall.nx, wall.ny, wall.nz], surface: wall.surface } : null;
  world.events.push({ type: 'botShot', id: b.id, origin: muzzle, end, impact, hit });
  if (hit) {
    const dmg = BOT_WEAPON.damage[zone];
    const res = applyDamage(pl, dmg);
    world.events.push({ type: 'playerDamaged', id: pl.id, by: b.id, amount: res.dealt, zone, from: muzzle, killed: res.killed, health: pl.health, armor: pl.armor });
    if (res.killed) world.onPlayerKilled(b);
  }
}

export function botForward(b, out) {
  return forwardFromAngles(b.yaw, b.pitch, out);
}
