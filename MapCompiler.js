// Compiles a map data asset into the runtime map shared by the sim, renderer, light baker and
// minimap. Pure and deterministic: client and server compile the same asset to the same data.
//
// Two authoring formats:
//   1. Brush maps (data/maps/*.js using BrushKit): explicit 3D convex brushes, so floors can sit
//      above other floors (catwalks, bridges, ship decks, tunnels).
//   2. Legacy grid maps (`layout` + `legend`, e.g. Saltworks): every 2 m cell is converted into
//      brushes. Identical neighbouring cells are merged into rectangles, so the brush count stays
//      small and collision matches the old heightfield exactly.
//
// Output (the "compiled map"):
//   brushes[]  compiled brushes (edge planes, bounds, flags, surfaces, variant group)
//   bounds     playable XZ extent and Y range
//   zones      plant sites { id, x0, z0, x1, z1, y0, y1, center }
//   spawns     { player: { pos, yaw }, hostiles: [{ pos, yaw }], dummies: [{ pos }] }
//   callouts   [{ name, x, y, z }]   nearest-point lookup (y separates stacked floors)
//   signs      [{ text, pos, normal, size, color }]
//   elevationMarkers [{ pos, normal, text, width }]
//   models     [{ id, pos, yaw, scale, tint, group }]   authored glTF props placed in the level
//   props      procedural detail props (PropKit), lights, variants (crane layouts)

import { SURFACE_IDS } from '../data/surfaces.js';
import { BF, SOLID } from './World.js';

export const KIND = { floor: 0, wall: 1, cover: 2, platform: 3, ramp: 4 };

/** Brush flag presets usable by name in map data. */
export const FLAG_PRESETS = {
  solid: SOLID,
  // Player clip: invisible, blocks movement only.
  clip: BF.COLLIDE,
  // Blocks everything but is never drawn (render comes from a glTF model on top of it).
  hull: BF.COLLIDE | BF.SHOT | BF.SIGHT | BF.MINIMAP | BF.LIGHT,
  // Railings, mesh fences: you walk into them, bullets and sight pass.
  rail: BF.COLLIDE | BF.MINIMAP,
  // Decorative geometry: drawn and shadowing, never collides.
  detail: BF.RENDER | BF.LIGHT | BF.SHOT | BF.SIGHT,
  // Thin glass: blocks movement and bullets, not sight or light.
  glass: BF.COLLIDE | BF.SHOT | BF.RENDER,
};

export function compileMap(asset) {
  const src = asset.layout ? gridToBrushes(asset) : asset;
  const map = {
    id: asset.id,
    name: asset.name,
    env: asset.env || { sun: asset.sun, sky: asset.sky, fog: asset.fog, exposure: asset.exposure },
    brushes: [],
    bounds: null,
    zones: {},
    spawns: { player: null, hostiles: [], dummies: [] },
    callouts: [],
    signs: [],
    elevationMarkers: [],
    models: (src.models || []).map((m) => ({ scale: 1, yaw: 0, tint: null, group: null, ...m })),
    props: src.props || [],
    lights: (src.lights || []).map((l) => ({ ...l })),
    variants: src.variants || null,
    crane: src.crane || null,
    minimapRotation: src.minimapRotation || 0,
    floorText: (src.floorText || []).map((t) => ({ ...t })),
    legacyGrid: src.legacyGrid || null,
    maxHeight: 0,
  };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  const groups = new Set();
  for (const raw of src.brushes) {
    const br = compileBrush(raw, map.brushes.length);
    map.brushes.push(br);
    if (br.group) groups.add(br.group);
    if (br.flags & BF.COLLIDE) {
      minX = Math.min(minX, br.minX); maxX = Math.max(maxX, br.maxX);
      minZ = Math.min(minZ, br.minZ); maxZ = Math.max(maxZ, br.maxZ);
    }
    minY = Math.min(minY, br.y0);
    maxY = Math.max(maxY, br.maxY);
  }
  for (const m of map.models) if (m.group) groups.add(m.group);
  const b = src.bounds;
  map.bounds = b ? { minY, maxY, ...b } : { minX, maxX, minZ, maxZ, minY, maxY };
  map.maxHeight = maxY;

  if (map.variants) {
    for (const layout of map.variants.layouts) for (const g of layout) if (!groups.has(g)) throw new Error(`Variant group '${g}' has no brushes`);
  }

  for (const [key, z] of Object.entries(src.zones || {})) {
    const y0 = z.y0 ?? -1, y1 = z.y1 ?? 3;
    map.zones[key] = { id: key, x0: z.x0, z0: z.z0, x1: z.x1, z1: z.z1, y0, y1, floorY: z.floorY ?? 0, center: [(z.x0 + z.x1) / 2, z.floorY ?? 0, (z.z0 + z.z1) / 2] };
  }
  const sp = src.spawns || {};
  if (sp.player) map.spawns.player = { pos: sp.player.pos.slice(), yaw: sp.player.yaw || 0 };
  for (const h of sp.hostiles || []) map.spawns.hostiles.push({ pos: h.pos.slice(), yaw: h.yaw, col: h.col, row: h.row });
  for (const d of sp.dummies || []) map.spawns.dummies.push({ pos: d.pos.slice(), col: d.col, row: d.row });
  for (const c of src.callouts || []) map.callouts.push({ name: c.name, x: c.x, y: c.y ?? 0, z: c.z });
  for (const s of src.signs || []) map.signs.push({ ...s });
  for (const m of src.elevationMarkers || []) map.elevationMarkers.push({ width: 2, ...m });
  if (!map.spawns.player) throw new Error(`${asset.id}: no player spawn`);
  return map;
}

