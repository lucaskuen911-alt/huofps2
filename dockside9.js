// MAP DATA ASSET — "Dockside 9"
// Heavy industrial port and cargo yard. Brush map (BrushKit): explicit 3D geometry, so the
// warehouse catwalks, the crane nest, the gangway tower and the freighter deck stack above the
// ground floor.
//
// Layout (north = -Z, east = +X, metres; quay level y = 0, harbour water y = -2.5):
//
//   z -60 ┌────────────── north fence ──────────────────────────────────┐
//         │ WAREHOUSE (A)      │ DEF SPAWN │   B NORTH ROAD              │ ~~~ water ~~~
//         │  catwalks +4.5     │           │──────────────────────────────│  FREIGHTER
//         │  crane nest +7.0   │ MID TOP   │   PIER (B site)              │  deck +6.0
//         │  site A            │───────────│   quay crane legs, crates    │  hatch covers
//         │  racks             │ OFFICE    │   gangway tower -> deck      │
//   z -6  │──roll-up door──────│(A link)   │──── B gate (booth) ──────────│
//         │ A MAIN (truck lane)│ MID YARD  │   STACKS  │ B MAIN (quay rd) │
//         │                    │ crane-moved containers │                  │
//   z 14  │ WORKSHOP           │ (3 layouts, re-stacked │                  │
//         │──────── A LOBBY ───│  every round)          │                  │
//   z 34  │                    │ MID BOTTOM             │                  │
//         │             ATTACKER SPAWN                                     │
//   z 50  └────────────────────────────────────────────────────────────────┘
//         x -68              -30    -20            10   22               42
//
// Zone colour code (readability): A-side cover is warm (orange / red), B-side cool (teal / blue),
// mid is neutral with yellow crane hardware.
//
// Gimmick: the RTG crane over mid re-stacks containers in the barrier phase. Each layout is a
// set of variant groups (collision + render), chosen by the authority and replicated.

import { box, cbox, obox, ramp, stairs, prism, cyl, flat } from './BrushKit.js';

const PI = Math.PI;
// ISO container dimensions.
const CW = 2.438, CH = 2.591, C40 = 12.192, C20 = 6.058;

const COL = {
  rust: [0.5, 0.1, 0.06],
  orange: [0.78, 0.3, 0.05],
  cream: [0.72, 0.62, 0.44],
  red: [0.56, 0.06, 0.06],
  teal: [0.03, 0.34, 0.34],
  blue: [0.05, 0.16, 0.42],
  navy: [0.04, 0.07, 0.17],
  green: [0.13, 0.3, 0.1],
  grey: [0.3, 0.32, 0.34],
  yellow: [0.85, 0.55, 0.03],
  white: [0.78, 0.78, 0.76],
};
// Building paint (brush tints, linear RGB).
const WALL = {
  warehouse: [0.5, 0.56, 0.6],
  warehouseTrim: [0.78, 0.3, 0.06],
  office: [0.78, 0.74, 0.66],
  workshop: [0.62, 0.44, 0.32],
  shed: [0.42, 0.5, 0.52],
  teal: [0.12, 0.42, 0.44],
};

const brushes = [];
const models = [];
const add = (...b) => brushes.push(...flat(b));
const model = (id, x, y, z, yaw = 0, o = {}) => models.push({ id, pos: [x, y, z], yaw, ...o });
/** Yaw that looks from (x, z) toward (tx, tz) (0 = -Z, matches the sim's camera yaw). */
const face = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

/** Vertical wall slab between two corners. */
function wall(x0, z0, x1, z1, h, surface = 'corrugated', o = {}) {
  return box(x0, z0, x1, z1, 0, h, surface, o);
}

/**
 * A container (collision hull + authored model). axis 'z' = long side along Z.
 * tier 0 sits on the ground; tier n sits on n containers. `y` overrides the base height.
 */
function container(cx, cz, axis, size, tint, o = {}) {
  const L = size === 40 ? C40 : C20;
  const tier = o.tier || 0;
  const y0 = o.y !== undefined ? o.y : tier * CH;
  const yaw = (axis === 'z' ? 0 : PI / 2) + (o.flip ? PI : 0);
  const sx = axis === 'z' ? CW : L, sz = axis === 'z' ? L : CW;
  // Inset 4 cm: corrugation recesses stay outside the hull so bake rays start in open air.
  add(cbox(cx, cz, sx - 0.08, sz - 0.08, y0, y0 + CH, 'paint', { flags: 'hull', group: o.group, tint }));
  model(`container${size}`, cx, y0, cz, yaw, { tint, group: o.group });
}

/** Stack of containers on one footprint. tints: bottom -> top. */
function stack(cx, cz, axis, size, tints, o = {}) {
  tints.forEach((t, i) => container(cx, cz, axis, size, t, { ...o, tier: (o.tier || 0) + i, flip: (i % 2 === 1) !== !!o.flip }));
}

/** Wooden crate with collision. */
function crate(cx, cz, s = 1.1, o = {}) {
  const y0 = o.y || 0;
  add(cbox(cx, cz, s, s, y0, y0 + s, 'wood', { flags: 'hull', group: o.group }));
  model(s > 1.5 ? 'crate_big' : 'crate', cx, y0, cz, o.yaw || 0, { group: o.group });
}

/** Railing: walk-blocking, see/shoot-through, with an authored model above it. */
function railing(x0, z0, x1, z1, y, o = {}) {
  add(box(x0, z0, x1, z1, y, y + 1.1, 'steel', { flags: 'rail' }));
  add(box(x0, z0, x1, z1, y + 1.0, y + 1.08, 'hazard', { flags: 'detail', ...o }));
  // Posts every ~1.5 m.
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.6));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = alongX ? x0 + (x1 - x0) * t : cx, pz = alongX ? cz : z0 + (z1 - z0) * t;
    add(cbox(px, pz, 0.06, 0.06, y, y + 1.0, 'steel', { flags: 'detail' }));
  }
  // Mid rail.
  add(box(alongX ? x0 : cx - 0.02, alongX ? cz - 0.02 : z0, alongX ? x1 : cx + 0.02, alongX ? cz + 0.02 : z1, y + 0.5, y + 0.54, 'steel', { flags: 'detail' }));
}

/** Collision-only rail along the open side of a stair run (follows the slope). */
function stairRail(x0, z0, x1, z1, yLo, yHi, rise) {
  add(ramp(x0, z0, x1, z1, yLo + 1.1, yHi + 1.1, rise, 'steel', { flags: 'rail', base: yLo }));
}

