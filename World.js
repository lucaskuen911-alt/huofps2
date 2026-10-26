// CollisionWorld: true 3D level geometry for movement, hitscan, sight lines and light baking.
//
// Every piece of level geometry is a BRUSH: a convex prism. Its footprint is a convex polygon
// in the XZ plane, its floor is a flat plane y = y0, and its roof is a plane
//     y = c + gx * x + gz * z
// (flat when gx = gz = 0, a ramp otherwise). That covers walls, floors, catwalks, ceilings,
// ramps in any direction, rotated crates, octagonal pillars and ring segments, and leaves
// open space underneath anything that is not resting on the ground: tunnels, bridges and
// multi-floor buildings all work.
//
// Queries (all allocation-free in steady state):
//   footprint()   square player hull vs brushes -> blocked / ground / ceiling / ground surface
//   raycast()     exact ray vs convex brushes through a uniform XZ grid (2D DDA)
//   lineOfSight() raycast with the SIGHT mask
//   groundBelow() highest walkable top under a point
//   pointSolid()  is a point inside any brush (used for hidden-face culling)
//
// Brush flags decide which queries see a brush, so the same data describes player clips,
// shoot-through railings, see-through glass and render-only detail.
//
// Dynamic brushes belong to a GROUP. Map variants (e.g. crane-moved containers) enable a set of
// groups per round; disabled brushes are invisible to every query. The active set is chosen by
// the authority and replicated in the round state, so prediction always collides with the same
// geometry as the server.

export const BF = {
  COLLIDE: 1, // blocks player and bot movement
  SHOT: 2, // stops bullets
  SIGHT: 4, // blocks bot line of sight and audio occlusion
  RENDER: 8, // drawn
  MINIMAP: 16, // drawn on the minimap
  LIGHT: 32, // casts baked shadows
  OCCLUDE: 64, // opaque: hides faces of other brushes it covers
};
export const SOLID = BF.COLLIDE | BF.SHOT | BF.SIGHT | BF.RENDER | BF.MINIMAP | BF.LIGHT | BF.OCCLUDE;

const CELL = 4;
const EPS = 1e-7;
const MAX_POLY = 24;

