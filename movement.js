// MOVEMENT DATA ASSET. Tuned for tactical play: high acceleration, near-instant stops.
// Speeds in m/s, accelerations in m/s^2, times in seconds.

export const MOVEMENT = {
  runSpeed: 6.75,
  walkSpeed: 3.75,
  crouchSpeed: 2.6,
  groundAccel: 72,
  groundDecel: 92,
  // When input opposes velocity on an axis, that axis is zeroed immediately (counter-strafe).
  counterStrafe: true,
  // Below this fraction of run speed the player counts as standing: first-shot accuracy returns.
  accurateSpeedFraction: 0.27,
  airAccel: 14,
  airSpeedCap: 6.75,
  gravity: 18.5,
  jumpVelocity: 6.2,
  stepHeight: 0.45,
  radius: 0.34,
  standHeight: 1.78,
  crouchHeight: 1.2,
  eyeStand: 1.62,
  eyeCrouch: 1.08,
  crouchTime: 0.11,
  landingPenalty: 0.14,
  dash: { speed: 15, duration: 0.18 },
};