// ---- ground markings: 2 cm render-only paint brushes (lit, baked, shadowed like the floor).
const MARK_Y = 0.02;
const PAINT_W = [0.86, 0.86, 0.82], PAINT_Y = [0.92, 0.66, 0.08];
function paintLine(x0, z0, x1, z1, w, tint, y = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  add(obox((x0 + x1) / 2, (z0 + z1) / 2, w, len, Math.atan2(x1 - x0, z1 - z0), y, y + MARK_Y, 'paint', { flags: 'detail', tint }));
}
function dashed(x0, z0, x1, z1, w, tint, dash = 2, gap = 2, y = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  for (let t = 0; t < len; t += dash + gap) {
    const a = t / len, b = Math.min(len, t + dash) / len;
    paintLine(x0 + (x1 - x0) * a, z0 + (z1 - z0) * a, x0 + (x1 - x0) * b, z0 + (z1 - z0) * b, w, tint, y);
  }
}
function paintRect(x0, z0, x1, z1, w, tint, y = 0) {
  paintLine(x0, z0, x1, z0, w, tint, y);
  paintLine(x0, z1, x1, z1, w, tint, y);
  paintLine(x0, z0 + w / 2, x0, z1 - w / 2, w, tint, y);
  paintLine(x1, z0 + w / 2, x1, z1 - w / 2, w, tint, y);
}
/** Diagonal no-go hatching inside a rectangle (45 degree stripes clipped to the box). */
function hatchRect(x0, z0, x1, z1, tint, pitch = 1.2, w = 0.3, y = 0) {
  paintRect(x0, z0, x1, z1, 0.15, tint, y);
  const W = x1 - x0, H = z1 - z0;
  for (let k = -H; k < W; k += pitch) {
    // Line x = x0 + k + (z - z0), clipped to the rectangle.
    const za = Math.max(z0, z0 - k), zb = Math.min(z1, z0 + W - k);
    if (zb - za < 0.3) continue;
    paintLine(x0 + k + (za - z0), za, x0 + k + (zb - z0), zb, w, tint, y);
  }
}
const floorText = [];

// =========================================================================== ground
// Non-overlapping slabs (coplanar overlaps would z-fight). Top surface y = 0.
add(
  box(-68, -60, -30, -57, -1, 0, 'asphalt'),
  box(-68, -57, -30, -6, -1, 0, 'epoxy', { tint: [0.46, 0.52, 0.5] }), // warehouse floor (under walls too)
  box(-68, -6, -30, 50, -1, 0, 'asphalt'),
  box(-30, -60, 10, -46, -1, 0, 'asphalt'), // defender spawn
  box(-30, -46, 10, 34, -1, 0, 'quay', { tint: [0.6, 0.58, 0.54] }), // office + mid yard
  box(-30, 34, 10, 50, -1, 0, 'asphalt'), // attacker spawn
  box(10, -60, 41, -12, -1, 0, 'quay', { tint: [0.64, 0.62, 0.58] }), // north road + pier
  box(10, -12, 41, 50, -1, 0, 'asphalt'), // B main + stacks
  box(41, -60, 42, 50, -3, 0, 'quay', { tint: [0.55, 0.53, 0.5] }), // quay wall
  box(42, -66, 76, 56, -3.2, -2.5, 'water', { flags: 'detail', tess: 2 }),
);
// Quay edge coping (yellow) and the invisible clip that keeps players out of the water.
add(box(41.2, -60, 42, 50, 0, 0.22, 'hazard', { flags: 'detail' }));
add(box(42, -60, 42.4, -40, 0, 4, 'concrete', { flags: 'clip' }));
add(box(42, -34, 42.4, 50, 0, 4, 'concrete', { flags: 'clip' }));
add(box(42, -40, 42.4, -34, 0, 4, 'concrete', { flags: 'clip' })); // under the gangway bridge

// =========================================================================== perimeter
// Tall sheds and fences frame the playable space (10-12 m: never climbable, they set the skyline).
add(
  wall(-70, -62, 42, -60, 9, 'corrugated', { tint: WALL.shed }), // north fence shed line
  wall(-70, -60, -68, 52, 11, 'corrugated', { tint: WALL.shed }), // west sheds
  wall(-70, 50, 42, 52, 10, 'corrugated', { tint: WALL.shed }), // south sheds
);

// =========================================================================== WAREHOUSE (A)
// Shell: x -67..-30, z -57..-6, walls 1 m, eaves 12 m. Interior x -66..-31, z -56..-7.
const WH = { x0: -67, x1: -30, z0: -57, z1: -6, h: 12 };
const whWall = (o) => ({ tint: WALL.warehouse, ...o });
// North wall (back).
add(wall(WH.x0, WH.z0, WH.x1, WH.z0 + 1, WH.h, 'corrugated', whWall()));
// West wall.
add(wall(WH.x0, WH.z0, WH.x0 + 1, WH.z1, WH.h, 'corrugated', whWall()));
// South wall with the A MAIN roll-up door (x -62..-55, 6 m clear, shutter half open above).
add(wall(WH.x0, WH.z1 - 1, -62, WH.z1, WH.h, 'corrugated', whWall()));
add(wall(-55, WH.z1 - 1, WH.x1, WH.z1, WH.h, 'corrugated', whWall()));
add(box(-62, WH.z1 - 1, -55, WH.z1, 6, WH.h, 'corrugated', whWall()));
add(box(-62, WH.z1 - 0.7, -55, WH.z1 - 0.3, 4.6, 6, 'shutter', { flags: 'detail' })); // half-raised shutter
// East wall with the A LINK door (z -16..-12) and the back door (z -54..-50).
add(wall(WH.x1 - 1, WH.z0, WH.x1, -54, WH.h, 'corrugated', whWall()));
add(wall(WH.x1 - 1, -50, WH.x1, -16, WH.h, 'corrugated', whWall()));
add(wall(WH.x1 - 1, -12, WH.x1, WH.z1, WH.h, 'corrugated', whWall()));
add(box(WH.x1 - 1, -54, WH.x1, -50, 3.6, WH.h, 'corrugated', whWall()));
add(box(WH.x1 - 1, -16, WH.x1, -12, 3.6, WH.h, 'corrugated', whWall()));
// Orange trim band at eave height and door frames (A colour).
add(box(WH.x0 - 0.05, WH.z1 - 0.05, WH.x1 + 0.05, WH.z1 + 0.05, 10.6, 11.2, 'paint', { flags: 'detail', tint: WALL.warehouseTrim }));
add(box(WH.x1 - 0.05, WH.z0 - 0.05, WH.x1 + 0.05, WH.z1 + 0.05, 10.6, 11.2, 'paint', { flags: 'detail', tint: WALL.warehouseTrim }));
for (const [x0, x1] of [[-62.4, -62], [-55, -54.6]]) add(box(x0, WH.z1 - 1.05, x1, WH.z1 + 0.05, 0, 6.3, 'hazard', { flags: 'detail' }));
add(box(-62.4, WH.z1 - 1.05, -54.6, WH.z1 + 0.05, 6, 6.3, 'hazard', { flags: 'detail' }));
// Roof: two pitches with a skylight strip along the ridge (sun shafts on the floor).
add(box(WH.x0, WH.z0, -51, WH.z1, WH.h, WH.h + 0.4, 'corrugated', { flags: 'detail', tint: [0.36, 0.4, 0.44] }));
add(box(-49, WH.z0, -38.5, WH.z1, WH.h, WH.h + 0.4, 'corrugated', { flags: 'detail', tint: [0.36, 0.4, 0.44] }));
add(box(-36.5, WH.z0, WH.x1, WH.z1, WH.h, WH.h + 0.4, 'corrugated', { flags: 'detail', tint: [0.36, 0.4, 0.44] }));
for (const x of [-50, -37.5]) for (let z = WH.z0; z < WH.z1 - 0.1; z += 6.375) add(box(x - 1, z, x + 1, Math.min(WH.z1, z + 0.4), WH.h, WH.h + 0.4, 'steel', { flags: 'detail' }));
for (let z = -52; z <= -10; z += 7) model('roof_truss', -48.5, WH.h - 2.4, z, PI / 2, { scale: 0.84 });
const lights = [];
for (const x of [-58, -44, -36]) for (const z of [-46, -32, -18]) {
  model('highbay', x, 9.6, z, 0);
  lights.push({ pos: [x, 9.0, z], color: [1.0, 0.9, 0.74], intensity: 1.6, range: 17 });
}

