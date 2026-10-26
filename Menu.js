// Front-end menus: play, loadout (attachments, skins, live stats, spray preview), settings,
// field manual. The menu edits a profile object and notifies the app; it never touches
// gameplay state directly.

import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { ATTACHMENTS, ATTACHMENT_SLOTS } from '../data/attachments.js';
import { SKINS, SKIN_ORDER } from '../data/skins.js';
import { ABILITIES } from '../data/abilities.js';
import { BOT_DIFFICULTY } from '../data/rules.js';
import { MOVEMENT } from '../data/movement.js';
import { buildWeaponStats, buildStatTable } from '../sim/WeaponBuilder.js';
import { createPlayerState } from '../sim/PlayerState.js';
import { runPlayerCmd } from '../sim/PlayerController.js';
import { BTN, makeCmd } from '../sim/UserCmd.js';
import { cmPer360 } from './Settings.js';
import { drawCrosshair } from './HudFacade.js';
import { MAPS, MAP_ORDER, DEFAULT_MAP } from '../data/maps/index.js';
const $ = (id) => document.getElementById(id);
const SLOT_LABEL = { muzzle: 'Muzzle', optic: 'Optic', magazine: 'Magazine', underbarrel: 'Underbarrel' };
const XH_COLORS = ['#62ffb0', '#ffffff', '#3fd6c4', '#ffc857', '#ff5bd6', '#ff4d4d'];

