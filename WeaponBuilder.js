// Builds EFFECTIVE weapon stats from a base data asset plus stat modifiers (attachments,
// ultimate buffs). The base asset is never mutated: every build deep-clones it first.
// The same op format is used by the presentation pipeline, so designers learn one syntax.

import { WEAPONS } from '../data/weapons.js';
import { ATTACHMENTS } from '../data/attachments.js';
export function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function resolve(obj, path) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] === undefined) o[keys[i]] = {};
    o = o[keys[i]];
  }
  return [o, keys[keys.length - 1]];
}

/** Apply one { path, op, value } modifier in place. */
export function applyOp(target, mod) {
  const [o, k] = resolve(target, mod.path);
  switch (mod.op) {
    case 'mul':
      o[k] = (o[k] ?? 0) * mod.value;
      break;
    case 'add':
      o[k] = (o[k] ?? 0) + mod.value;
      break;
    case 'set':
      o[k] = deepClone(mod.value);
      break;
    case 'push':
      o[k] = (o[k] || []).concat([mod.value]);
      break;
    case 'scalePattern':
      o[k] = (o[k] || []).map(([y, p]) => [y * mod.value[0], p * mod.value[1]]);
      break;
    default:
      throw new Error(`Unknown modifier op ${mod.op}`);
  }
}

export function validateAttachments(weaponId, attachmentIds) {
  const used = new Set();
  const out = [];
  for (const id of attachmentIds) {
    const a = ATTACHMENTS[id];
    if (!a || !a.compatible.includes(weaponId) || used.has(a.slot)) continue;
    used.add(a.slot);
    out.push(id);
  }
  return out;
}

/**
 * @param {string} weaponId
 * @param {string[]} attachmentIds
 * @param {Array} extraMods  temporary modifiers (e.g. ultimate), applied last
 */
export function buildWeaponStats(weaponId, attachmentIds = [], extraMods = []) {
  const stats = deepClone(WEAPONS[weaponId]);
  for (const id of validateAttachments(weaponId, attachmentIds)) {
    for (const mod of ATTACHMENTS[id].stats) applyOp(stats, mod);
  }
  for (const mod of extraMods) applyOp(stats, mod);
  stats.magSize = Math.round(stats.magSize);
  stats.fireInterval = 60 / stats.rpm;
  stats.attachments = validateAttachments(weaponId, attachmentIds);
  return stats;
}

/** Builds the per-player stat table: normal and "overclocked" variants for every weapon. */
export function buildStatTable(loadout, ultimateMods) {
  const table = {};
  for (const id of Object.keys(WEAPONS)) {
    const atts = (loadout[id] && loadout[id].attachments) || [];
    table[id] = { normal: buildWeaponStats(id, atts), boosted: buildWeaponStats(id, atts, ultimateMods) };
  }
  return table;
}