// ---- catwalks (+4.5): north run, east run, stairs down by the A LINK door, nest stairs.
const CWY = 4.5;
add(box(-66, -56, -31, -52, CWY - 0.3, CWY, 'grate', { tint: [0.52, 0.54, 0.56] })); // north
add(box(-35, -52, -31, -30, CWY - 0.3, CWY, 'grate', { tint: [0.52, 0.54, 0.56] })); // east
add(stairs(-34.6, -30, -31.4, -18, 0, CWY, 'n', 'grate', { tint: [0.52, 0.54, 0.56], base: -0.01 }));
// Under-catwalk beams and columns (cover pillars on the ground floor).
for (const x of [-60, -52, -44]) add(cbox(x, -52.3, 0.4, 0.4, 0, CWY - 0.3, 'paint', { tint: COL.yellow }));
for (const z of [-44, -36]) add(cbox(-34.7, z, 0.4, 0.4, 0, CWY - 0.3, 'paint', { tint: COL.yellow }));
add(box(-66, -52.2, -35, -52, CWY - 0.6, CWY - 0.3, 'paint', { flags: 'detail', tint: COL.yellow }));
railing(-66, -52.1, -46, -52, CWY);
railing(-42, -52.1, -35, -52, CWY);
railing(-35.1, -52, -35, -30, CWY);
stairRail(-35.0, -30, -34.6, -18, 0, CWY, 'n');

// ---- crane NEST (+7.0): operator cab platform on the north catwalk, reached by a short stair.
const NY = 7.0;
add(stairs(-50, -56, -44, -54, CWY, NY, 'e', 'grate', { tint: [0.52, 0.54, 0.56], base: CWY - 0.3 }));
add(box(-44, -56, -38, -50.5, NY - 0.3, NY, 'grate', { tint: [0.52, 0.54, 0.56] }));
add(box(-44, -50.7, -38, -50.5, NY, NY + 1.0, 'steel', { flags: 'rail' })); // open cab front: waist bar, shoot-through
add(box(-44.2, -54, -44, -50.5, NY, NY + 1.0, 'paint', { tint: COL.yellow })); // cab side (stairs arrive at z -56..-54)
add(box(-38, -56, -37.8, -50.5, NY, NY + 2.4, 'paint', { tint: COL.yellow }));
add(box(-44.2, -56, -37.8, -50.5, NY + 2.4, NY + 2.7, 'paint', { flags: 'detail', tint: COL.yellow })); // cab roof
add(box(-44.2, -50.7, -37.8, -50.5, NY + 1.0, NY + 1.15, 'paint', { flags: 'detail', tint: COL.yellow }));
for (const x of [-44.1, -37.9]) add(cbox(x, -50.6, 0.15, 0.15, NY + 1.0, NY + 2.4, 'paint', { flags: 'detail', tint: COL.yellow }));
// Overhead bridge crane girder (render only) the cab rides on.
add(box(-66, -51, -31, -49.8, 9.4, 10.4, 'paint', { flags: 'detail', tint: COL.yellow }));
add(box(-66, -35.6, -31, -34.4, 9.4, 10.4, 'paint', { flags: 'detail', tint: COL.yellow }));
add(box(-48, -49.8, -46.8, -35.6, 9.0, 10.0, 'paint', { flags: 'detail', tint: COL.yellow })); // bridge
add(box(-48.4, -43.6, -46.4, -41.6, 8.2, 9.0, 'steel', { flags: 'detail' })); // hoist
add(cbox(-47.4, -42.6, 0.06, 0.06, 3.2, 8.2, 'steel', { flags: 'detail' })); // hook cable

// ---- ground floor: racks (west aisle), site A cover, truck bay.
// Pallet racks: two rows with an aisle between them; solid hulls, authored rack models.
for (const z of [-46, -39.5, -33, -26.5]) {
  add(cbox(-64, z, 1.2, 6.2, 0, 4.2, 'paint', { flags: 'hull' }));
  model('rack', -64, 0, z, PI / 2);
}
for (const z of [-46, -39.5]) {
  add(cbox(-58.5, z, 1.2, 6.2, 0, 4.2, 'paint', { flags: 'hull' }));
  model('rack', -58.5, 0, z, PI / 2);
}
// Site A plant zone x -52..-38, z -40..-26. Cover: a container pair, crate stacks, pallet blocks.
container(-46.5, -36.5, 'x', 20, COL.orange);
container(-46.5, -36.5, 'x', 20, COL.rust, { tier: 1, flip: true });
container(-41, -29.5, 'z', 20, COL.cream);
crate(-51, -31, 2.2);
crate(-51, -29.6, 1.1);
crate(-39.5, -41.5, 1.1);
crate(-38.4, -41.5, 1.1);
crate(-38.95, -41.5, 1.1, { y: 1.1 });
add(cbox(-55.5, -21, 2.4, 1.2, 0, 1.3, 'wood', { flags: 'hull' }));
model('pallet_stack', -55.5, 0, -21, 0);
// Truck bay inside the roll-up door: a parked 40' on a chassis blocks the straight look-in.
container(-50.5, -14, 'x', 40, COL.rust, { y: 1.2 });
add(cbox(-50.5, -14, 11, 1.2, 0.95, 1.2, 'steel', { tint: [0.12, 0.12, 0.13] })); // chassis frame
for (const x of [-55.2, -54, -47.5, -46.3]) add(box(x - 0.5, -15.1, x + 0.5, -12.9, 0, 0.95, 'steel', { tint: [0.08, 0.08, 0.09] })); // wheels
add(cbox(-50.5, -14, 11, 1.8, 0, 0.95, 'steel', { flags: 'clip' })); // no crawling under the trailer
crate(-58.5, -10, 1.1);
add(cbox(-43, -10.5, 1.4, 2.6, 0, 1.0, 'paint', { flags: 'hull', tint: COL.yellow }));
model('forklift', -43, 0, -10.5, PI);

