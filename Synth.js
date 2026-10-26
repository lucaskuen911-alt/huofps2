// Tiny offline DSP toolkit. Every sound in the game is synthesised once at load into an
// AudioBuffer, so triggering a sound at runtime is a single BufferSource start(): no decoding,
// no scheduling jitter, sample-accurate with the frame that fired the shot.

import { makeRng } from '../core/Rng.js';
export class Buf {
  constructor(sr, seconds) {
    this.sr = sr;
    this.d = new Float32Array(Math.ceil(sr * seconds));
  }
  get length() {
    return this.d.length;
  }
}

export function noise(n, seed) {
  const r = makeRng(seed);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = r() * 2 - 1;
  return o;
}

export function lowpass(x, sr, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] = y;
  }
  return x;
}

export function highpass(x, sr, fc) {
  const a = Math.exp((-2 * Math.PI * fc) / sr);
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (py + x[i] - px);
    px = x[i];
    py = y;
    x[i] = y;
  }
  return x;
}

/** RBJ band-pass (constant skirt gain). */
export function bandpass(x, sr, fc, q) {
  const w = (2 * Math.PI * fc) / sr;
  const al = Math.sin(w) / (2 * q);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/** Multiply by attack-decay envelope. tau = decay time constant (s). */
export function envelope(x, sr, attack, tau, start = 0) {
  const s0 = Math.floor(start * sr);
  for (let i = 0; i < x.length; i++) {
    const t = (i - s0) / sr;
    if (t < 0) {
      x[i] = 0;
      continue;
    }
    const a = attack > 0 ? Math.min(1, t / attack) : 1;
    x[i] *= a * Math.exp(-t / tau);
  }
  return x;
}

/** Exponential sine sweep with decay. */
export function sweep(n, sr, f0, f1, sweepTime, tau, phase = 0) {
  const o = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = Math.min(1, t / sweepTime);
    const f = f0 * Math.pow(f1 / f0, k);
    ph += (2 * Math.PI * f) / sr;
    o[i] = Math.sin(ph) * Math.exp(-t / tau);
  }
  return o;
}

export function tone(n, sr, f, tau, start = 0, attack = 0.002) {
  const o = new Float32Array(n);
  const s0 = Math.floor(start * sr);
  for (let i = s0; i < n; i++) {
    const t = (i - s0) / sr;
    o[i] = Math.sin(2 * Math.PI * f * t) * Math.min(1, t / attack) * Math.exp(-t / tau);
  }
  return o;
}

/** Add `src` scaled by `gain` into `dst` starting at `offset` seconds. */
export function mixInto(dst, src, gain, sr, offset = 0) {
  const o = Math.floor(offset * sr);
  for (let i = 0; i < src.length && i + o < dst.length; i++) dst[i + o] += src[i] * gain;
  return dst;
}

export function softClip(x, drive) {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k;
  return x;
}

export function normalize(x, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Fade the last `ms` to silence to avoid clicks. */
export function fadeOut(x, sr, ms = 8) {
  const n = Math.floor((sr * ms) / 1000);
  for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n;
  return x;
}
