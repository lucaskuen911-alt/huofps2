// HUD FACADE
// Gameplay and presentation code talk to the HUD ONLY through this interface. The DOM
// implementation below can be replaced (canvas HUD, native UI, test spy) without touching
// a line of gameplay. Every setter is idempotent and dirty-checked, so callers may push
// state every frame without DOM churn.
//
// interface Hud {
//   setVitals(health, armor)
//   setAmmo({ mag, reserve, magSize, name, detail, reload01 })
//   setRound({ phase, timeLeft, number, wins, losses, hostilesLeft, hostilesTotal })
//   setAbilities([{ key, name, charges, max, cooldown01, cost, points, active }])
//   setLocation(name)
//   setPlant(progress01 | null, site)
//   setScope(visible)
//   setOverlays({ smoke, lowHealth, hurt })
//   setCrosshair(settings, bloomPx, visible)
//   setPerf(stats | null)
//   hitmarker(kind)                       kind: 'body' | 'head' | 'kill'
//   damageNumber(x, y, amount, headshot)  screen-space px
//   damageDirection(angle)                radians relative to view, 0 = ahead
//   killfeed({ killer, victim, weapon, headshot, mine })
//   banner(title, subtitle, tone)         tone: 'win' | 'loss' | 'info'
// }

const $ = (id) => document.getElementById(id);

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class DomHud {
  constructor() {
    this.el = {
      root: $('hud'),
      hp: $('hp-num'),
      hpBar: $('hp-bar'),
      armor: $('armor-num'),
      armorBox: $('armor-box'),
      mag: $('ammo-mag'),
      reserve: $('ammo-reserve'),
      wname: $('weapon-name'),
      wdetail: $('weapon-detail'),
      reload: $('reload-bar'),
      timer: $('round-timer'),
      phase: $('round-phase'),
      wins: $('score-w'),
      losses: $('score-l'),
      pips: $('hostile-pips'),
      abilities: $('abilities'),
      location: $('location'),
      plant: $('plant'),
      plantBar: $('plant-bar'),
      plantLabel: $('plant-label'),
      scope: $('scope'),
      smoke: $('smoke-tint'),
      low: $('lowhp'),
      hurt: $('hurt'),
      xhair: $('crosshair'),
      hit: $('hitmarker'),
      dmgLayer: $('dmg-layer'),
      dir: $('dmg-dir'),
      feed: $('killfeed'),
      banner: $('banner'),
      bannerTitle: $('banner-title'),
      bannerSub: $('banner-sub'),
      perf: $('perf'),
    };
    this.cache = {};
    this.xctx = this.el.xhair.getContext('2d');
    this.abilityEls = null;
    this.bannerTimer = 0;
    this.hitTimer = 0;
  }

  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  show(visible) {
    this.set('visible', visible, (v) => (this.el.root.hidden = !v));
  }

  setVitals(health, armor) {
    this.set('hp', health, (v) => {
      this.el.hp.textContent = v;
      this.el.hpBar.style.transform = `scaleX(${v / 100})`;
      this.el.root.classList.toggle('critical', v <= 30);
    });
    this.set('armor', armor, (v) => {
      this.el.armor.textContent = v;
      this.el.armorBox.classList.toggle('empty', v <= 0);
    });
  }

  setAmmo(a) {
    this.set('mag', a.mag, (v) => {
      this.el.mag.textContent = v;
      this.el.mag.classList.toggle('low', v <= Math.ceil(a.magSize * 0.25));
    });
    this.set('reserve', a.reserve, (v) => (this.el.reserve.textContent = v));
    this.set('wname', a.name, (v) => (this.el.wname.textContent = v));
    this.set('wdetail', a.detail, (v) => (this.el.wdetail.textContent = v));
    const r = a.reload01 === null ? -1 : Math.round(a.reload01 * 100);
    this.set('reload', r, (v) => {
      this.el.reload.hidden = v < 0;
      if (v >= 0) this.el.reload.firstElementChild.style.transform = `scaleX(${v / 100})`;
    });
  }

  setRound(r) {
    this.set('timer', `${r.phase}:${Math.ceil(r.timeLeft)}`, () => {
      this.el.timer.textContent = fmtTime(r.timeLeft);
      this.el.timer.classList.toggle('urgent', r.phase === 'live' && r.timeLeft <= 10);
    });
    this.set('phase', `${r.phase}:${r.number}`, () => {
      this.el.phase.textContent = r.phase === 'barrier' ? `Round ${r.number} · Barrier` : r.phase === 'post' ? `Round ${r.number} · Over` : `Round ${r.number}`;
    });
    this.set('wins', r.wins, (v) => (this.el.wins.textContent = v));
    this.set('losses', r.losses, (v) => (this.el.losses.textContent = v));
    this.set('pips', `${r.hostilesLeft}/${r.hostilesTotal}`, () => {
      let html = '';
      for (let i = 0; i < r.hostilesTotal; i++) html += `<i class="${i < r.hostilesLeft ? 'alive' : ''}"></i>`;
      this.el.pips.innerHTML = html;
    });
  }

  setAbilities(list) {
    if (!this.abilityEls) {
      this.el.abilities.innerHTML = list
        .map(
          (a) => `<div class="ability" data-key="${a.key}">
            <span class="ab-key">${a.key}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">${ABILITY_ICONS[a.key]}</svg>
            <span class="ab-cd"></span>
            <span class="ab-pips"></span>
            <span class="ab-name">${a.name}</span>
          </div>`,
        )
        .join('');
      this.abilityEls = [...this.el.abilities.children];
    }
    list.forEach((a, i) => {
      const el = this.abilityEls[i];
      const ready = a.cost ? a.points >= a.cost : a.charges > 0;
      this.set(`ab:${a.key}:ready`, `${ready}:${a.active}`, () => {
        el.classList.toggle('ready', ready);
        el.classList.toggle('active', !!a.active);
      });
      const cd = Math.round((a.cooldown01 || 0) * 100);
      this.set(`ab:${a.key}:cd`, cd, (v) => el.children[2].style.setProperty('--cd', v / 100));
      const pips = a.cost ? `${a.points}/${a.cost}` : `${a.charges}/${a.max}`;
      this.set(`ab:${a.key}:pips`, pips, () => {
        const total = a.cost || a.max;
        const fill = a.cost ? a.points : a.charges;
        let html = '';
        for (let k = 0; k < total; k++) html += `<i class="${k < fill ? 'on' : ''}"></i>`;
        el.children[3].innerHTML = html;
      });
    });
  }

  setLocation(name) {
    this.set('loc', name, (v) => (this.el.location.textContent = v));
  }

  setPlant(p, site) {
    const v = p === null ? -1 : Math.round(p * 100);
    this.set('plant', v, () => {
      this.el.plant.hidden = v < 0;
      if (v >= 0) {
        this.el.plantBar.style.transform = `scaleX(${v / 100})`;
        this.el.plantLabel.textContent = `Planting on ${site}`;
      }
    });
  }

  setScope(visible) {
    this.set('scope', visible, (v) => (this.el.scope.hidden = !v));
  }

  setOverlays(o) {
    this.set('smoke', Math.round(o.smoke * 50), (v) => (this.el.smoke.style.opacity = v / 50));
    this.set('low', Math.round(o.lowHealth * 50), (v) => (this.el.low.style.opacity = v / 50));
    this.set('hurt', Math.round(o.hurt * 50), (v) => (this.el.hurt.style.opacity = v / 50));
  }

  setCrosshair(cfg, bloomPx, visible) {
    const key = `${JSON.stringify(cfg)}:${Math.round(bloomPx)}:${visible}`;
    this.set('xhair', key, () => drawCrosshair(this.xctx, cfg, visible ? bloomPx : -1));
  }

  setPerf(stats) {
    if (!stats) {
      this.set('perf', '', () => (this.el.perf.hidden = true));
      return;
    }
    const txt = `${stats.fps} FPS  ${stats.frameMs} ms  ${stats.draws} draws  ${stats.tris}k tris  cull ${stats.cull}\nsim ${stats.tick} Hz  rtt ${stats.rtt} ms  pred err ${stats.err} mm  audio ${stats.audio} ms`;
    this.set('perf', txt, (v) => {
      this.el.perf.hidden = false;
      this.el.perf.textContent = v;
    });
  }

  hitmarker(kind) {
    const el = this.el.hit;
    el.className = '';
    void el.offsetWidth; // restart the animation
    el.className = `show ${kind}`;
  }

  damageNumber(x, y, amount, headshot) {
    const d = document.createElement('span');
    d.className = `dmg${headshot ? ' head' : ''}`;
    d.textContent = amount;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.el.dmgLayer.appendChild(d);
    setTimeout(() => d.remove(), 800);
  }

  damageDirection(angle) {
    const el = this.el.dir;
    el.style.setProperty('--a', `${angle}rad`);
    el.className = '';
    void el.offsetWidth;
    el.className = 'show';
  }

  killfeed(k) {
    const row = document.createElement('div');
    row.className = `kf${k.mine ? ' mine' : ''}${k.victimIsPlayer ? ' death' : ''}`;
    row.innerHTML = `<b>${k.killer}</b><span class="kf-w">${k.weapon}${k.headshot ? ' <em>HS</em>' : ''}</span><b>${k.victim}</b>`;
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 5) this.el.feed.lastElementChild.remove();
    setTimeout(() => row.classList.add('fade'), 4200);
    setTimeout(() => row.remove(), 5000);
  }

  banner(title, subtitle, tone) {
    const b = this.el.banner;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = subtitle || '';
    b.className = '';
    void b.offsetWidth;
    b.className = `show ${tone || 'info'}`;
  }
}