// =========================================================================== A MAIN + WORKSHOP
// Truck lane x -68..-50 from the lobby (z 14..34) north to the roll-up door (z -6).
// Workshop block x -50..-30, z -6..14 (solid, 8 m).
add(wall(-50, -6, -30, 14, 8, 'corrugated', { tint: WALL.workshop }));
add(box(-50.05, -6.05, -29.95, 14.05, 7.2, 7.8, 'paint', { flags: 'detail', tint: COL.cream }));
add(box(-50.1, 2, -50, 8, 0, 4.2, 'shutter', { flags: 'detail' })); // closed workshop shutter (facing the lane)
// Lane cover: jersey barriers and a container pair offset so the lobby has no clean look at the door.
for (const [x, z] of [[-63, 4], [-60.5, 4]]) {
  add(cbox(x, z, 2.4, 0.6, 0, 0.95, 'concrete', { flags: 'hull' }));
  model('jersey', x, 0, z, PI / 2);
}
stack(-54, 8, 'z', 20, [COL.orange]);
container(-65, 18, 'z', 40, COL.red);
container(-65, 18, 'z', 40, COL.cream, { tier: 1 });
crate(-55, -2, 1.1);
add(cbox(-66.2, -2, 1.2, 1.2, 0, 1.0, 'paint', { flags: 'hull', tint: COL.blue }));
model('barrels', -66.2, 0, -2, 0);

// =========================================================================== A LOBBY + ATTACKER SPAWN
// Lobby x -68..-30, z 14..34. Spawn x -30..10 (and east into the B main mouth), z 34..50.
add(wall(-50, 24, -30, 34, 6, 'corrugated', { tint: WALL.workshop })); // lobby shed, splits lobby from spawn
add(box(-50.05, 23.95, -29.95, 34.05, 5.4, 6, 'paint', { flags: 'detail', tint: COL.cream }));
container(-44, 18.5, 'x', 20, COL.rust);
crate(-38, 18, 1.1);
crate(-36.9, 18, 1.1);
add(cbox(-58, 28, 2.4, 0.6, 0, 0.95, 'concrete', { flags: 'hull' }));
model('jersey', -58, 0, 28, PI / 2);
// Spawn boundary: the lobby corridor (z 34..38) runs west under the lobby shed to the A side.
add(wall(-68, 38, -36, 50, 9, 'corrugated', { tint: WALL.shed }));
add(wall(-30, 34, -22, 35, 4.2, 'corrugated', { tint: WALL.shed }));
stack(-34, 44, 'z', 20, [COL.grey, COL.green]);
// Lobby cut to mid bottom: 4 m corridor between office annexes (z 18..22).
add(wall(-30, 14, -20, 18, 5, 'plaster', { tint: WALL.office }));
add(wall(-30, 22, -20, 24, 5, 'plaster', { tint: WALL.office }));
// Spawn interior: booth, crates, dummies' strafing lane.
add(cbox(-14, 46, 3.4, 2.6, 0, 2.8, 'paint', { flags: 'hull', tint: COL.white }));
model('booth', -14, 0, 46, PI);
crate(2, 46.5, 1.1);
crate(3.1, 46.5, 1.1);

// =========================================================================== OFFICE BLOCK (A LINK)
// x -30..-20, z -40..14. Solid except the A LINK corridor: mid (x -20, z -6..-2) -> west to
// x -25.4 -> north to z -16 -> west through the warehouse door (z -16..-12).
const OFF = { tint: WALL.office };
add(wall(-30, -46, -20, -40, 7, 'plaster', OFF)); // north block
add(wall(-30, -40, -20, -17, 7, 'plaster', OFF)); // north of corridor
add(wall(-24.6, -17, -20, -6, 7, 'plaster', OFF)); // inner block
add(wall(-30, -12, -29.4, -2, 7, 'plaster', OFF)); // west sliver against the warehouse
add(wall(-30, -2, -20, 14, 7, 'plaster', OFF)); // south block
// Corridor ceiling (indoor, 3.4 m) so the bake darkens the link.
add(box(-30, -17, -24.6, -2, 3.4, 7, 'plaster', OFF));
add(box(-24.6, -6, -20, -2, 3.4, 7, 'plaster', OFF));
// Window bands and a teal stripe on the mid face.
for (let z = -38; z < 12; z += 4) if (z < -8 || z > -1) add(box(-20.06, z, -20, z + 2.6, 4.2, 5.6, 'glass', { flags: 'detail' }));
add(box(-20.08, -46, -20, 14, 6.4, 7, 'paint', { flags: 'detail', tint: COL.orange }));
lights.push({ pos: [-27.2, 3.1, -12], color: [0.9, 0.95, 1.0], intensity: 1.1, range: 9 });
lights.push({ pos: [-22.3, 3.1, -4], color: [0.9, 0.95, 1.0], intensity: 1.0, range: 8 });
// Corridor dressing: a desk block (cover) and a water cooler stand-in.
add(cbox(-27.2, -9, 1.6, 0.8, 0, 0.9, 'wood', { flags: 'hull', tint: [0.4, 0.28, 0.18] }));

// =========================================================================== DEFENDER SPAWN
// x -30..10, z -60..-46. Exits: west back corridor to the warehouse back door, south to mid top,
// east along the north road.
add(wall(-30, -60, -29.4, -54, 6, 'corrugated', { tint: WALL.shed })); // corridor north wall (warehouse back door at x -33..-30)
add(wall(-30, -50, -28, -46, 6, 'corrugated', { tint: WALL.shed }));
add(cbox(-10, -56, 3.4, 2.6, 0, 2.8, 'paint', { flags: 'hull', tint: COL.white }));
model('booth', -10, 0, -56, 0);
stack(4, -55, 'x', 20, [COL.teal, COL.blue]);

