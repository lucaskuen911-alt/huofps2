// ABILITY DATA ASSETS. Keys follow the tactical-shooter convention C / Q / E / X.

export const ABILITIES = {
  C: {
    id: 'haze',
    name: 'Haze',
    kind: 'smoke',
    charges: 2,
    maxCharges: 2,
    range: 32,
    radius: 4.2,
    duration: 14,
    blurb: 'Throw a vision-blocking smoke where you aim.',
  },
  Q: {
    id: 'pulse',
    name: 'Pulse',
    kind: 'reveal',
    charges: 1,
    maxCharges: 1,
    recharge: 22,
    range: 40,
    radius: 26,
    duration: 4,
    blurb: 'Fire a recon dart. Hostiles near the impact are revealed through walls.',
  },
  E: {
    id: 'slipstream',
    name: 'Slipstream',
    kind: 'dash',
    charges: 1,
    maxCharges: 1,
    recharge: 9,
    blurb: 'Signature. Burst in your movement direction.',
  },
  X: {
    id: 'overclock',
    name: 'Overclock',
    kind: 'ultimate',
    cost: 5,
    duration: 8,
    // The ultimate reuses the attachment stat-op pipeline as a temporary modifier.
    stats: [
      { path: 'rpm', op: 'mul', value: 1.2 },
      { path: 'recoil.pattern', op: 'scalePattern', value: [0.6, 0.6] },
      { path: 'recoil.procedural.pitchPerShot', op: 'mul', value: 0.6 },
      { path: 'recoil.procedural.yawRandom', op: 'mul', value: 0.6 },
      { path: 'reloadTime', op: 'mul', value: 0.6 },
    ],
    armorRefill: 50,
    blurb: 'Ultimate (5 points). +20% fire rate, 40% less recoil, faster reloads for 8 s.',
  },
};

export const ABILITY_KEYS = ['C', 'Q', 'E', 'X'];
