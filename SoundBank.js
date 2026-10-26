// Sound design, as data + recipes. Weapon reports are three layers that the AudioEngine
// starts on the same sample:
//   click : mechanical action (only audible up close / for the shooter)
//   boom  : body of the report (low sine sweep + filtered crack), the "punch"
//   tail  : room / distance reflections, kept separate so suppressors and distance can
//           scale it independently
// Everything returns mono Float32Arrays at the engine's sample rate.

import { noise, lowpass, highpass, bandpass, envelope, sweep, tone, mixInto, softClip, normalize, fadeOut } from './Synth.js';
const WEAPON_VOICES = {
  rifle: { sweep: [165, 46], tau: 0.065, crackHz: 5200, crackTau: 0.005, body: 2400, tail: 1.15, tailTau: 0.34, drive: 2.2, clickHz: 1900 },
  smg: { sweep: [220, 62], tau: 0.042, crackHz: 6200, crackTau: 0.004, body: 3000, tail: 0.85, tailTau: 0.24, drive: 2.0, clickHz: 2300 },
  pistol: { sweep: [260, 70], tau: 0.038, crackHz: 6800, crackTau: 0.004, body: 3200, tail: 0.75, tailTau: 0.22, drive: 1.8, clickHz: 2600 },
  sniper: { sweep: [125, 34], tau: 0.13, crackHz: 4200, crackTau: 0.008, body: 1800, tail: 2.1, tailTau: 0.7, drive: 2.8, clickHz: 1500 },
};

