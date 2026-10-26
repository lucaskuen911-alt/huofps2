// Runs ONE UserCmd for ONE player: abilities -> movement -> weapon. Called by the authority
// for every received command and by the client predictor for every locally generated
// command. World effects (damage, smokes, reveals) go through ctx callbacks that only the
// authority implements, so prediction can never desync gameplay state it doesn't own.

import { BTN, pressed } from './UserCmd.js';
import { stepMovement } from './Movement.js';
import { computeSpread, shotDirection, applyShotRecoil, recoverRecoil, resetRecoil } from './Recoil.js';
import { ABILITIES } from '../data/abilities.js';
import { ROUND } from '../data/rules.js';
import { WEAPONS } from '../data/weapons.js';
import { forwardFromAngles } from '../core/MathUtil.js';
const dirTmp = [0, 0, 0];

export function eyeHeight(p, move) {
  return move.eyeStand + (move.eyeCrouch - move.eyeStand) * p.crouch;
}

export function currentStats(p, ctx) {
  const entry = ctx.stats[p.inv.current];
  return p.abilities.X.activeUntil > p.clock ? entry.boosted : entry.normal;
}

/**
 * @param p      player state (mutated)
 * @param cmd    UserCmd
 * @param ctx    { hf, move, stats, zones, canMove, canFire, adsMode, onShot, onAbility }
 * @param events array receiving gameplay events (may be null during prediction replay)
 */
export function runPlayerCmd(p, cmd, ctx, events) {
  const prev = p.lastButtons;
  p.clock += cmd.dt;
  p.yaw = cmd.yaw;
  p.pitch = cmd.pitch;

  if (!p.alive) {
    p.lastButtons = cmd.buttons;
    return;
  }

  rechargeAbilities(p);
  if (ctx.canFire) runAbilities(p, cmd, prev, ctx, events);

  const stats = currentStats(p, ctx);
  const inv = p.inv;
  let speedMul = stats.moveSpeedMul;
  if (inv.adsT > 0.5) speedMul *= stats.ads.moveSpeedMul;
  if (p.plantProgress > 0) speedMul = 0;
  stepMovement(p, cmd, prev, cmd.dt, ctx.hf, ctx.move, speedMul, ctx.canMove && p.plantProgress <= 0, events);

  runWeapon(p, cmd, prev, ctx, events);
  runPlant(p, cmd, ctx, events);
  p.lastButtons = cmd.buttons;
}

function rechargeAbilities(p) {
  const a = p.abilities;
  if (a.Q.charges < ABILITIES.Q.maxCharges && a.Q.rechargeAt > 0 && p.clock >= a.Q.rechargeAt) {
    a.Q.charges++;
    a.Q.rechargeAt = 0;
  }
  if (a.E.charges < ABILITIES.E.maxCharges && a.E.rechargeAt > 0 && p.clock >= a.E.rechargeAt) {
    a.E.charges++;
    a.E.rechargeAt = 0;
  }
}

function runAbilities(p, cmd, prev, ctx, events) {
  const a = p.abilities;
  const move = ctx.move;
  const eye = [p.pos[0], p.pos[1] + eyeHeight(p, move), p.pos[2]];
  const look = forwardFromAngles(p.yaw, p.pitch, [0, 0, 0]);

  if (pressed(cmd, prev, BTN.AB_C) && a.C.charges > 0) {
    a.C.charges--;
    events && events.push({ type: 'ability', key: 'C', id: p.id });
    ctx.onAbility && ctx.onAbility(p, 'C', eye, look);
  }
  if (pressed(cmd, prev, BTN.AB_Q) && a.Q.charges > 0) {
    a.Q.charges--;
    a.Q.rechargeAt = p.clock + ABILITIES.Q.recharge;
    events && events.push({ type: 'ability', key: 'Q', id: p.id });
    ctx.onAbility && ctx.onAbility(p, 'Q', eye, look);
  }
  if (pressed(cmd, prev, BTN.AB_E) && a.E.charges > 0) {
    a.E.charges--;
    a.E.rechargeAt = p.clock + ABILITIES.E.recharge;
    // Dash direction: current input, or forward when standing still.
    const b = cmd.buttons;
    const f = (b & BTN.FWD ? 1 : 0) - (b & BTN.BACK ? 1 : 0);
    const r = (b & BTN.RIGHT ? 1 : 0) - (b & BTN.LEFT ? 1 : 0);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let dx = -sy * (f || (r ? 0 : 1)) + cy * r;
    let dz = -cy * (f || (r ? 0 : 1)) - sy * r;
    const len = Math.hypot(dx, dz) || 1;
    p.dashDir = [dx / len, dz / len];
    p.dashTime = ctx.move.dash.duration;
    events && events.push({ type: 'ability', key: 'E', id: p.id });
  }
  if (pressed(cmd, prev, BTN.AB_X) && p.ultPoints >= ABILITIES.X.cost) {
    p.abilities.X.activeUntil = p.clock + ABILITIES.X.duration;
    events && events.push({ type: 'ability', key: 'X', id: p.id });
    ctx.onAbility && ctx.onAbility(p, 'X', eye, look);
  }
}

