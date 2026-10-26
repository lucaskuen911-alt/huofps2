// ATTACHMENT DATA ASSETS.
// Each attachment carries two independent halves:
//   stats        -> read ONLY by sim/WeaponBuilder (gameplay)
//   presentation -> read ONLY by presentation/PresentationProfile (look, sound, particles)
// Stat ops: { path, op: 'mul' | 'add' | 'set' | 'scalePattern', value }
// Presentation ops: { path, op: 'set' | 'push' | 'mul', value }

export const ATTACHMENT_SLOTS = ['muzzle', 'optic', 'magazine', 'underbarrel'];

export const ATTACHMENTS = {
  suppressor: {
    id: 'suppressor',
    name: 'Baffle Suppressor',
    slot: 'muzzle',
    compatible: ['halberd', 'hornet', 'wren'],
    blurb: 'Quieter report, smaller flash, slightly tamer climb.',
    stats: [
      { path: 'recoil.procedural.pitchPerShot', op: 'mul', value: 0.92 },
      { path: 'spread.base', op: 'mul', value: 0.92 },
      { path: 'falloff', op: 'set', value: [{ range: 25, mul: 0.92 }] },
    ],
    presentation: [
      { path: 'audio.fire', op: 'set', value: 'suppressed' },
      { path: 'fx.muzzleFlash', op: 'set', value: 'suppressed' },
      { path: 'model.parts', op: 'push', value: 'suppressor' },
      { path: 'audio.tailGain', op: 'mul', value: 0.25 },
    ],
  },
  compensator: {
    id: 'compensator',
    name: 'Port Compensator',
    slot: 'muzzle',
    compatible: ['halberd', 'hornet', 'longbow'],
    blurb: 'Vents gas upward: 18% less vertical climb, louder crack.',
    stats: [
      { path: 'recoil.pattern', op: 'scalePattern', value: [1.0, 0.82] },
      { path: 'recoil.procedural.pitchPerShot', op: 'mul', value: 0.82 },
      { path: 'recoil.punch.pitch', op: 'mul', value: 0.8 },
    ],
    presentation: [
      { path: 'audio.layers', op: 'push', value: 'compCrack' },
      { path: 'fx.muzzleFlash', op: 'set', value: 'ported' },
      { path: 'model.parts', op: 'push', value: 'compensator' },
    ],
  },
  reflex: {
    id: 'reflex',
    name: 'Reflex Sight',
    slot: 'optic',
    compatible: ['halberd', 'hornet', 'wren'],
    blurb: 'Clean dot, faster aim-down-sights.',
    stats: [
      { path: 'ads.time', op: 'mul', value: 0.85 },
      { path: 'ads.zooms', op: 'set', value: [1.25] },
    ],
    presentation: [{ path: 'model.parts', op: 'push', value: 'reflex' }],
  },
  scope25: {
    id: 'scope25',
    name: '2.5x Marksman Scope',
    slot: 'optic',
    compatible: ['halberd'],
    blurb: 'Full scope overlay at 2.5x. Slower to raise, tighter while scoped.',
    stats: [
      { path: 'ads.zooms', op: 'set', value: [2.5] },
      { path: 'ads.scoped', op: 'set', value: true },
      { path: 'ads.time', op: 'add', value: 0.08 },
      { path: 'spread.adsMul', op: 'mul', value: 0.6 },
      { path: 'ads.moveSpeedMul', op: 'mul', value: 0.85 },
    ],
    presentation: [{ path: 'model.parts', op: 'push', value: 'scope' }],
  },
  extmag: {
    id: 'extmag',
    name: 'Extended Magazine',
    slot: 'magazine',
    compatible: ['halberd', 'hornet', 'wren', 'longbow'],
    blurb: '+30% capacity, slower reload.',
    stats: [
      { path: 'magSize', op: 'mul', value: 1.3 },
      { path: 'reloadTime', op: 'add', value: 0.3 },
    ],
    presentation: [{ path: 'model.parts', op: 'push', value: 'extmag' }],
  },
  grip: {
    id: 'grip',
    name: 'Angled Grip',
    slot: 'underbarrel',
    compatible: ['halberd', 'hornet'],
    blurb: '30% less horizontal wander once the pattern runs out.',
    stats: [
      { path: 'recoil.procedural.yawRandom', op: 'mul', value: 0.7 },
      { path: 'recoil.procedural.yawDrift', op: 'mul', value: 0.7 },
      { path: 'ads.time', op: 'add', value: 0.015 },
    ],
    presentation: [{ path: 'model.parts', op: 'push', value: 'grip' }],
  },
};
