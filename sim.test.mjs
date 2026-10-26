// Headless tests for the gameplay core. Run: node test/sim.test.mjs
// These exercise the exact modules the browser runs: no mocks of gameplay code.

import { SALTWORKS } from '../src/data/maps/saltworks.js';
import { compileMap } from '../src/sim/MapCompiler.js';
import { MOVEMENT } from '../src/data/movement.js';
import { createPlayerState } from '../src/sim/PlayerState.js';
import { runPlayerCmd } from '../src/sim/PlayerController.js';
import { buildStatTable, buildWeaponStats } from '../src/sim/WeaponBuilder.js';
import { computeSpread } from '../src/sim/Recoil.js';
import { BTN, makeCmd } from '../src/sim/UserCmd.js';
import { ABILITIES } from '../src/data/abilities.js';
import { DEFAULT_LOADOUT } from '../src/data/settings.js';
import { AuthorityServer } from '../src/net/AuthorityServer.js';
import { ClientPredictor } from '../src/net/ClientPredictor.js';
import { createLoopback } from '../src/net/Transport.js';
import { TICK_DT } from '../src/sim/Simulation.js';
import { DOCKSIDE9 } from '../src/data/maps/dockside9.js';
import { CollisionWorld } from '../src/sim/World.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}

const map = compileMap(SALTWORKS);
const hf = new CollisionWorld(map);
const grid = map.legacyGrid;
const stats = buildStatTable(DEFAULT_LOADOUT, ABILITIES.X.stats);

function ctxFor(extra = {}) {
  return { hf, move: MOVEMENT, stats, zones: map.zones, canMove: true, canFire: true, adsMode: 'hold', ...extra };
}
function spawnPlayer() {
  const p = createPlayerState(1, 42);
  p.pos = map.spawns.player.pos.slice();
  p.inv.equipEnd = 0;
  return p;
}
let seq = 0;
const cmd = (buttons, yaw = 0, pitch = 0, weapon = null) => makeCmd(++seq, TICK_DT, buttons, yaw, pitch, weapon, undefined);

// ---- map
check('legacy grid compiles 48x40 to merged brushes', grid.cols === 48 && grid.rows === 40 && map.brushes.length < 48 * 40 / 3, `${map.brushes.length} brushes`);
check('player spawn exists', !!map.spawns.player);
check('9 hostiles + 3 dummies', map.spawns.hostiles.length === 9 && map.spawns.dummies.length === 3, `${map.spawns.hostiles.length}/${map.spawns.dummies.length}`);
check('two plant zones', !!map.zones.A && !!map.zones.B);
// A heaven ramp: col 1 rows 5..8 rising north into 2.5 m platform
const rampTop = hf.heightAt(grid.originX + 1 * 2 + 1, grid.originZ + 5 * 2 + 0.01);
const rampBottom = hf.heightAt(grid.originX + 1 * 2 + 1, grid.originZ + 9 * 2 - 0.01);
check('ramp interpolates 2.5 -> 0', Math.abs(rampTop - 2.5) < 0.05 && Math.abs(rampBottom) < 0.05, `${rampTop.toFixed(2)} / ${rampBottom.toFixed(2)}`);
check('elevation markers generated', map.elevationMarkers.length >= 3, `${map.elevationMarkers.length}`);

// ---- raycast
const s = map.spawns.player.pos;
const down = hf.raycast(s[0], 1.6, s[2], 0, -1, 0, 10);
check('ray down hits floor at y=0', down && Math.abs(down.y) < 1e-6 && down.ny === 1);
const south = hf.raycast(s[0], 1.6, s[2], 0, 0, 1, 100);
check('ray south hits spray wall', south && south.nz === -1 && Math.abs(south.z - (grid.originZ + 39 * 2)) < 1e-6, south && south.z.toFixed(2));