// =========================================================================== MID
// Yard x -20..10, z -46..34: an RTG container block.
//   x -20..-18   west crane rail lane (RTG legs ride here; a narrow flank along the office)
//   x -18..-13.1 WEST BLOCK: two fixed rows, 2 high, cut at the A LINK mouth (z -7..-1)
//   x -13.1..-8.4  LANE W        x -8.4..-6.0  slot column V1
//   x -6.0..-1.3   LANE C        x -1.3..1.1   slot column V2
//   x 1.1..8       LANE E        x 8..10       east crane rail lane, against the B-side wall
// Mid Top (z -46..-31) and Mid Bottom (z 14..34) are open plazas with fixed cover.
stack(-14, -38.5, 'x', 20, [COL.yellow, COL.grey]);
crate(-9.5, -39, 1.1);
stack(4.5, -41, 'z', 20, [COL.grey]);
stack(-15, 25, 'z', 20, [COL.white, COL.white]);
crate(-4, 26, 1.1);
crate(-4, 27.1, 1.1);
crate(-4, 26.55, 1.1, { y: 1.1 });
stack(5, 22, 'z', 40, [COL.green]);
// Crane rails (painted strips the RTG tyres ride on).
for (const x of [-19, 9]) add(box(x - 0.4, -46, x + 0.4, 34, 0, 0.03, 'hazard', { flags: 'detail' }));
// West block.
const WBX = [-16.78, -14.34];
const wbTints = [[COL.cream, COL.red], [COL.orange, COL.cream], [COL.rust, COL.orange], [COL.red, COL.rust]];
[[-31.38 + C40 / 2, 0], [-31.38 + C40 * 1.5, 1], [-1 + C40 / 2, 2]].forEach(([z, k]) => {
  stack(WBX[0], z, 'z', 40, wbTints[k], { flip: k % 2 === 1 });
  stack(WBX[1], z, 'z', 40, wbTints[(k + 1) % 4], { flip: k % 2 === 0 });
});
// East wall (B side): B-link gap at z -21.6..-18.
stack(11.3, -46 + C40 / 2, 'z', 40, [COL.blue, COL.teal, COL.navy]);
stack(11.3, -46 + C40 * 1.5, 'z', 40, [COL.teal, COL.navy], { flip: true });
stack(11.3, -12 - C20 / 2, 'z', 20, [COL.navy, COL.blue, COL.teal]);
// Stacks block between mid and B main, z -12..37 (three high, solid).
for (let i = 0; i < 4; i++) {
  const z = -6 + i * 12.4;
  stack(11.3, z, 'z', 40, [[COL.teal, COL.navy, COL.blue], [COL.blue, COL.teal], [COL.navy, COL.blue, COL.teal], [COL.teal, COL.blue]][i]);
  stack(14, z, 'z', 40, [[COL.blue, COL.teal, COL.navy], [COL.navy, COL.blue, COL.teal], [COL.teal, COL.navy], [COL.blue, COL.navy, COL.teal]][i]);
  stack(16.7, z, 'z', 40, [[COL.navy, COL.blue], [COL.teal, COL.navy, COL.blue], [COL.blue, COL.teal, COL.navy], [COL.navy, COL.teal]][i]);
  stack(19.4, z, 'z', 40, [[COL.teal, COL.navy, COL.blue], [COL.blue, COL.teal], [COL.navy, COL.blue, COL.teal], [COL.teal, COL.blue, COL.navy]][i]);
}
add(box(10, 42.4, 22, 50, 0, 8, 'corrugated', { tint: WALL.shed })); // south of the stacks: spawn corner
// The pier side of the B-link gap: a crate pile so mid has no straight look onto site.
crate(15.5, -21, 2.2);
crate(15.5, -19.6, 1.1);

// ---- crane-moved containers. Six physical stacks (objects) live in nine slots; each layout
// assigns every object a slot. Collision exists per object@slot combination (a variant group);
// the RTG crane carries exactly the objects whose slot changed, so what you see moved is what
// changed. Column slots take 40' stacks along Z; cross slots take 20' stacks that close a lane.
const V1 = -7.18, V2 = -0.08;
const SLOTS = {
  v1a: { x: V1, z: -23.9, axis: 'z' }, v1b: { x: V1, z: -8.5, axis: 'z' }, v1c: { x: V1, z: 8.1, axis: 'z' },
  v2a: { x: V2, z: -22.9, axis: 'z' }, v2b: { x: V2, z: -7.4, axis: 'z' }, v2c: { x: V2, z: 9.1, axis: 'z' },
  xw: { x: -10.76, z: -15.9, axis: 'x' }, xc: { x: -3.63, z: 0.35, axis: 'x' }, xe: { x: 4.57, z: -15.15, axis: 'x' },
};
const OBJECTS = {
  A: { size: 40, axis: 'z', tints: [COL.red, COL.cream] },
  B: { size: 40, axis: 'z', tints: [COL.yellow] },
  C: { size: 40, axis: 'z', tints: [COL.teal, COL.blue] },
  D: { size: 40, axis: 'z', tints: [COL.orange, COL.grey] },
  W: { size: 20, axis: 'x', tints: [COL.rust, COL.cream] },
  E: { size: 20, axis: 'x', tints: [COL.navy, COL.teal] },
};
const CRANE_LAYOUTS = [
  { name: 'West Shut', park: 'c0', at: { A: 'v1a', B: 'v1b', C: 'v2b', D: 'v2c', W: 'xw', E: 'xe' } }, // only the centre lane runs
  { name: 'Zig-Zag', park: 'c1', at: { A: 'v2a', B: 'v1b', C: 'v1c', D: 'v2c', W: 'xc', E: 'xe' } }, // west lane open, centre broken
  { name: 'Open Middle', park: 'c2', at: { A: 'v1a', B: 'v2a', C: 'v1c', D: 'v2c', W: 'xc', E: 'xw' } }, // north sealed, crossings mid
];
const combos = new Set();
for (const L of CRANE_LAYOUTS) for (const [o, sl] of Object.entries(L.at)) {
  if (OBJECTS[o].axis !== SLOTS[sl].axis) throw new Error(`Dockside 9: object ${o} cannot sit in slot ${sl}`);
  combos.add(`${o}@${sl}`);
}
// Collision only: the CraneView draws the objects (models) wherever the crane has put them.
for (const g of combos) {
  const [o, sl] = g.split('@');
  const ob = OBJECTS[o], st = SLOTS[sl];
  const L = ob.size === 40 ? C40 : C20;
  const sx = ob.axis === 'z' ? CW : L, sz = ob.axis === 'z' ? L : CW;
  add(cbox(st.x, st.z, sx - 0.08, sz - 0.08, 0, CH * ob.tints.length, 'paint', { flags: 'hull', group: g }));
}
// RTG crane leg collision per park position (the crane ends each re-stack parked here).
const CRANE_X = -5, CRANE_SPAN = 28, CRANE_WB = 7;
const CRANE_PARK = { c0: -27, c1: 2, c2: 13 };
for (const [g, z] of Object.entries(CRANE_PARK)) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cbox(CRANE_X + sx * CRANE_SPAN / 2, z + sz * CRANE_WB / 2, 1.1, 2.6, 0, 3.0, 'paint', { flags: 'hull', group: g }));
}

// =========================================================================== B MAIN (quay road)
// x 22..41, z -12..34. Gate at z -12: booth + boom gate + container stack.
container(31.5, 6, 'z', 40, COL.teal);
container(31.5, 6, 'z', 40, COL.blue, { tier: 1, flip: true });
// Back-road row along the stacks: narrows the road and gives a second lane behind it.
stack(23, 30.5, 'z', 40, [COL.navy, COL.teal]);
stack(23, 15.5, 'z', 40, [COL.blue]);
container(31.5, 22.5, 'z', 20, COL.navy);
crate(33.2, 21, 1.1);
add(cbox(25, 24, 1.4, 2.6, 0, 1.0, 'paint', { flags: 'hull', tint: COL.yellow }));
model('forklift', 25, 0, 24, PI / 2);
for (const [x, z] of [[37, -2], [37, 16]]) {
  add(cbox(x, z, 0.6, 2.4, 0, 0.95, 'concrete', { flags: 'hull' }));
  model('jersey', x, 0, z, 0);
}
crate(24, -6, 1.1);
crate(24, -4.9, 1.1);
add(cbox(26, 38, 1.2, 1.2, 0, 1.0, 'paint', { flags: 'hull', tint: COL.blue }));
model('barrels', 26, 0, 38, 0);
// Gate line z -13..-10.5.
stack(17, -11.5, 'x', 20, [COL.navy, COL.teal]);
stack(23.2, -11.5, 'x', 20, [COL.blue, COL.navy]);
add(cbox(27.5, -11.8, 2.6, 3.4, 0, 2.8, 'paint', { flags: 'hull', tint: COL.white })); // booth (west of the gate)
model('booth', 27.5, 0, -11.8, PI / 2);
model('boom_gate', 31.9, 0, -11.2, 0);
stack(38.2, -11.5, 'x', 20, [COL.teal, COL.blue]);

