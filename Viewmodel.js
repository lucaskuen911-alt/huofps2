// First-person weapon presentation: hip/ADS poses, sway, bob, recoil kick, equip, reload and
// inspect clips, muzzle flash sprites and flash light. All motion is spring- or curve-driven
// and keyed off predicted gameplay state, so it lines up with the shot on the same frame.

import { buildWeaponModel, buildAuthoredWeaponModel } from './WeaponModels.js';
import { compose, multiply, mat4, transformPoint } from './gl/Mat4.js';
import { Spring, DEG, clamp, easeOutCubic, easeInOutCubic, smoothstep } from '../core/MathUtil.js';
import { fxUV } from './Textures.js';
import { VERTEX_FLOATS } from './gl/GLUtil.js';
// Hip pose: weapon origin (trigger) relative to the eye. Tuned with the 56 deg viewmodel FOV so
// the stock sits off-screen at the shoulder and the left side of the receiver faces the player.
const HIP = {
  rifle: [0.15, -0.172, -0.5],
  smg: [0.145, -0.164, -0.46],
  pistol: [0.1, -0.13, -0.42],
  sniper: [0.155, -0.176, -0.53],
};
const EYE_RELIEF = { rifle: 0.17, smg: 0.16, pistol: 0.3, sniper: 0.12 };
// Hip yaw: the barrel converges on the crosshair; short guns turn further to show their flank.
const HIP_YAW = { rifle: 0.12, smg: 0.12, pistol: 0.34, sniper: 0.1 };
const UV_STAR = fxUV(3);
const UV_GLOW = fxUV(0);
const FLASH = {
  rifle: { size: 0.075, side: 0.05, intensity: 4.5 },
  smg: { size: 0.06, side: 0.04, intensity: 3.5 },
  pistol: { size: 0.055, side: 0.03, intensity: 3.2 },
  sniper: { size: 0.12, side: 0.09, intensity: 7 },
  suppressed: { size: 0.018, side: 0, intensity: 0.4 },
  ported: { size: 0.05, side: 0.0, up: 0.07, intensity: 4 },
};

// Material roles in weapons.glb -> palette entries (skins recolour these; fixed_* never change).
const ROLE_TINT = { body: 'body', accent: 'accent', metal: 'metal', grip: 'grip' };
// Agent arms: dark leather gloves, deep teal sleeves, warm-grey hardware (knuckle guard, straps).
const ARM_TINT = { glove: [0.07, 0.062, 0.058], sleeve: [0.035, 0.12, 0.16], gear: [0.3, 0.27, 0.24] };

export class Viewmodel {
  constructor(renderer, asset = null) {
    this.renderer = renderer;
    this.asset = asset;
    this.shotPulse = 0;
    this.cache = new Map();
    this.current = null;
    this.mats = { root: mat4(), body: mat4(), mag: mat4(), bolt: mat4(), armL: mat4(), tmp: mat4(), cam: mat4(), local: mat4() };
    this.sway = { yaw: new Spring(180, 20), pitch: new Spring(180, 20), x: new Spring(120, 18), y: new Spring(120, 18) };
    this.kick = { back: new Spring(900, 48), pitch: new Spring(700, 40), roll: new Spring(500, 34), side: new Spring(600, 40) };
    this.dip = new Spring(220, 22);
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.time = 0;
    this.flash = { age: 1, life: 0.035, kind: 'rifle', tint: [1, 1, 1], rot: 0 };
    this.anim = { equipStart: -10, equipDur: 0.5, reloadStart: -10, reloadDur: 1, inspectStart: -10, inspectClip: 'tilt' };
    this.lastShot = -10;
    this.fxVerts = new Float32Array(6 * 6 * VERTEX_FLOATS);
    this.fxMesh = renderer.createMesh(new Float32Array(6 * 6 * VERTEX_FLOATS), null, true);
    this.fxMesh.count = 0;
    this.muzzleWorld = [0, 0, 0];
    this.ejectWorld = [0, 0, 0];
    this.hidden = false;
  }