// ---- movement
{
  const p = spawnPlayer();
  for (let i = 0; i < 128; i++) runPlayerCmd(p, cmd(BTN.FWD), ctxFor(), null);
  check('reaches run speed', Math.abs(p.speed - MOVEMENT.runSpeed) < 0.01, p.speed.toFixed(3));
  let ticksToMax = 0;
  const q = spawnPlayer();
  while (q.speed < MOVEMENT.runSpeed - 0.01 && ticksToMax < 100) { runPlayerCmd(q, cmd(BTN.FWD), ctxFor(), null); ticksToMax++; }
  check('top speed within 100 ms', ticksToMax * TICK_DT <= 0.1, `${(ticksToMax * TICK_DT * 1000).toFixed(0)} ms`);
}
{
  // Counter-strafe: strafe right at full speed, then tap left.
  const p = spawnPlayer();
  for (let i = 0; i < 64; i++) runPlayerCmd(p, cmd(BTN.RIGHT), ctxFor(), null);
  const before = p.speed;
  runPlayerCmd(p, cmd(BTN.LEFT), ctxFor(), null);
  check('counter-strafe zeroes velocity in one tick', p.counterStrafed && p.speed < MOVEMENT.runSpeed * MOVEMENT.accurateSpeedFraction, `${before.toFixed(2)} -> ${p.speed.toFixed(2)} m/s`);
  const spread = computeSpread(stats.halberd.normal, p, MOVEMENT);
  check('counter-strafed shot has base accuracy', Math.abs(spread - stats.halberd.normal.spread.base) < 1e-9, `${spread.toFixed(3)} deg`);
  // Releasing without counter-strafe takes longer
  const r = spawnPlayer();
  for (let i = 0; i < 64; i++) runPlayerCmd(r, cmd(BTN.RIGHT), ctxFor(), null);
  let n = 0;
  while (r.speed > MOVEMENT.runSpeed * MOVEMENT.accurateSpeedFraction) { runPlayerCmd(r, cmd(0), ctxFor(), null); n++; }
  check('key release reaches accuracy in <= 60 ms', n * TICK_DT <= 0.06, `${(n * TICK_DT * 1000).toFixed(0)} ms`);
}
{
  // Walk into a wall: no penetration, flush contact.
  const p = spawnPlayer();
  for (let i = 0; i < 400; i++) runPlayerCmd(p, cmd(BTN.BACK), ctxFor(), null);
  const wallZ = grid.originZ + 39 * 2;
  check('wall collision flush', p.pos[2] <= wallZ - MOVEMENT.radius + 1e-6 && p.pos[2] > wallZ - MOVEMENT.radius - 0.02, (wallZ - p.pos[2]).toFixed(4));
}
{
  // Jump onto a 1.1 m crate (A main crate at col 5,row 24): approach from south.
  const p = spawnPlayer();
  p.pos = [grid.originX + 5 * 2 + 1, 0, grid.originZ + 26 * 2 + 1];
  let maxY = 0;
  for (let i = 0; i < 160; i++) {
    runPlayerCmd(p, cmd(BTN.FWD | (i === 20 ? BTN.JUMP : 0)), ctxFor(), null);
    maxY = Math.max(maxY, p.pos[1]);
  }
  check('can mantle a 1.1 m crate', Math.abs(p.pos[1] - 1.1) < 1e-6 || maxY >= 1.1, `y=${p.pos[1].toFixed(2)}`);
}
{
  // Walk up the A heaven ramp onto the platform.
  const p = spawnPlayer();
  p.pos = [grid.originX + 1 * 2 + 1.0, 0, grid.originZ + 10 * 2 + 1];
  for (let i = 0; i < 400; i++) runPlayerCmd(p, cmd(BTN.FWD), ctxFor(), null);
  check('walks up ramp to heaven', Math.abs(p.pos[1] - 2.5) < 1e-6, `y=${p.pos[1].toFixed(2)}`);
}

