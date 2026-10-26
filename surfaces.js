// SURFACE DATA ASSETS. Shared by the sim (surface IDs on brushes) and presentation (tint,
// texture, decal, particles, footstep and impact audio). Colours are linear RGB.
// `albedo` is the scalar reflectance the light baker uses for bounce light.
// New surfaces are appended: brush data stores the index, so the order is part of the format.

export const SURFACE_IDS = ['tile', 'plaster', 'concrete', 'metal', 'wood', 'range', 'asphalt', 'grate', 'steel', 'water', 'corrugated', 'paint', 'hazard', 'deck', 'epoxy', 'shutter', 'glass', 'quay'];

export const SURFACES = {
  tile: { tint: [0.6, 0.47, 0.33], texture: 'tile', decal: 'chip', particles: 'dust', dust: [0.62, 0.55, 0.47], step: 'stone', impact: 'stone', albedo: 0.55 },
  plaster: { tint: [0.76, 0.6, 0.55], texture: 'plaster', decal: 'chip', particles: 'dust', dust: [0.85, 0.78, 0.72], step: 'stone', impact: 'stone', albedo: 0.7 },
  concrete: { tint: [0.45, 0.46, 0.49], texture: 'concrete', decal: 'chip', particles: 'dust', dust: [0.55, 0.55, 0.53], step: 'stone', impact: 'stone', albedo: 0.5 },
  metal: { tint: [0.05, 0.32, 0.36], texture: 'metal', decal: 'scuff', particles: 'sparks', dust: [0.4, 0.5, 0.5], step: 'metal', impact: 'metal', albedo: 0.45 },
  wood: { tint: [0.62, 0.35, 0.13], texture: 'wood', decal: 'splinter', particles: 'chips', dust: [0.55, 0.38, 0.2], step: 'wood', impact: 'wood', albedo: 0.5 },
  range: { tint: [0.8, 0.78, 0.74], texture: 'range', decal: 'chip', particles: 'dust', dust: [0.85, 0.82, 0.78], step: 'stone', impact: 'stone', albedo: 0.72 },
  asphalt: { tint: [0.4, 0.4, 0.41], texture: 'asphalt', decal: 'chip', particles: 'dust', dust: [0.45, 0.44, 0.42], step: 'stone', impact: 'stone', albedo: 0.32 },
  grate: { tint: [0.46, 0.48, 0.5], texture: 'grate', decal: 'scuff', particles: 'sparks', dust: [0.4, 0.42, 0.44], step: 'metal', impact: 'metal', albedo: 0.4 },
  steel: { tint: [0.6, 0.6, 0.62], texture: 'steel', decal: 'scuff', particles: 'sparks', dust: [0.45, 0.46, 0.48], step: 'metal', impact: 'metal', albedo: 0.5 },
  water: { tint: [0.1, 0.19, 0.21], texture: 'water', decal: 'chip', particles: 'dust', dust: [0.5, 0.6, 0.62], step: 'stone', impact: 'stone', albedo: 0.12 },
  // Dockside 9 kit (stylized painted sets; tint multiplies a near-white texture).
  corrugated: { tint: [0.62, 0.64, 0.66], texture: 'corrugated', decal: 'scuff', particles: 'sparks', dust: [0.5, 0.52, 0.55], step: 'metal', impact: 'metal', albedo: 0.5 },
  paint: { tint: [0.6, 0.6, 0.6], texture: 'paint', decal: 'scuff', particles: 'sparks', dust: [0.5, 0.5, 0.5], step: 'metal', impact: 'metal', albedo: 0.5 },
  hazard: { tint: [1, 1, 1], texture: 'hazard', decal: 'scuff', particles: 'sparks', dust: [0.7, 0.6, 0.3], step: 'metal', impact: 'metal', albedo: 0.55 },
  deck: { tint: [0.5, 0.5, 0.5], texture: 'deck', decal: 'scuff', particles: 'sparks', dust: [0.45, 0.4, 0.38], step: 'metal', impact: 'metal', albedo: 0.4 },
  epoxy: { tint: [0.52, 0.56, 0.54], texture: 'epoxy', decal: 'chip', particles: 'dust', dust: [0.55, 0.57, 0.55], step: 'stone', impact: 'stone', albedo: 0.45 },
  shutter: { tint: [0.6, 0.6, 0.62], texture: 'shutter', decal: 'scuff', particles: 'sparks', dust: [0.5, 0.5, 0.52], step: 'metal', impact: 'metal', albedo: 0.5 },
  glass: { tint: [0.3, 0.42, 0.46], texture: 'glass', decal: 'chip', particles: 'sparks', dust: [0.7, 0.8, 0.85], step: 'stone', impact: 'metal', albedo: 0.2 },
  quay: { tint: [0.62, 0.6, 0.56], texture: 'quay', decal: 'chip', particles: 'dust', dust: [0.6, 0.58, 0.55], step: 'stone', impact: 'stone', albedo: 0.5 },
};
