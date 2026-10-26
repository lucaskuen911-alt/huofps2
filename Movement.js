// First-person movement. Pure function of (state, cmd, dt, collision world, tuning).
//
// Feel goals:
//  - High acceleration and deceleration: top speed in ~95 ms, full stop in ~75 ms.
//  - Counter-strafe dead-zone: pressing the opposite key zeroes that axis immediately, so the
//    player is "standing" (first-shot accurate) on the very next tick.
//  - Per-axis local-space integration: strafe and forward are independent, which makes
//    A-D peeks crisp instead of drifting.

import { BTN } from './UserCmd.js';
import { approach } from '../core/MathUtil.js';
const fp = { blocked: false, ground: 0, ceiling: 1e3, surface: 0 };

export function stepMovement(p, cmd, prevButtons, dt, hf, cfg, speedMul, canMove, events) {
  const b = canMove ? cmd.buttons : cmd.buttons & (BTN.CROUCH | BTN.WALK);
  const fwdIn = (b & BTN.FWD ? 1 : 0) - (b & BTN.BACK ? 1 : 0);
  const rightIn = (b & BTN.RIGHT ? 1 : 0) - (b & BTN.LEFT ? 1 : 0);
  const sy = Math.sin(cmd.yaw);
  const cy = Math.cos(cmd.yaw);

  // Crouch is a timed transition so the eye height never pops.
  p.crouch = approach(p.crouch, b & BTN.CROUCH ? 1 : 0, dt / cfg.crouchTime);

  let maxSpeed = cfg.runSpeed;
  if (p.crouch > 0.5) maxSpeed = cfg.crouchSpeed;
  else if (b & BTN.WALK) maxSpeed = cfg.walkSpeed;
  maxSpeed *= speedMul;
  if (p.landTimer > 0) {
    p.landTimer = Math.max(0, p.landTimer - dt);
    maxSpeed *= 0.7;
  }

  // Local-space velocity.
  let vF = -sy * p.vel[0] - cy * p.vel[2];
  let vR = cy * p.vel[0] - sy * p.vel[2];
  p.counterStrafed = false;

  if (p.dashTime > 0) {
    p.dashTime -= dt;
    p.vel[0] = p.dashDir[0] * cfg.dash.speed;
    p.vel[2] = p.dashDir[1] * cfg.dash.speed;
    if (p.dashTime <= 0) {
      // Exit the dash at run speed so it chains cleanly into normal movement.
      p.vel[0] = p.dashDir[0] * cfg.runSpeed;
      p.vel[2] = p.dashDir[1] * cfg.runSpeed;
    }
  } else if (p.onGround) {
    const norm = fwdIn !== 0 && rightIn !== 0 ? Math.SQRT1_2 : 1;
    vF = axisStep(p, vF, fwdIn, maxSpeed * norm, cfg, dt);
    vR = axisStep(p, vR, rightIn, maxSpeed * norm, cfg, dt);
    p.vel[0] = -sy * vF + cy * vR;
    p.vel[2] = -cy * vF - sy * vR;

    if (b & BTN.JUMP && !(prevButtons & BTN.JUMP) && p.crouch < 0.5) {
      p.vel[1] = cfg.jumpVelocity;
      p.onGround = false;
      events && events.push({ type: 'jump', id: p.id });
    }
  } else {
    // Air control: limited acceleration, never exceeds the cap unless already faster.
    const wx = -sy * fwdIn + cy * rightIn;
    const wz = -cy * fwdIn - sy * rightIn;
    const before = Math.hypot(p.vel[0], p.vel[2]);
    p.vel[0] += wx * cfg.airAccel * dt;
    p.vel[2] += wz * cfg.airAccel * dt;
    const after = Math.hypot(p.vel[0], p.vel[2]);
    const cap = Math.max(before, cfg.airSpeedCap * speedMul);
    if (after > cap) {
      p.vel[0] *= cap / after;
      p.vel[2] *= cap / after;
    }
  }

  if (!p.onGround) p.vel[1] -= cfg.gravity * dt;

  // Horizontal collision, axis-separated with contact refinement (no visible gaps at walls).
  const step = cfg.stepHeight;
  const height = cfg.standHeight + (cfg.crouchHeight - cfg.standHeight) * p.crouch;
  moveAxis(p, 0, p.vel[0] * dt, hf, cfg.radius, step, height);
  moveAxis(p, 2, p.vel[2] * dt, hf, cfg.radius, step, height);

  // Vertical: ground snapping keeps the hull glued to ramps and steps without floatiness.
  const prevY = p.pos[1];
  if (p.onGround) {
    hf.footprint(p.pos[0], p.pos[2], cfg.radius, p.pos[1], step, height, fp);
    if (fp.ground >= p.pos[1] - 0.55) {
      p.pos[1] = fp.ground;
      p.vel[1] = 0;
    } else {
      p.onGround = false;
      p.vel[1] = 0;
    }
  } else {
    p.pos[1] += p.vel[1] * dt;
    hf.footprint(p.pos[0], p.pos[2], cfg.radius, p.pos[1], step, height, fp);
    // Head against an overhang (catwalk underside, container stack): stop rising.
    if (p.vel[1] > 0 && p.pos[1] + height > fp.ceiling) {
      p.pos[1] = Math.max(fp.ground, fp.ceiling - height);
      p.vel[1] = 0;
    }
    if (p.vel[1] <= 0 && p.pos[1] <= fp.ground) {
      const impact = -p.vel[1];
      p.pos[1] = fp.ground;
      p.vel[1] = 0;
      p.onGround = true;
      if (impact > 6.5) p.landTimer = cfg.landingPenalty;
      events && events.push({ type: 'land', id: p.id, impact, surface: fp.surface });
    }
  }
  if (p.pos[1] < -5) p.pos[1] = 0; // safety net

  const speed = Math.hypot(p.vel[0], p.vel[2]);
  p.speed = speed;

  // Footsteps: running is audible; walking and crouching are silent.
  if (p.onGround && speed > cfg.walkSpeed + 0.4 && !(b & BTN.WALK) && p.crouch < 0.5) {
    p.stepAccum += speed * dt;
    if (p.stepAccum > 2.35) {
      p.stepAccum = 0;
      events && events.push({ type: 'footstep', id: p.id, pos: [p.pos[0], p.pos[1], p.pos[2]], surface: hf.surfaceBelow(p.pos[0], p.pos[1] + 0.05, p.pos[2]) });
    }
  } else if (speed < 0.5) {
    p.stepAccum = 1.6;
  }
  return prevY;
}

function axisStep(p, v, input, target, cfg, dt) {
  if (input !== 0) {
    if (cfg.counterStrafe && v * input < 0) {
      v = 0;
      p.counterStrafed = true;
    }
    const goal = input * target;
    const rate = Math.abs(v) > Math.abs(goal) ? cfg.groundDecel : cfg.groundAccel;
    return approach(v, goal, rate * dt);
  }
  return approach(v, 0, cfg.groundDecel * dt);
}

function moveAxis(p, axis, delta, hf, radius, step, height) {
  if (delta === 0) return;
  const start = p.pos[axis];
  p.pos[axis] = start + delta;
  hf.footprint(p.pos[0], p.pos[2], radius, p.pos[1], step, height, fp);
  if (!fp.blocked) return;
  // Bisect toward the contact point so the hull rests flush against the wall.
  let lo = 0, hi = 1;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    p.pos[axis] = start + delta * mid;
    hf.footprint(p.pos[0], p.pos[2], radius, p.pos[1], step, height, fp);
    if (fp.blocked) hi = mid;
    else lo = mid;
  }
  p.pos[axis] = start + delta * lo;
  p.vel[axis] = 0;
}
