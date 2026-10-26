// Decorator pipeline for weapon presentation.
//
//   base profile (data/presentation.js)
//     -> attachment decorators (model parts, muzzle flash type, audio swaps)
//     -> skin decorator (palette, tracer/muzzle tint, inspect clip, reload audio layers, particles)
//
// Each decorator is a list of { path, op, value } ops applied to a deep copy, so the base
// prefab and the weapon classes are never modified. The viewmodel, FX and audio systems only
// ever read the resolved profile.

import { WEAPON_PRESENTATION } from '../data/presentation.js';
import { ATTACHMENTS } from '../data/attachments.js';
import { SKINS } from '../data/skins.js';
import { applyOp, deepClone, validateAttachments } from '../sim/WeaponBuilder.js';
export function makeDecorator(ops) {
  return { decorate: (profile) => (ops.forEach((op) => applyOp(profile, op)), profile) };
}

export function resolvePresentation(weaponId, loadoutEntry) {
  const base = deepClone(WEAPON_PRESENTATION[weaponId]);
  const decorators = [];
  for (const id of validateAttachments(weaponId, (loadoutEntry && loadoutEntry.attachments) || [])) {
    decorators.push(makeDecorator(ATTACHMENTS[id].presentation));
  }
  const skin = SKINS[(loadoutEntry && loadoutEntry.skin) || 'stock'] || SKINS.stock;
  decorators.push(makeDecorator(skin.presentation));
  const profile = decorators.reduce((p, d) => d.decorate(p), base);
  profile.weaponId = weaponId;
  profile.skinId = skin.id;
  return profile;
}