// ---- weapons and recoil
{
  const a = buildWeaponStats('halberd', ['compensator']);
  check('compensator scales pattern pitch', Math.abs(a.recoil.pattern[3][1] - 0.68 * 0.82) < 1e-9);
  const b = buildWeaponStats('halberd', ['compensator', 'suppressor']);
  check('one attachment per slot', b.attachments.length === 1);
  const c = buildWeaponStats('hornet', ['extmag']);
  check('extended mag rounds', c.magSize === 39, `${c.magSize}`);
}
{
  const p1 = spawnPlayer();
  const p2 = spawnPlayer();
  const shots1 = [], shots2 = [];
  const ctx1 = ctxFor({ onShot: (p, shot) => shots1.push(shot.dir) });
  const ctx2 = ctxFor({ onShot: (p, shot) => shots2.push(shot.dir) });
  for (let i = 0; i < 400; i++) {
    runPlayerCmd(p1, cmd(BTN.FIRE), ctx1, null);
    runPlayerCmd(p2, cmd(BTN.FIRE), ctx2, null);
  }
  check('full mag fired', shots1.length === 25, `${shots1.length}`);
  check('recoil + spread deterministic across instances', JSON.stringify(shots1) === JSON.stringify(shots2));
  const first = shots1[0];
  const err = Math.acos(Math.min(1, -first[2])) * 180 / Math.PI;
  check('first shot within base spread', err <= 0.25 + 1e-6, `${err.toFixed(3)} deg`);
  // Vertical climb over the fixed pattern
  const pitchDeg = (d) => Math.asin(d[1]) * 180 / Math.PI;
  check('pattern climbs', pitchDeg(shots1[9]) > pitchDeg(shots1[1]) + 3, `${pitchDeg(shots1[1]).toFixed(2)} -> ${pitchDeg(shots1[9]).toFixed(2)}`);
  // Cadence
  check('ammo 0 after spray', p1.inv.slots.halberd.ammo === 0);
}
{
  // Fire-rate cadence: 585 rpm => 9.75 shots per second
  const p = spawnPlayer();
  p.inv.slots.halberd.ammo = 1000;
  let shots = 0;
  const ctx = ctxFor({ onShot: () => shots++ });
  for (let i = 0; i < 128 * 2; i++) runPlayerCmd(p, cmd(BTN.FIRE), ctx, null);
  check('fire rate matches rpm', Math.abs(shots - 19.5) <= 1, `${shots} shots in 2 s`);
}

// ---- netcode: prediction stays exact under latency + jitter
{
  const link = createLoopback();
  const server = new AuthorityServer(SALTWORKS, link);
  link.up.send({ type: 'join', id: 1, loadout: DEFAULT_LOADOUT, settings: { adsMode: 'hold', difficulty: 'recruit' } }, 0);
  server.update(0, 0);
  link.up.setConditions(70, 25);
  link.down.setConditions(70, 25);
  const pred = new ClientPredictor();
  pred.init(server.sim.player);
  const ctx = ctxFor({ canMove: true, canFire: true });
  let now = 0, seqN = 0, yaw = 0, worst = 0;
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  let buttons = 0;
  for (let i = 0; i < 128 * 6; i++) {
    now += 1000 / 128;
    if (i % 24 === 0) buttons = [BTN.FWD, BTN.LEFT, BTN.RIGHT, BTN.FWD | BTN.RIGHT, BTN.BACK, BTN.FWD | BTN.JUMP][Math.floor(rnd() * 6)];
    yaw += (rnd() - 0.5) * 0.05;
    const c = makeCmd(++seqN, TICK_DT, buttons, yaw, 0, null, undefined);
    const r = server.sim.round;
    ctx.canMove = r.phase !== 'barrier';
    ctx.canFire = r.phase === 'live';
    link.up.send({ type: 'cmd', id: 1, cmd: c }, now);
    pred.predict(c, ctx, null);
    server.update(now, TICK_DT);
    for (const m of link.down.receive(now)) {
      if (m.type === 'snap') {
        ctx.canMove = m.round.phase !== 'barrier';
        ctx.canFire = m.round.phase === 'live';
        pred.reconcile(m.player, m.ack, ctx);
        if (i > 128 * 4) worst = Math.max(worst, pred.stats.lastError);
      }
    }
  }
  check('prediction error under 140 ms RTT + jitter', worst < 1e-3, `${worst.toExponential(2)} m over ${pred.stats.reconciles} reconciles`);
}

