// Map design checker (dev tool, not part of the build).
//
// Compiles a map, builds the collision world and measures what a designer needs to know:
//   - walkable graph on a 0.5 m grid, every floor level (catwalks, decks), using the exact
//     movement hull (radius 0.34, height 1.78, step 0.45) plus mantle-height (1.1 m) climbs and drops
//   - shortest run times between named points at run speed (6.75 m/s), per variant layout
//   - reachability of every spawn, plant zone and callout (an unreachable one is a bug)
// Writes <out>.json for tools/mapviz.py (top-down render) and prints a timing table.
//
// Usage: node tools/mapcheck.mjs dockside9 shots/map

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAPS } from '../src/data/maps/index.js';
import { compileMap } from '../src/sim/MapCompiler.js';
import { CollisionWorld, BF } from '../src/sim/World.js';
import { MOVEMENT } from '../src/data/movement.js';

const [, , mapId = 'dockside9', out = 'shots/map'] = process.argv;
const asset = MAPS[mapId];
const map = compileMap(asset);
const world = new CollisionWorld(map);
const STEP = 0.5;
const RUN = MOVEMENT.runSpeed;
const MANTLE = 1.15;
const b = map.bounds;

function floorsAt(x, z) {
  // Candidate standing heights: tops of colliding brushes covering the point, plus anything
  // within step height (ramps) — the footprint query then confirms.
  const list = world.cells[world.row(z) * world.cols + world.col(x)];
  const hs = new Set();
  for (const br of list) {
    if (!(br.flags & BF.COLLIDE) || !br.enabled) continue;
    if (x < br.minX || x > br.maxX || z < br.minZ || z > br.maxZ || !world.inside2D(br, x, z)) continue;
    hs.add(Math.round(world.topAt(br, x, z) * 100) / 100);
  }
  const fp = {};
  const res = [];
  for (const h of hs) {
    world.footprint(x, z, MOVEMENT.radius, h + 0.02, MOVEMENT.stepHeight, MOVEMENT.standHeight, fp);
    // Ramps report the highest point under the hull, a little above the centre height.
    if (!fp.blocked && fp.ground - h > -0.05 && fp.ground - h < 0.4 && fp.ceiling - fp.ground >= MOVEMENT.standHeight && !res.some((y) => Math.abs(y - fp.ground) < 0.1)) res.push(fp.ground);
  }
  return res;
}

function buildGraph() {
  const cols = Math.floor((b.maxX - b.minX) / STEP), rows = Math.floor((b.maxZ - b.minZ) / STEP);
  const nodes = []; // { x, z, y }
  const at = new Map(); // "c,r" -> [node ids]
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.minX + (c + 0.5) * STEP, z = b.minZ + (r + 0.5) * STEP;
      const fl = floorsAt(x, z);
      if (!fl.length) continue;
      const ids = fl.map((y) => nodes.push({ x, z, y, c, r }) - 1);
      at.set(c + ',' + r, ids);
    }
  }
  const adj = nodes.map(() => []);
  const fp = {};
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
      const ids = at.get(n.c + dc + ',' + (n.r + dr));
      if (!ids) continue;
      for (const j of ids) {
        const m = nodes[j];
        const dy = m.y - n.y;
        if (dy > MANTLE) continue; // too high to climb
        if (dy < -7) continue; // fatal-ish drop: not a route
        // Diagonal moves must not cut a wall corner: both orthogonal neighbours walkable.
        if (dc && dr) {
          const a = at.get(n.c + dc + ',' + n.r), c2 = at.get(n.c + ',' + (n.r + dr));
          if (!a || !c2) continue;
        }
        // Mid-point clearance (thin walls / rails between cells).
        const mx = (n.x + m.x) / 2, mz = (n.z + m.z) / 2;
        world.footprint(mx, mz, MOVEMENT.radius * 0.9, Math.min(n.y, m.y) + 0.02, Math.max(MOVEMENT.stepHeight, Math.abs(dy) + 0.05), MOVEMENT.standHeight, fp);
        if (fp.blocked) continue;
        const d = Math.hypot(m.x - n.x, m.z - n.z) * (dy > MOVEMENT.stepHeight ? 1.6 : 1);
        adj[i].push([j, d]);
      }
    }
  }
  return { nodes, adj, at };
}

function nearest(g, p) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const n = g.nodes[i];
    const d = Math.hypot(n.x - p[0], n.z - p[2]) + Math.abs(n.y - (p[1] || 0)) * 3;
    if (d < bd) { bd = d; best = i; }
  }
  return bd < 2.5 ? best : -1;
}