  /** Select (and lazily build) the model for a weapon + loadout entry. */
  setWeapon(weaponId, profile) {
    const key = `${weaponId}:${JSON.stringify(profile.model)}:${profile.skinId}`;
    let entry = this.cache.get(key);
    if (!entry && this.asset) {
      const built = buildAuthoredWeaponModel(profile, this.asset);
      const up = (prims) => (prims ? prims.map((p) => ({ mesh: this.renderer.createMesh(p.vertices, p.indices), material: this.renderer.material(this.asset, p.material), role: p.material.name })) : null);
      const P = built.parts;
      entry = {
        authored: true,
        meshes: { body: up(P.body), mag: up(P.mag), bolt: up(P.bolt), reticle: up(P.reticle), armR: up(P.armR), armL: up(P.armL), pips: P.pips.map(up) },
        sockets: built.sockets,
      };
      this.cache.set(key, entry);
    }
    if (!entry) {
      const built = buildWeaponModel(profile);
      const up = (b) => (b ? this.renderer.createMesh(b.vertices(), b.indices()) : null);
      entry = {
        meshes: { body: up(built.meshes.body), mag: up(built.meshes.mag), bolt: up(built.meshes.bolt), reticle: up(built.meshes.reticle), armR: up(built.meshes.armR), armL: up(built.meshes.armL) },
        sockets: built.sockets,
      };
      this.cache.set(key, entry);
    }
    this.current = { id: weaponId, profile, ...entry, model: profile.model.id };
  }

  onEquip(duration) {
    this.anim.equipStart = this.time;
    this.anim.equipDur = duration;
    this.anim.reloadStart = -10;
    this.anim.inspectStart = -10;
  }
  onReload(duration) {
    this.anim.reloadStart = this.time;
    this.anim.reloadDur = duration;
    this.anim.inspectStart = -10;
  }
  onReloadCancel() {
    this.anim.reloadStart = -10;
  }
  onInspect(clip) {
    this.anim.inspectStart = this.time;
    this.anim.inspectClip = clip;
  }
  onLand(impact) {
    this.dip.impulse(-Math.min(1.2, impact * 0.12));
  }

  /** Called on the frame a shot is predicted. `punch` from weapon recoil data. */
  onShot(punch, ads, flashKind, tint) {
    const k = ads ? 0.45 : 1;
    // Impulses are tuned so the spring peak lands at ~3 cm back / ~4 deg up for a rifle.
    this.kick.back.impulse(punch.back * 55 * k);
    this.kick.pitch.impulse(punch.pitch * 9 * k);
    this.kick.roll.impulse((Math.random() - 0.5) * 2 * punch.roll * 2.3 * k);
    this.kick.side.impulse((Math.random() - 0.5) * 0.3 * k);
    this.flash.age = 0;
    this.flash.kind = flashKind;
    this.flash.tint = tint;
    this.flash.rot = Math.random() * Math.PI;
    this.anim.inspectStart = -10;
    this.shotPulse = 1;
    this.lastShot = this.time;
  }