/** Normalise one authored brush descriptor into the runtime form used by CollisionWorld. */
export function compileBrush(raw, id) {
  const poly = raw.poly;
  if (!poly || poly.length < 3) throw new Error(`Brush ${id} needs a polygon`);
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x; cz += z; }
  cx /= poly.length; cz /= poly.length;
  const edges = new Float64Array(poly.length * 3);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let rect = poly.length === 4;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b2 = poly[(i + 1) % poly.length];
    let nx = b2[1] - a[1], nz = -(b2[0] - a[0]);
    const l = Math.hypot(nx, nz);
    if (l < 1e-9) throw new Error(`Brush ${id} has a degenerate edge`);
    nx /= l; nz /= l;
    let d = nx * a[0] + nz * a[1];
    if (nx * cx + nz * cz > d) { nx = -nx; nz = -nz; d = -d; }
    edges[i * 3] = nx; edges[i * 3 + 1] = nz; edges[i * 3 + 2] = d;
    if (Math.abs(nx) > 1e-9 && Math.abs(nz) > 1e-9) rect = false;
    minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]);
    minZ = Math.min(minZ, a[1]); maxZ = Math.max(maxZ, a[1]);
  }
  const gx = raw.gx || 0, gz = raw.gz || 0, c = raw.c;
  let maxY = -Infinity, minRoof = Infinity;
  for (const [x, z] of poly) {
    const y = c + gx * x + gz * z;
    maxY = Math.max(maxY, y);
    minRoof = Math.min(minRoof, y);
  }
  if (minRoof <= raw.y0 + 1e-6 && !(gx || gz)) throw new Error(`Brush ${id} has no height`);
  const surface = SURFACE_IDS.indexOf(raw.surface);
  if (surface < 0) throw new Error(`Brush ${id}: unknown surface ${raw.surface}`);
  const topSurface = raw.top ? SURFACE_IDS.indexOf(raw.top) : surface;
  if (topSurface < 0) throw new Error(`Brush ${id}: unknown top surface ${raw.top}`);
  let flags = raw.flags === undefined ? SOLID : typeof raw.flags === 'string' ? FLAG_PRESETS[raw.flags] : raw.flags;
  if (flags === undefined) throw new Error(`Brush ${id}: unknown flag preset ${raw.flags}`);
  return {
    id,
    poly: poly.map((p) => [p[0], p[1]]),
    edges,
    rect,
    minX, maxX, minZ, maxZ,
    y0: raw.y0,
    c, gx, gz,
    maxY,
    surface,
    topSurface,
    flags,
    group: raw.group || null,
    enabled: !raw.group,
    tint: raw.tint || null,
    topTint: raw.topTint || null,
    glow: raw.glow || 0,
    uv: raw.uv || 1,
    hide: raw.hide || null,
    stairs: raw.stairs || 0,
    tag: raw.tag || null,
    detail: raw.detail || null,
    tess: raw.tess || 1,
  };
}