export class CollisionWorld {
  constructor(map) {
    this.map = map;
    this.brushes = map.brushes;
    const b = map.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.maxX = b.maxX;
    this.maxZ = b.maxZ;
    this.minY = b.minY;
    this.maxY = b.maxY;
    this.cols = Math.max(1, Math.ceil((this.maxX - this.minX) / CELL));
    this.rows = Math.max(1, Math.ceil((this.maxZ - this.minZ) / CELL));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    for (const br of this.brushes) {
      const c0 = this.col(br.minX), c1 = this.col(br.maxX);
      const r0 = this.row(br.minZ), r1 = this.row(br.maxZ);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(br);
    }
    this.stamp = new Uint32Array(this.brushes.length);
    this.stampId = 1;
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 0, brush: null };
    this.groundSurface = 0;
    // Scratch polygons for hull clipping.
    this.pa = new Float64Array(MAX_POLY * 2);
    this.pb = new Float64Array(MAX_POLY * 2);
    this.groups = new Set();
    this.variant = -1;
    for (const br of this.brushes) br.enabled = !br.group;
    this.setVariant(0);
  }

  col(x) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / CELL)));
  }
  row(z) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / CELL)));
  }

  nextStamp() {
    if (++this.stampId === 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /** Enable the brush groups of layout `index` (no-op for maps without variants). */
  setVariant(index) {
    const v = this.map.variants;
    if (!v) return;
    if (index === this.variant) return;
    const n = v.layouts.length;
    const i = ((index % n) + n) % n;
    this.variant = i;
    this.setGroups(v.layouts[i]);
  }

  /** Explicit group set (the light baker uses this to bake each slot in isolation). */
  setGroups(list) {
    this.groups = new Set(list);
    for (const br of this.brushes) if (br.group) br.enabled = this.groups.has(br.group);
  }

  topAt(br, x, z) {
    return br.c + br.gx * x + br.gz * z;
  }

  /** Convex point-in-polygon against the brush's outward edge planes. */
  inside2D(br, x, z, eps = 0) {
    const e = br.edges;
    for (let i = 0; i < e.length; i += 3) if (e[i] * x + e[i + 1] * z > e[i + 2] + eps) return false;
    return true;
  }

  /**
   * Square hull query used by movement.
   * hull = [x - r, x + r] x [z - r, z + r] x [feetY, feetY + height].
   *  - ground  : highest brush top under the hull that is at most `step` above the feet
   *  - blocked : a brush rises above feet + step and its underside is below the head
   *  - ceiling : lowest underside of a brush overhead (for jump clamping)
   */
  footprint(x, z, radius, feetY, step, height, out) {
    if (out === undefined) { out = height; height = 1.78; }
    const x0 = x - radius, x1 = x + radius, z0 = z - radius, z1 = z + radius;
    out.blocked = false;
    out.ground = -1e3;
    out.ceiling = 1e3;
    out.surface = 0;
    if (x0 < this.minX || x1 > this.maxX || z0 < this.minZ || z1 > this.maxZ) {
      out.blocked = true;
      return out;
    }
    const s = this.nextStamp();
    const c0 = this.col(x0), c1 = this.col(x1), r0 = this.row(z0), r1 = this.row(z1);
    const head = feetY + height;
    const stepTop = feetY + step;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells[r * this.cols + c];
        for (let k = 0; k < list.length; k++) {
          const br = list[k];
          if (this.stamp[br.id] === s) continue;
          this.stamp[br.id] = s;
          if (!(br.flags & BF.COLLIDE) || !br.enabled) continue;
          if (br.maxX <= x0 + EPS || br.minX >= x1 - EPS || br.maxZ <= z0 + EPS || br.minZ >= z1 - EPS) continue;
          if (br.y0 >= head && br.maxY > stepTop) {
            // Entirely overhead: only a candidate ceiling (cheap reject before clipping).
            if (this.overlapTop(br, x0, z0, x1, z1) === -Infinity) continue;
            if (br.y0 < out.ceiling) out.ceiling = br.y0;
            continue;
          }
          const top = this.overlapTop(br, x0, z0, x1, z1);
          if (top === -Infinity) continue;
          if (top <= stepTop) {
            if (top > out.ground) {
              out.ground = top;
              out.surface = br.topSurface;
            }
          } else if (br.y0 < head) out.blocked = true;
          else if (br.y0 < out.ceiling) out.ceiling = br.y0;
        }
      }
    }
    return out;
  }

  /** Max roof height of `br` over its overlap with the rectangle, or -Infinity if none. */
  overlapTop(br, x0, z0, x1, z1) {
    if (br.rect) {
      const ax = Math.max(x0, br.minX), bx = Math.min(x1, br.maxX);
      const az = Math.max(z0, br.minZ), bz = Math.min(z1, br.maxZ);
      if (bx - ax <= EPS || bz - az <= EPS) return -Infinity;
      if (br.gx === 0 && br.gz === 0) return br.c;
      return br.c + Math.max(br.gx * ax, br.gx * bx) + Math.max(br.gz * az, br.gz * bz);
    }
    // General convex polygon: clip the rectangle by each brush edge (Sutherland-Hodgman).
    let src = this.pa, dst = this.pb;
    src[0] = x0; src[1] = z0; src[2] = x1; src[3] = z0; src[4] = x1; src[5] = z1; src[6] = x0; src[7] = z1;
    let n = 4;
    const e = br.edges;
    for (let i = 0; i < e.length && n > 0; i += 3) {
      const ex = e[i], ez = e[i + 1], ed = e[i + 2];
      let m = 0;
      for (let j = 0; j < n; j++) {
        const ax = src[j * 2], az = src[j * 2 + 1];
        const k = (j + 1) % n;
        const bx = src[k * 2], bz = src[k * 2 + 1];
        const da = ex * ax + ez * az - ed, db = ex * bx + ez * bz - ed;
        if (da <= 0) {
          dst[m * 2] = ax;
          dst[m * 2 + 1] = az;
          m++;
        }
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const t = da / (da - db);
          dst[m * 2] = ax + (bx - ax) * t;
          dst[m * 2 + 1] = az + (bz - az) * t;
          m++;
        }
        if (m >= MAX_POLY - 1) break;
      }
      n = m;
      const tmp = src;
      src = dst;
      dst = tmp;
    }
    if (n < 3) return -Infinity;
    let area = 0;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      area += src[j * 2] * src[k * 2 + 1] - src[k * 2] * src[j * 2 + 1];
    }
    if (Math.abs(area) < 1e-7) return -Infinity;
    let top = -Infinity;
    for (let j = 0; j < n; j++) {
      const h = br.c + br.gx * src[j * 2] + br.gz * src[j * 2 + 1];
      if (h > top) top = h;
    }
    return top;
  }

  /** Highest walkable roof at (x, z) that is at or below y (+1 cm tolerance). */
  groundBelow(x, y, z) {
    this.groundSurface = 0;
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return -1e3;
    const list = this.cells[this.row(z) * this.cols + this.col(x)];
    let best = -1e3;
    for (let k = 0; k < list.length; k++) {
      const br = list[k];
      if (!(br.flags & BF.COLLIDE) || !br.enabled) continue;
      if (x < br.minX || x > br.maxX || z < br.minZ || z > br.maxZ || !this.inside2D(br, x, z)) continue;
      const top = this.topAt(br, x, z);
      if (top <= y + 0.01 && top > best) {
        best = top;
        this.groundSurface = br.topSurface;
      }
    }
    return best;
  }

  surfaceBelow(x, y, z) {
    this.groundBelow(x, y, z);
    return this.groundSurface;
  }

  /** Highest walkable top at (x, z) under `y` (defaults to the sky). */
  heightAt(x, z, y = 1e3) {
    return this.groundBelow(x, y, z);
  }

  surfaceAt(x, z, y = 1e3) {
    return this.surfaceBelow(x, y, z);
  }

  /** True when the point is strictly inside any enabled brush carrying `mask`. */
  pointSolid(x, y, z, mask, skip = null) {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return false;
    const list = this.cells[this.row(z) * this.cols + this.col(x)];
    for (let k = 0; k < list.length; k++) {
      const br = list[k];
      if (br === skip || !(br.flags & mask) || !br.enabled) continue;
      if (y <= br.y0 || x < br.minX || x > br.maxX || z < br.minZ || z > br.maxZ) continue;
      if (!this.inside2D(br, x, z, -1e-6)) continue;
      if (y < this.topAt(br, x, z)) return true;
    }
    return false;
  }

  /**
   * Ray vs world. Direction must be normalised. Returns the shared hit record or null.
   * Brushes that contain the ray origin are ignored, so muzzles poking into a wall still fire.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = BF.SHOT) {
    // Clip the ray against the world's XZ bounds first.
    let t0 = 0, t1 = maxDist;
    if (Math.abs(dx) < 1e-12) {
      if (ox < this.minX || ox > this.maxX) return null;
    } else {
      let a = (this.minX - ox) / dx, b = (this.maxX - ox) / dx;
      if (a > b) { const s = a; a = b; b = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < this.minZ || oz > this.maxZ) return null;
    } else {
      let a = (this.minZ - oz) / dz, b = (this.maxZ - oz) / dz;
      if (a > b) { const s = a; a = b; b = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (t0 > t1) return null;

    const sx = ox + dx * (t0 + 1e-9), sz = oz + dz * (t0 + 1e-9);
    let c = this.col(sx), r = this.row(sz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? (this.minX + (dx > 0 ? c + 1 : c) * CELL - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? (this.minZ + (dz > 0 ? r + 1 : r) * CELL - oz) / dz : Infinity;

    const s = this.nextStamp();
    let bestT = Infinity, best = null, bnx = 0, bny = 0, bnz = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const list = this.cells[r * this.cols + c];
      for (let k = 0; k < list.length; k++) {
        const br = list[k];
        if (this.stamp[br.id] === s) continue;
        this.stamp[br.id] = s;
        if (!(br.flags & mask) || !br.enabled) continue;
        // Inline Kay-Kajiya against the brush planes.
        let tIn = -Infinity, tOut = Infinity, nx = 0, ny = 0, nz = 0, miss = false;
        const e = br.edges;
        for (let i = 0; i < e.length; i += 3) {
          const ex = e[i], ez = e[i + 1];
          const den = ex * dx + ez * dz;
          const dist = e[i + 2] - (ex * ox + ez * oz);
          if (den === 0) {
            if (dist < 0) { miss = true; break; }
          } else {
            const t = dist / den;
            if (den < 0) {
              if (t > tIn) { tIn = t; nx = ex; ny = 0; nz = ez; }
            } else if (t < tOut) tOut = t;
          }
          if (tIn > tOut) { miss = true; break; }
        }
        if (miss) continue;
        // Floor plane: -y <= -y0
        if (dy === 0) {
          if (oy < br.y0) continue;
        } else {
          const t = (br.y0 - oy) / dy;
          if (dy > 0) {
            if (t > tIn) { tIn = t; nx = 0; ny = -1; nz = 0; }
          } else if (t < tOut) tOut = t;
        }
        // Roof plane: -gx x + y - gz z <= c
        const rden = -br.gx * dx + dy - br.gz * dz;
        const rdist = br.c - (-br.gx * ox + oy - br.gz * oz);
        if (rden === 0) {
          if (rdist < 0) continue;
        } else {
          const t = rdist / rden;
          if (rden < 0) {
            if (t > tIn) { tIn = t; nx = -br.gx; ny = 1; nz = -br.gz; }
          } else if (t < tOut) tOut = t;
        }
        if (tIn > tOut || tOut < 0 || tIn < 0) continue; // tIn < 0: origin inside, ignore
        if (tIn < bestT && tIn <= maxDist) {
          bestT = tIn;
          best = br;
          bnx = nx; bny = ny; bnz = nz;
        }
      }
      const tExit = Math.min(tMaxX, tMaxZ);
      if (bestT <= tExit || tExit >= t1) break;
      if (tMaxX < tMaxZ) {
        c += stepX;
        tMaxX += tDeltaX;
      } else {
        r += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) break;
      // Rays that have climbed above every brush or dropped below the world cannot hit.
      const yNow = oy + dy * tExit;
      if ((dy > 0 && yNow > this.maxY) || (dy < 0 && yNow < this.minY)) break;
    }
    if (!best || bestT > maxDist) return null;
    const inv = 1 / Math.sqrt(bnx * bnx + bny * bny + bnz * bnz);
    const h = this.hit;
    h.t = bestT;
    h.x = ox + dx * bestT;
    h.y = oy + dy * bestT;
    h.z = oz + dz * bestT;
    h.nx = bnx * inv;
    h.ny = bny * inv;
    h.nz = bnz * inv;
    h.brush = best;
    // Roof hits report the top surface; everything else the side surface.
    h.surface = h.ny > 0.5 ? best.topSurface : best.surface;
    return h;
  }

  /** True when the segment a->b is unobstructed. */
  lineOfSight(ax, ay, az, bx, by, bz, mask = BF.SIGHT) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, mask);
  }
}
