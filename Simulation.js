// The authoritative game world. Owns players, bots, round state, smokes and reveals.
// No rendering, no audio, no DOM: it can run in a worker, in Node, or on a dedicated server.

import { compileMap } from './MapCompiler.js';
import { CollisionWorld } from './World.js';
import { hash32 } from '../core/Rng.js';
import { createPlayerState, resetPlayerForRound } from './PlayerState.js';
import { runPlayerCmd, eyeHeight } from './PlayerController.js';
import { buildStatTable } from './WeaponBuilder.js';
import { traceEntities, damageFor, applyDamage } from './Hitscan.js';
import { createBots, resetBots, tickBots, hearSound, alertBot } from './Bots.js';
import { MOVEMENT } from '../data/movement.js';
import { ABILITIES } from '../data/abilities.js';
import { ROUND } from '../data/rules.js';
import { WEAPONS } from '../data/weapons.js';
export const TICK_RATE = 128;
export const TICK_DT = 1 / TICK_RATE;
const HISTORY_SECONDS = 1;

export class Simulation {
  constructor(mapAsset, seed = 1337) {
    this.map = compileMap(mapAsset);
    // Per-map rule overrides (Dockside 9 lengthens the barrier so the cranes can re-stack).
    this.rules = { ...ROUND, ...(mapAsset.rules || {}) };
    this.hf = new CollisionWorld(this.map);
    this.seed = seed;
    this.time = 0;
    this.tick = 0;
    this.players = new Map();
    this.playerCtx = new Map();
    this.bots = createBots(this.map, this.hf, seed);
    this.smokes = [];
    this.reveals = [];
    this.events = [];
    this.difficulty = 'veteran';
    this.history = []; // ring of { time, poses } for lag compensation
    this.nextEntityId = 1;
    this.round = { number: 0, phase: 'barrier', phaseEnd: 0, wins: 0, losses: 0, result: null, reason: '', plantedSite: null, startedAt: 0, variant: 0, prevVariant: 0 };
  }

  addPlayer(id, loadout, settings) {
    const p = createPlayerState(id, 0x5eed + id * 7919);
    this.players.set(id, p);
    this.setLoadout(id, loadout, settings);
    this.startRound();
    return p;
  }

  setLoadout(id, loadout, settings) {
    const stats = buildStatTable(loadout, ABILITIES.X.stats);
    this.playerCtx.set(id, { loadout, stats, adsMode: (settings && settings.adsMode) || 'hold' });
    const p = this.players.get(id);
    if (p) {
      for (const wid of Object.keys(stats)) {
        const slot = p.inv.slots[wid];
        slot.ammo = Math.min(slot.ammo, stats[wid].normal.magSize);
      }
    }
  }

  setDifficulty(d) {
    this.difficulty = d;
  }

  get player() {
    return this.players.values().next().value || null;
  }

  // ---------------------------------------------------------------- rounds
  startRound() {
    const r = this.round;
    r.number++;
    r.phase = 'barrier';
    r.phaseEnd = this.time + this.rules.barrierTime;
    r.result = null;
    r.reason = '';
    r.plantedSite = null;
    r.startedAt = this.time;
    // Map variant (Dockside 9 cranes re-stack containers every round). Chosen by the authority,
    // replicated in the round snapshot; never the same layout twice in a row.
    const variants = this.map.variants;
    if (variants) {
      const n = variants.layouts.length;
      r.prevVariant = r.variant;
      let v = r.number === 1 ? variants.first || 0 : hash32(this.seed, r.number, 0xc4a9e) % n;
      if (r.number > 1 && v === r.prevVariant) v = (v + 1) % n;
      r.variant = v;
      if (r.number === 1) r.prevVariant = v;
      this.hf.setVariant(v);
    }
    this.smokes = [];
    this.reveals = [];
    resetBots(this.bots, this.seed + r.number);
    for (const [id, p] of this.players) {
      const stats = this.playerCtx.get(id).stats;
      const mags = {};
      for (const wid of Object.keys(stats)) mags[wid] = stats[wid].normal.magSize;
      resetPlayerForRound(p, this.map.spawns.player, mags);
    }
    this.events.push({ type: 'round', phase: 'barrier', number: r.number });
  }