function dijkstra(g, src) {
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const prev = new Int32Array(g.nodes.length).fill(-1);
  dist[src] = 0;
  // Binary heap.
  const heap = [[0, src]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    for (const [j, w] of g.adj[i]) {
      const nd = d + w;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push([nd, j]); }
    }
  }
  return { dist, prev };
}

function pathTo(res, j) {
  const p = [];
  for (let k = j; k >= 0; k = res.prev[k]) p.push(k);
  return p.reverse();
}

const zoneCenter = (z) => [(z.x0 + z.x1) / 2, z.floorY || 0, (z.z0 + z.z1) / 2];
const POINTS = {
  'Attacker Spawn': map.spawns.player.pos,
  'A Site': zoneCenter(map.zones.A),
  'B Site': map.zones.B ? zoneCenter(map.zones.B) : null,
};
for (const c of map.callouts) if (!POINTS[c.name]) POINTS[c.name] = [c.x, c.y || 0, c.z];
const ROUTES = [
  ['Attacker Spawn', 'A Site'], ['Attacker Spawn', 'B Site'], ['Attacker Spawn', 'Mid Top'],
  ['Defender Spawn', 'A Site'], ['Defender Spawn', 'B Site'], ['Defender Spawn', 'Crane Yard'],
  ['A Site', 'B Site'], ['Attacker Spawn', 'A Main'], ['A Main', 'A Site'], ['Attacker Spawn', 'B Main'], ['Attacker Spawn', 'Nest'], ['Defender Spawn', 'Deck'], ['B Site', 'Deck'],
];

const layouts = map.variants ? map.variants.layouts.length : 1;
const report = { map: mapId, bounds: b, variants: [], brushes: [], models: map.models, zones: map.zones, spawns: map.spawns, callouts: map.callouts };
for (const br of map.brushes) report.brushes.push({ poly: br.poly, y0: br.y0, maxY: br.maxY, flags: br.flags, group: br.group, surface: br.surface, tint: br.tint });

let failures = 0;
for (let v = 0; v < layouts; v++) {
  world.setVariant(v);
  const t0 = Date.now();
  const g = buildGraph();
  const name = map.variants ? map.variants.names?.[v] || `layout ${v}` : 'static';
  const ids = {};
  for (const [k, p] of Object.entries(POINTS)) if (p) ids[k] = nearest(g, p);
  const cache = {};
  const times = {};
  const paths = {};
  for (const [a, bb] of ROUTES) {
    if (ids[a] === undefined || ids[bb] === undefined) continue;
    if (ids[a] < 0 || ids[bb] < 0) { times[`${a} -> ${bb}`] = 'no node'; failures++; continue; }
    const res = cache[a] || (cache[a] = dijkstra(g, ids[a]));
    const d = res.dist[ids[bb]];
    times[`${a} -> ${bb}`] = Number.isFinite(d) ? +(d / RUN).toFixed(1) : 'UNREACHABLE';
    if (!Number.isFinite(d)) failures++;
    else paths[`${a} -> ${bb}`] = pathTo(res, ids[bb]).filter((_, k) => k % 3 === 0).map((k) => [g.nodes[k].x, g.nodes[k].z]);
  }
  // Every callout / spawn reachable from attacker spawn?
  const fromSpawn = cache['Attacker Spawn'] || dijkstra(g, ids['Attacker Spawn']);
  const unreachable = Object.entries(ids).filter(([k, i]) => i < 0 || !Number.isFinite(fromSpawn.dist[i])).map(([k]) => k);
  const hostiles = map.spawns.hostiles.map((h) => nearest(g, h.pos)).filter((i) => i < 0 || !Number.isFinite(fromSpawn.dist[i])).length;
  if (unreachable.length) failures++;
  console.log(`\n[${name}] ${g.nodes.length} nodes, built in ${Date.now() - t0} ms`);
  for (const [k, t] of Object.entries(times)) console.log(`  ${k.padEnd(34)} ${t}${typeof t === 'number' ? ' s' : ''}`);
  if (unreachable.length) console.log('  UNREACHABLE:', unreachable.join(', '));
  if (hostiles) console.log(`  hostile posts off the walk graph: ${hostiles}`);
  const walk = [];
  for (const n of g.nodes) walk.push([+n.x.toFixed(2), +n.z.toFixed(2), +n.y.toFixed(2)]);
  report.variants.push({ name, groups: map.variants ? map.variants.layouts[v] : [], times, paths, unreachable, walk });
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out + '.json', JSON.stringify(report));
console.log(`\nwrote ${out}.json${failures ? `  (${failures} problems)` : ''}`);
process.exit(failures ? 1 : 0);