// =========================================================================== B SITE (pier)
// Pier x 10..41, z -50..-12. Plant zone x 21..33, z -38..-26.
// Ship-to-shore crane: portal legs at x 24 / 40 (span 16), z -42 / -26 (gauge 16). Legs are the
// signature cover of the site; the boom reaches out over the freighter.
const STS = { x: 29, z: -34, k: 0.7 }; // model scale 0.7: legs at x 22 / 36, z -39.6 / -28.4
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const lx = STS.x + sx * 10 * STS.k, lz = STS.z + sz * 8 * STS.k;
  add(cbox(lx, lz, 1.8 * STS.k, 5 * STS.k, 0, 2 * STS.k, 'paint', { flags: 'hull' }));
  add(cbox(lx, lz, 1.6 * STS.k, 1.0 * STS.k + 0.3, 2 * STS.k, 30, 'paint', { flags: 'hull' }));
}
model('sts_crane', STS.x, 0, STS.z, 0, { scale: STS.k, tint: COL.yellow });
// Site cover.
container(18, -31, 'z', 20, COL.blue);
container(18, -31, 'z', 20, COL.teal, { tier: 1, flip: true });
crate(28.5, -29.5, 2.2);
crate(30.7, -29.5, 1.1);
crate(26.5, -37.5, 1.1);
crate(27.6, -37.5, 1.1);
container(33.6, -18, 'x', 20, COL.navy);
add(cbox(14.5, -44, 2.4, 1.2, 0, 1.3, 'wood', { flags: 'hull' }));
model('pallet_stack', 14.5, 0, -44, 0);
// North pier: reefer pair + crates break the long look from the north road into site.
stack(30, -45.5, 'x', 20, [COL.white, COL.white]);
crate(19, -42, 1.1);
crate(19, -43.1, 1.1);
add(cbox(36.5, -44, 1.2, 1.2, 0, 1.0, 'paint', { flags: 'hull', tint: COL.teal }));
model('barrels', 36.5, 0, -44, 0);
// Bollards and fenders along the quay edge (bollards are knee-high cover).
for (let z = -56; z <= 46; z += 9) {
  if (z > -40 && z < -9) continue; // gangway tower, gate stack
  add(cyl(40.5, z, 0.32, 0, 0.7, 8, 'paint', { flags: 'hull', tint: COL.navy }));
  model('bollard', 40.5, 0, z, PI / 2);
  model('fender', 41.95, -1.8, z + 4, PI / 2);
}
for (const z of [-48, -6, 30]) model('lifebuoy', 41.2, 1.2, z, PI / 2);
// North road (x 10..41, z -60..-50) back to defender spawn: a container line separates it from the pier.
stack(16, -50, 'x', 20, [COL.navy]);
stack(26, -50.5, 'x', 40, [COL.blue, COL.teal]);
crate(36, -50.5, 2.2);

// ---- gangway tower: stairs up the quay edge to a bridge onto the freighter deck (+6.0).
const DECK = 6.0;
add(stairs(38.2, -34, 40.9, -18, 0, DECK, 'n', 'grate', { tint: [0.52, 0.54, 0.56], base: -0.01 }));
add(box(37, -38, 41, -34, DECK - 0.3, DECK, 'grate', { tint: [0.52, 0.54, 0.56] })); // top landing
add(box(37, -38, 41, -34, 0, DECK - 0.3, 'paint', { flags: 'hull', tint: COL.teal })); // tower core
add(box(41, -37.5, 45.5, -34.5, DECK - 0.3, DECK, 'grate', { tint: [0.52, 0.54, 0.56] })); // bridge
stairRail(37.8, -34, 38.2, -18, 0, DECK, 'n');
railing(41, -37.6, 45.5, -37.5, DECK);
railing(41, -34.5, 45.5, -34.4, DECK);
railing(37, -38.1, 41, -38, DECK);

// =========================================================================== FREIGHTER
// Hull x 45..63, z -60..4 (bow north). Deck +6.0. Playable deck z -50..-20: hatch covers as
// cover, deck containers at the south end, forecastle wall at the north end.
const HULL = 'paint';
add(prism([[45, -52], [48, -62], [60, -62], [63, -52], [63, 4], [45, 4]], -3, DECK, HULL, { tint: [0.06, 0.1, 0.2], top: 'deck', topTint: [0.32, 0.12, 0.08] }));
add(box(44.95, -52, 63.05, 4, 4.8, 5.1, 'paint', { flags: 'detail', tint: [0.75, 0.72, 0.66] })); // boot stripe
add(box(45, -62, 63, -50, DECK, DECK + 2.5, 'paint', { tint: [0.7, 0.68, 0.62] })); // forecastle
// Bulwarks / railings along the deck edges.
railing(45, -50, 45.2, -38, DECK);
railing(45, -34, 45.2, -20, DECK);
railing(62.8, -50, 63, -20, DECK);
// Hatch covers (1.6 m): two of them, a gap between for crossing.
add(box(48, -47, 60, -40, DECK, DECK + 1.6, 'paint', { flags: 'hull' }));
add(box(48, -35, 60, -28, DECK, DECK + 1.6, 'paint', { flags: 'hull' }));
model('hatch_cover', 54, DECK, -43.5, 0);
model('hatch_cover', 54, DECK, -31.5, 0);
model('deck_crane', 54, DECK, -13, PI, { tint: COL.green });
for (const sx of [-1, 1]) model('lifeboat', 54 + sx * 8.2, DECK + 5.8, 1.5, 0);
// Mooring: bitts on the deck edge, hawsers down to the quay bollards.
for (const [bz, qz] of [[-48, -56], [-44, -47], [-14, -2], [-8, 7]]) {
  model('bitts', 46, DECK, bz, 0);
  model('mooring_line', 40.5, 0.62, qz, 0, { aim: [46, DECK + 0.9, bz], sag: 1.2 });
}
// Deck containers close off the aft part of the ship.
stack(49, -21, 'x', 20, [COL.red, COL.cream], { y: DECK });
stack(55.2, -21, 'x', 20, [COL.orange, COL.blue], { y: DECK });
stack(61.2, -21, 'x', 20, [COL.teal], { y: DECK });
add(box(45, -19.6, 63, 4, DECK, DECK + 5.2, 'paint', { flags: 'clip' }));
// Superstructure (render only, sets the skyline over B main).
add(box(47, -6, 61, 4, DECK, DECK + 14, 'paint', { flags: 'hull' }));
add(box(51.8, 0.6, 56.2, 3.8, DECK + 14, DECK + 18, 'paint', { flags: 'hull' })); // funnel
model('ship_house', 54, DECK, -1, 0);