  endRound(result, reason) {
    const r = this.round;
    if (r.phase !== 'live') return;
    r.phase = 'post';
    r.result = result;
    r.reason = reason;
    r.phaseEnd = this.time + ROUND.postTime;
    if (result === 'win') r.wins++;
    else r.losses++;
    this.events.push({ type: 'round', phase: 'post', result, reason, number: r.number });
  }

  tickRound() {
    const r = this.round;
    const p = this.player;
    if (r.phase === 'barrier' && this.time >= r.phaseEnd) {
      r.phase = 'live';
      r.phaseEnd = this.time + ROUND.roundTime;
      this.events.push({ type: 'round', phase: 'live', number: r.number });
    } else if (r.phase === 'live') {
      const hostilesLeft = this.bots.filter((b) => b.kind === 'hostile' && b.alive).length;
      if (p && p.plantProgress >= ROUND.plantTime) {
        r.plantedSite = p.plantSite;
        this.events.push({ type: 'planted', site: p.plantSite });
        this.endRound('win', `Spike planted on ${p.plantSite}`);
      } else if (hostilesLeft === 0) this.endRound('win', 'All hostiles eliminated');
      else if (p && !p.alive) this.endRound('loss', 'You were eliminated');
      else if (this.time >= r.phaseEnd) this.endRound('loss', 'Time expired');
    } else if (r.phase === 'post' && this.time >= r.phaseEnd) {
      this.startRound();
    }
  }

  // ---------------------------------------------------------------- commands
  /** Process one client command authoritatively. */
  applyCmd(id, cmd) {
    const p = this.players.get(id);
    if (!p) return;
    const pc = this.playerCtx.get(id);
    const live = this.round.phase === 'live';
    const ctx = {
      hf: this.hf,
      move: MOVEMENT,
      stats: pc.stats,
      zones: this.map.zones,
      adsMode: pc.adsMode,
      canMove: this.round.phase !== 'barrier',
      canFire: live,
      onShot: (pl, shot, stats) => this.resolveShot(pl, shot, stats),
      onAbility: (pl, key, eye, look) => this.resolveAbility(pl, key, eye, look),
    };
    const evs = [];
    runPlayerCmd(p, cmd, ctx, evs);
    for (const e of evs) {
      e.authoritative = true;
      e.fromPlayer = true;
      if (e.type === 'footstep') hearSound(this.bots, e.pos, 20, this.time);
      if (e.type === 'shot') hearSound(this.bots, e.origin, 32, this.time);
      this.events.push(e);
    }
  }

  resolveShot(p, shot, stats) {
    const [ox, oy, oz] = shot.origin;
    const [dx, dy, dz] = shot.dir;
    const wall = this.hf.raycast(ox, oy, oz, dx, dy, dz, 200);
    const wallT = wall ? wall.t : 200;
    const wallHit = wall ? { pos: [wall.x, wall.y, wall.z], normal: [wall.nx, wall.ny, wall.nz], surface: wall.surface } : null;
    // Lag compensation: test against bot poses as the shooter saw them.
    const poses = this.posesAt(shot.viewTime);
    const ent = traceEntities(ox, oy, oz, dx, dy, dz, wallT, this.bots, poses);
    shot.end = ent ? [ox + dx * ent.t, oy + dy * ent.t, oz + dz * ent.t] : wallHit ? wallHit.pos : [ox + dx * 200, oy + dy * 200, oz + dz * 200];
    shot.impact = ent ? null : wallHit;
    if (!ent) return;
    const bot = ent.entity;
    const dmg = damageFor(stats, ent.zone, ent.t);
    const res = applyDamage(bot, dmg);
    alertBot(bot, p.pos, this.time);
    shot.hitBot = bot.id;
    this.events.push({ type: 'hit', id: p.id, target: bot.id, zone: ent.zone, amount: res.dealt, killed: res.killed, armorBroke: res.armorBroke, pos: shot.end, weapon: shot.weapon });
    if (res.killed) {
      bot.deathTime = this.time;
      if (bot.kind === 'hostile') p.ultPoints = Math.min(ABILITIES.X.cost, p.ultPoints + 1);
      this.events.push({ type: 'kill', killer: p.id, victim: bot.id, victimKind: bot.kind, weapon: shot.weapon, headshot: ent.zone === 'head', pos: bot.pos.slice() });
    }
  }