  /**
   * @param s { dt, camPos, yaw, pitch, roll, mouseDYaw, mouseDPitch, speed, onGround, ads, scoped, crouch, bob }
   * @returns draw items
   */
  update(s) {
    const dt = s.dt;
    this.time += dt;
    const cur = this.current;
    if (!cur) return [];
    const model = cur.model;
    const sk = cur.sockets;
    const adsE = easeInOutCubic(clamp(s.ads, 0, 1));
    const swayK = 1 - adsE * 0.75;

    // Sway: weapon lags behind the view's angular velocity; springs settle without wobble.
    const inv = 1 / Math.max(dt, 1e-3);
    const vYaw = s.mouseDYaw * inv, vPitch = s.mouseDPitch * inv;
    this.sway.yaw.step(dt, clamp(-vYaw * 0.012, -0.08, 0.08) * swayK);
    this.sway.pitch.step(dt, clamp(-vPitch * 0.012, -0.06, 0.06) * swayK);
    this.sway.x.step(dt, clamp(-vYaw * 0.0018, -0.012, 0.012) * swayK);
    this.sway.y.step(dt, clamp(-vPitch * 0.0015, -0.01, 0.01) * swayK);

    // Bob from ground speed.
    const target = s.onGround ? clamp(s.speed / 6.75, 0, 1) : 0;
    this.bobAmp += (target - this.bobAmp) * Math.min(1, dt * 10);
    this.bobPhase += dt * (4 + s.speed * 1.35);
    const bobK = this.bobAmp * (1 - adsE * 0.85) * (s.bob ? 1 : 0.35);
    const bobX = Math.sin(this.bobPhase) * 0.0075 * bobK;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * bobK + Math.sin(this.time * 1.7) * 0.0012 * (1 - adsE);

    const kb = this.kick.back.step(dt), kp = this.kick.pitch.step(dt), kr = this.kick.roll.step(dt), ks = this.kick.side.step(dt);
    const dip = this.dip.step(dt) * 0.02;

    // Base pose: hip -> ADS (sight line on the camera axis).
    const hip = HIP[model];
    const relief = EYE_RELIEF[model];
    const ads = [0, -sk.sightY, -relief - sk.sightZ];
    let px = hip[0] + (ads[0] - hip[0]) * adsE + bobX + this.sway.x.x + ks;
    let py = hip[1] + (ads[1] - hip[1]) * adsE + bobY + this.sway.y.x + dip - s.crouch * 0.008;
    let pz = hip[2] + (ads[2] - hip[2]) * adsE + kb;
    let rx = this.sway.pitch.x + kp;
    let ry = this.sway.yaw.x + ks * 2;
    let rz = kr + bobX * 2;
    // Hip pose cants the barrel slightly toward the crosshair, like a shouldered rifle.
    ry += (1 - adsE) * HIP_YAW[model];
    rx += (1 - adsE) * 0.035;
    // Slight hip cant (top away from the player) shows the receiver's left side: pips, window.
    rz -= (1 - adsE) * 0.07;

    // Equip: rise from below.
    const et = clamp((this.time - this.anim.equipStart) / this.anim.equipDur, 0, 1);
    if (et < 1) {
      const e = 1 - easeOutCubic(et);
      py -= e * 0.28;
      rx -= e * 0.7;
      rz += e * 0.3;
    }

    // Reload clip keyed to the presentation timeline.
    const tl = cur.profile.reloadTimeline;
    const rt = (this.time - this.anim.reloadStart) / this.anim.reloadDur;
    let magOffY = 0, magHide = false, boltBack = 0;
    let magFloat = null; // inspect 'assemble': [dx, dy, dz, rx, rz]
    // Per-shot action: the bolt carrier (seen through the receiver window) or the pistol slide
    // cycles with every round; the sniper bolt is worked by hand after the shot.
    const since = this.time - this.lastShot;
    if (model === 'sniper') {
      if (since > 0.18 && since < 0.62) boltBack = Math.sin(((since - 0.18) / 0.44) * Math.PI) * 0.07;
    } else if (since < 0.07) {
      boltBack = Math.sin((since / 0.07) * Math.PI) * (model === 'pistol' ? 0.026 : 0.022);
    }
    let handTarget = null;
    if (rt >= 0 && rt <= 1) {
      const tilt = smoothstep(0, 0.14, rt) * (1 - smoothstep(0.86, 1, rt));
      rz += tilt * 0.42;
      rx += tilt * 0.16;
      px -= tilt * 0.035;
      py += tilt * 0.02;
      if (rt > tl.magOut - 0.04 && rt < tl.magIn - 0.16) {
        const k = clamp((rt - (tl.magOut - 0.04)) / 0.12, 0, 1);
        magOffY = -k * k * 0.3;
        if (k >= 1) magHide = true;
      } else if (rt >= tl.magIn - 0.16 && rt < tl.magIn) {
        const k = clamp((rt - (tl.magIn - 0.16)) / 0.16, 0, 1);
        magOffY = -(1 - easeOutCubic(k)) * 0.22;
        handTarget = 'mag';
      }
      if (rt > tl.magOut - 0.1 && rt < tl.magIn + 0.04) handTarget = 'mag';
      if (rt > tl.bolt && rt < tl.bolt + 0.12) {
        const k = (rt - tl.bolt) / 0.12;
        boltBack = Math.sin(k * Math.PI) * 0.05;
        rx -= Math.sin(k * Math.PI) * 0.05;
      }
    }

    // Inspect clips (chosen by the skin decorator).
    const it = (this.time - this.anim.inspectStart) / 2.4;
    if (it >= 0 && it <= 1) {
      const inOut = smoothstep(0, 0.18, it) * (1 - smoothstep(0.82, 1, it));
      const clip = this.anim.inspectClip;
      if (clip === 'tilt') {
        ry += inOut * 0.85;
        rz -= inOut * 0.45;
        px -= inOut * 0.06;
        py += inOut * 0.03;
        rx += inOut * Math.sin(it * Math.PI * 2) * 0.06;
      } else if (clip === 'spin') {
        ry += inOut * 0.55;
        px -= inOut * 0.05;
        const spin = smoothstep(0.3, 0.7, it);
        rz += spin * Math.PI * 2;
      } else if (clip === 'assemble') {
        // Magnetic assembly: the weapon turns to show its side, the magazine and bolt float
        // out on soft arcs, hang with the glow pulsing, then snap home.
        ry += inOut * 0.7;
        rz -= inOut * 0.25;
        px -= inOut * 0.05;
        py += inOut * 0.03;
        const out = smoothstep(0.22, 0.42, it) * (1 - smoothstep(0.7, 0.86, it));
        const bob = Math.sin(it * Math.PI * 6) * 0.004 * out;
        magFloat = [-0.03 * out, -0.07 * out + bob, 0.02 * out, 0.35 * out, -0.25 * out];
        boltBack = Math.max(boltBack, 0.06 * out);
        this.shotPulse = Math.max(this.shotPulse, out * (0.5 + 0.5 * Math.sin(it * 30)));
      } else if (clip === 'flip') {
        const toss = smoothstep(0.25, 0.75, it);
        rx += toss * Math.PI * 2;
        py += Math.sin(toss * Math.PI) * 0.14;
        ry += inOut * 0.35;
        px -= inOut * 0.04;
      }
    }

    this.hidden = s.scoped && s.ads > 0.92;

    // World matrices: camera * weapon-local.
    const M = this.mats;
    compose(M.cam, s.camPos[0], s.camPos[1], s.camPos[2], s.pitch, s.yaw, s.roll);
    compose(M.local, px, py, pz, rx, ry, rz);
    multiply(M.root, M.cam, M.local);
    // Magazine and bolt relative to the weapon.
    const mp = sk.magPivot;
    if (magFloat) compose(M.tmp, mp[0] + magFloat[0], mp[1] + magOffY + magFloat[1], mp[2] + magFloat[2], magFloat[3], 0, magFloat[4]);
    else compose(M.tmp, mp[0], mp[1] + magOffY, mp[2], 0, 0, 0);
    multiply(M.mag, M.root, M.tmp);
    compose(M.tmp, 0, 0, boltBack, 0, 0, 0);
    multiply(M.bolt, M.root, M.tmp);
    const lh = handTarget === 'mag' ? [sk.magWell[0] - 0.01, sk.magWell[1] - 0.08 + magOffY, sk.magWell[2] + 0.02] : sk.leftHand;
    const handLerp = this.handPos || (this.handPos = lh.slice());
    for (let i = 0; i < 3; i++) handLerp[i] += (lh[i] - handLerp[i]) * Math.min(1, dt * 22);
    compose(M.tmp, handLerp[0], handLerp[1], handLerp[2], 0, 0, 0);
    multiply(M.armL, M.root, M.tmp);

    transformPoint(M.root, sk.muzzle[0], sk.muzzle[1], sk.muzzle[2], this.muzzleWorld);
    transformPoint(M.root, sk.eject[0], sk.eject[1], sk.eject[2], this.ejectWorld);

    this.flash.age += dt;
    this.buildFlash(s, M.root, sk);

    this.shotPulse = Math.max(0, this.shotPulse - dt * 9);
    if (this.hidden) return [];
    const probe = s.probe;
    const glow = cur.profile.palette.glow;
    if (cur.authored) return this.authoredItems(cur, s, M, probe, glow, magHide);
    const items = [
      { mesh: cur.meshes.body, model: M.root, probe, glow },
      { mesh: cur.meshes.bolt, model: M.bolt, probe, glow },
      { mesh: cur.meshes.armR, model: M.root, probe, glow },
      { mesh: cur.meshes.armL, model: M.armL, probe, glow },
    ];
    if (!magHide) items.push({ mesh: cur.meshes.mag, model: M.mag, probe, glow });
    if (cur.meshes.reticle) items.push({ mesh: cur.meshes.reticle, model: M.root, probe, glow: [3.2, 0.25, 0.12] });
    return items;
  }