export function buildSoundBank(sr) {
  const S = {};
  let seed = 1;
  const N = (sec) => Math.ceil(sec * sr);
  const nz = (sec) => noise(N(sec), seed++);

  for (const [key, v] of Object.entries(WEAPON_VOICES)) {
    // click
    const click = highpass(nz(0.05), sr, 3000);
    envelope(click, sr, 0.0005, 0.006);
    mixInto(click, tone(N(0.05), sr, v.clickHz, 0.012), 0.5, sr);
    S[`${key}.click`] = normalize(click, 0.6);
    // boom
    const boom = sweep(N(0.4), sr, v.sweep[0], v.sweep[1], 0.12, v.tau);
    const crack = highpass(nz(0.4), sr, v.crackHz * 0.4);
    envelope(crack, sr, 0.0003, v.crackTau);
    const bodyN = lowpass(nz(0.4), sr, v.body);
    envelope(bodyN, sr, 0.001, v.tau * 0.45);
    mixInto(boom, crack, 1.4, sr);
    mixInto(boom, bodyN, 1.1, sr);
    softClip(boom, v.drive);
    S[`${key}.boom`] = fadeOut(normalize(boom, 0.95), sr, 20);
    // tail: early reflections + diffuse decay
    const tail = lowpass(nz(v.tail), sr, 1100);
    envelope(tail, sr, 0.02, v.tailTau);
    const er = highpass(nz(0.05), sr, 1500);
    envelope(er, sr, 0, 0.01);
    for (const [d, g] of [[0.021, 0.5], [0.037, 0.4], [0.061, 0.3], [0.093, 0.22]]) mixInto(tail, er, g, sr, d);
    S[`${key}.tail`] = fadeOut(normalize(tail, 0.55), sr, 60);
  }

  // Suppressed report: mechanical action dominates, muffled thump, almost no tail.
  {
    const click = highpass(nz(0.08), sr, 2200);
    envelope(click, sr, 0.0005, 0.01);
    mixInto(click, tone(N(0.08), sr, 2100, 0.02), 0.6, sr);
    mixInto(click, tone(N(0.08), sr, 3400, 0.01, 0.018), 0.4, sr);
    S['suppressed.click'] = normalize(click, 0.75);
    const thump = lowpass(nz(0.2), sr, 650);
    envelope(thump, sr, 0.001, 0.03);
    mixInto(thump, sweep(N(0.2), sr, 140, 60, 0.05, 0.035), 0.8, sr);
    S['suppressed.boom'] = normalize(thump, 0.7);
    const tail = lowpass(nz(0.4), sr, 600);
    envelope(tail, sr, 0.01, 0.1);
    S['suppressed.tail'] = normalize(tail, 0.2);
  }

  // Extra layers from attachments / skins
  {
    const c = highpass(nz(0.06), sr, 4500);
    envelope(c, sr, 0.0002, 0.006);
    S.compCrack = normalize(c, 0.6);
    const k = new Float32Array(N(0.22));
    for (let i = 0; i < 9; i++) {
      const p = highpass(nz(0.01), sr, 2500);
      envelope(p, sr, 0, 0.0015);
      mixInto(k, p, 0.4 + Math.random() * 0.5, sr, 0.01 + i * 0.022 + Math.random() * 0.01);
    }
    S.crackle = normalize(k, 0.4);
  }

  // Reload foley (shared across models with pitch variation at playback)
  {
    const magOut = bandpass(nz(0.12), sr, 1300, 2);
    envelope(magOut, sr, 0.001, 0.025);
    mixInto(magOut, tone(N(0.12), sr, 820, 0.04), 0.4, sr);
    S.magOut = normalize(magOut, 0.6);
    const magIn = highpass(nz(0.2), sr, 1800);
    envelope(magIn, sr, 0.03, 0.02);
    const thunk = bandpass(nz(0.2), sr, 700, 1.5);
    envelope(thunk, sr, 0.001, 0.02, 0.07);
    mixInto(magIn, thunk, 1.6, sr);
    mixInto(magIn, tone(N(0.2), sr, 1600, 0.015, 0.072), 0.5, sr);
    S.magIn = normalize(magIn, 0.7);
    const bolt = highpass(nz(0.26), sr, 1200);
    envelope(bolt, sr, 0.005, 0.03);
    const fwd = bandpass(nz(0.26), sr, 1500, 2);
    envelope(fwd, sr, 0.001, 0.018, 0.12);
    mixInto(bolt, fwd, 1.3, sr);
    mixInto(bolt, tone(N(0.26), sr, 2300, 0.01, 0.125), 0.6, sr);
    S.bolt = normalize(bolt, 0.7);
    const equip = lowpass(nz(0.3), sr, 2000);
    envelope(equip, sr, 0.08, 0.06);
    mixInto(equip, tone(N(0.3), sr, 2000, 0.01, 0.2), 0.4, sr);
    S.equip = normalize(equip, 0.35);
    const dry = highpass(nz(0.05), sr, 2500);
    envelope(dry, sr, 0, 0.004);
    mixInto(dry, tone(N(0.05), sr, 3100, 0.006), 0.6, sr);
    S.dry = normalize(dry, 0.5);
    const inspect = lowpass(nz(0.5), sr, 1600);
    envelope(inspect, sr, 0.15, 0.12);
    S.inspect = normalize(inspect, 0.25);
  }

  // Skin reload layers
  {
    const sh = new Float32Array(N(0.9));
    [2637, 3322, 4186, 5274].forEach((f, i) => mixInto(sh, tone(N(0.9), sr, f, 0.22, i * 0.05), 0.3, sr));
    S.shimmer = normalize(sh, 0.4);
    const ig = bandpass(nz(0.55), sr, 900, 0.8);
    for (let i = 0; i < ig.length; i++) {
      const t = i / sr;
      ig[i] *= Math.sin(Math.min(1, t / 0.45) * Math.PI) * (0.5 + t * 2);
    }
    mixInto(ig, S.crackle, 0.6, sr, 0.25);
    S.ignite = normalize(ig, 0.45);
    const cr = new Float32Array(N(0.7));
    [1975, 2637, 3951].forEach((f, i) => mixInto(cr, tone(N(0.7), sr, f, 0.18, i * 0.06), 0.4, sr));
    S.crystal = normalize(cr, 0.5);
  }

  // Footsteps / landing / casings per surface family
  const step = (fam, k) => {
    const s = new Float32Array(N(0.2));
    if (fam === 'stone') {
      const g = highpass(nz(0.2), sr, 1800);
      envelope(g, sr, 0.002, 0.018);
      mixInto(s, g, 0.6, sr);
      mixInto(s, tone(N(0.2), sr, 75 + k * 6, 0.03), 0.8, sr);
      const sc = lowpass(nz(0.2), sr, 900);
      envelope(sc, sr, 0.004, 0.035);
      mixInto(s, sc, 0.7, sr);
    } else if (fam === 'metal') {
      const m = bandpass(nz(0.2), sr, 1100 + k * 80, 6);
      envelope(m, sr, 0.001, 0.06);
      mixInto(s, m, 1.5, sr);
      mixInto(s, tone(N(0.2), sr, 430 + k * 25, 0.07), 0.5, sr);
    } else {
      const w = bandpass(nz(0.2), sr, 600 + k * 40, 2.5);
      envelope(w, sr, 0.001, 0.04);
      mixInto(s, w, 1.2, sr);
      mixInto(s, tone(N(0.2), sr, 170 + k * 10, 0.05), 0.6, sr);
    }
    return normalize(s, 0.6);
  };
  for (const fam of ['stone', 'metal', 'wood']) {
    for (let k = 0; k < 3; k++) S[`step.${fam}.${k}`] = step(fam, k);
    const land = step(fam, 1);
    mixInto(land, tone(N(0.2), sr, 55, 0.06), 0.9, sr);
    S[`land.${fam}`] = normalize(land, 0.75);
    const shell = new Float32Array(N(0.3));
    const tau = fam === 'metal' ? 0.16 : fam === 'wood' ? 0.04 : 0.08;
    mixInto(shell, tone(N(0.3), sr, fam === 'wood' ? 2400 : 3300, tau), 0.6, sr);
    mixInto(shell, tone(N(0.3), sr, fam === 'wood' ? 3600 : 4900, tau * 0.7), 0.4, sr);
    S[`shell.${fam}`] = normalize(shell, 0.35);
    const imp = new Float32Array(N(0.25));
    const ic = bandpass(nz(0.25), sr, fam === 'metal' ? 2600 : fam === 'wood' ? 750 : 1900, fam === 'metal' ? 8 : 1.5);
    envelope(ic, sr, 0.0005, fam === 'metal' ? 0.06 : 0.02);
    mixInto(imp, ic, 1.5, sr);
    if (fam === 'metal') mixInto(imp, tone(N(0.25), sr, 1780, 0.12), 0.5, sr);
    S[`impact.${fam}`] = normalize(imp, 0.6);
  }

  // Combat feedback
  {
    const body = lowpass(nz(0.15), sr, 1400);
    envelope(body, sr, 0.001, 0.025);
    mixInto(body, tone(N(0.15), sr, 150, 0.04), 0.9, sr);
    S.hitBody = normalize(body, 0.55);
    const head = new Float32Array(N(0.5));
    mixInto(head, tone(N(0.5), sr, 2350, 0.16), 0.6, sr);
    mixInto(head, tone(N(0.5), sr, 3720, 0.1), 0.35, sr);
    mixInto(head, S.hitBody, 0.5, sr);
    S.hitHead = normalize(head, 0.7);
    const kill = new Float32Array(N(0.6));
    mixInto(kill, tone(N(0.6), sr, 1318.5, 0.12), 0.5, sr);
    mixInto(kill, tone(N(0.6), sr, 1975.5, 0.18, 0.07), 0.5, sr);
    S.kill = normalize(kill, 0.55);
    const ab = highpass(nz(0.3), sr, 2500);
    envelope(ab, sr, 0.001, 0.05);
    mixInto(ab, sweep(N(0.3), sr, 3000, 900, 0.2, 0.08), 0.5, sr);
    S.armorBreak = normalize(ab, 0.5);
    const hurt = lowpass(nz(0.3), sr, 500);
    envelope(hurt, sr, 0.002, 0.05);
    mixInto(hurt, sweep(N(0.3), sr, 110, 50, 0.1, 0.07), 1, sr);
    S.hurt = normalize(hurt, 0.8);
    const whiz = highpass(nz(0.12), sr, 2500);
    for (let i = 0; i < whiz.length; i++) whiz[i] *= Math.sin((i / whiz.length) * Math.PI) ** 2;
    mixInto(whiz, sweep(N(0.12), sr, 3600, 1300, 0.12, 0.08), 0.3, sr);
    S.whiz = normalize(whiz, 0.4);
  }

  // Abilities
  {
    const smoke = bandpass(nz(1.4), sr, 1700, 0.7);
    envelope(smoke, sr, 0.05, 0.45);
    const pop = lowpass(nz(0.1), sr, 400);
    envelope(pop, sr, 0, 0.02);
    mixInto(smoke, pop, 2, sr);
    S.smoke = normalize(smoke, 0.55);
    const pulse = new Float32Array(N(1.0));
    for (const [d, g] of [[0, 0.6], [0.18, 0.3], [0.36, 0.15]]) {
      mixInto(pulse, tone(N(1.0), sr, 880, 0.12, d), g, sr);
      mixInto(pulse, tone(N(1.0), sr, 1320, 0.09, d), g * 0.7, sr);
    }
    S.pulse = normalize(pulse, 0.55);
    const dash = bandpass(nz(0.35), sr, 900, 0.6);
    for (let i = 0; i < dash.length; i++) dash[i] *= Math.sin((i / dash.length) * Math.PI);
    S.dash = normalize(dash, 0.6);
    const ult = new Float32Array(N(1.0));
    [261.6, 329.6, 392, 523.3].forEach((f, i) => mixInto(ult, tone(N(1.0), sr, f, 0.5, i * 0.06, 0.03), 0.3, sr));
    S.ult = normalize(ult, 0.6);
  }

  // Round / UI stingers
  {
    const chord = (notes, gap, tau, len) => {
      const o = new Float32Array(N(len));
      notes.forEach((f, i) => {
        mixInto(o, tone(N(len), sr, f, tau, i * gap, 0.01), 0.35, sr);
        mixInto(o, tone(N(len), sr, f * 2, tau * 0.6, i * gap, 0.01), 0.1, sr);
      });
      return normalize(o, 0.55);
    };
    S.roundStart = chord([392, 587.3], 0.12, 0.25, 0.8);
    S.roundWin = chord([523.3, 659.3, 784, 1046.5], 0.09, 0.35, 1.2);
    S.roundLoss = chord([392, 311.1, 261.6], 0.14, 0.4, 1.2);
    const beep = new Float32Array(N(0.12));
    mixInto(beep, tone(N(0.12), sr, 1500, 0.04, 0, 0.002), 0.6, sr);
    S.beep = normalize(beep, 0.4);
    S.planted = chord([440, 554.4, 659.3], 0.05, 0.4, 1.0);
    const tick = new Float32Array(N(0.04));
    mixInto(tick, tone(N(0.04), sr, 2800, 0.006), 1, sr);
    S.uiTick = normalize(tick, 0.25);
  }
  return S;
}