  resolveAbility(p, key, eye, look) {
    const def = ABILITIES[key];
    if (key === 'C' || key === 'Q') {
      const hit = this.hf.raycast(eye[0], eye[1], eye[2], look[0], look[1], look[2], def.range);
      const pos = hit
        ? [hit.x + hit.nx * 0.2, hit.y + hit.ny * 0.2, hit.z + hit.nz * 0.2]
        : [eye[0] + look[0] * def.range, eye[1] + look[1] * def.range, eye[2] + look[2] * def.range];
      if (key === 'C') {
        const ground = this.hf.groundBelow(pos[0], pos[1] + 0.1, pos[2]);
        pos[1] = Math.max(ground + def.radius * 0.55, pos[1]);
        const smoke = { id: this.nextEntityId++, pos, radius: def.radius, until: this.time + def.duration, born: this.time };
        this.smokes.push(smoke);
        this.events.push({ type: 'smoke', smoke, from: eye });
      } else {
        const revealed = [];
        for (const b of this.bots) {
          if (!b.alive || b.kind !== 'hostile') continue;
          if (Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[2]) <= def.radius) {
            b.revealedUntil = this.time + def.duration;
            revealed.push(b.id);
          }
        }
        this.reveals.push({ pos, radius: def.radius, born: this.time, until: this.time + 1.2 });
        this.events.push({ type: 'reveal', pos, radius: def.radius, revealed, from: eye });
      }
    } else if (key === 'X') {
      p.ultPoints = 0;
      p.armor = Math.max(p.armor, ABILITIES.X.armorRefill);
    }
  }

  // ---------------------------------------------------------------- world tick
  tickWorld(dt) {
    this.time += dt;
    this.tick++;
    const p = this.player;
    tickBots(
      {
        time: this.time,
        tick: this.tick,
        hf: this.hf,
        bots: this.bots,
        player: p,
        smokes: this.smokes,
        difficulty: this.difficulty,
        roundLive: this.round.phase === 'live',
        events: this.events,
        onPlayerKilled: (bot) => this.events.push({ type: 'kill', killer: bot.id, victim: p.id, victimKind: 'player', weapon: 'bot', headshot: false, pos: p.pos.slice() }),
      },
      dt,
    );
    this.smokes = this.smokes.filter((s) => s.until > this.time);
    this.reveals = this.reveals.filter((r) => r.until > this.time);
    this.tickRound();
    this.recordHistory();
  }

  recordHistory() {
    const poses = this.bots.map((b) => ({ pos: b.pos.slice(), crouch: b.crouch }));
    this.history.push({ time: this.time, poses });
    while (this.history.length && this.history[0].time < this.time - HISTORY_SECONDS) this.history.shift();
  }

  /** Bot poses interpolated at `t` (clamped to the history window). */
  posesAt(t) {
    const h = this.history;
    if (!h.length || t === undefined || t >= this.time) return null;
    if (t <= h[0].time) return h[0].poses;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.time && t <= b.time) {
        const k = (t - a.time) / (b.time - a.time || 1);
        return a.poses.map((pa, j) => {
          const pb = b.poses[j];
          return {
            pos: [pa.pos[0] + (pb.pos[0] - pa.pos[0]) * k, pa.pos[1] + (pb.pos[1] - pa.pos[1]) * k, pa.pos[2] + (pb.pos[2] - pa.pos[2]) * k],
            crouch: pa.crouch + (pb.crouch - pa.crouch) * k,
          };
        });
      }
    }
    return null;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  eyeOf(p) {
    return [p.pos[0], p.pos[1] + eyeHeight(p, MOVEMENT), p.pos[2]];
  }

  weaponDef(id) {
    return WEAPONS[id];
  }
}
