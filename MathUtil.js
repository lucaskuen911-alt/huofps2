// Scalar helpers shared by simulation and presentation.
// Pure functions only: safe to run on an authoritative server.

export const DEG = Math.PI / 180;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Move `v` toward `target` by at most `maxDelta` (linear, framerate-safe). */
export function approach(v, target, maxDelta) {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/** Exponential smoothing that is independent of frame rate. */
export function damp(a, b, lambda, dt) {
  return b + (a - b) * Math.exp(-lambda * dt);
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Forward vector for the engine's yaw/pitch convention (yaw 0 looks down -Z, +yaw turns left). */
export function forwardFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

export function length2(x, z) {
  return Math.sqrt(x * x + z * z);
}

/**
 * Critically-damped spring. Used for camera punch, viewmodel kick and sway so every
 * transient returns to rest without overshoot ("zero floatiness").
 */
export class Spring {
  constructor(stiffness = 300, damping = 2 * Math.sqrt(300)) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }
  impulse(v) {
    this.v += v;
  }
  step(dt, target = 0) {
    // Semi-implicit Euler with sub-steps keeps stiff springs stable at low frame rates.
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}
