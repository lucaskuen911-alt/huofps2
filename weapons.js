// WEAPON DATA ASSETS — gameplay stats only.
// No meshes, sounds, colours or animation names live here: `presentation` is an ID that the
// presentation layer resolves in data/presentation.js. Swap stats without touching visuals
// and vice versa.
//
// Units: angles in degrees, time in seconds, distance in metres.
// recoil.pattern[i] = [yaw (+right), pitch (+up)] applied AFTER shot i+1.
// Shots beyond the fixed pattern use recoil.procedural (seeded, server-reproducible).

export const WEAPONS = {
  halberd: {
    id: 'halberd',
    name: 'Halberd',
    category: 'Rifle',
    slot: 1,
    presentation: 'halberd',
    fireMode: 'auto',
    rpm: 585,
    magSize: 25,
    reserve: 75,
    reloadTime: 2.4,
    equipTime: 0.75,
    damage: { head: 160, body: 40, legs: 34 },
    falloff: [],
    spread: { base: 0.25, walk: 3.2, run: 6.0, air: 9.0, crouchMul: 0.85, adsMul: 0.85, sprayStart: 3, sprayGrowth: 0.1, sprayMax: 1.4 },
    recoil: {
      pattern: [
        [0, 0.18], [0.02, 0.32], [-0.03, 0.52], [0.05, 0.68], [0.0, 0.78],
        [-0.08, 0.8], [0.1, 0.72], [0.16, 0.6], [-0.12, 0.5], [-0.2, 0.42],
      ],
      procedural: { pitchPerShot: 0.22, pitchMax: 7.5, yawRandom: 0.32, yawDrift: 0.3, driftFlipChance: 0.22 },
      viewKick: 0.45,
      recoveryDelay: 0.08,
      recoveryRate: 22,
      offsetHalfLife: 0.075,
      punch: { pitch: 0.55, roll: 0.9, back: 0.045 },
    },
    ads: { zooms: [1.25], time: 0.13, moveSpeedMul: 0.76, scoped: false },
    moveSpeedMul: 1.0,
  },

  hornet: {
    id: 'hornet',
    name: 'Hornet',
    category: 'SMG',
    slot: 2,
    presentation: 'hornet',
    fireMode: 'auto',
    rpm: 800,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.1,
    equipTime: 0.6,
    damage: { head: 78, body: 26, legs: 22 },
    falloff: [{ range: 20, mul: 0.85 }],
    spread: { base: 0.4, walk: 1.2, run: 2.2, air: 6.0, crouchMul: 0.9, adsMul: 0.8, sprayStart: 4, sprayGrowth: 0.08, sprayMax: 1.5 },
    recoil: {
      pattern: [
        [0, 0.12], [0.03, 0.2], [-0.04, 0.3], [0.06, 0.38], [-0.02, 0.42],
        [0.08, 0.4], [-0.1, 0.36], [0.12, 0.3],
      ],
      procedural: { pitchPerShot: 0.14, pitchMax: 4.8, yawRandom: 0.3, yawDrift: 0.24, driftFlipChance: 0.3 },
      viewKick: 0.4,
      recoveryDelay: 0.06,
      recoveryRate: 30,
      offsetHalfLife: 0.06,
      punch: { pitch: 0.35, roll: 0.7, back: 0.03 },
    },
    ads: { zooms: [1.15], time: 0.11, moveSpeedMul: 0.82, scoped: false },
    moveSpeedMul: 1.0,
  },

  wren: {
    id: 'wren',
    name: 'Wren',
    category: 'Sidearm',
    slot: 3,
    presentation: 'wren',
    fireMode: 'semi',
    rpm: 405,
    magSize: 12,
    reserve: 36,
    reloadTime: 1.7,
    equipTime: 0.5,
    damage: { head: 78, body: 26, legs: 22 },
    falloff: [{ range: 30, mul: 0.9 }],
    spread: { base: 0.4, walk: 1.6, run: 2.4, air: 5.0, crouchMul: 0.9, adsMul: 1.0, sprayStart: 1, sprayGrowth: 0.35, sprayMax: 2.6 },
    recoil: {
      pattern: [[0, 0.9], [0.1, 0.85], [-0.12, 0.8]],
      procedural: { pitchPerShot: 0.7, pitchMax: 4.0, yawRandom: 0.4, yawDrift: 0.0, driftFlipChance: 0 },
      viewKick: 0.6,
      recoveryDelay: 0.05,
      recoveryRate: 12,
      offsetHalfLife: 0.06,
      punch: { pitch: 0.9, roll: 0.6, back: 0.05 },
    },
    ads: { zooms: [1.15], time: 0.1, moveSpeedMul: 0.85, scoped: false },
    moveSpeedMul: 1.05,
  },

  longbow: {
    id: 'longbow',
    name: 'Longbow',
    category: 'Sniper',
    slot: 4,
    presentation: 'longbow',
    fireMode: 'semi',
    rpm: 40,
    magSize: 5,
    reserve: 10,
    reloadTime: 3.4,
    equipTime: 1.1,
    damage: { head: 255, body: 150, legs: 127 },
    falloff: [],
    // `scopedBase` replaces `base` once the scope is fully up.
    spread: { base: 5.0, scopedBase: 0.0, walk: 6.0, run: 9.0, air: 12.0, crouchMul: 0.9, adsMul: 1.0, sprayStart: 0, sprayGrowth: 0, sprayMax: 0 },
    recoil: {
      pattern: [[0, 3.2]],
      procedural: { pitchPerShot: 3.2, pitchMax: 6.0, yawRandom: 0.3, yawDrift: 0, driftFlipChance: 0 },
      viewKick: 0.7,
      recoveryDelay: 0.2,
      recoveryRate: 3,
      offsetHalfLife: 0.16,
      punch: { pitch: 2.4, roll: 1.4, back: 0.11 },
    },
    // Right-click cycles hip -> 2.5x -> 5x -> hip.
    ads: { zooms: [2.5, 5.0], time: 0.26, moveSpeedMul: 0.6, scoped: true, cycle: true },
    moveSpeedMul: 0.9,
  },
};

export const WEAPON_ORDER = ['halberd', 'hornet', 'wren', 'longbow'];