// =========================================================================== skyline (render only)
// Beyond the playable fence: more terminal. Flags = RENDER only, so these never take part in
// collision, bullets, bot sight or the light bake; they still cast sun shadows (static map).
const FAR = 8;
const far = (x0, z0, x1, z1, h, tint, surface = 'corrugated') => add(box(x0, z0, x1, z1, 0, h, surface, { flags: FAR, tint, tess: 4 }));
// North: a second warehouse row and stacked yard behind the fence.
far(-70, -84, -40, -64, 16, [0.46, 0.52, 0.56]);
far(-36, -80, -8, -66, 12, [0.6, 0.44, 0.32]);
for (let i = 0; i < 6; i++) far(-4 + i * 7, -74, 1 + i * 7, -64, 5.2 + (i % 3) * 2.6, [[0.05, 0.16, 0.42], [0.56, 0.06, 0.06], [0.03, 0.34, 0.34]][i % 3], 'paint');
// West: tall sheds.
far(-96, -60, -72, -10, 14, [0.42, 0.5, 0.52]);
far(-92, -6, -72, 50, 11, [0.62, 0.44, 0.32]);
// South: terminal offices and a stacked yard.
far(-60, 54, -20, 72, 9, [0.78, 0.74, 0.66], 'plaster');
for (let i = 0; i < 7; i++) far(-14 + i * 7.5, 54, -8.5 + i * 7.5, 70, 2.6 * (1 + (i % 3)), [[0.78, 0.3, 0.05], [0.05, 0.16, 0.42], [0.13, 0.3, 0.1]][i % 3], 'paint');
// Far shore across the basin (east): low warehouses and a quay line.
far(84, -120, 140, 80, 2.0, [0.5, 0.5, 0.48], 'concrete');
for (let i = 0; i < 6; i++) far(90, -110 + i * 32, 118, -86 + i * 32, 7 + (i % 3) * 4, [[0.46, 0.52, 0.56], [0.72, 0.62, 0.44], [0.12, 0.42, 0.44]][i % 3]);
add(box(76, -120, 84, 80, -3.2, -2.5, 'water', { flags: FAR, tess: 4 }));
// More quay cranes along our berth line, beyond the play space.
model('sts_crane', 29, 0, -92, 0, { scale: 0.7, tint: COL.yellow });
model('sts_crane', 29, 0, 78, 0, { scale: 0.7, tint: COL.yellow });
model('sts_crane', 112, 2, -40, Math.PI, { scale: 0.7, tint: [0.75, 0.2, 0.08] });
model('sts_crane', 112, 2, 20, Math.PI, { scale: 0.7, tint: [0.75, 0.2, 0.08] });

// ---- rooftop dressing (office, workshop, lobby shed)
for (const [x, z] of [[-27, -30], [-23, -30], [-27, 6], [-23, 6]]) {
  add(cbox(x, z, 2.2, 1.6, 7, 8.2, 'paint', { flags: 'detail', tint: [0.7, 0.7, 0.68] }));
  add(cyl(x, z, 0.55, 8.2, 8.35, 10, 'steel', { flags: 'detail' }));
}
add(box(-30.1, -46, -29.9, 14, 7, 7.6, 'paint', { flags: 'detail', tint: WALL.office }));
add(box(-20.1, -46, -19.9, 14, 7, 7.6, 'paint', { flags: 'detail', tint: WALL.office }));
for (const x of [-46, -40, -34]) add(cbox(x, 4, 1.4, 1.4, 8, 9.2, 'steel', { flags: 'detail', tint: [0.4, 0.42, 0.44] }));
add(box(-50, -6, -49.8, 14, 8, 8.6, 'paint', { flags: 'detail', tint: COL.cream }));

// =========================================================================== crane (RTG) + lights
const LIGHT_MASTS = [[-28, 30], [-24, -49], [20, -14.5], [8, 36], [-66.5, 10], [38.5, 30]];
for (const [x, z] of LIGHT_MASTS) {
  add(cyl(x, z, 0.35, 0, 18, 8, 'paint', { flags: 'hull', tint: COL.grey }));
  model('light_mast', x, 0, z, face(x, z, -5, -10));
}

// =========================================================================== markings
// Quay safety line and crane rails along the water.
paintLine(40.1, -60, 40.1, -40, 0.15, PAINT_Y);
paintLine(40.1, -34, 40.1, 50, 0.15, PAINT_Y);
for (const x of [22, 36]) {
  add(box(x - 0.09, -60, x + 0.09, -12.8, 0, 0.05, 'steel', { flags: 'detail', tint: [0.35, 0.36, 0.38] }));
  paintLine(x - 0.45, -60, x - 0.45, -12.8, 0.08, PAINT_Y);
  paintLine(x + 0.45, -60, x + 0.45, -12.8, 0.08, PAINT_Y);
}
// B main: road edge + centre dashes, gate stop line, hatch under the booth approach.
dashed(36.2, -9, 36.2, 36, 0.14, PAINT_W, 3, 3);
paintLine(24.6, -9.5, 24.6, 36, 0.14, PAINT_W);
paintLine(28.8, -9.6, 35.2, -9.6, 0.4, PAINT_W);
hatchRect(25.2, -9.4, 28.6, -7.2, PAINT_Y);
// Mid yard: every crane slot is outlined, so you can read where a stack may land next round.
for (const [k, st] of Object.entries(SLOTS)) {
  const L = st.axis === 'z' ? C40 : C20;
  const hx = (st.axis === 'z' ? CW : L) / 2 + 0.25, hz = (st.axis === 'z' ? L : CW) / 2 + 0.25;
  paintRect(st.x - hx, st.z - hz, st.x + hx, st.z + hz, 0.12, PAINT_W);
  floorText.push({ text: k.toUpperCase(), pos: [st.x, MARK_Y + 0.004, st.z + (st.axis === 'z' ? hz - 1.2 : 0)], size: 0.55, color: [0.2, 0.2, 0.22], yaw: 0 });
}
// Mid bottom / spawn: bay lines.
for (const x of [-18, -12, -6, 0, 6]) paintLine(x, 36, x, 41, 0.12, PAINT_W);
dashed(-19, 14.5, 9, 14.5, 0.15, PAINT_Y, 1.5, 1.0);
dashed(-19, -31, 9, -31, 0.15, PAINT_Y, 1.5, 1.0);
// A main: lane centre dashes and a stop line at the roll-up door.
dashed(-59, -4, -59, 32, 0.14, PAINT_W, 3, 3);
paintLine(-62, -5.6, -55, -5.6, 0.4, PAINT_W);
// Warehouse: forklift aisles (yellow) around the racks and the site; hatch in front of the stairs.
paintRect(-62.9, -49.6, -55.6, -17, 0.14, PAINT_Y);
paintRect(-53.2, -41.2, -36.8, -24.8, 0.1, [0.9, 0.42, 0.12]);
hatchRect(-35.2, -17.6, -30.8, -13.6, PAINT_Y);
dashed(-62, -7.5, -62, -17, 0.14, PAINT_Y, 1, 1);
// Pier: berth numbers and bollard bays.
floorText.push({ text: 'BERTH 9', pos: [38.2, MARK_Y + 0.004, -46], size: 1.0, color: [0.22, 0.22, 0.24], yaw: Math.PI / 2 });
floorText.push({ text: 'BERTH 9', pos: [38.2, MARK_Y + 0.004, 0], size: 1.0, color: [0.22, 0.22, 0.24], yaw: Math.PI / 2 });
floorText.push({ text: 'MID', pos: [-4, MARK_Y + 0.004, 18], size: 2.2, color: [0.25, 0.25, 0.27], yaw: 0 });