// --------------------------------------------------------------------- legacy grid conversion

function gridToBrushes(asset) {
  const rows = asset.layout.length;
  const cols = asset.layout[0].length;
  const cs = asset.cellSize;
  const ox = (-cols * cs) / 2, oz = (-rows * cs) / 2;
  const n = rows * cols;
  const kinds = new Uint8Array(n), heights = new Float32Array(n), surf = new Array(n);
  const rampAxis = new Uint8Array(n), rampLo = new Float32Array(n), rampHi = new Float32Array(n);
  const rampCells = [];
  const zoneBounds = {};
  const spawns = { player: null, hostiles: [], dummies: [] };
  for (let r = 0; r < rows; r++) {
    const line = asset.layout[r];
    if (line.length !== cols) throw new Error(`Map row ${r} has ${line.length} cells, expected ${cols}`);
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      const def = asset.legend[ch];
      if (!def) throw new Error(`Unknown map glyph '${ch}' at ${c},${r}`);
      const i = r * cols + c;
      kinds[i] = KIND[def.kind];
      if (SURFACE_IDS.indexOf(def.surface) < 0) throw new Error(`Unknown surface ${def.surface}`);
      surf[i] = def.surface;
      if (def.kind === 'ramp') rampCells.push({ c, r, rise: def.rise });
      else heights[i] = def.height;
      if (def.zone) {
        const b = zoneBounds[def.zone] || (zoneBounds[def.zone] = { c0: c, r0: r, c1: c, r1: r });
        b.c0 = Math.min(b.c0, c); b.r0 = Math.min(b.r0, r);
        b.c1 = Math.max(b.c1, c); b.r1 = Math.max(b.r1, r);
      }
      if (def.spawn) {
        const pos = [ox + (c + 0.5) * cs, def.height || 0, oz + (r + 0.5) * cs];
        if (def.spawn === 'player') spawns.player = { pos, yaw: 0 };
        else if (def.spawn === 'hostile') spawns.hostiles.push({ pos, col: c, row: r });
        else spawns.dummies.push({ pos, col: c, row: r });
      }
    }
  }
  const g = { rows, cols, cs, ox, oz, kinds, heights, rampAxis, rampLo, rampHi };
  compileRamps(g, rampCells);

  // Greedy rectangle merge of identical cells.
  const keyOf = (i) => (rampAxis[i] ? null : `${heights[i]}|${surf[i]}`);
  const used = new Uint8Array(n);
  const brushes = [];
  const FLOOR_BASE = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (used[i]) continue;
      if (rampAxis[i]) {
        used[i] = 1;
        const x0 = ox + c * cs, z0 = oz + r * cs, x1 = x0 + cs, z1 = z0 + cs;
        let cc, gx = 0, gz = 0;
        if (rampAxis[i] === 2) { gz = (rampHi[i] - rampLo[i]) / cs; cc = rampLo[i] - gz * z0; }
        else { gx = (rampHi[i] - rampLo[i]) / cs; cc = rampLo[i] - gx * x0; }
        brushes.push({ poly: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0: FLOOR_BASE, c: cc, gx, gz, surface: surf[i] });
        continue;
      }
      const k = keyOf(i);
      let w = 1;
      while (c + w < cols && !used[i + w] && keyOf(i + w) === k) w++;
      let h = 1;
      outer: while (r + h < rows) {
        for (let q = 0; q < w; q++) {
          const j = (r + h) * cols + c + q;
          if (used[j] || keyOf(j) !== k) break outer;
        }
        h++;
      }
      for (let rr = 0; rr < h; rr++) for (let q = 0; q < w; q++) used[(r + rr) * cols + c + q] = 1;
      const x0 = ox + c * cs, z0 = oz + r * cs;
      const top = heights[i];
      brushes.push({ poly: [[x0, z0], [x0 + w * cs, z0], [x0 + w * cs, z0 + h * cs], [x0, z0 + h * cs]], y0: FLOOR_BASE, c: top, gx: 0, gz: 0, surface: surf[i] });
    }
  }

  const zones = {};
  for (const key of Object.keys(zoneBounds)) {
    const b = zoneBounds[key];
    zones[key] = { x0: ox + b.c0 * cs, z0: oz + b.r0 * cs, x1: ox + (b.c1 + 1) * cs, z1: oz + (b.r1 + 1) * cs, y0: -1, y1: 4 };
  }

  const faceN = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const signs = (asset.signs || []).map((s) => {
    const [nx, nz] = faceN[s.face];
    const x = ox + (s.col + 0.5) * cs + nx * (cs / 2 + 0.012);
    const z = oz + (s.row + 0.5) * cs + nz * (cs / 2 + 0.012);
    return { text: s.text, pos: [x, s.y, z], normal: [nx, 0, nz], size: s.size, color: s.color };
  });
  const callouts = (asset.callouts || []).map((c) => ({ name: c.name, x: ox + (c.col + 0.5) * cs, z: oz + (c.row + 0.5) * cs }));
  const elevationMarkers = buildElevationMarkers(g);

  return {
    brushes,
    zones,
    spawns,
    signs,
    callouts,
    elevationMarkers,
    bounds: { minX: ox, maxX: ox + cols * cs, minZ: oz, maxZ: oz + rows * cs },
    legacyGrid: { cols, rows, cellSize: cs, originX: ox, originZ: oz },
  };
}

