// WEAPON PRESENTATION ASSETS — the visual/audio "prefab" referenced by weapons.js.
// Attachments and skins decorate a copy of these profiles; nothing here affects gameplay.
// Colours are linear RGB; values above 1 read as emissive glow.

function base(model, audio, extra = {}) {
  return {
    model: { id: model, parts: [] },
    palette: {
      body: [0.07, 0.075, 0.09],
      accent: [0.5, 0.17, 0.05],
      metal: [0.15, 0.155, 0.17],
      grip: [0.06, 0.06, 0.07],
      glow: [1.4, 0.55, 0.18],
    },
    audio: { fire: audio, layers: [], tailGain: 1, reload: audio, reloadLayers: [], killLayer: null },
    fx: { muzzleFlash: audio, tracer: [1.7, 1.25, 0.7], muzzleTint: [1.6, 1.1, 0.6], impactExtra: null, casing: audio },
    inspect: 'assemble',
    // Normalised reload timeline: audio cues and mag animation are keyed to these.
    reloadTimeline: { magOut: 0.2, magIn: 0.56, bolt: 0.8 },
    ...extra,
  };
}

export const WEAPON_PRESENTATION = {
  halberd: base('rifle', 'rifle'),
  hornet: base('smg', 'smg', { reloadTimeline: { magOut: 0.18, magIn: 0.5, bolt: 0.76 } }),
  wren: base('pistol', 'pistol', { reloadTimeline: { magOut: 0.15, magIn: 0.55, bolt: 0.8 } }),
  longbow: base('sniper', 'sniper', { reloadTimeline: { magOut: 0.22, magIn: 0.58, bolt: 0.84 } }),
};
