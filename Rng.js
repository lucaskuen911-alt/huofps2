// Deterministic random numbers. Recoil deviation and spread use seeded streams so the
// client's predicted shot and the server's authoritative shot land on the same pixel.

export function hash32(a, b = 0, c = 0) {
  let h = 0x811c9dc5 ^ a;
  h = Math.imul(h ^ (b + 0x9e3779b9), 0x01000193);
  h = Math.imul(h ^ (c + 0x85ebca6b), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough statistical quality for gameplay noise. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
