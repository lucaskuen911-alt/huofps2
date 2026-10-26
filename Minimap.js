// Minimap: the static layer (brushes shaded by elevation, sites, callouts) is rendered once to
// an offscreen canvas; each frame only blits it and draws dynamic markers plus the current
// variant's movable cover (crane-stacked containers), which changes every round.

import { BF } from '../sim/World.js';
export class Minimap {
  constructor(canvas, map, world = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.world = world;
    const b = map.bounds;
    this.x0 = b.minX;
    this.z0 = b.minZ;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = canvas.clientWidth || 220;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * (h / w) * dpr);
    this.scale = canvas.width / w;
    this.base = this.renderBase();
  }

  toPx(x, z) {
    return [(x - this.x0) * this.scale, (z - this.z0) * this.scale];
  }

  brushPath(g, br) {
    g.beginPath();
    br.poly.forEach(([x, z], i) => {
      const [px, py] = this.toPx(x, z);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
  }

  fillFor(br) {
    const tall = br.maxY - Math.max(br.y0, -0.5) >= 2.3;
    if (tall && br.maxY > 2.3) return 'rgba(10,12,16,0.92)';
    const h = Math.max(0, br.maxY);
    const k = Math.min(1, h / 8);
    return `rgba(${Math.round(150 + k * 70)},${Math.round(153 + k * 62)},${Math.round(160 + k * 52)},0.86)`;
  }

  renderBase() {
    const m = this.map;
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    const list = m.brushes.filter((br) => br.flags & BF.MINIMAP && !br.group).sort((a, b) => a.maxY - b.maxY);
    for (const br of list) {
      g.fillStyle = this.fillFor(br);
      this.brushPath(g, br);
      g.fill();
      if (br.maxY > 0.5 && br.maxY - br.y0 < 2.3) {
        g.strokeStyle = 'rgba(10,12,16,0.35)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
    const cell = 2 * this.scale;
    for (const key of Object.keys(m.zones)) {
      const z = m.zones[key];
      const [x0, y0] = this.toPx(z.x0, z.z0);
      const [x1, y1] = this.toPx(z.x1, z.z1);
      g.fillStyle = 'rgba(255,91,58,0.28)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = 'rgba(255,91,58,0.9)';
      g.lineWidth = Math.max(1, cell * 0.12);
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = '#fff';
      g.font = `800 ${Math.round(cell * 2.2)}px "Big Shoulders Display", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(key, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    return c;
  }

  /**
   * @param s { pos, yaw, bots:[{pos, visible}], smokes:[{pos, radius}], pulses:[{pos, radius, t}] }
   */
  draw(s) {
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.base, 0, 0);
    if (this.world) {
      for (const br of this.map.brushes) {
        if (!br.group || !br.enabled || !(br.flags & BF.MINIMAP)) continue;
        g.fillStyle = br.maxY > 3 ? 'rgba(10,12,16,0.95)' : 'rgba(36,40,48,0.92)';
        this.brushPath(g, br);
        g.fill();
      }
    }
    if (s.empActive) {
      g.fillStyle = 'rgba(10,12,16,0.85)';
      g.fillRect(0, 0, W, H);
      return;
    }
    for (const sm of s.smokes) {
      const [x, y] = this.toPx(sm.pos[0], sm.pos[2]);
      g.fillStyle = 'rgba(205,200,220,0.75)';
      g.beginPath();
      g.arc(x, y, sm.radius * this.scale, 0, Math.PI * 2);
      g.fill();
    }
    for (const p of s.pulses) {
      const [x, y] = this.toPx(p.pos[0], p.pos[2]);
      g.strokeStyle = `rgba(63,214,196,${1 - p.t})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, p.radius * this.scale * Math.sqrt(p.t), 0, Math.PI * 2);
      g.stroke();
    }
    for (const b of s.bots) {
      if (!b.visible) continue;
      const [x, y] = this.toPx(b.pos[0], b.pos[2]);
      g.fillStyle = b.kind === 'dummy' ? '#ffc857' : '#ff4d4d';
      g.strokeStyle = '#0b0d10';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // Player: view cone + arrow
    const [px, py] = this.toPx(s.pos[0], s.pos[2]);
    const ang = -s.yaw - Math.PI / 2; // engine yaw 0 = north (-Z) = up on the map
    g.fillStyle = 'rgba(98,255,176,0.16)';
    g.beginPath();
    g.moveTo(px, py);
    g.arc(px, py, 46, ang - 0.6, ang + 0.6);
    g.closePath();
    g.fill();
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.fillStyle = '#62ffb0';
    g.strokeStyle = '#0b0d10';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-6, 6);
    g.lineTo(-3, 0);
    g.lineTo(-6, -6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  calloutAt(x, z, y = 0) {
    let best = null, bd = 1e9;
    for (const c of this.map.callouts) {
      // Height counts triple so stacked floors (catwalk over warehouse floor) resolve correctly.
      const d = (c.x - x) ** 2 + (c.z - z) ** 2 + ((c.y || 0) - y) ** 2 * 9;
      if (d < bd) {
        bd = d;
        best = c.name;
      }
    }
    return best || '';
  }
}
