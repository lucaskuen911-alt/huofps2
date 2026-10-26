// MATCH RULES AND BOT TUNING DATA.

export const ROUND = {
  barrierTime: 3,
  roundTime: 100,
  postTime: 4.5,
  plantTime: 3.5,
  playerHealth: 100,
  playerArmor: 50,
  armorAbsorb: 0.66,
  respawnDummyAfter: 2.2,
};

export const BOT_DIFFICULTY = {
  recruit: { label: 'Recruit', reaction: [0.55, 0.8], hitChance: 0.28, headChance: 0.06, burst: 3, fov: 90, rangeFalloff: 0.035 },
  veteran: { label: 'Veteran', reaction: [0.34, 0.52], hitChance: 0.42, headChance: 0.12, burst: 4, fov: 110, rangeFalloff: 0.025 },
  elite: { label: 'Elite', reaction: [0.2, 0.32], hitChance: 0.58, headChance: 0.22, burst: 5, fov: 130, rangeFalloff: 0.018 },
};

export const BOT_WEAPON = { rpm: 600, damage: { head: 120, body: 30, legs: 25 }, range: 55 };

// Hitbox layout relative to feet (metres). Head is a sphere; body/legs are boxes.
export const HITBOX = {
  legs: { y0: 0, y1: 0.82, half: 0.2 },
  body: { y0: 0.82, y1: 1.46, half: 0.26 },
  head: { y: 1.6, r: 0.145 },
  crouchScale: 0.72,
};