// =========================================================================== signage
// { text, pos, normal, size, color } on wall faces (MapDecals paints them).
const RED = [0.86, 0.24, 0.08], TEAL = [0.05, 0.45, 0.45], INK = [0.06, 0.07, 0.09], WHITE = [0.95, 0.95, 0.92];
const signs = [
  { text: 'A', pos: [-31.0 - 0.02, 5.5, -40], normal: [-1, 0, 0], size: 4.2, color: RED },
  { text: 'A', pos: [-58.5, 8.2, -5.99], normal: [0, 0, 1], size: 3.0, color: RED },
  { text: 'WAREHOUSE 4', pos: [-44, 9.4, -5.99], normal: [0, 0, 1], size: 1.4, color: WHITE },
  { text: 'B', pos: [12.47, 3.2, -36], normal: [1, 0, 0], size: 3.0, color: TEAL },
  { text: 'B', pos: [38.2, 3.6, -10.27], normal: [0, 0, 1], size: 2.0, color: TEAL },
  { text: 'PIER 9', pos: [23.2, 3.6, -10.27], normal: [0, 0, 1], size: 1.2, color: WHITE },
  { text: 'A MAIN ↑', pos: [-44, 3.0, 14.01], normal: [0, 0, 1], size: 0.9, color: INK },
  { text: '← A LINK', pos: [-19.99, 2.6, -8.5], normal: [1, 0, 0], size: 0.8, color: INK },
  { text: 'MID ↑', pos: [-26, 2.6, 35.01], normal: [0, 0, 1], size: 0.9, color: INK },
  { text: '← B MAIN', pos: [9.99, 3.0, 46], normal: [-1, 0, 0], size: 0.9, color: INK },
  { text: 'DOCKSIDE 9', pos: [-14, 7.0, 50 - 0.01], normal: [0, 0, -1], size: 2.4, color: WHITE },
];

// =========================================================================== gameplay data
const hostile = (x, y, z, tx, tz) => ({ pos: [x, y, z], yaw: face(x, z, tx, tz) });

export const DOCKSIDE9 = {
  id: 'dockside9',
  name: 'Dockside 9',
  blurb: 'Container port. Cranes re-stack mid between rounds; the warehouse hides a crane nest, the pier a freighter deck.',
  manual:
    'Three lanes: A Main (truck lane into Warehouse 4), Mid (the crane yard), B Main (the quay road to Pier 9). The RTG crane re-stacks the yard containers during every barrier phase, so mid cover and lanes change each round (three layouts, never the same twice). A has a +4.5 m catwalk and a +7 m crane nest; B has the quay-crane legs and a gangway up to the freighter deck at +6 m.',
  env: {
    // Late-afternoon harbour light: warm low sun from the south-west, teal sky, sea haze.
    sun: { dir: [-0.55, 0.62, 0.56], color: [1.0, 0.84, 0.64], intensity: 2.5 },
    sky: { zenith: [0.22, 0.46, 0.74], horizon: [0.72, 0.8, 0.84], ground: [0.5, 0.46, 0.42], bounce: [0.38, 0.33, 0.29], ambient: 0.72 },
    exposure: 0.74,
    fog: { color: [0.72, 0.78, 0.82], density: 0.0036 },
    horizon: 'harbour',
  },
  rules: { barrierTime: 7 },
  assets: ['docks', 'ship'],
  bounds: { minX: -68, maxX: 64, minZ: -63, maxZ: 50 },
  brushes,
  models,
  lights,
  zones: {
    A: { x0: -53, z0: -41, x1: -37, z1: -25 },
    B: { x0: 21, z0: -38, x1: 33, z1: -26 },
  },
  spawns: {
    player: { pos: [-11, 0, 43], yaw: 0 },
    hostiles: [
      hostile(-41, NY, -53, -58.5, -6), // nest: covers the roll-up door and the site
      hostile(-33, CWY, -40, -30, -14), // east catwalk: watches the A link door
      hostile(-49, 0, -40.5, -58.5, -8), // site A, behind the orange pair
      hostile(-61, 0, -30, -58, -8), // rack aisle
      hostile(-14, 0, -42, -6, 20), // mid top, behind the yellow stack
      hostile(14, 0, -24.5, 0, -18), // B link, behind the crate pile
      hostile(55, DECK, -38, 31, -12), // freighter deck, between the hatch covers
      hostile(22, 0, -43.2, 31, -12), // site B, behind the crane bogie
      hostile(34, 0, -22, 31, -12), // B, behind the navy 20'
    ],
    dummies: [{ pos: [-17, 0, 38.5] }, { pos: [-11, 0, 37.5] }, { pos: [-5, 0, 38.5] }],
  },
  variants: {
    layouts: CRANE_LAYOUTS.map((L) => [...Object.entries(L.at).map(([o, sl]) => `${o}@${sl}`), L.park]),
    first: 0,
    names: CRANE_LAYOUTS.map((L) => L.name),
  },
  crane: { model: 'rtg', x: CRANE_X, span: CRANE_SPAN, wheelbase: CRANE_WB, park: CRANE_PARK, slots: SLOTS, objects: OBJECTS, layouts: CRANE_LAYOUTS.map((L) => ({ park: L.park, at: L.at })) },
  callouts: [
    { name: 'A Site', x: -45, z: -33 },
    { name: 'Nest', x: -41, y: NY, z: -53 },
    { name: 'Catwalk', x: -48, y: CWY, z: -54 },
    { name: 'A Stairs', x: -33, y: 2, z: -24 },
    { name: 'Racks', x: -61, z: -36 },
    { name: 'Truck Bay', x: -51, z: -11 },
    { name: 'A Main', x: -59, z: 6 },
    { name: 'A Lobby', x: -50, z: 20 },
    { name: 'A Link', x: -26, z: -10 },
    { name: 'Mid Top', x: -5, z: -38 },
    { name: 'Crane Yard', x: -5, z: -6 },
    { name: 'Mid Bottom', x: -5, z: 24 },
    { name: 'B Link', x: 13, z: -21 },
    { name: 'B Site', x: 27, z: -32 },
    { name: 'Crane Legs', x: 38, z: -28 },
    { name: 'Gangway', x: 39.5, y: 3, z: -26 },
    { name: 'Deck', x: 54, y: DECK, z: -36 },
    { name: 'North Road', x: 26, z: -55 },
    { name: 'B Gate', x: 31, z: -12 },
    { name: 'B Main', x: 31, z: 12 },
    { name: 'Defender Spawn', x: -8, z: -52 },
    { name: 'Attacker Spawn', x: -6, z: 42 },
  ],
  signs,
  floorText,
  minimapRotation: 0,
};
