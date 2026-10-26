// Client-side prediction and reconciliation for the local player.
//
// Every locally generated UserCmd is (1) sent to the authority and (2) immediately run through
// the same runPlayerCmd() the server uses, so movement and firing respond on the same frame
// as the input. When a snapshot arrives, the predicted state is rebuilt from the server's
// state at the acknowledged sequence and all unacknowledged commands are replayed silently.
// Any residual difference becomes a visual offset that decays over ~100 ms instead of a snap.

import { runPlayerCmd } from '../sim/PlayerController.js';
import { clonePlayer } from '../sim/PlayerState.js';
export class ClientPredictor {
  constructor() {
    this.state = null;
    this.pending = [];
    this.prevPos = [0, 0, 0];
    this.correction = [0, 0, 0];
    this.stats = { reconciles: 0, replayed: 0, lastError: 0, maxError: 0 };
  }

  init(serverState) {
    this.state = clonePlayer(serverState);
    this.prevPos = this.state.pos.slice();
  }

  /** Predict one command. `events` receives first-time gameplay events for presentation. */
  predict(cmd, ctx, events) {
    this.pending.push(cmd);
    if (this.pending.length > 512) this.pending.shift();
    this.prevPos[0] = this.state.pos[0];
    this.prevPos[1] = this.state.pos[1];
    this.prevPos[2] = this.state.pos[2];
    runPlayerCmd(this.state, cmd, ctx, events);
  }

  reconcile(serverState, ackSeq, ctx) {
    while (this.pending.length && this.pending[0].seq <= ackSeq) this.pending.shift();
    const before = this.state.pos.slice();
    const beforePrev = this.prevPos.slice();
    this.state = clonePlayer(serverState);
    // Replay without events: these were already presented when first predicted.
    const replayCtx = { ...ctx, onShot: null, onAbility: null };
    for (const cmd of this.pending) runPlayerCmd(this.state, cmd, replayCtx, null);
    this.stats.replayed += this.pending.length;
    this.stats.reconciles++;

    const ex = before[0] - this.state.pos[0];
    const ey = before[1] - this.state.pos[1];
    const ez = before[2] - this.state.pos[2];
    const err = Math.hypot(ex, ey, ez);
    this.stats.lastError = err;
    this.stats.maxError = Math.max(this.stats.maxError * 0.995, err);
    if (err > 2) {
      // Teleport (respawn, round reset): no smoothing.
      this.correction = [0, 0, 0];
      this.prevPos = this.state.pos.slice();
    } else if (err > 1e-5) {
      this.correction[0] += ex;
      this.correction[1] += ey;
      this.correction[2] += ez;
      this.prevPos = [beforePrev[0] - ex, beforePrev[1] - ey, beforePrev[2] - ez];
    } else {
      this.prevPos = beforePrev;
    }
  }

  /** Decay the visual correction offset. */
  decay(dt) {
    const k = Math.exp(-dt * 18);
    this.correction[0] *= k;
    this.correction[1] *= k;
    this.correction[2] *= k;
  }

  renderPos(alpha, out) {
    const s = this.state.pos;
    out[0] = this.prevPos[0] + (s[0] - this.prevPos[0]) * alpha + this.correction[0];
    out[1] = this.prevPos[1] + (s[1] - this.prevPos[1]) * alpha + this.correction[1];
    out[2] = this.prevPos[2] + (s[2] - this.prevPos[2]) * alpha + this.correction[2];
    return out;
  }
}