export class Menu {
  constructor(profile, { onDeploy, onChange, onTick }) {
    this.profile = profile;
    this.onDeploy = onDeploy;
    this.onChange = onChange;
    this.onTick = onTick || (() => {});
    this.weapon = 'halberd';
    this.root = $('menu');
    this.bindTabs();
    this.buildPlay();
    this.buildLoadout();
    this.buildSettings();
    this.buildManual();
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) {
      $('touch-note').hidden = false;
    }
  }

  show(paused) {
    this.root.hidden = false;
    $('deploy-label').textContent = paused ? 'Resume' : 'Deploy';
    $('deploy-sub').textContent = paused ? 'Esc pauses · click locks the mouse' : this.mapLine || '';
  }

  hide() {
    this.root.hidden = true;
  }

  changed() {
    this.onChange(this.profile);
  }

  bindTabs() {
    const tabs = [...document.querySelectorAll('.tab')];
    tabs.forEach((t) =>
      t.addEventListener('click', () => {
        this.onTick();
        tabs.forEach((x) => {
          x.setAttribute('aria-selected', String(x === t));
          $(x.dataset.panel).hidden = x !== t;
        });
        if (t.dataset.panel === 'p-loadout') this.renderLoadout();
      }),
    );
  }

  /** Called by the client once the map is compiled. */
  setMapInfo(name, hostiles) {
    this.mapLine = `${name} · ${hostiles} hostiles`;
    $('deploy-sub').textContent = this.mapLine;
  }

  buildPlay() {
    $('deploy').addEventListener('click', () => this.onDeploy());
    const ms = $('map-select');
    if (ms) {
      const cur = MAPS[this.profile.settings.map] ? this.profile.settings.map : DEFAULT_MAP;
      for (const key of MAP_ORDER) {
        const b = document.createElement('button');
        b.textContent = MAPS[key].name;
        b.setAttribute('aria-pressed', String(cur === key));
        b.addEventListener('click', () => {
          if (key === cur) return;
          // A new map needs a new light bake: save and reload.
          this.profile.settings.map = key;
          this.changed();
          location.reload();
        });
        ms.appendChild(b);
      }
      $('map-blurb').textContent = MAPS[cur].blurb || '';
    }
    const seg = $('difficulty');
    const render = () => {
      seg.innerHTML = '';
      for (const [key, d] of Object.entries(BOT_DIFFICULTY)) {
        const b = document.createElement('button');
        b.textContent = d.label;
        b.setAttribute('aria-pressed', String(this.profile.settings.difficulty === key));
        b.addEventListener('click', () => {
          this.profile.settings.difficulty = key;
          render();
          this.changed();
        });
        seg.appendChild(b);
      }
    };
    render();
  }

  // ------------------------------------------------------------------ loadout
  buildLoadout() {
    this.renderLoadout();
  }

  renderLoadout() {
    const wt = $('wtabs');
    wt.innerHTML = '';
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const b = document.createElement('button');
      b.className = 'wtab';
      b.setAttribute('aria-pressed', String(id === this.weapon));
      b.innerHTML = `<b>${w.name}</b><span>${w.category} · key ${w.slot}</span>`;
      b.addEventListener('click', () => {
        this.weapon = id;
        this.onTick();
        this.renderLoadout();
      });
      wt.appendChild(b);
    }
    const entry = this.profile.loadout[this.weapon];
    const slots = $('att-slots');
    slots.innerHTML = '';
    for (const slot of ATTACHMENT_SLOTS) {
      const options = Object.values(ATTACHMENTS).filter((a) => a.slot === slot && a.compatible.includes(this.weapon));
      if (!options.length) continue;
      const field = document.createElement('div');
      field.className = 'field';
      const current = entry.attachments.find((id) => ATTACHMENTS[id] && ATTACHMENTS[id].slot === slot) || null;
      field.innerHTML = `<span class="label">${SLOT_LABEL[slot]}</span>`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      const mk = (label, id) => {
        const c = document.createElement('button');
        c.className = 'chip';
        c.textContent = label;
        c.setAttribute('aria-pressed', String(current === id));
        c.title = id ? ATTACHMENTS[id].blurb : 'No attachment';
        c.addEventListener('click', () => {
          entry.attachments = entry.attachments.filter((a) => ATTACHMENTS[a].slot !== slot);
          if (id) entry.attachments.push(id);
          this.onTick();
          this.changed();
          this.renderLoadout();
        });
        chips.appendChild(c);
      };
      mk('None', null);
      for (const a of options) mk(a.name, a.id);
      field.appendChild(chips);
      if (current) {
        const n = document.createElement('span');
        n.className = 'note';
        n.textContent = ATTACHMENTS[current].blurb;
        field.appendChild(n);
      }
      slots.appendChild(field);
    }
    const sk = $('skins');
    sk.innerHTML = '';
    for (const id of SKIN_ORDER) {
      const c = document.createElement('button');
      c.className = 'chip';
      c.textContent = SKINS[id].name;
      c.setAttribute('aria-pressed', String(entry.skin === id));
      c.addEventListener('click', () => {
        entry.skin = id;
        this.onTick();
        this.changed();
        this.renderLoadout();
      });
      sk.appendChild(c);
    }
    $('skin-blurb').textContent = SKINS[entry.skin].blurb;
    this.renderStats(entry);
    this.renderSpray(entry);
  }

  renderStats(entry) {
    const base = buildWeaponStats(this.weapon, []);
    const s = buildWeaponStats(this.weapon, entry.attachments);
    const climb = (st) => st.recoil.pattern.slice(0, 10).reduce((a, p) => a + p[1], 0) + Math.max(0, 10 - st.recoil.pattern.length) * st.recoil.procedural.pitchPerShot;
    const rows = [
      ['Body damage', s.damage.body, base.damage.body, 160, (v) => v],
      ['Head damage', s.damage.head, base.damage.head, 260, (v) => v],
      ['Fire rate', s.rpm, base.rpm, 1000, (v) => `${Math.round(v)}`],
      ['Magazine', s.magSize, base.magSize, 40, (v) => v],
      ['Reload', 4.2 - s.reloadTime, 4.2 - base.reloadTime, 3, () => `${s.reloadTime.toFixed(2)}s`],
      ['Aim speed', 0.4 - s.ads.time, 0.4 - base.ads.time, 0.32, () => `${Math.round(s.ads.time * 1000)}ms`],
      ['Recoil control', 10 - climb(s), 10 - climb(base), 10, () => `${climb(s).toFixed(1)}°`],
      ['First shot', 1 - s.spread.base / 5.2, 1 - base.spread.base / 5.2, 1, () => `${s.spread.base.toFixed(2)}°`],
    ];
    $('stats').innerHTML = rows
      .map(([label, v, b, max, fmt]) => {
        const pct = Math.max(0, Math.min(1, v / max)) * 100;
        const delta = v > b + 1e-6 ? 'delta-up' : v < b - 1e-6 ? 'delta-down' : '';
        return `<div class="stat"><span>${label}</span><span class="bar"><i class="${delta}" style="width:${pct}%"></i></span><output>${fmt(v)}</output></div>`;
      })
      .join('');
  }

  /** Simulate a full-auto spray with the real sim code and plot impacts on a 10 m wall. */
  renderSpray(entry) {
    const canvas = $('spray');
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const lo = { ...this.profile.loadout, [this.weapon]: entry };
    const stats = buildStatTable(lo, ABILITIES.X.stats);
    const p = createPlayerState(1, 0x5eed + 7919);
    p.inv.current = this.weapon;
    p.inv.slots[this.weapon].ammo = 25;
    const shots = [];
    const ctx = { hf: null, move: MOVEMENT, stats, zones: {}, canMove: false, canFire: true, adsMode: 'hold', onShot: (pl, shot) => shots.push({ dir: shot.dir, idx: shot.recoilIdx }) };
    // Movement needs a heightfield; use a flat stub so the spray preview has no map dependency.
    ctx.hf = { footprint: (x, z, r, y, s, h, out) => { const o = out || h; o.blocked = false; o.ground = 0; o.ceiling = 1e3; o.surface = 0; return o; }, surfaceBelow: () => 0, groundBelow: () => 0, heightAt: () => 0 };
    const semi = stats[this.weapon].normal.fireMode === 'semi';
    for (let i = 0; i < 128 * 4 && shots.length < 25; i++) {
      const fire = semi ? (i % 20 < 2 ? BTN.FIRE : 0) : BTN.FIRE;
      runPlayerCmd(p, makeCmd(i + 1, 1 / 128, fire, 0, 0, null, undefined), ctx, null);
      if (p.inv.slots[this.weapon].ammo === 0 && shots.length < 25) p.inv.slots[this.weapon].ammo = 25 - shots.length;
    }
    // Plot: 10 m wall, 1 px = 0.25 cm at 420 px wide covering 1.05 m
    g.fillStyle = '#f1efea';
    g.fillRect(0, 0, W, H);
    const pxPerM = W / 1.2;
    const cx = W / 2, cy = H * 0.86;
    g.strokeStyle = 'rgba(20,20,24,0.12)';
    g.lineWidth = 1;
    for (let k = -6; k <= 6; k++) {
      g.beginPath();
      g.moveTo(cx + k * 0.1 * pxPerM, 0);
      g.lineTo(cx + k * 0.1 * pxPerM, H);
      g.stroke();
    }
    for (let k = -2; k <= 14; k++) {
      g.beginPath();
      g.moveTo(0, cy - k * 0.1 * pxPerM);
      g.lineTo(W, cy - k * 0.1 * pxPerM);
      g.stroke();
    }
    // Head-height silhouette for scale (head 29 cm wide at 10 m)
    g.fillStyle = 'rgba(20,20,24,0.08)';
    g.beginPath();
    g.arc(cx, cy, 0.145 * pxPerM, 0, Math.PI * 2);
    g.fill();
    const patternLen = stats[this.weapon].normal.recoil.pattern.length;
    const pts = shots.map((s) => [cx + (s.dir[0] / -s.dir[2]) * 10 * pxPerM, cy - (s.dir[1] / -s.dir[2]) * 10 * pxPerM, s.idx]);
    g.strokeStyle = 'rgba(20,20,24,0.35)';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    pts.forEach(([x, y, idx], i) => {
      g.fillStyle = idx < patternLen ? '#ff5b3a' : '#2a2d33';
      g.beginPath();
      g.arc(x, y, i === 0 ? 7 : 5, 0, Math.PI * 2);
      g.fill();
      if (i === 0 || i === pts.length - 1) {
        g.fillStyle = '#0a0c10';
        g.font = '600 18px "JetBrains Mono", monospace';
        g.fillText(String(i + 1), x + 10, y + 6);
      }
    });
    $('spray-cap').textContent = semi
      ? `${shots.length} taps at max cadence, 10 m. Grid = 10 cm.`
      : `${shots.length} rounds held at 10 m. Orange: fixed pattern (first ${patternLen + 1}); dark: procedural. Grid = 10 cm.`;
  }

  // ------------------------------------------------------------------ settings
  slider(parent, { id, label, min, max, step, value, fmt, onInput }) {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `<label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output>${fmt(value)}</output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = fmt(v);
      onInput(v);
      this.changed();
    });
    parent.appendChild(row);
    return row;
  }

  toggle(parent, { id, label, checked, onChange }) {
    const l = document.createElement('label');
    l.className = 'toggle';
    l.innerHTML = `<input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span>${label}</span>`;
    l.querySelector('input').addEventListener('change', (e) => {
      onChange(e.target.checked);
      this.changed();
    });
    parent.appendChild(l);
  }

  buildSettings() {
    const S = this.profile.settings;
    const aim = $('set-aim');
    aim.innerHTML = '<span class="label">Aim</span>';
    const sensRow = this.slider(aim, {
      id: 'sens', label: 'Sensitivity', min: 0.1, max: 1.5, step: 0.01, value: S.sensitivity,
      fmt: (v) => v.toFixed(2), onInput: (v) => { S.sensitivity = v; cm.textContent = `${cmPer360(v).toFixed(1)} cm / 360° at 800 DPI`; },
    });
    const cm = document.createElement('span');
    cm.className = 'note';
    cm.textContent = `${cmPer360(S.sensitivity).toFixed(1)} cm / 360° at 800 DPI`;
    sensRow.after(cm);
    this.slider(aim, { id: 'adssens', label: 'Aim sensitivity ×', min: 0.3, max: 1.5, step: 0.01, value: S.adsSensitivityMul, fmt: (v) => v.toFixed(2), onInput: (v) => (S.adsSensitivityMul = v) });
    this.slider(aim, { id: 'fov', label: 'Horizontal FOV', min: 80, max: 110, step: 1, value: S.fovHorizontal, fmt: (v) => `${v}°`, onInput: (v) => (S.fovHorizontal = v) });
    const modeRow = document.createElement('div');
    modeRow.className = 'row';
    modeRow.innerHTML = '<span class="note" style="min-width:150px">Aim down sights</span>';
    const seg = document.createElement('div');
    seg.className = 'seg';
    const renderMode = () => {
      seg.innerHTML = '';
      for (const m of ['hold', 'toggle']) {
        const b = document.createElement('button');
        b.textContent = m === 'hold' ? 'Hold' : 'Toggle';
        b.setAttribute('aria-pressed', String(S.adsMode === m));
        b.addEventListener('click', () => { S.adsMode = m; renderMode(); this.changed(); });
        seg.appendChild(b);
      }
    };
    renderMode();
    modeRow.appendChild(seg);
    aim.appendChild(modeRow);

    // Crosshair
    const xh = $('set-xh');
    const preview = () => drawCrosshair($('xh-preview').getContext('2d'), S.crosshair, 0);
    const sw = document.createElement('div');
    sw.className = 'swatches';
    const renderSw = () => {
      sw.innerHTML = '';
      for (const c of XH_COLORS) {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.style.background = c;
        b.setAttribute('aria-label', `Crosshair colour ${c}`);
        b.setAttribute('aria-pressed', String(S.crosshair.color === c));
        b.addEventListener('click', () => { S.crosshair.color = c; renderSw(); preview(); this.changed(); });
        sw.appendChild(b);
      }
    };
    renderSw();
    xh.appendChild(sw);
    for (const [key, label, min, max] of [['gap', 'Gap', 0, 12], ['length', 'Length', 0, 14], ['thickness', 'Thickness', 1, 5]]) {
      this.slider(xh, { id: `xh-${key}`, label, min, max, step: 1, value: S.crosshair[key], fmt: (v) => `${v}px`, onInput: (v) => { S.crosshair[key] = v; preview(); } });
    }
    const tg = document.createElement('div');
    tg.className = 'row';
    xh.appendChild(tg);
    this.toggle(tg, { id: 'xh-outline', label: 'Outline', checked: S.crosshair.outline, onChange: (v) => { S.crosshair.outline = v; preview(); } });
    this.toggle(tg, { id: 'xh-dot', label: 'Centre dot', checked: S.crosshair.dot, onChange: (v) => { S.crosshair.dot = v; preview(); } });
    this.toggle(tg, { id: 'xh-move', label: 'Show movement error', checked: S.crosshair.movementError, onChange: (v) => (S.crosshair.movementError = v) });
    preview();

    const misc = $('set-misc');
    misc.innerHTML = '<span class="label">Audio &amp; video</span>';
    this.slider(misc, { id: 'vol', label: 'Master volume', min: 0, max: 1, step: 0.01, value: S.masterVolume, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (S.masterVolume = v) });
    const scaleRow = document.createElement('div');
    scaleRow.className = 'row';
    scaleRow.innerHTML = '<span class="note" style="min-width:150px">Render scale</span>';
    const sseg = document.createElement('div');
    sseg.className = 'seg';
    const renderScale = () => {
      sseg.innerHTML = '';
      for (const [k, l] of [['auto', 'Auto'], ['1', '100%'], ['0.75', '75%'], ['0.5', '50%']]) {
        const b = document.createElement('button');
        b.textContent = l;
        b.setAttribute('aria-pressed', String(String(S.renderScale) === k));
        b.addEventListener('click', () => { S.renderScale = k; renderScale(); this.changed(); });
        sseg.appendChild(b);
      }
    };
    renderScale();
    scaleRow.appendChild(sseg);
    misc.appendChild(scaleRow);
    const tr = document.createElement('div');
    tr.className = 'row';
    misc.appendChild(tr);
    this.toggle(tr, { id: 'bob', label: 'Camera bob', checked: S.cameraBob, onChange: (v) => (S.cameraBob = v) });
    this.toggle(tr, { id: 'perfo', label: 'Performance overlay', checked: S.showPerf, onChange: (v) => (S.showPerf = v) });

    const net = $('set-net');
    net.innerHTML = '<span class="label">Network simulation</span><span class="note">The server runs in-process. Add latency to watch prediction, reconciliation and lag compensation keep hits honest.</span>';
    this.slider(net, { id: 'lat', label: 'One-way latency', min: 0, max: 150, step: 5, value: S.netLatencyMs, fmt: (v) => `${v} ms`, onInput: (v) => (S.netLatencyMs = v) });
    this.slider(net, { id: 'jit', label: 'Jitter', min: 0, max: 40, step: 1, value: S.netJitterMs, fmt: (v) => `${v} ms`, onInput: (v) => (S.netJitterMs = v) });
  }

  buildManual() {
    const keys = [
      ['Move', 'W A S D'], ['Walk (silent)', 'Shift'], ['Crouch', 'V · Ctrl in fullscreen'], ['Jump', 'Space'],
      ['Fire', 'Left mouse'], ['Aim / scope', 'Right mouse'], ['Reload', 'R'], ['Inspect', 'Y'],
      ['Weapons', '1 2 3 4 · wheel'], ['Plant spike', 'Hold F in a site'], ['Haze smoke', 'C'], ['Pulse recon', 'Q'],
      ['Slipstream dash', 'E'], ['Overclock', 'X'], ['Pause', 'Esc'], ['Perf overlay', '`'],
    ];
    $('keys').innerHTML = keys.map(([a, b]) => `<div><span>${a}</span><kbd>${b}</kbd></div>`).join('');
    const sys = [
      ['Counter-strafe', 'Tap the opposite direction and that axis stops on the next tick. Below 27% of run speed you are standing: first-shot accuracy returns. Walking and crouching make no footstep noise.'],
      ['Recoil', 'Each gun has a fixed, learnable opening pattern; after it, climb flattens and horizontal wander is seeded per shot. The camera shows only part of the kick, so pull down. Recovery waits one fire interval, then rewinds.'],
      ['Authority', 'Your inputs go to a 128-tick server that runs the same code. Movement and shots are predicted instantly; snapshots reconcile silently. Hits are checked against what you saw (lag compensation).'],
      ['Customisation', 'Attachments change stats through data modifiers. Skins are decorators: palette, tracers, inspect clip, reload audio layers and impact particles, never damage.'],
      ...MAP_ORDER.map((k) => [MAPS[k].name, MAPS[k].manual || MAPS[k].blurb || '']),
    ];
    $('systems').innerHTML = sys.map(([h, p]) => `<div><h3>${h}</h3><p>${p}</p></div>`).join('');
  }
}
