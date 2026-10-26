// First-person camera. Rotation comes straight from accumulated mouse input every frame
// (never interpolated, never smoothed). Position follows the predicted player with sub-tick
// interpolation. On top: recoil view-kick (a fraction of the true recoil offset), shot punch,
// landing dip, step smoothing, subtle bob, and tight FOV transitions for ADS/scopes.

import { mat4, compose, invertRigid, multiply, perspective, invert } from '../render/gl/Mat4.js';
import { Spring, DEG, clamp, easeOutCubic } from '../core/MathUtil.js';
const YAW_PER_COUNT = 0.07 * DEG; // tactical-shooter standard: sens 1.0 = 0.07 deg per count

export class CameraRig {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
    this.dispYaw = 0;
    this.dispPitch = 0;
    this.roll = 0;
    this.pos = [0, 0, 0];
    this.smoothY = null;
    this.punchPitch = new Spring(420, 30);
    this.punchRoll = new Spring(380, 30);
    this.dip = new Spring(260, 26);
    this.bobPhase = 0;
    this.fovH = 103 * DEG;
    this.zoom = 1;
    this.view = mat4();
    this.world = mat4();
    this.proj = mat4();
    this.viewProj = mat4();
    this.invViewProj = mat4();
    this.vmProj = mat4();
    this.vmViewProj = mat4();
    this.lastDYaw = 0;
    this.lastDPitch = 0;
  }

  /** Apply raw mouse counts. `scale` folds in ADS sensitivity. */
  applyMouse(dx, dy, sensitivity, scale) {
    const k = sensitivity * YAW_PER_COUNT * scale;
    const before = [this.yaw, this.pitch];
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch - dy * k, -88 * DEG, 88 * DEG);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.lastDYaw = -dx * k;
    this.lastDPitch = this.pitch - before[1];
  }

  onShot(punch, ads) {
    const k = ads ? 0.55 : 1;
    this.punchPitch.impulse(punch.pitch * 1.6 * k * DEG * 30);
    this.punchRoll.impulse((Math.random() - 0.5) * punch.roll * DEG * 40 * k);
  }

  onLand(impact) {
    this.dip.impulse(-Math.min(3, impact * 0.28));
  }

  /**
   * @param s { dt, renderPos, eye, onGround, speed, strafeVel, recoilYawDeg, recoilPitchDeg,
   *            viewKick, adsT, zoom, fovH, aspect, bob }
   */
  update(s) {
    const dt = s.dt;
    // Step smoothing: absorb small instantaneous height changes while grounded.
    const targetY = s.renderPos[1] + s.eye;
    if (this.smoothY === null || !s.onGround || Math.abs(targetY - this.smoothY) > 0.7) this.smoothY = targetY;
    else this.smoothY += (targetY - this.smoothY) * (1 - Math.exp(-dt * 24));

    const bobAmt = s.bob && s.onGround ? clamp(s.speed / 6.75, 0, 1) * (1 - s.adsT) : 0;
    this.bobPhase += dt * (4 + s.speed * 1.35);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.012 * bobAmt;
    const dip = this.dip.step(dt) * 0.03;

    this.pos[0] = s.renderPos[0];
    this.pos[1] = this.smoothY + bobY + dip;
    this.pos[2] = s.renderPos[2];

    const pp = this.punchPitch.step(dt);
    const pr = this.punchRoll.step(dt);
    // Only a fraction of the true recoil offset moves the camera: the rest is on the player.
    this.dispYaw = this.yaw - s.recoilYawDeg * s.viewKick * DEG;
    this.dispPitch = clamp(this.pitch + s.recoilPitchDeg * s.viewKick * DEG + pp, -89 * DEG, 89 * DEG);
    const strafeTilt = clamp(-s.strafeVel * 0.0011, -0.012, 0.012) * (s.bob ? 1 : 0);
    this.roll += (strafeTilt - this.roll) * Math.min(1, dt * 10);
    const roll = this.roll + pr;

    // FOV: horizontal base, ADS zoom with a tight ease.
    const zoomNow = 1 + (s.zoom - 1) * easeOutCubic(clamp(s.adsT, 0, 1));
    this.zoom = zoomNow;
    const hFov = 2 * Math.atan(Math.tan(s.fovH / 2) / zoomNow);
    const vFov = clamp(2 * Math.atan(Math.tan(hFov / 2) / s.aspect), 10 * DEG, 120 * DEG);
    this.vFov = vFov;

    compose(this.world, this.pos[0], this.pos[1], this.pos[2], this.dispPitch, this.dispYaw, roll);
    invertRigid(this.view, this.world);
    perspective(this.proj, vFov, s.aspect, 0.03, 260);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
    // Viewmodel: fixed 66 deg vertical FOV (narrowed slightly when aiming so sights fill more).
    const vmV = (56 - 10 * clamp(s.adsT, 0, 1)) * DEG;
    perspective(this.vmProj, vmV, s.aspect, 0.01, 6);
    multiply(this.vmViewProj, this.vmProj, this.view);
    this.dispRoll = roll;
  }

  /** Camera basis for billboards: right and up from the world matrix. */
  basis() {
    const w = this.world;
    return { pos: this.pos, right: [w[0], w[1], w[2]], up: [w[4], w[5], w[6]], fwd: [-w[8], -w[9], -w[10]] };
  }
}
