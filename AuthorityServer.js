// Authoritative server loop. Applies client commands in sequence order the moment they
// arrive (Source-style per-command movement), advances the world on a fixed 128 Hz tick,
// and publishes 64 Hz snapshots carrying the acknowledged command sequence.

import { Simulation, TICK_DT } from '../sim/Simulation.js';
import { clonePlayer } from '../sim/PlayerState.js';
export const SNAPSHOT_EVERY = 2; // ticks -> 64 Hz

export class AuthorityServer {
  constructor(mapAsset, link) {
    this.sim = new Simulation(mapAsset);
    this.link = link;
    this.acc = 0;
    this.ackSeq = new Map();
    this.sinceSnap = 0;
    this.stats = { ticks: 0, cmds: 0, snapshots: 0 };
  }

  update(nowMs, realDt) {
    for (const msg of this.link.up.receive(nowMs)) this.handle(msg);
    this.acc += Math.min(realDt, 0.25);
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.sim.tickWorld(TICK_DT);
      this.stats.ticks++;
      if (++this.sinceSnap >= SNAPSHOT_EVERY) {
        this.sinceSnap = 0;
        this.sendSnapshot(nowMs);
      }
    }
  }

  handle(msg) {
    const sim = this.sim;
    switch (msg.type) {
      case 'join':
        sim.addPlayer(msg.id, msg.loadout, msg.settings);
        sim.setDifficulty(msg.settings.difficulty);
        break;
      case 'cmd': {
        const last = this.ackSeq.get(msg.id) || 0;
        if (msg.cmd.seq <= last) return; // duplicate / out of order
        sim.applyCmd(msg.id, msg.cmd);
        this.ackSeq.set(msg.id, msg.cmd.seq);
        this.stats.cmds++;
        break;
      }
      case 'loadout':
        sim.setLoadout(msg.id, msg.loadout, msg.settings);
        break;
      case 'difficulty':
        sim.setDifficulty(msg.value);
        break;
      case 'restart':
        sim.round.wins = 0;
        sim.round.losses = 0;
        sim.round.number = 0;
        sim.round.phase = 'post';
        sim.round.phaseEnd = sim.time;
        break;
    }
  }

  sendSnapshot(nowMs) {
    const sim = this.sim;
    const p = sim.player;
    if (!p) return;
    this.stats.snapshots++;
    this.link.down.send(
      {
        type: 'snap',
        time: sim.time,
        tick: sim.tick,
        ack: this.ackSeq.get(p.id) || 0,
        player: clonePlayer(p),
        bots: sim.bots.map((b) => ({
          id: b.id,
          kind: b.kind,
          pos: b.pos,
          vel: b.vel,
          yaw: b.yaw,
          pitch: b.pitch,
          crouch: b.crouch,
          alive: b.alive,
          health: b.health,
          revealedUntil: b.revealedUntil,
          deathTime: b.deathTime,
        })),
        smokes: sim.smokes,
        reveals: sim.reveals,
        round: sim.round,
        events: sim.drainEvents(),
      },
      nowMs,
    );
  }
}