// ---- lag compensation: shoot where the client SAW a moving dummy
{
  const link = createLoopback();
  const server = new AuthorityServer(SALTWORKS, link);
  link.up.send({ type: 'join', id: 1, loadout: DEFAULT_LOADOUT, settings: { adsMode: 'hold', difficulty: 'recruit' } }, 0);
  server.update(0, 0);
  link.up.setConditions(100, 0);
  link.down.setConditions(100, 0);
  let now = 0;
  const snaps = [];
  for (let i = 0; i < 128 * 4; i++) {
    now += 1000 / 128;
    server.update(now, TICK_DT);
    for (const m of link.down.receive(now)) snaps.push(m);
  }
  // Client view: latest snapshot is ~100 ms old. Aim at the strafing dummy's chest as seen.
  const last = snaps[snaps.length - 1];
  const dummy = last.bots.find((b) => b.kind === 'dummy');
  const sp = server.sim.player;
  const eye = [sp.pos[0], sp.pos[1] + MOVEMENT.eyeStand, sp.pos[2]];
  const tx = dummy.pos[0] - eye[0], ty = dummy.pos[1] + 1.1 - eye[1], tz = dummy.pos[2] - eye[2];
  const yaw = Math.atan2(-tx, -tz);
  const pitch = Math.atan2(ty, Math.hypot(tx, tz));
  const nowBot = server.sim.bots.find((b) => b.id === dummy.id);
  const drift = Math.hypot(nowBot.pos[0] - dummy.pos[0], nowBot.pos[2] - dummy.pos[2]);
  sp.inv.equipEnd = 0;
  server.sim.round.phase = 'live';
  server.sim.round.phaseEnd = server.sim.time + 50;
  let hit = false;
  const c = makeCmd(1, TICK_DT, BTN.FIRE, yaw, pitch, null, last.time);
  server.sim.applyCmd(1, c);
  for (const e of server.sim.drainEvents()) if (e.type === 'hit' && e.target === dummy.id) hit = true;
  check('lag-compensated hit on 100 ms-old view', hit, `target moved ${drift.toFixed(2)} m since that snapshot`);
}

// ---- bots engage
{
  const link = createLoopback();
  const server = new AuthorityServer(SALTWORKS, link);
  link.up.send({ type: 'join', id: 1, loadout: DEFAULT_LOADOUT, settings: { adsMode: 'hold', difficulty: 'elite' } }, 0);
  server.update(0, 0);
  const p = server.sim.player;
  // Stand in mid, in view of the mid-top bot.
  p.pos = [grid.originX + 26 * 2 + 1, 0, grid.originZ + 19 * 2 + 1];
  let damaged = false, now = 0;
  for (let i = 0; i < 128 * 8 && !damaged; i++) {
    now += 1000 / 128;
    server.update(now, TICK_DT);
    for (const m of link.down.receive(now)) for (const e of m.events) if (e.type === 'playerDamaged') damaged = true;
  }
  check('hostile bot engages a visible player', damaged);
}

// ---- round rules: plant wins, elimination wins
{
  const link = createLoopback();
  const server = new AuthorityServer(SALTWORKS, link);
  link.up.send({ type: 'join', id: 1, loadout: DEFAULT_LOADOUT, settings: { adsMode: 'hold', difficulty: 'recruit' } }, 0);
  server.update(0, 0);
  const sim = server.sim;
  sim.round.phase = 'live';
  sim.round.phaseEnd = sim.time + 60;
  const p = sim.player;
  const z = map.zones.A;
  p.pos = [z.x0 + 1, 0, z.z0 + 1];
  for (const b of sim.bots) b.alive = b.kind !== 'hostile' ? b.alive : false;
  sim.bots.find((b) => b.kind === 'hostile').alive = true; // keep one alive so only the plant can end it
  sim.bots.forEach((b) => (b.pos = [0, -50, 0]));
  let result = null;
  for (let i = 0; i < 128 * 4 && !result; i++) {
    sim.applyCmd(1, makeCmd(1000 + i, TICK_DT, BTN.PLANT, 0, 0, null, undefined));
    sim.tickWorld(TICK_DT);
    for (const e of sim.drainEvents()) if (e.type === 'round' && e.phase === 'post') result = e;
  }
  check('holding plant in site A wins the round', result && result.result === 'win' && /planted/.test(result.reason), result && result.reason);
  for (let i = 0; i < 128 * 5; i++) sim.tickWorld(TICK_DT);
  check('next round starts after post phase', sim.round.phase !== 'post' && sim.round.number === 2, `${sim.round.phase} #${sim.round.number}`);
  sim.round.phase = 'live';
  sim.round.phaseEnd = sim.time + 60;
  for (const b of sim.bots) if (b.kind === 'hostile') b.alive = false;
  sim.tickWorld(TICK_DT);
  const ev = sim.drainEvents().find((e) => e.type === 'round' && e.phase === 'post');
  check('eliminating every hostile wins the round', ev && ev.result === 'win', ev && ev.reason);
}

