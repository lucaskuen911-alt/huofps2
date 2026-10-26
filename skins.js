// SKIN DATA ASSETS — presentation decorators only. A skin can never change damage, recoil or
// timing; the sim never reads this file.
// Colours are linear RGB. `inspect` picks an animation clip, `audio.reloadLayers` adds sound
// layers on top of the base reload, `fx.impactExtra` adds a particle burst on impacts.

export const SKINS = {
  stock: {
    id: 'stock',
    name: 'Field Issue',
    blurb: 'Matte polymer and gunmetal.',
    presentation: [],
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier',
    blurb: 'Frosted ceramic. Spin inspect, ice-chime reload, frost impacts.',
    presentation: [
      { path: 'palette.body', op: 'set', value: [0.78, 0.86, 0.92] },
      { path: 'palette.accent', op: 'set', value: [0.1, 0.55, 0.85] },
      { path: 'palette.glow', op: 'set', value: [0.35, 0.85, 1.6] },
      { path: 'fx.tracer', op: 'set', value: [0.45, 0.9, 1.6] },
      { path: 'fx.muzzleTint', op: 'set', value: [0.55, 0.9, 1.4] },
      { path: 'fx.impactExtra', op: 'set', value: 'frost' },
      { path: 'inspect', op: 'set', value: 'spin' },
      { path: 'audio.reloadLayers', op: 'push', value: 'shimmer' },
      { path: 'audio.killLayer', op: 'set', value: 'crystal' },
    ],
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    blurb: 'Blackened steel with molten seams. Flip inspect, ignition reload, ember sparks.',
    presentation: [
      { path: 'palette.body', op: 'set', value: [0.05, 0.05, 0.06] },
      { path: 'palette.accent', op: 'set', value: [0.9, 0.28, 0.05] },
      { path: 'palette.glow', op: 'set', value: [2.2, 0.7, 0.15] },
      { path: 'fx.tracer', op: 'set', value: [1.8, 0.55, 0.15] },
      { path: 'fx.muzzleTint', op: 'set', value: [1.6, 0.6, 0.25] },
      { path: 'fx.impactExtra', op: 'set', value: 'embers' },
      { path: 'inspect', op: 'set', value: 'flip' },
      { path: 'audio.reloadLayers', op: 'push', value: 'ignite' },
      { path: 'audio.layers', op: 'push', value: 'crackle' },
      { path: 'audio.killLayer', op: 'set', value: 'ignite' },
    ],
  },
};

export const SKIN_ORDER = ['stock', 'glacier', 'ember'];
