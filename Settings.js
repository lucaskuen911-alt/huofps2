// Per-browser persistence of settings and loadout. Storage can be unavailable (private mode,
// sandboxed previews): every access is guarded and the game runs on defaults without it.

import { DEFAULT_SETTINGS, DEFAULT_LOADOUT } from '../data/settings.js';
import { deepClone } from '../sim/WeaponBuilder.js';
const KEY = 'hairline.v1';

export function loadProfile() {
  const settings = deepClone(DEFAULT_SETTINGS);
  const loadout = deepClone(DEFAULT_LOADOUT);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(settings, saved.settings || {});
      settings.crosshair = { ...DEFAULT_SETTINGS.crosshair, ...((saved.settings && saved.settings.crosshair) || {}) };
      for (const k of Object.keys(loadout)) if (saved.loadout && saved.loadout[k]) loadout[k] = { ...loadout[k], ...saved.loadout[k] };
    }
  } catch (e) {
    /* storage unavailable: defaults */
  }
  return { settings, loadout };
}

export function saveProfile(profile) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
  } catch (e) {
    /* ignore */
  }
}

export function cmPer360(sensitivity, dpi = 800) {
  const counts = 360 / (sensitivity * 0.07);
  return (counts / dpi) * 2.54;
}
