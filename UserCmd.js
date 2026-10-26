// UserCmd: the ONLY way a client influences the simulation. Clients send intent
// (buttons + view angles), never positions or damage. The server replays the same command
// through the same pure functions, so a prediction that matches is bit-for-bit identical.

export const BTN = {
  FWD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  CROUCH: 1 << 5,
  WALK: 1 << 6,
  FIRE: 1 << 7,
  ADS: 1 << 8,
  RELOAD: 1 << 9,
  INSPECT: 1 << 10,
  PLANT: 1 << 11,
  AB_C: 1 << 12,
  AB_Q: 1 << 13,
  AB_E: 1 << 14,
  AB_X: 1 << 15,
};

/**
 * @typedef {Object} UserCmd
 * @property {number} seq       monotonically increasing sequence number
 * @property {number} dt        simulated duration of this command (1 / tickRate)
 * @property {number} buttons   BTN bitmask (held state; edges are derived server-side)
 * @property {number} yaw       radians
 * @property {number} pitch     radians
 * @property {string|null} weapon  requested weapon id (switch request)
 * @property {number} viewTime  server time the client was rendering (for lag compensation)
 */
export function makeCmd(seq, dt, buttons, yaw, pitch, weapon, viewTime) {
  return { seq, dt, buttons, yaw, pitch, weapon, viewTime };
}

export function pressed(cmd, prevButtons, bit) {
  return (cmd.buttons & bit) !== 0 && (prevButtons & bit) === 0;
}
