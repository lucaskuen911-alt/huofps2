// DEFAULT PLAYER SETTINGS AND LOADOUT. Persisted per browser by ui/Settings.

export const DEFAULT_SETTINGS = {
  sensitivity: 0.4, // degrees per mouse count = sensitivity * 0.07
  adsSensitivityMul: 1.0,
  fovHorizontal: 103,
  adsMode: 'hold',
  crosshair: { color: '#62ffb0', gap: 3, length: 5, thickness: 2, outline: true, dot: false, movementError: false },
  masterVolume: 0.8,
  cameraBob: true,
  showPerf: false,
  renderScale: 'auto',
  difficulty: 'veteran',
  map: 'dockside9',
  netLatencyMs: 0,
  netJitterMs: 0,
};

export const DEFAULT_LOADOUT = {
  halberd: { attachments: ['grip'], skin: 'stock' },
  hornet: { attachments: [], skin: 'stock' },
  wren: { attachments: [], skin: 'stock' },
  longbow: { attachments: [], skin: 'stock' },
};
