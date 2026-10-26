// Maps client game state onto the HUD facade once per frame. All formatting decisions live
// here; the facade only knows how to display, and gameplay only knows how to simulate.

import { WEAPONS } from '../data/weapons.js';
import { ABILITIES, ABILITY_KEYS } from '../data/abilities.js';
import { ATTACHMENTS } from '../data/attachments.js';
import { SKINS } from '../data/skins.js';
import { ROUND } from '../data/rules.js';
import { DEG } from '../core/MathUtil.js';
export class HudPresenter {
  constructor(hud) {
    this.hud = hud;
  }

  update(c) {
    const hud = this.hud;
    const p = c.player;
    const st = c.stats;
    const inv = p.inv;
    const slot = inv.slots[inv.current];
    hud.setVitals(Math.max(0, Math.round(p.health)), Math.max(0, Math.round(p.armor)));

    const entry = c.loadout[inv.current];
    const atts = (entry.attachments || []).map((a) => ATTACHMENTS[a] && ATTACHMENTS[a].name).filter(Boolean);
    const skin = SKINS[entry.skin] ? SKINS[entry.skin].name : '';
    const reloading = inv.reloadEnd > 0 ? Math.min(1, (p.clock - inv.reloadStart) / (inv.reloadEnd - inv.reloadStart)) : null;
    hud.setAmmo({
      mag: slot.ammo,
      reserve: slot.reserve,
      magSize: st.magSize,
      name: WEAPONS[inv.current].name,
      detail: [WEAPONS[inv.current].fireMode === 'auto' ? 'Auto' : 'Semi', ...atts, skin !== 'Field Issue' ? skin : null].filter(Boolean).join(' · '),
      reload01: reloading,
    });

    const r = c.round;
    const timeLeft = r.phase === 'post' ? 0 : r.phaseEnd - c.serverTime;
    hud.setRound({ phase: r.phase, timeLeft: Math.max(0, timeLeft), number: r.number, wins: r.wins, losses: r.losses, hostilesLeft: c.hostilesLeft, hostilesTotal: c.hostilesTotal });

    const a = p.abilities;
    const cd = (k) => {
      const def = ABILITIES[k];
      if (k === 'Q' || k === 'E') return a[k].rechargeAt > 0 ? Math.max(0, (a[k].rechargeAt - p.clock) / def.recharge) : 0;
      return 0;
    };
    hud.setAbilities(
      ABILITY_KEYS.map((k) => ({
        key: k,
        name: ABILITIES[k].name,
        charges: k === 'X' ? 0 : a[k].charges,
        max: ABILITIES[k].maxCharges || 1,
        cooldown01: cd(k),
        cost: k === 'X' ? ABILITIES.X.cost : 0,
        points: p.ultPoints,
        active: k === 'X' && a.X.activeUntil > p.clock,
      })),
    );

    hud.setLocation(c.location);
    hud.setPlant(p.plantProgress > 0 ? p.plantProgress / ROUND.plantTime : null, p.plantSite || '');
    const scoped = st.ads.scoped && inv.adsT > 0.92;
    hud.setScope(scoped);
    hud.setOverlays({ smoke: c.smokeInside, lowHealth: p.alive && p.health < 35 ? 1 - p.health / 35 : 0, hurt: c.hurt });

    let bloom = 0;
    if (c.settings.crosshair.movementError) {
      const spreadRad = c.spread * DEG;
      bloom = (Math.tan(spreadRad) / Math.tan(c.vFov / 2)) * (c.viewportH / 2);
    }
    hud.setCrosshair(c.settings.crosshair, Math.min(60, bloom), !scoped && p.alive);
    hud.setPerf(c.perf);
  }
}