  /** Draw items for a glTF weapon: palette-tinted roles, reactive emissive channels. */
  authoredItems(cur, s, M, probe, glow, magHide) {
    const pal = cur.profile.palette;
    // Reactive emissive: glow channels flare on each shot; the LED counter tracks the magazine
    // and blinks when it is nearly empty.
    const flare = 1 + this.shotPulse * 2.2;
    const glowEmit = [glow[0] * flare, glow[1] * flare, glow[2] * flare];
    const items = [];
    const push = (prims, model) => {
      if (!prims) return;
      for (const p of prims) {
        const role = p.role;
        const it = { mesh: p.mesh, material: p.material, model, probe };
        if (ROLE_TINT[role]) it.tint = pal[ROLE_TINT[role]];
        else if (ARM_TINT[role]) it.tint = ARM_TINT[role];
        if (role === 'glow') { it.tint = ZERO3; it.emit = glowEmit; }
        items.push(it);
      }
    };
    push(cur.meshes.body, M.root);
    push(cur.meshes.bolt, M.bolt);
    push(cur.meshes.armR, M.root);
    push(cur.meshes.armL, M.armL);
    if (!magHide) push(cur.meshes.mag, M.mag);
    if (cur.meshes.reticle) for (const p of cur.meshes.reticle) items.push({ mesh: p.mesh, material: p.material, model: M.root, probe, tint: ZERO3, emit: [6, 0.4, 0.2] });
    const pips = cur.meshes.pips;
    if (pips.length) {
      const frac = s.ammoFrac === undefined ? 1 : s.ammoFrac;
      const lit = Math.ceil(frac * pips.length - 1e-6);
      const low = frac > 0 && frac <= 0.25;
      const blink = low ? (Math.sin(this.time * 18) > 0 ? 1 : 0.25) : 1;
      for (let i = 0; i < pips.length; i++) {
        const on = i < lit;
        const k = on ? blink * (low ? 1.3 : 1) : 0.035;
        const c = low && on ? [2.4 * k, 0.35 * k, 0.15 * k] : [glow[0] * k, glow[1] * k, glow[2] * k];
        for (const p of pips[i]) items.push({ mesh: p.mesh, material: p.material, model: M.root, probe, tint: ZERO3, emit: c });
      }
    }
    return items;
  }