// ---- Dockside 9: brush map, crane layouts, sites, bots on valid floors
{
  const dm = compileMap(DOCKSIDE9);
  const w = new CollisionWorld(dm);
  check('dockside9 compiles', dm.brushes.length > 300, `${dm.brushes.length} brushes, ${dm.models.length} models`);
  check('dockside9 9 hostiles + 3 dummies', dm.spawns.hostiles.length === 9 && dm.spawns.dummies.length === 3);
  check('dockside9 sites A and B', !!dm.zones.A && !!dm.zones.B);
  check('dockside9 three crane layouts', dm.variants.layouts.length === 3 && dm.crane && Object.keys(dm.crane.objects).length === 6);
  // Every hostile post stands on a real floor at its authored height (catwalk, nest, deck...).
  const bad = dm.spawns.hostiles.filter((h) => Math.abs(w.groundBelow(h.pos[0], h.pos[1] + 0.05, h.pos[2]) - h.pos[1]) > 0.06);
  check('dockside9 hostile posts on floors', bad.length === 0, bad.map((h) => h.pos.map((x) => x.toFixed(1)).join(',')).join(' | '));
  // Crane layouts really change collision: object A sits in slot v1a in layout 0, v2a in layout 1.
  const S = dm.crane.slots;
  w.setVariant(0);
  const a0 = w.pointSolid(S.v1a.x, 1.0, S.v1a.z, 1), b0 = w.pointSolid(S.v2a.x, 1.0, S.v2a.z, 1);
  w.setVariant(1);
  const a1 = w.pointSolid(S.v1a.x, 1.0, S.v1a.z, 1), b1 = w.pointSolid(S.v2a.x, 1.0, S.v2a.z, 1);
  check('crane layout switches collision', a0 && !b0 && !a1 && b1, `v1a ${a0}->${a1}, v2a ${b0}->${b1}`);
  // A bullet fired down lane W in layout 0 is stopped by the cross stack; in layout 1 it is not.
  const lw = S.xw;
  w.setVariant(0);
  const hit0 = w.raycast(lw.x, 1.3, lw.z + 8, 0, 0, -1, 16, 2);
  w.setVariant(1);
  const hit1 = w.raycast(lw.x, 1.3, lw.z + 8, 0, 0, -1, 16, 2);
  check('cross stack blocks lane W only when placed', !!hit0 && !hit1);
  // Planting on B (the pier) wins the round; the barrier is long enough for the crane re-stack.
  const link = createLoopback();
  const server = new AuthorityServer(DOCKSIDE9, link);
  link.up.send({ type: 'join', id: 1, loadout: DEFAULT_LOADOUT, settings: { adsMode: 'hold', difficulty: 'recruit' } }, 0);
  server.update(0, 0);
  const sim = server.sim;
  check('dockside9 barrier fits the crane', sim.rules.barrierTime >= 6, `${sim.rules.barrierTime} s`);
  sim.round.phase = 'live';
  sim.round.phaseEnd = sim.time + 60;
  const z = dm.zones.B;
  sim.player.pos = [z.x0 + 1, 0, z.z1 - 1];
  for (const b of sim.bots) b.pos = [0, -50, 0];
  let result = null;
  for (let i = 0; i < 128 * 5 && !result; i++) {
    sim.applyCmd(1, makeCmd(5000 + i, TICK_DT, BTN.PLANT, 0, 0, null, undefined));
    sim.tickWorld(TICK_DT);
    for (const e of sim.drainEvents()) if (e.type === 'round' && e.phase === 'post') result = e;
  }
  check('planting on B (pier) wins', result && result.result === 'win', result && result.reason);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
