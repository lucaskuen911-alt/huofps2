// Raw input capture. Mouse deltas are accumulated from every pointermove event (including
// coalesced events) and consumed once per frame, so view rotation is applied on the very
// frame the input arrives. Button presses are LATCHED until the next command is built: a tap
// shorter than one tick (7.8 ms) still produces a shot.

import { BTN } from '../sim/UserCmd.js';
export const DEFAULT_BINDS = {
  KeyW: BTN.FWD,
  KeyS: BTN.BACK,
  KeyA: BTN.LEFT,
  KeyD: BTN.RIGHT,
  Space: BTN.JUMP,
  KeyV: BTN.CROUCH,
  ShiftLeft: BTN.WALK,
  KeyR: BTN.RELOAD,
  KeyY: BTN.INSPECT,
  KeyF: BTN.PLANT,
  KeyC: BTN.AB_C,
  KeyQ: BTN.AB_Q,
  KeyE: BTN.AB_E,
  KeyX: BTN.AB_X,
};

export const WEAPON_KEYS = { Digit1: 'halberd', Digit2: 'hornet', Digit3: 'wren', Digit4: 'longbow' };

export class Input {
  constructor(target) {
    this.target = target;
    this.binds = { ...DEFAULT_BINDS };
    this.held = 0;
    this.latched = 0;
    this.dx = 0;
    this.dy = 0;
    this.weaponRequest = null;
    this.wheel = 0;
    this.locked = false;
    this.freeLook = false; // fallback when pointer lock is refused
    this.keyboardLocked = false;
    this.onUnlock = null;
    this.onKey = null;
    this.lastLockRequest = 0;
    this.lockWorked = false; // once raw lock has succeeded, never degrade to free-look
    this.onFreeLook = null;
    this.px = innerWidth / 2;
    this.py = innerHeight / 2;
    this.lastConsume = performance.now();

    const down = (bit) => {
      this.held |= bit;
      this.latched |= bit;
    };
    const up = (bit) => {
      this.held &= ~bit;
    };

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (this.onKey && this.onKey(e)) return;
      const bit = this.binds[e.code] || (this.keyboardLocked && e.code === 'ControlLeft' ? BTN.CROUCH : 0);
      if (bit) {
        down(bit);
        e.preventDefault();
      }
      if (WEAPON_KEYS[e.code]) {
        this.weaponRequest = WEAPON_KEYS[e.code];
        e.preventDefault();
      }
      if (e.code === 'Tab' || (e.ctrlKey && e.code !== 'ControlLeft')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const bit = this.binds[e.code] || (e.code === 'ControlLeft' ? BTN.CROUCH : 0);
      if (bit) up(bit);
    });
    window.addEventListener('blur', () => {
      this.held = 0;
    });