function runWeapon(p, cmd, prev, ctx, events) {
  const inv = p.inv;
  const b = cmd.buttons;

  // 1. Switching
  if (cmd.weapon && cmd.weapon !== inv.current && WEAPONS[cmd.weapon]) {
    inv.current = cmd.weapon;
    const s = currentStats(p, ctx);
    inv.equipEnd = p.clock + s.equipTime;
    inv.reloadEnd = 0;
    inv.adsLevel = 0;
    inv.inspectEnd = 0;
    resetRecoil(inv.recoil);
    events && events.push({ type: 'equip', id: p.id, weapon: inv.current, duration: s.equipTime });
  }
  const stats = currentStats(p, ctx);
  const slot = inv.slots[inv.current];
  const equipping = p.clock < inv.equipEnd;

  // 2. Reload completion / start
  if (inv.reloadEnd > 0 && p.clock >= inv.reloadEnd) {
    const need = stats.magSize - slot.ammo;
    const take = Math.min(need, slot.reserve);
    slot.ammo += take;
    slot.reserve -= take;
    inv.reloadEnd = 0;
    events && events.push({ type: 'reloadEnd', id: p.id, weapon: inv.current });
  }
  const wantReload = pressed(cmd, prev, BTN.RELOAD) || (slot.ammo === 0 && b & BTN.FIRE && !(prev & BTN.FIRE));
  if (wantReload && inv.reloadEnd === 0 && !equipping && slot.ammo < stats.magSize && slot.reserve > 0) {
    inv.reloadStart = p.clock;
    inv.reloadEnd = p.clock + stats.reloadTime;
    inv.adsLevel = 0;
    inv.inspectEnd = 0;
    events && events.push({ type: 'reloadStart', id: p.id, weapon: inv.current, duration: stats.reloadTime });
  }
  const reloading = inv.reloadEnd > 0;

  // 3. Aim down sights / scope cycling
  if (reloading || equipping || !p.alive) inv.adsLevel = 0;
  else if (stats.ads.cycle) {
    if (pressed(cmd, prev, BTN.ADS)) inv.adsLevel = (inv.adsLevel + 1) % (stats.ads.zooms.length + 1);
  } else if (ctx.adsMode === 'toggle') {
    if (pressed(cmd, prev, BTN.ADS)) inv.adsLevel = inv.adsLevel ? 0 : 1;
  } else {
    inv.adsLevel = b & BTN.ADS ? 1 : 0;
  }
  const adsTarget = inv.adsLevel > 0 ? 1 : 0;
  const adsRate = cmd.dt / Math.max(0.01, stats.ads.time);
  inv.adsT = inv.adsT < adsTarget ? Math.min(adsTarget, inv.adsT + adsRate) : Math.max(adsTarget, inv.adsT - adsRate * 1.4);
  if (inv.adsLevel > 0) inv.inspectEnd = 0;

  // 4. Inspect
  if (pressed(cmd, prev, BTN.INSPECT) && !reloading && !equipping && inv.adsLevel === 0) {
    inv.inspectEnd = p.clock + 2.4;
    events && events.push({ type: 'inspect', id: p.id, weapon: inv.current });
  }

  // 5. Fire
  const semiReady = stats.fireMode === 'auto' || !(prev & BTN.FIRE);
  if (ctx.canFire && b & BTN.FIRE && semiReady && !reloading && !equipping && p.clock >= inv.nextFire && slot.ammo > 0 && p.plantProgress <= 0) {
    fire(p, cmd, stats, ctx, events);
  }

  recoverRecoil(stats, p, cmd.dt);
}

function fire(p, cmd, stats, ctx, events) {
  const inv = p.inv;
  const slot = inv.slots[inv.current];
  const spread = computeSpread(stats, p, ctx.move);
  inv.shotSeq++;
  const dir = shotDirection(p, spread, p.seed, dirTmp);
  const origin = [p.pos[0], p.pos[1] + eyeHeight(p, ctx.move), p.pos[2]];
  slot.ammo--;
  // Keep exact cadence when the trigger is held; restart the clock after a pause.
  const due = p.clock - inv.nextFire < cmd.dt ? inv.nextFire : p.clock;
  inv.nextFire = due + stats.fireInterval;
  inv.inspectEnd = 0;
  const recoilIdx = Math.floor(inv.recoil.idx);
  const kick = applyShotRecoil(stats, p, p.seed);

  const shot = {
    type: 'shot',
    id: p.id,
    weapon: inv.current,
    seq: inv.shotSeq,
    origin,
    dir: [dir[0], dir[1], dir[2]],
    spread,
    recoilIdx,
    kick,
    ammo: slot.ammo,
    viewTime: cmd.viewTime,
  };
  if (ctx.onShot) ctx.onShot(p, shot, stats);
  events && events.push(shot);
}

function runPlant(p, cmd, ctx, events) {
  const holding = cmd.buttons & BTN.PLANT;
  let zone = null;
  if (holding && p.onGround && p.speed < 0.6 && ctx.canFire) {
    for (const key of Object.keys(ctx.zones)) {
      const z = ctx.zones[key];
      if (p.pos[0] >= z.x0 && p.pos[0] <= z.x1 && p.pos[2] >= z.z0 && p.pos[2] <= z.z1 && p.pos[1] >= z.y0 && p.pos[1] <= z.y1) zone = z;
    }
  }
  if (zone) {
    if (p.plantProgress === 0) events && events.push({ type: 'plantStart', id: p.id, site: zone.id });
    p.plantProgress = Math.min(ROUND.plantTime, p.plantProgress + cmd.dt);
    p.plantSite = zone.id;
  } else {
    if (p.plantProgress > 0 && p.plantProgress < ROUND.plantTime) events && events.push({ type: 'plantCancel', id: p.id });
    p.plantProgress = 0;
  }
}