export function drawCrosshair(ctx, cfg, bloomPx) {
  const c = ctx.canvas;
  ctx.clearRect(0, 0, c.width, c.height);
  if (bloomPx < 0) return;
  const cx = c.width / 2, cy = c.height / 2;
  const gap = cfg.gap + bloomPx;
  const L = cfg.length, T = cfg.thickness;
  const rects = [];
  if (L > 0) {
    rects.push([cx - T / 2, cy - gap - L, T, L]);
    rects.push([cx - T / 2, cy + gap, T, L]);
    rects.push([cx - gap - L, cy - T / 2, L, T]);
    rects.push([cx + gap, cy - T / 2, L, T]);
  }
  if (cfg.dot) rects.push([cx - T / 2, cy - T / 2, T, T]);
  if (cfg.outline) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    for (const [x, y, w, h] of rects) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, w + 2, h + 2);
  }
  ctx.fillStyle = cfg.color;
  for (const [x, y, w, h] of rects) ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

const ABILITY_ICONS = {
  C: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="11" r="6"/><circle cx="13" cy="16" r="4"/>',
  Q: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" fill="none" stroke-width="1.6"/><circle cx="12" cy="12" r="10.5" fill="none" stroke-width="1" opacity=".6"/>',
  E: '<path d="M3 12h9M6 7h9M6 17h9"/><path d="M14 6l7 6-7 6z"/>',
  X: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
};
