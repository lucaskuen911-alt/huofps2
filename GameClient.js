// Composition of the client: input -> prediction -> transport -> authority -> snapshots ->
// presentation. Owns the frame loop.
//
// Frame order (latency-critical path first):
//   1. consume mouse deltas, rotate the camera immediately
//   2. run fixed 128 Hz client ticks: build UserCmd, send, predict, present predicted events
//   3. advance the in-process authority (would be a remote server in production)
//   4. apply snapshots: reconcile, buffer bot states, present authoritative events
//   5. present: camera, viewmodel, characters, FX, audio listener, HUD, render

import { MAPS, DEFAULT_MAP } from '../data/maps/index.js';
import { MOVEMENT } from '../data/movement.js';
import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { ABILITIES } from '../data/abilities.js';
import { SURFACES, SURFACE_IDS } from '../data/surfaces.js';
import { TICK_DT, TICK_RATE } from '../sim/Simulation.js';
import { compileMap } from '../sim/MapCompiler.js';
import { CollisionWorld } from '../sim/World.js';
import { BF } from '../sim/World.js';
import { buildStatTable } from '../sim/WeaponBuilder.js';
import { eyeHeight } from '../sim/PlayerController.js';
import { computeSpread } from '../sim/Recoil.js';
import { traceEntities } from '../sim/Hitscan.js';
import { makeCmd } from '../sim/UserCmd.js';
import { createLoopback } from '../net/Transport.js';
import { AuthorityServer } from '../net/AuthorityServer.js';
import { ClientPredictor } from '../net/ClientPredictor.js';
import { Input } from './Input.js';
import { CameraRig } from './CameraRig.js';
import { Renderer } from '../render/Renderer.js';
import { LightBaker } from '../render/LightBaker.js';
import { buildMapGeometry } from '../render/MapGeometry.js';
import { buildMapDecals } from '../render/MapDecals.js';
import { Viewmodel } from '../render/Viewmodel.js';
import { BotView } from '../render/BotView.js';
import { Fx } from '../render/Fx.js';
import { loadGlb } from '../render/Gltf.js';
import { loadAsset, loadImage } from './Assets.js';
import { buildStaticModels, CraneView } from '../render/MapModels.js';
import { compose, invertRigid, multiply, perspective, invert } from '../render/gl/Mat4.js';
import { resolvePresentation } from '../presentation/PresentationProfile.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { DomHud } from '../ui/HudFacade.js';
import { HudPresenter } from '../ui/HudPresenter.js';
import { Minimap } from '../ui/Minimap.js';
import { Menu } from '../ui/Menu.js';
import { saveProfile } from '../ui/Settings.js';
import { DEG, clamp, wrapAngle } from '../core/MathUtil.js';
import { EventBus } from '../core/EventBus.js';
const PLAYER_ID = 1;
const STEP_FAMILY = { stone: 'stone', metal: 'metal', wood: 'wood' };

export class GameClient {
  constructor(profile, report) {
    this.profile = profile;
    this.report = report;
    this.bus = new EventBus();
  }