  /** Muzzle flash sprites (world space, drawn in the viewmodel pass) + flash light. */
  buildFlash(s, root, sk) {
    const f = this.flash;
    const v = this.fxVerts;
    let n = 0;
    this.light = [0, 0, 0, 0];
    if (f.age < f.life && !this.hidden) {
      const spec = FLASH[f.kind] || FLASH.rifle;
      const t = f.age / f.life;
      const c = f.tint;
      const a = 1 - t * 0.6;
      const m = this.muzzleWorld;
      const right = [root[0], root[1], root[2]], up = [root[4], root[5], root[6]], fwd = [-root[8], -root[9], -root[10]];
      const cr = Math.cos(f.rot), sr = Math.sin(f.rot);
      const ax = [right[0] * cr + up[0] * sr, right[1] * cr + up[1] * sr, right[2] * cr + up[2] * sr];
      const bx = [up[0] * cr - right[0] * sr, up[1] * cr - right[1] * sr, up[2] * cr - right[2] * sr];
      const quad = (cx, ax2, bx2, uv, k) => {
        const F = VERTEX_FLOATS;
        const P = [
          [cx[0] - ax2[0] - bx2[0], cx[1] - ax2[1] - bx2[1], cx[2] - ax2[2] - bx2[2], uv[0], uv[3]],
          [cx[0] + ax2[0] - bx2[0], cx[1] + ax2[1] - bx2[1], cx[2] + ax2[2] - bx2[2], uv[2], uv[3]],
          [cx[0] + ax2[0] + bx2[0], cx[1] + ax2[1] + bx2[1], cx[2] + ax2[2] + bx2[2], uv[2], uv[1]],
          [cx[0] - ax2[0] + bx2[0], cx[1] - ax2[1] + bx2[1], cx[2] - ax2[2] + bx2[2], uv[0], uv[1]],
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const o = n * F;
          const p = P[idx];
          v[o] = p[0]; v[o + 1] = p[1]; v[o + 2] = p[2];
          v[o + 6] = p[3]; v[o + 7] = p[4];
          v[o + 8] = c[0] * k; v[o + 9] = c[1] * k; v[o + 10] = c[2] * k; v[o + 11] = a;
          n++;
        }
      };
      const sz = spec.size * (1 + Math.random() * 0.25);
      quad(m, ax.map((x) => x * sz), bx.map((x) => x * sz), UV_STAR, 1);
      if (spec.side) {
        // Side-on petal along the barrel so the flash has depth from the shooter's view.
        const c2 = [m[0] + fwd[0] * spec.side * 0.6, m[1] + fwd[1] * spec.side * 0.6, m[2] + fwd[2] * spec.side * 0.6];
        quad(c2, fwd.map((x) => x * spec.side), up.map((x) => x * spec.side * 0.35), UV_GLOW, 0.8);
        quad(c2, fwd.map((x) => x * spec.side), right.map((x) => x * spec.side * 0.35), UV_GLOW, 0.8);
      }
      if (spec.up) {
        const c3 = [m[0] + up[0] * spec.up * 0.6, m[1] + up[1] * spec.up * 0.6, m[2] + up[2] * spec.up * 0.6];
        quad(c3, up.map((x) => x * spec.up), right.map((x) => x * 0.012), UV_GLOW, 1);
      }
      quad(m, ax.map((x) => x * sz * 2.2), bx.map((x) => x * sz * 2.2), UV_GLOW, 0.35);
      const L = spec.intensity * (1 - t);
      this.light = [m[0] + fwd[0] * 0.3, m[1] + fwd[1] * 0.3, m[2] + fwd[2] * 0.3, L];
    }
    const gl = this.renderer.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fxMesh.vbo);
    if (n) gl.bufferSubData(gl.ARRAY_BUFFER, 0, v, 0, n * VERTEX_FLOATS);
    this.fxMesh.count = n;
  }
}

const ZERO3 = [0, 0, 0];
