// Replicated player state. Plain data so it can be cloned into snapshots and diffed.
// Fields marked [server] are owned by the authority; prediction never trusts its own copy.

import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { ABILITIES } from '../data/abilities.js';
import { ROUND } from '../data/rules.js';
import { makeRecoilState } from './Recoil.js';
export function createPlayerState(id, seed) {
  const slots = {};
  for (const wid of WEAPON_ORDER) slots[wid] = { ammo: WEAPONS[wid].magSize, reserve: WEAPONS[wid].reserve };
  return {
    id,
    seed, // per-player RNG seed for recoil/spread streams
    clock: 0,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    onGround: true,
    crouch: 0,
    speed: 0,
    landTimer: 0,
    stepAccum: 1.6,
    dashTime: 0,
    dashDir: [0, 0],
    counterStrafed: false,
    alive: true, // [server]
    health: ROUND.playerHealth, // [server]
    armor: ROUND.playerArmor, // [server]
    ultPoints: 0, // [server]
    lastButtons: 0,
    plantProgress: 0,
    inv: {
      current: 'halberd',
      slots,
      equipEnd: 0,
      reloadEnd: 0,
      reloadStart: 0,
      nextFire: 0,
      adsLevel: 0,
      adsT: 0,
      shotSeq: 0,
      inspectEnd: 0,
      recoil: makeRecoilState(),
    },
    abilities: {
      C: { charges: ABILITIES.C.charges },
      Q: { charges: ABILITIES.Q.charges, rechargeAt: 0 },
      E: { charges: ABILITIES.E.charges, rechargeAt: 0 },
      X: { activeUntil: 0 },
    },
  };
}

export function clonePlayer(p) {
  return JSON.parse(JSON.stringify(p));
}

/** Copy every field from `src` into `dst` (keeps object identity for long-lived references). */
export function copyPlayerInto(dst, src) {
  const c = clonePlayer(src);
  for (const k of Object.keys(c)) dst[k] = c[k];
  return dst;
}

export function resetPlayerForRound(p, spawn, magSizes) {
  p.pos = spawn.pos.slice();
  p.vel = [0, 0, 0];
  p.yaw = spawn.yaw;
  p.pitch = 0;
  p.onGround = true;
  p.crouch = 0;
  p.alive = true;
  p.health = ROUND.playerHealth;
  p.armor = ROUND.playerArmor;
  p.plantProgress = 0;
  p.dashTime = 0;
  for (const wid of WEAPON_ORDER) {
    p.inv.slots[wid].ammo = magSizes[wid];
    p.inv.slots[wid].reserve = WEAPONS[wid].reserve;
  }
  p.inv.reloadEnd = 0;
  p.inv.adsLevel = 0;
  p.inv.adsT = 0;
  p.inv.equipEnd = p.clock + 0.3;
  p.abilities.C.charges = ABILITIES.C.charges;
  p.abilities.Q.charges = ABILITIES.Q.charges;
  p.abilities.E.charges = ABILITIES.E.charges;
  p.abilities.X.activeUntil = 0;
}