  async boot() {
    const canvas = document.getElementById('view');
    const tb = performance.now();
    const mark = (label) => console.info(`[boot] ${label} ${Math.round(performance.now() - tb)} ms`);
    this.report(0.03, 'Loading models…');
    this.assets = {};
    this.mapId = MAPS[this.profile.settings.map] ? this.profile.settings.map : DEFAULT_MAP;
    this.mapAsset = MAPS[this.mapId];
    for (const name of ['weapons', 'agent', ...(this.mapAsset.assets || [])]) {
      try {
        this.assets[name] = await loadGlb(await loadAsset(`${name}.glb`));
        this.assets[name].id = name;
      } catch (e) {
        console.warn(`Model set '${name}' unavailable, using procedural fallback:`, e.message);
      }
    }
    mark('models');
    this.report(0.08, 'Compiling map…');
    this.map = compileMap(this.mapAsset);
    this.hf = new CollisionWorld(this.map);
    this.renderer = new Renderer(canvas);
    await nextFrame();
    this.report(0.15, 'Baking lighting (sky, sun, one bounce)…');
    await nextFrame();
    const t0 = performance.now();
    this.baker = new LightBaker(this.map, this.hf);
    const geometry = buildMapGeometry(this.map, this.hf, this.baker);
    this.bakeMs = Math.round(performance.now() - t0);
    this.bakeVerts = geometry.verts;
    this.report(0.7, `Baked ${geometry.verts.toLocaleString()} vertices, ${geometry.rays.toLocaleString()} rays in ${this.bakeMs} ms. Uploading…`);
    await nextFrame();
    mark('bake');
    // Authored stylized surface textures replace the procedural fallbacks where present.
    await Promise.all(SURFACE_IDS.map(async (id) => {
      try {
        const img = await loadImage(`tex/${id}.webp`);
        if (img) this.renderer.setSurfaceImage(id, img);
      } catch (e) {
        console.warn(`Texture ${id} failed:`, e.message);
      }
    }));
    this.renderer.initWorld(this.map, geometry, buildMapDecals(this.map));
    mark('upload');
    // Authored props: flattened, light-baked, chunked; the yard crane animates the movable stacks.
    const levelAssets = Object.fromEntries((this.mapAsset.assets || []).map((n) => [n, this.assets[n]]).filter(([, a]) => a));
    if (this.map.models.length && Object.keys(levelAssets).length) {
      this.report(0.75, 'Baking props…');
      await nextFrame();
      const sm = buildStaticModels(this.map, levelAssets, this.baker, this.renderer);
      this.renderer.setStaticProps(sm.items);
      if (sm.missing.length) console.warn('Map models without an asset:', sm.missing.join(', '));
      console.info(`[boot] props ${sm.verts} verts, ${sm.baked} bakes, ${sm.items.length} draws`);
      mark('props');
    }
    this.renderer.bakeStaticShadow(this.map);
    mark('sun shadow');
    this.crane = this.map.crane ? new CraneView(this.renderer, this.baker, this.map.crane, levelAssets, { ...this.mapAsset.rules }) : null;
    if (this.crane && !this.crane.ok) this.crane = null;
    this.viewmodel = new Viewmodel(this.renderer, this.assets.weapons || null);
    this.botView = new BotView(this.renderer, this.baker, this.assets.agent || null);
    this.fx = new Fx(this.renderer, this.hf);
    this.camera = new CameraRig();
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.audio.occlusion = (a, b) => !this.hf.lineOfSight(a[0], a[1], a[2], b[0], b[1] + 0.5, b[2]);
    this.hud = new DomHud();
    this.presenter = new HudPresenter(this.hud);
    this.minimap = new Minimap(document.getElementById('minimap'), this.map, this.hf);
    this.menu = new Menu(this.profile, {
      onDeploy: () => this.deploy(),
      onChange: () => this.applyProfile(),
      onTick: () => this.audio.play('uiTick', { gain: 0.6 }),
    });

    // Network: loopback link to an in-process authority.
    this.link = createLoopback();
    this.server = new AuthorityServer(this.mapAsset, this.link);
    this.predictor = new ClientPredictor();
    this.seq = 0;
    this.acc = 0;
    this.snapshots = [];
    this.renderTime = 0;
    this.latestServerTime = 0;
    this.latestArrival = 0;
    this.round = null;
    this.sendTimes = new Map();
    this.rtt = 0;
    this.playing = false;
    this.deployed = false;
    this.hurt = 0;
    this.lastZoom = 1;
    this.probe = [1, 1];
    this.frameCount = 0;
    this.perf = { fps: 0, frameMs: 0, acc: 0, n: 0, t: performance.now() };
    this.visibleBots = new Set();
    this.minimapPulses = [];
    this.profiles = {};
    this.applyProfile(true);

    const now = performance.now();
    this.link.up.send({ type: 'join', id: PLAYER_ID, loadout: this.profile.loadout, settings: this.profile.settings }, now);
    this.server.update(now, 0);
    for (const m of this.link.down.receive(now)) this.onMessage(m, now);
    // Prime one snapshot so the attract view has state.
    this.server.sendSnapshot(now);
    for (const m of this.link.down.receive(now)) this.onMessage(m, now);

    this.input.onUnlock = () => this.pause();
    this.input.onFreeLook = (on) => {
      const note = document.getElementById('freelook-note');
      if (!note) return;
      clearTimeout(this.freeLookTimer);
      note.classList.remove('fade');
      note.hidden = !on;
      if (on) this.freeLookTimer = setTimeout(() => note.classList.add('fade'), 9000);
    };
    this.input.onKey = (e) => {
      if (e.code === 'Backquote') {
        this.profile.settings.showPerf = !this.profile.settings.showPerf;
        this.applyProfile();
        return true;
      }
      if (e.code === 'Escape' && this.input.freeLook) {
        this.input.unlock();
        this.pause();
        return true;
      }
      return false;
    };
    canvas.addEventListener('click', () => {
      if (this.deployed && !this.playing) this.resume();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    mark('ui');
    this.menu.setMapInfo(this.map.name, this.map.spawns.hostiles.length);
    window.__hairline = { ready: true, client: this, debugShot: (s) => this.debugShot(s) };
    this.report(1, 'Ready');
    this.last = performance.now();
    // ?manual: no frame loop (headless screenshots render frames on demand via debugShot).
    this.manual = typeof location !== 'undefined' && /[?&]manual\b/.test(location.search);
    if (!this.manual) requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ profile
  applyProfile(initial = false) {
    const { settings, loadout } = this.profile;
    this.stats = buildStatTable(loadout, ABILITIES.X.stats);
    for (const id of WEAPON_ORDER) this.profiles[id] = resolvePresentation(id, loadout[id]);
    this.audio.setVolume(settings.masterVolume);
    this.link && this.link.up.setConditions(settings.netLatencyMs, settings.netJitterMs);
    this.link && this.link.down.setConditions(settings.netLatencyMs, settings.netJitterMs);
    if (!initial) {
      const now = performance.now();
      this.link.up.send({ type: 'loadout', id: PLAYER_ID, loadout, settings }, now);
      this.link.up.send({ type: 'difficulty', value: settings.difficulty }, now);
      saveProfile(this.profile);
    }
    if (this.predictor && this.predictor.state) this.viewmodel.setWeapon(this.predictor.state.inv.current, this.profiles[this.predictor.state.inv.current]);
    this.resize();
  }

  resize() {
    if (!this.renderer) return;
    const s = this.profile.settings;
    const dpr = window.devicePixelRatio || 1;
    const scale = s.renderScale === 'auto' ? Math.min(dpr, 1.5) : parseFloat(s.renderScale) * Math.min(dpr, 2);
    const c = this.renderer.canvas;
    this.cssW = c.clientWidth || window.innerWidth;
    this.cssH = c.clientHeight || window.innerHeight;
    this.renderer.resize(this.cssW, this.cssH, scale);
  }

  // ------------------------------------------------------------------ flow
  async deploy() {
    this.audio.init();
    this.audio.setVolume(this.profile.settings.masterVolume);
    if (!this.deployed) {
      this.deployed = true;
      this.link.up.send({ type: 'restart' }, performance.now());
    }
    await this.resume();
  }

  async resume() {
    this.audio.init();
    const el = document.documentElement;
    // Request the pointer lock in the same task as the click (no await before it), so the
    // user activation is still fresh; fullscreen is optional and runs alongside.
    try {
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } catch (e) {
      /* fullscreen is optional */
    }
    const ok = await this.input.lock();
    if (!ok && !this.input.freeLook) {
      document.getElementById('deploy-sub').textContent = 'Click again to capture the mouse';
      return;
    }
    document.getElementById('resume-hint').hidden = true;
    this.menu.hide();
    this.hud.show(true);
    this.playing = true;
    this.last = performance.now();
    this.input.consumeMouse();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.menu.show(true);
    this.input.held = 0;
  }

  // ------------------------------------------------------------------ network
  predictCtx(phase) {
    return {
      hf: this.hf,
      move: MOVEMENT,
      stats: this.stats,
      zones: this.map.zones,
      canMove: phase !== 'barrier',
      canFire: phase === 'live',
      adsMode: this.profile.settings.adsMode,
      onShot: (p, shot) => this.predictShot(p, shot),
      onAbility: null,
    };
  }

  /** Client-side trace for instant impact FX (authority decides damage). */
  predictShot(p, shot) {
    const [ox, oy, oz] = shot.origin;
    const [dx, dy, dz] = shot.dir;
    const wall = this.hf.raycast(ox, oy, oz, dx, dy, dz, 200);
    const wallT = wall ? wall.t : 200;
    const impact = wall ? { pos: [wall.x, wall.y, wall.z], normal: [wall.nx, wall.ny, wall.nz], surface: wall.surface } : null;
    const ent = traceEntities(ox, oy, oz, dx, dy, dz, wallT, this.renderBots || [], null);
    shot.end = ent ? [ox + dx * ent.t, oy + dy * ent.t, oz + dz * ent.t] : impact ? impact.pos : [ox + dx * 200, oy + dy * 200, oz + dz * 200];
    shot.impact = ent ? null : impact;
    shot.predictedHit = ent ? { zone: ent.zone, id: ent.entity.id } : null;
  }

  clientTick(now) {
    const phase = this.round ? this.round.phase : 'barrier';
    const buttons = this.playing ? this.input.consumeButtons() : 0;
    let weapon = this.playing ? this.input.consumeWeaponRequest() : null;
    const wheel = this.playing ? this.input.consumeWheel() : 0;
    if (!weapon && wheel) {
      const i = WEAPON_ORDER.indexOf(this.predictor.state.inv.current);
      weapon = WEAPON_ORDER[(i + (wheel > 0 ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length];
    }
    const cmd = makeCmd(++this.seq, TICK_DT, buttons, this.camera.yaw, this.camera.pitch, weapon, this.renderTime);
    this.link.up.send({ type: 'cmd', id: PLAYER_ID, cmd }, now);
    this.sendTimes.set(cmd.seq, now);
    const events = [];
    this.predictor.predict(cmd, this.predictCtx(phase), events);
    for (const e of events) this.onLocalEvent(e);
  }

  onMessage(m, now) {
    if (m.type !== 'snap') return;
    if (!this.predictor.state) {
      this.predictor.init(m.player);
      this.camera.yaw = m.player.yaw;
      this.camera.pitch = m.player.pitch;
      this.viewmodel.setWeapon(m.player.inv.current, this.profiles[m.player.inv.current]);
    } else {
      const before = this.predictor.state.alive;
      this.predictor.reconcile(m.player, m.ack, this.predictCtx(m.round.phase));
      if (m.player.alive && !before) this.viewmodel.onEquip(0.4);
    }
    const sent = this.sendTimes.get(m.ack);
    if (sent !== undefined) {
      this.rtt = this.rtt * 0.8 + (now - sent) * 0.2;
      for (const k of this.sendTimes.keys()) if (k <= m.ack) this.sendTimes.delete(k);
    }
    // Teleport (new round): snap the view to the spawn heading.
    if (this.round && m.round.number !== this.round.number) {
      this.camera.yaw = m.player.yaw;
      this.camera.pitch = 0;
      this.viewmodel.setWeapon(m.player.inv.current, this.profiles[m.player.inv.current]);
      this.viewmodel.onEquip(0.5);
    }
    // Map variant (crane-moved containers): collide with exactly what the authority uses.
    if (m.round.variant !== undefined && this.hf.variant !== m.round.variant) this.setVariant(m.round.variant, m.round.prevVariant);
    this.round = m.round;
    this.latestServerTime = m.time;
    this.latestArrival = now;
    this.snapshots.push({ time: m.time, bots: m.bots, smokes: m.smokes, reveals: m.reveals });
    while (this.snapshots.length > 40) this.snapshots.shift();
    for (const e of m.events) this.onServerEvent(e);
  }

  interpDelay() {
    return 2 / 64 + (this.profile.settings.netJitterMs * 1.3) / 1000;
  }

  /** Bots at renderTime, interpolated between bracketing snapshots. */
  interpolateBots() {
    const snaps = this.snapshots;
    if (!snaps.length) return [];
    const t = this.renderTime;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].time <= t && snaps[i].time >= t) {
        a = snaps[i - 1];
        b = snaps[i];
        break;
      }
    }
    const k = b.time > a.time ? clamp((t - a.time) / (b.time - a.time), 0, 1) : 1;
    return b.bots.map((bb, i) => {
      const ab = a.bots[i] || bb;
      return {
        ...bb,
        pos: [ab.pos[0] + (bb.pos[0] - ab.pos[0]) * k, ab.pos[1] + (bb.pos[1] - ab.pos[1]) * k, ab.pos[2] + (bb.pos[2] - ab.pos[2]) * k],
        yaw: ab.yaw + wrapAngle(bb.yaw - ab.yaw) * k,
        pitch: ab.pitch + (bb.pitch - ab.pitch) * k,
        crouch: ab.crouch + (bb.crouch - ab.crouch) * k,
        alive: k < 1 ? ab.alive && bb.alive : bb.alive,
      };
    });
  }

  // ------------------------------------------------------------------ events
  botName(id) {
    if (id === PLAYER_ID) return 'You';
    const b = this.server.sim.bots.find((x) => x.id === id);
    if (!b) return `Bot ${id}`;
    return b.kind === 'dummy' ? 'Range dummy' : `Hostile ${String(id - 99).padStart(2, '0')}`;
  }

  onLocalEvent(e) {
    const p = this.predictor.state;
    const prof = this.profiles[p.inv.current];
    const A = this.audio;
    switch (e.type) {
      case 'shot': {
        const st = this.currentStats();
        const ads = p.inv.adsT > 0.5;
        A.fire(prof, null);
        this.viewmodel.onShot(st.recoil.punch, ads, prof.fx.muzzleFlash, prof.fx.muzzleTint);
        this.camera.onShot(st.recoil.punch, ads);
        const from = this.viewmodel.hidden ? [this.camera.pos[0], this.camera.pos[1] - 0.08, this.camera.pos[2]] : this.viewmodel.muzzleWorld.slice();
        this.fx.tracer(from, e.end, prof.fx.tracer, ads ? 0.014 : 0.02);
        if (e.impact) {
          this.fx.impact(e.impact.pos, e.impact.normal, e.impact.surface, prof.fx.impactExtra);
          const fam = SURFACES[SURFACE_IDS[e.impact.surface]].impact;
          A.playAt(`impact.${fam}`, e.impact.pos, { gain: 0.5, rate: 0.9 + Math.random() * 0.2 });
        }
        if (e.predictedHit) {
          const head = e.predictedHit.zone === 'head';
          this.fx.hitSpark(e.end, e.dir, head);
          this.botView.flash(e.predictedHit.id, head);
        }
        if (!this.viewmodel.hidden) {
          const cam = this.camera.basis();
          const v = p.vel;
          const r = Math.random();
          this.fx.casing(this.viewmodel.ejectWorld, [cam.right[0] * (2 + r) + cam.up[0] * 1.6 + v[0], cam.right[1] * (2 + r) + cam.up[1] * 1.6 + 1.2 + v[1], cam.right[2] * (2 + r) + cam.up[2] * 1.6 + v[2]]);
        }
        break;
      }
      case 'equip':
        this.viewmodel.setWeapon(e.weapon, this.profiles[e.weapon]);
        this.viewmodel.onEquip(e.duration);
        A.play('equip', { gain: 0.7 });
        break;
      case 'reloadStart': {
        this.viewmodel.onReload(e.duration);
        const tl = prof.reloadTimeline;
        const rate = prof.model.id === 'pistol' ? 1.15 : prof.model.id === 'sniper' ? 0.9 : 1;
        A.play('magOut', { delay: tl.magOut * e.duration, rate, gain: 0.8 });
        A.play('magIn', { delay: tl.magIn * e.duration, rate, gain: 0.8 });
        A.play('bolt', { delay: tl.bolt * e.duration, rate, gain: 0.7 });
        for (const layer of prof.audio.reloadLayers) A.play(layer, { delay: tl.magIn * e.duration, gain: 0.55 });
        break;
      }
      case 'inspect':
        this.viewmodel.onInspect(prof.inspect);
        A.play('inspect', { gain: 0.7 });
        break;
      case 'footstep': {
        const fam = SURFACES[SURFACE_IDS[e.surface]].step;
        A.play(`step.${STEP_FAMILY[fam]}.${Math.floor(Math.random() * 3)}`, { gain: 0.32, rate: 0.94 + Math.random() * 0.12 });
        break;
      }
      case 'land': {
        const fam = SURFACES[SURFACE_IDS[e.surface]].step;
        A.play(`land.${fam}`, { gain: Math.min(0.9, 0.25 + e.impact * 0.06) });
        this.camera.onLand(e.impact);
        this.viewmodel.onLand(e.impact);
        break;
      }
      case 'ability':
        if (e.key === 'C') A.play('dash', { gain: 0.4, rate: 1.4 });
        if (e.key === 'Q') A.play('pulse', { gain: 0.7 });
        if (e.key === 'E') A.play('dash', { gain: 0.8 });
        if (e.key === 'X') A.play('ult', { gain: 0.8 });
        break;
      case 'plantStart':
        A.play('beep', { gain: 0.6 });
        break;
    }
  }

  onServerEvent(e) {
    const A = this.audio;
    if (e.fromPlayer) {
      // Already presented by prediction. Only server-only facts follow.
      return;
    }
    switch (e.type) {
      case 'hit': {
        const head = e.zone === 'head';
        this.hud.hitmarker(e.killed ? 'kill' : head ? 'head' : 'body');
        A.play(head ? 'hitHead' : 'hitBody', { gain: 0.7 });
        if (e.armorBroke) A.play('armorBreak', { gain: 0.5 });
        const s = this.project(e.pos);
        if (s) this.hud.damageNumber(s[0] + (Math.random() - 0.5) * 20, s[1] - 20, e.amount, head);
        break;
      }
      case 'kill': {
        const mine = e.killer === PLAYER_ID;
        this.hud.killfeed({ killer: this.botName(e.killer), victim: this.botName(e.victim), weapon: e.weapon === 'bot' ? 'Rifle' : WEAPONS[e.weapon].name, headshot: e.headshot, mine, victimIsPlayer: e.victim === PLAYER_ID });
        if (mine) {
          A.play('kill', { gain: 0.6, delay: 0.05 });
          const layer = this.profiles[e.weapon] && this.profiles[e.weapon].audio.killLayer;
          if (layer) A.play(layer, { gain: 0.5, delay: 0.08 });
        }
        break;
      }
      case 'botShot': {
        A.fire(this.profiles.halberd, e.origin);
        this.fx.muzzleFlash(e.origin, [2.2, 1.0, 0.45], 0.32);
        this.fx.tracer(e.origin, e.end, [2.2, 0.6, 0.35], 0.018);
        if (e.impact) this.fx.impact(e.impact.pos, e.impact.normal, e.impact.surface, null);
        if (!e.hit) {
          // Near-miss crack when the round passes close to the player's head.
          const p = this.predictor.state;
          const eye = [p.pos[0], p.pos[1] + 1.6, p.pos[2]];
          if (segmentDistance(e.origin, e.end, eye) < 1.6) A.playAt('whiz', eye, { gain: 0.6 });
        }
        break;
      }
      case 'playerDamaged': {
        this.hurt = Math.min(1, this.hurt + 0.5 + e.amount / 100);
        A.play('hurt', { gain: 0.8 });
        const p = this.predictor.state;
        const toYaw = Math.atan2(-(e.from[0] - p.pos[0]), -(e.from[2] - p.pos[2]));
        this.hud.damageDirection(-wrapAngle(toYaw - this.camera.yaw));
        break;
      }
      case 'smoke':
        A.playAt('smoke', e.smoke.pos, { gain: 1 });
        break;
      case 'reveal':
        this.fx.pulse(e.pos, e.radius);
        this.minimapPulses.push({ pos: e.pos, radius: e.radius, born: performance.now() });
        A.playAt('pulse', e.pos, { gain: 0.8, rate: 0.8 });
        break;
      case 'round':
        if (e.phase === 'barrier') {
          this.hud.banner(`Round ${e.number}`, 'Barrier drops in 3 s', 'info');
          A.play('roundStart', { gain: 0.7 });
          this.fx.clearDecals();
        } else if (e.phase === 'live') {
          this.hud.banner('Engage', 'Eliminate hostiles or plant on A / B', 'info');
          A.play('beep', { gain: 0.6 });
        } else if (e.phase === 'post') {
          this.hud.banner(e.result === 'win' ? 'Round won' : 'Round lost', e.reason, e.result);
          A.play(e.result === 'win' ? 'roundWin' : 'roundLoss', { gain: 0.8 });
        }
        break;
      case 'planted':
        A.play('planted', { gain: 0.9 });
        break;
    }
  }

  project(pos) {
    const m = this.camera.viewProj;
    const x = m[0] * pos[0] + m[4] * pos[1] + m[8] * pos[2] + m[12];
    const y = m[1] * pos[0] + m[5] * pos[1] + m[9] * pos[2] + m[13];
    const w = m[3] * pos[0] + m[7] * pos[1] + m[11] * pos[2] + m[15];
    if (w <= 0) return null;
    return [(x / w * 0.5 + 0.5) * this.cssW, (1 - (y / w * 0.5 + 0.5)) * this.cssH];
  }

  currentStats() {
    const p = this.predictor.state;
    const e = this.stats[p.inv.current];
    return p.abilities.X.activeUntil > p.clock ? e.boosted : e.normal;
  }

  // ------------------------------------------------------------------ frame
  frame(t) {
    if (!this.manual) requestAnimationFrame((tt) => this.frame(tt));
    const cpu0 = performance.now();
    const dt = clamp((t - this.last) / 1000, 0, 0.1);
    this.last = t;
    const now = performance.now();

    // 1. Mouse -> camera, immediately.
    const [mdx, mdy] = this.input.consumeMouse();
    const prevYaw = this.camera.yaw, prevPitch = this.camera.pitch;
    if (this.playing && this.predictor.state) {
      // Aiming scales sensitivity by the zoom so screen-space feel is preserved.
      const zoom = this.camera.zoom || 1;
      const adsScale = zoom > 1.01 ? this.profile.settings.adsSensitivityMul / zoom : 1;
      this.camera.applyMouse(mdx, mdy, this.profile.settings.sensitivity, adsScale);
    }

    // 2-4. Simulation and network (frozen while paused: this is a practice server).
    if (this.playing) {
      this.acc += dt;
      let ticks = 0;
      while (this.acc >= TICK_DT && ticks < 32) {
        this.acc -= TICK_DT;
        this.clientTick(now);
        ticks++;
      }
      this.server.update(now, dt);
      const target = this.latestServerTime + (now - this.latestArrival) / 1000 - this.interpDelay();
      if (Math.abs(this.renderTime - target) > 0.25) this.renderTime = target;
      else this.renderTime += dt + (target - this.renderTime) * 0.08;
    }
    for (const m of this.link.down.receive(now)) this.onMessage(m, now);
    this.predictor.decay(dt);

    this.present(dt, now, this.camera.yaw - prevYaw, this.camera.pitch - prevPitch);
    this.updatePerf(performance.now() - cpu0, t);
  }

  present(dt, now, dYaw, dPitch) {
    const p = this.predictor.state;
    if (!p) return;
    const st = this.currentStats();
    const settings = this.profile.settings;
    const aspect = this.cssW / this.cssH;
    const alpha = this.acc / TICK_DT;
    const renderPos = this.predictor.renderPos(clamp(alpha, 0, 1), [0, 0, 0]);
    const inv = p.inv;
    if (inv.adsLevel > 0) this.lastZoom = st.ads.zooms[Math.min(inv.adsLevel, st.ads.zooms.length) - 1];

    const dbg = this.debugCam;
    const deployedView = dbg ? dbg.viewmodel : this.deployed;
    if (dbg) {
      this.camera.yaw = dbg.yaw;
      this.camera.pitch = dbg.pitch;
      this.camera.smoothY = null;
      this.camera.update({ dt, renderPos: dbg.pos, eye: dbg.free ? 0 : MOVEMENT.eyeStand, onGround: true, speed: 0, strafeVel: 0, recoilYawDeg: 0, recoilPitchDeg: 0, viewKick: 0, adsT: dbg.ads || 0, zoom: dbg.zoom || 1, fovH: (dbg.fov || settings.fovHorizontal) * DEG, aspect, bob: false });
    } else if (deployedView) {
      const strafeVel = Math.cos(this.camera.yaw) * p.vel[0] - Math.sin(this.camera.yaw) * p.vel[2];
      this.camera.update({
        dt,
        renderPos,
        eye: eyeHeight(p, MOVEMENT),
        onGround: p.onGround,
        speed: p.speed,
        strafeVel,
        recoilYawDeg: inv.recoil.yaw,
        recoilPitchDeg: inv.recoil.pitch,
        viewKick: st.recoil.viewKick,
        adsT: inv.adsT,
        zoom: this.lastZoom,
        fovH: settings.fovHorizontal * DEG,
        aspect,
        bob: settings.cameraBob,
      });
    } else {
      this.attractCamera(now, aspect);
    }
    const cam = this.camera;
    this.audio.setListener(cam.pos, cam.dispYaw);

    // Light probe for the viewmodel: sun visibility + sky openness at the eye.
    if (this.frameCount++ % 4 === 0) {
      const pr = this.baker.probe(cam.pos[0], cam.pos[1], cam.pos[2], [0, 0]);
      this.probe[0] += (pr[0] - this.probe[0]) * 0.5;
      this.probe[1] += (pr[1] - this.probe[1]) * 0.5;
    }

    // Characters
    const bots = this.interpolateBots();
    this.renderBots = bots;
    const lit = [];
    this.botView.collect(bots, this.renderTime, dt, lit);
    if (this.crane) {
      this.crane.update(this.renderTime);
      this.crane.collect(lit);
    }
    this.fx.update(dt, (pos, surface, n) => {
      const fam = SURFACES[SURFACE_IDS[surface]].step;
      this.audio.playAt(`shell.${fam}`, pos, { gain: n === 0 ? 0.5 : 0.25, rate: 0.9 + Math.random() * 0.2 });
    });
    this.fx.casingDraws(lit);

    // Viewmodel
    const vmItems = deployedView && p.alive
      ? this.viewmodel.update({
          dt,
          camPos: cam.pos,
          yaw: cam.dispYaw,
          pitch: cam.dispPitch,
          roll: cam.dispRoll,
          mouseDYaw: dYaw,
          mouseDPitch: dPitch,
          speed: p.speed,
          onGround: p.onGround,
          ads: dbg && dbg.ads !== undefined ? dbg.ads : inv.adsT,
          scoped: st.ads.scoped,
          crouch: p.crouch,
          bob: settings.cameraBob,
          probe: this.probe,
          ammoFrac: inv.slots[inv.current].ammo / Math.max(1, st.magSize),
        })
      : [];
    if (!deployedView || !p.alive) this.viewmodel.light = [0, 0, 0, 0];

    const latest = this.snapshots[this.snapshots.length - 1] || { smokes: [], reveals: [] };
    const fxOut = this.fx.build(cam.basis(), latest.smokes, this.renderTime);
    const tint = this.profiles[inv.current].fx.muzzleTint;
    this.renderer.render({
      time: performance.now() / 1000,
      camera: { pos: cam.pos, viewProj: cam.viewProj, invViewProj: cam.invViewProj },
      vmCamera: { pos: cam.pos, viewProj: cam.vmViewProj },
      lit,
      viewmodel: vmItems,
      vmFx: this.viewmodel.fxMesh,
      muzzle: { light: this.viewmodel.light || [0, 0, 0, 0], color: tint },
      decals: fxOut.decals,
      fxAdd: fxOut.add,
      fxAlpha: fxOut.alpha,
    });

    if (!deployedView) return;
    // HUD
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    let smokeInside = 0;
    for (const s of latest.smokes) {
      const d = Math.hypot(cam.pos[0] - s.pos[0], cam.pos[1] - s.pos[1], cam.pos[2] - s.pos[2]);
      smokeInside = Math.max(smokeInside, clamp((s.radius * 0.95 - d) / 1.2, 0, 0.92));
    }
    const hostiles = bots.filter((b) => b.kind === 'hostile');
    if (this.frameCount % 6 === 0) this.updateVisibility(bots, cam.pos);
    this.minimap.draw({
      pos: renderPos,
      yaw: cam.yaw,
      bots: bots.map((b) => ({ pos: b.pos, kind: b.kind, visible: b.alive && (b.revealedUntil > this.renderTime || this.visibleBots.has(b.id)) })),
      smokes: latest.smokes,
      pulses: this.minimapPulses.filter((q) => now - q.born < 1500).map((q) => ({ pos: q.pos, radius: q.radius, t: (now - q.born) / 1500 })),
    });
    const showPerf = settings.showPerf;
    this.presenter.update({
      player: p,
      stats: st,
      loadout: this.profile.loadout,
      round: this.round,
      serverTime: this.renderTime + this.interpDelay(),
      hostilesLeft: hostiles.filter((b) => b.alive).length,
      hostilesTotal: hostiles.length,
      location: this.minimap.calloutAt(renderPos[0], renderPos[2], renderPos[1]),
      smokeInside,
      hurt: this.hurt,
      settings,
      spread: computeSpread(st, p, MOVEMENT),
      vFov: cam.vFov,
      viewportH: this.cssH,
      perf: showPerf ? this.perfStats() : null,
    });
  }

  updateVisibility(bots, eye) {
    this.visibleBots.clear();
    for (const b of bots) {
      if (!b.alive) continue;
      if (this.hf.lineOfSight(eye[0], eye[1], eye[2], b.pos[0], b.pos[1] + 1.5, b.pos[2])) this.visibleBots.add(b.id);
    }
  }

  /** Dev hook for tools/shots.mjs: freeze the sim and frame a deterministic view. */
  debugShot(s) {
    this.playing = false;
    this.menu.hide();
    this.hud.show(!!s.hud);
    if (s.variant !== undefined && s.prevVariant !== undefined) {
      // Crane re-stack preview: start from the previous layout, then jump craneT seconds in.
      this.hf.setVariant(-1);
      this.setVariant(s.prevVariant, s.prevVariant);
      this.setVariant(s.variant, s.prevVariant);
      if (this.crane) this.crane.t0 = this.renderTime - (s.craneT || 0);
    } else if (s.variant !== undefined) this.setVariant(s.variant, s.variant);
    if (s.weapon && this.profiles[s.weapon]) this.viewmodel.setWeapon(s.weapon, this.profiles[s.weapon]);
    if (s.inspect) this.viewmodel.onInspect(s.inspect);
    if (s.shotAgo !== undefined) this.viewmodel.lastShot = this.viewmodel.time - s.shotAgo;
    this.debugCam = { pos: s.pos, yaw: s.yaw || 0, pitch: s.pitch || 0, free: !!s.free, viewmodel: !s.free && s.viewmodel !== false, fov: s.fov, ads: s.ads, zoom: s.zoom };
    // Render synchronously (twice: springs settle, probes update) and hand back the pixels.
    const t0 = performance.now();
    this.last = t0 - 16;
    for (let i = 0; i < (s.frames || 3); i++) this.frame(this.last + 16);
    const ms = performance.now() - t0;
    const r = this.renderer.stats;
    return { ms: Math.round(ms), bakeMs: this.bakeMs, verts: this.bakeVerts, draws: r.drawCalls, tris: Math.round(r.triangles), byPass: r.byPass, png: s.capture ? this.renderer.canvas.toDataURL('image/png') : null };
  }

  setVariant(v, prev) {
    this.hf.setVariant(v);
    if (this.crane) this.crane.onVariant(v, prev === undefined ? v : prev, this.renderTime);
  }

  attractCamera(now, aspect) {
    const t = now / 1000;
    const c = this.camera;
    const a = t * 0.05 + 0.6;
    c.pos = [Math.sin(a) * 30, 17, Math.cos(a) * 26];
    c.dispYaw = Math.atan2(c.pos[0], c.pos[2]);
    c.dispPitch = -0.48;
    c.dispRoll = 0;
    c.vFov = 52 * DEG;
    compose(c.world, c.pos[0], c.pos[1], c.pos[2], c.dispPitch, c.dispYaw, 0);
    invertRigid(c.view, c.world);
    perspective(c.proj, c.vFov, aspect, 0.1, 300);
    multiply(c.viewProj, c.proj, c.view);
    invert(c.invViewProj, c.viewProj);
    c.vmViewProj.set(c.viewProj); // copy: never alias the two matrices
  }

  updatePerf(cpuMs, t) {
    const P = this.perf;
    P.acc += cpuMs;
    P.n++;
    if (t - P.t > 500) {
      P.fps = Math.round((P.n * 1000) / (t - P.t));
      P.frameMs = (P.acc / P.n).toFixed(2);
      P.acc = 0;
      P.n = 0;
      P.t = t;
    }
  }

  perfStats() {
    const r = this.renderer.stats;
    return {
      fps: this.perf.fps,
      frameMs: this.perf.frameMs,
      draws: r.drawCalls,
      tris: (r.triangles / 1000).toFixed(1),
      cull: `${r.chunksVisible}/${r.chunksTotal}`,
      tick: TICK_RATE,
      rtt: Math.round(this.rtt),
      err: (this.predictor.stats.lastError * 1000).toFixed(1),
      audio: Math.round(this.audio.latencyMs),
    };
  }
}

function segmentDistance(a, b, p) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1], a[2] + dz * t - p[2]);
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