    target.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) down(BTN.FIRE);
      if (e.button === 2) down(BTN.ADS);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) up(BTN.FIRE);
      if (e.button === 2) up(BTN.ADS);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    const move = (e) => {
      if (e.clientX !== undefined) { this.px = e.clientX; this.py = e.clientY; }
      if (!this.active) return;
      // Coalesced events give every hardware sample delivered since the last frame.
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (list && list.length) {
        for (const c of list) this.addDelta(c.movementX, c.movementY);
      } else this.addDelta(e.movementX, e.movementY);
    };
    // Listen on the window: HUD overlays sit above the canvas and an unlocked cursor can be
    // over any of them.
    if ('onpointerrawupdate' in window) window.addEventListener('pointerrawupdate', move);
    else window.addEventListener('pointermove', move);
    // An unlocked cursor that leaves the frame never delivers mouseup: release the trigger.
    document.addEventListener('pointerleave', () => {
      if (this.freeLook) this.held &= ~(BTN.FIRE | BTN.ADS);
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === target;
      if (this.locked) {
        this.lockWorked = true;
        this.setFreeLook(false);
      }
      if (was && !this.locked) {
        this.held = 0;
        if (this.onUnlock) this.onUnlock();
      }
    });
  }

  get active() {
    return this.locked || this.freeLook;
  }

  addDelta(x, y) {
    // Chromium occasionally reports a huge spike when the lock engages; drop it.
    if (Math.abs(x) > 600 || Math.abs(y) > 600) return;
    this.dx += x;
    this.dy += y;
  }

  /**
   * Request pointer lock; resolves true only once the pointer is actually locked. Embedded
   * frames (sandboxed iframes, some app views) refuse the lock silently, by throwing, or by
   * firing pointerlockerror; any of those with no lock ever achieved switches to free-look.
   */
  async lock() {
    const t = this.target;
    this.lastLockRequest = performance.now();
    if (document.pointerLockElement === t) return true;
    const settled = new Promise((resolve) => {
      const done = (ok) => {
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => { if (document.pointerLockElement === t) done(true); };
      const onError = () => done(false);
      const timer = setTimeout(() => done(document.pointerLockElement === t), 900);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
    });
    const attempt = (opts) => {
      try {
        const r = opts ? t.requestPointerLock(opts) : t.requestPointerLock();
        return r && r.then ? r.then(() => true, () => false) : Promise.resolve(true);
      } catch (e) {
        return Promise.resolve(false);
      }
    };
    if (!t.requestPointerLock) {
      this.setFreeLook(true);
      return false;
    }
    let ok = await attempt({ unadjustedMovement: true });
    if (!ok) ok = await attempt(null);
    const locked = ok ? await settled : document.pointerLockElement === t;
    if (!locked) {
      // Browsers refuse a re-lock for ~1 s after Esc. Only fall back to free-look when
      // pointer lock has never worked here (e.g. a frame that forbids it).
      if (!this.lockWorked) this.setFreeLook(true);
      return false;
    }
    this.lockWorked = true;
    // Keyboard lock (fullscreen only) lets Ctrl act as crouch without browser shortcuts.
    try {
      if (navigator.keyboard && navigator.keyboard.lock && document.fullscreenElement) {
        await navigator.keyboard.lock(['ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']);
        this.keyboardLocked = true;
      }
    } catch (e) {
      this.keyboardLocked = false;
    }
    return true;
  }

  /**
   * Free-look: the cursor is hidden and its motion turns the view as if locked. A cursor
   * cannot travel past the frame edge, so holding it in the outer band keeps turning
   * (edge-pan), which gives continuous 360-degree turning without pointer lock.
   */
  setFreeLook(on) {
    if (this.freeLook === on) return;
    this.freeLook = on;
    document.documentElement.classList.toggle('freelook', on);
    if (this.onFreeLook) this.onFreeLook(on);
  }

  edgePan(dt) {
    if (!this.freeLook || this.locked) return [0, 0];
    const w = innerWidth, h = innerHeight;
    const band = Math.max(24, Math.min(w, h) * 0.07);
    const axis = (p, size) => {
      if (p < band) return -(band - Math.max(0, p)) / band;
      if (p > size - band) return (Math.min(size, p) - (size - band)) / band;
      return 0;
    };
    // Up to ~1400 px/s of virtual mouse travel at the very edge (about 1.5 turns/s at
    // default sensitivity); quadratic so the band's inner part is a gentle nudge.
    const ax = axis(this.px, w), ay = axis(this.py, h);
    const rate = 1400 * dt;
    return [Math.sign(ax) * ax * ax * rate, Math.sign(ay) * ay * ay * rate * 0.6];
  }

  unlock() {
    this.setFreeLook(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.held = 0;
  }

  consumeMouse() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastConsume) / 1000);
    this.lastConsume = now;
    const e = this.edgePan(dt);
    const d = [this.dx + e[0], this.dy + e[1]];
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  /** Buttons for the next command: held state OR anything pressed since the last command. */
  consumeButtons() {
    const b = this.held | this.latched;
    this.latched = 0;
    return b;
  }

  consumeWeaponRequest() {
    const w = this.weaponRequest;
    this.weaponRequest = null;
    return w;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
