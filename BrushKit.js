// BRUSH KIT: the vocabulary map data assets are authored in.
//
// Every helper returns plain brush descriptors (no classes, no engine state), so a map file is
// still pure data that the MapCompiler turns into collision, render meshes, baked lighting and
// the minimap. This is the one module other data/ files may import.
//
// Brush descriptor:
//   { poly: [[x, z], ...]  convex footprint, any winding
//     y0                    floor of the prism
//     c, gx, gz             roof plane  y = c + gx * x + gz * z
//     surface               side surface id (data/surfaces.js)
//     top                   optional roof surface id (defaults to `surface`)
//     tint, glow            optional albedo multiplier [r, g, b] and emissive strength
//     flags                 preset name or BF bitmask (see FLAG_PRESETS in MapCompiler)
//     group                 optional variant group (crane-moved containers etc.)
//     uv                    optional texture scale multiplier
//     hide                  optional list of faces never drawn: 'top' | 'bottom' | 'sides' }
//
// Coordinates: metres, +X east, -Z north, +Y up.

export function box(x0, z0, x1, z1, y0, y1, surface, o = {}) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
  return { poly: [[ax, az], [bx, az], [bx, bz], [ax, bz]], y0, c: y1, gx: 0, gz: 0, surface, ...o };
}

/** Box from centre + size (sx along X, sz along Z). */
export function cbox(cx, cz, sx, sz, y0, y1, surface, o = {}) {
  return box(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2, y0, y1, surface, o);
}

/**
 * Ramp over a rectangle. `rise` is the direction the roof climbs toward:
 * 'n' (-Z), 's' (+Z), 'e' (+X), 'w' (-X). Solid from `base` (default yLo) to the slope.
 */
export function ramp(x0, z0, x1, z1, yLo, yHi, rise, surface, o = {}) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
  let c, gx = 0, gz = 0;
  if (rise === 'n') { gz = (yLo - yHi) / (bz - az); c = yHi - gz * az; }
  else if (rise === 's') { gz = (yHi - yLo) / (bz - az); c = yLo - gz * az; }
  else if (rise === 'e') { gx = (yHi - yLo) / (bx - ax); c = yLo - gx * ax; }
  else { gx = (yLo - yHi) / (bx - ax); c = yHi - gx * ax; }
  const base = o.base !== undefined ? o.base : yLo;
  const { base: _b, ...rest } = o;
  return { poly: [[ax, az], [bx, az], [bx, bz], [ax, bz]], y0: base, c, gx, gz, surface, ...rest };
}

/** Arbitrary convex prism with a flat roof. */
export function prism(points, y0, y1, surface, o = {}) {
  return { poly: points.map((p) => [p[0], p[1]]), y0, c: y1, gx: 0, gz: 0, surface, ...o };
}

/** Oriented box: width w along the rotated X axis, depth d along rotated Z, yaw in radians. */
export function obox(cx, cz, w, d, yaw, y0, y1, surface, o = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
  return prism(pts, y0, y1, surface, o);
}

/** Regular n-gon column. */
export function cyl(cx, cz, r, y0, y1, sides, surface, o = {}) {
  const pts = [];
  const a0 = o.phase || Math.PI / sides;
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  const { phase: _p, ...rest } = o;
  return prism(pts, y0, y1, surface, rest);
}

/**
 * One ring segment between radii r0 < r1 and angles a0 < a1 (radians, 0 = +X, increasing
 * toward +Z). Segments are exact trapezoids, so consecutive ones tile with no gaps.
 */
export function arcSeg(cx, cz, r0, r1, a0, a1, y0, y1, surface, o = {}) {
  const p = (r, a) => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  return prism([p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1)], y0, y1, surface, o);
}

/**
 * A ring of `n` segments. `skip(i, aMid)` returns true for segments to leave out (doorways).
 * `from`/`to` restrict the arc.
 */
export function ring(cx, cz, r0, r1, y0, y1, n, surface, o = {}, opts = {}) {
  const from = opts.from ?? 0, to = opts.to ?? Math.PI * 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a0 = from + ((to - from) * i) / n, a1 = from + ((to - from) * (i + 1)) / n;
    if (opts.skip && opts.skip(i, (a0 + a1) / 2)) continue;
    out.push(arcSeg(cx, cz, r0, r1, a0, a1, y0, y1, surface, o));
  }
  return out;
}

/** Straight run of steps (render + collide as a ramp; drawn as steps by the prop pass). */
export function stairs(x0, z0, x1, z1, yLo, yHi, rise, surface, o = {}) {
  return ramp(x0, z0, x1, z1, yLo, yHi, rise, surface, { stairs: Math.max(2, Math.round((yHi - yLo) / 0.2)), ...o });
}

/** Mirror a brush list across the plane x = 0 (for symmetric maps). */
export function mirrorX(list) {
  return list.map((b) => ({ ...b, poly: b.poly.map(([x, z]) => [-x, z]).reverse(), gx: -b.gx }));
}

/** Mirror across z = 0. */
export function mirrorZ(list) {
  return list.map((b) => ({ ...b, poly: b.poly.map(([x, z]) => [x, -z]).reverse(), gz: -b.gz }));
}

/** Rotate a brush list by `yaw` around (cx, cz). Only valid for flat-roofed brushes. */
export function rotateY(list, yaw, cx = 0, cz = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return list.map((b) => {
    const poly = b.poly.map(([x, z]) => [cx + (x - cx) * c + (z - cz) * s, cz - (x - cx) * s + (z - cz) * c]);
    // Roof gradient rotates with the geometry.
    const gx = b.gx * c + b.gz * s, gz = -b.gx * s + b.gz * c;
    const ox = b.poly[0][0], oz = b.poly[0][1];
    const y = b.c + b.gx * ox + b.gz * oz;
    const nx = poly[0][0], nz = poly[0][1];
    return { ...b, poly, gx, gz, c: y - gx * nx - gz * nz };
  });
}

/** Flatten nested arrays of brushes. */
export function flat(...parts) {
  return parts.flat(Infinity).filter(Boolean);
}