function compileRamps(g, rampCells) {
  const isRamp = (c, r, rise) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && rampCells.some((p) => p.c === c && p.r === r && p.rise === rise);
  const heightOf = (c, r) => (c < 0 || r < 0 || c >= g.cols || r >= g.rows ? 0 : g.heights[r * g.cols + c]);
  for (const { c, r, rise } of rampCells) {
    const i = r * g.cols + c;
    let lo, hi;
    if (rise === 'north' || rise === 'south') {
      let r0 = r; while (isRamp(c, r0 - 1, rise)) r0--;
      let r1 = r; while (isRamp(c, r1 + 1, rise)) r1++;
      const L = r1 - r0 + 1;
      const northH = heightOf(c, r0 - 1), southH = heightOf(c, r1 + 1);
      lo = northH + (southH - northH) * ((r - r0) / L);
      hi = northH + (southH - northH) * ((r - r0 + 1) / L);
      g.rampAxis[i] = 2;
    } else {
      let c0 = c; while (isRamp(c0 - 1, r, rise)) c0--;
      let c1 = c; while (isRamp(c1 + 1, r, rise)) c1++;
      const L = c1 - c0 + 1;
      const westH = heightOf(c0 - 1, r), eastH = heightOf(c1 + 1, r);
      lo = westH + (eastH - westH) * ((c - c0) / L);
      hi = westH + (eastH - westH) * ((c - c0 + 1) / L);
      g.rampAxis[i] = 1;
    }
    g.rampLo[i] = lo;
    g.rampHi[i] = hi;
    g.heights[i] = Math.max(lo, hi);
  }
}

// Outward lips of raised platforms get a "+2.5 m" label and a hazard stripe.
function buildElevationMarkers(g) {
  const out = [];
  const seen = new Set();
  const cs = g.cs;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (g.kinds[i] !== KIND.platform) continue;
      const h = g.heights[i];
      for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const c2 = c + dc, r2 = r + dr;
        if (c2 < 0 || r2 < 0 || c2 >= g.cols || r2 >= g.rows) continue;
        if (g.kinds[r2 * g.cols + c2] !== KIND.floor) continue;
        const x = g.ox + (c + 0.5) * cs + dc * (cs / 2 + 0.012);
        const z = g.oz + (r + 0.5) * cs + dr * (cs / 2 + 0.012);
        const block = `${h.toFixed(1)}:${Math.floor(c / 8)}:${Math.floor(r / 8)}`;
        const label = !seen.has(block);
        seen.add(block);
        out.push({ pos: [x, h * 0.55, z], stripeY: h, normal: [dc, 0, dr], text: label ? `+${h.toFixed(1)} m` : null, width: cs });
      }
    }
  }
  return out;
}
