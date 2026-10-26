// Runtime audio: pre-rendered buffers, layered weapon reports, positional cues.
//
// Positional model (cheap, readable, competitive-friendly):
//   - equal-power stereo pan from the listener's right vector
//   - distance gain 1 / (1 + d / 9)
//   - distance low-pass (air absorption) and propagation delay (d / 343 m/s)
//   - occlusion: a blocked line of sight darkens and quietens the sound
// Voices are capped per sound so a full-auto spray never smears into mud.

import { buildSoundBank } from './SoundBank.js';
const MAX_VOICES = { tail: 3, boom: 6, click: 4, default: 8 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.voices = new Map();
    this.listener = { pos: [0, 0, 0], yaw: 0 };
    this.occlusion = null;
    this.volume = 0.8;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);
    const raw = buildSoundBank(ctx.sampleRate);
    for (const [name, data] of Object.entries(raw)) {
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(data, 0);
      this.buffers[name] = b;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get latencyMs() {
    if (!this.ctx) return 0;
    return ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
  }

  setListener(pos, yaw) {
    this.listener.pos = pos;
    this.listener.yaw = yaw;
  }

  /**
   * @param name buffer key
   * @param o { gain, rate, pan, delay, lowpass, voice }
   */
  play(name, o = {}) {
    const ctx = this.ctx;
    const buf = this.buffers[name];
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate || 1;
    let node = src;
    if (o.lowpass && o.lowpass < 16000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.value = o.gain === undefined ? 1 : o.gain;
    node.connect(g);
    node = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(this.master);
    const when = ctx.currentTime + (o.delay || 0);
    src.start(when);
    this.track(o.voice || name, src);
  }

  track(key, src) {
    const family = key.split('.').pop();
    const cap = MAX_VOICES[family] || MAX_VOICES.default;
    let list = this.voices.get(key);
    if (!list) this.voices.set(key, (list = []));
    list.push(src);
    src.onended = () => {
      const i = list.indexOf(src);
      if (i >= 0) list.splice(i, 1);
    };
    while (list.length > cap) {
      const old = list.shift();
      try {
        old.stop();
      } catch (e) {
        /* already stopped */
      }
    }
  }

  /** Positional parameters for a world-space source. */
  spatial(pos) {
    const L = this.listener;
    const dx = pos[0] - L.pos[0], dy = pos[1] - L.pos[1], dz = pos[2] - L.pos[2];
    const d = Math.hypot(dx, dy, dz);
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = d > 0.5 ? ((dx * rx + dz * rz) / Math.max(d, 1e-3)) * 0.85 : 0;
    let gain = 1 / (1 + d / 9);
    let lowpass = 20000 * Math.exp(-d / 38) + 700;
    if (this.occlusion && d > 1.5 && this.occlusion(L.pos, pos)) {
      gain *= 0.55;
      lowpass *= 0.3;
    }
    return { d, pan, gain, lowpass, delay: d > 12 ? d / 343 : 0 };
  }

  playAt(name, pos, o = {}) {
    const s = this.spatial(pos);
    this.play(name, { ...o, pan: s.pan, gain: (o.gain === undefined ? 1 : o.gain) * s.gain, lowpass: s.lowpass, delay: s.delay });
  }

  /**
   * Layered weapon report.
   * @param profile resolved presentation profile (audio.fire, audio.layers, audio.tailGain)
   * @param pos     world position, or null for the local shooter
   */
  fire(profile, pos, rateJitter = 0.03) {
    const a = profile.audio;
    const key = a.fire;
    const rate = 1 + (Math.random() - 0.5) * rateJitter;
    if (!pos) {
      this.play(`${key}.click`, { gain: 0.55, rate, voice: 'local.click' });
      this.play(`${key}.boom`, { gain: 0.85, rate, voice: 'local.boom' });
      this.play(`${key}.tail`, { gain: 0.5 * a.tailGain, rate, voice: 'local.tail' });
      for (const layer of a.layers) this.play(layer, { gain: 0.5, rate });
      return;
    }
    const s = this.spatial(pos);
    const near = Math.max(0, 1 - s.d / 20);
    this.play(`${key}.boom`, { gain: 0.9 * s.gain, rate, pan: s.pan, lowpass: s.lowpass, delay: s.delay, voice: 'remote.boom' });
    // Distant shots are mostly tail: it carries direction better than the transient.
    this.play(`${key}.tail`, { gain: (0.45 + 0.4 * (1 - near)) * Math.sqrt(s.gain) * a.tailGain, rate, pan: s.pan * 0.6, lowpass: Math.max(900, s.lowpass * 0.6), delay: s.delay, voice: 'remote.tail' });
    if (near > 0) this.play(`${key}.click`, { gain: 0.4 * near, rate, pan: s.pan, voice: 'remote.click' });
  }
}
