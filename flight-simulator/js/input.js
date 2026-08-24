/*
 * input.js — maps keyboard, gamepad and mouse into normalised control demands
 * and drives the flight model's control surfaces with realistic behaviour:
 *   - Primary controls (elevator/aileron/rudder) spring back toward centre
 *     when released, like a real yoke/pedals, but move progressively while held.
 *   - Throttle, flaps and trim are "sticky" — they hold their position.
 */

'use strict';

class InputController {
  constructor(model) {
    this.model = model;
    this.keys = {};
    this.useMouse = false;
    this.mouse = { x: 0, y: 0, active: false };

    // Rates at which held controls move and self-centre (per second).
    this.rate = { pitch: 1.6, roll: 2.2, yaw: 2.0 };
    this.center = { pitch: 2.2, roll: 3.0, yaw: 3.0 };

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, down) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Prevent the page from scrolling on arrows/space.
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)
    ) {
      e.preventDefault();
    }
    this.keys[k] = down;

    if (!down) return;
    const c = this.model.controls;
    // One-shot (edge-triggered) actions.
    switch (k) {
      case 'f': // flaps down one notch
        c.flaps = Math.min(this.model.def.flapSettings.length - 1, c.flaps + 1);
        break;
      case 'g': // flaps up one notch
        c.flaps = Math.max(0, c.flaps - 1);
        break;
      case 'b': // toggle wheel brakes (held elsewhere too)
        break;
      case 'p': // parking brake toggle
        c.parkingBrake = !c.parkingBrake;
        break;
      case 'x': // cut throttle to idle
        c.throttle = 0;
        break;
      case 'z': // full throttle
        c.throttle = 1;
        break;
      case 'm': // toggle mouse-as-yoke
        this.useMouse = !this.useMouse;
        break;
      default:
        break;
    }
  }

  attachMouse(canvas) {
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      this.mouse.active = true;
    });
    canvas.addEventListener('mouseleave', () => (this.mouse.active = false));
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this._mouseBrake = true;
    });
    canvas.addEventListener('mouseup', () => (this._mouseBrake = false));
    window.addEventListener('blur', () => {
      this.keys = {};
      this._mouseBrake = false;
    });
  }

  _held(...names) {
    return names.some((n) => this.keys[n]);
  }

  update(dt) {
    const c = this.model.controls;
    const k = this.keys;

    // ---- Throttle (sticky) ----
    if (this._held('Shift', '=', '+')) c.throttle += 0.6 * dt;
    if (this._held('Control', '-', '_')) c.throttle -= 0.6 * dt;
    c.throttle = Math.max(0, Math.min(1, c.throttle));

    // ---- Trim (sticky) ----
    if (this._held('[')) c.trim += 0.25 * dt; // nose up trim
    if (this._held(']')) c.trim -= 0.25 * dt; // nose down trim
    c.trim = Math.max(-0.6, Math.min(0.6, c.trim));

    // ---- Brakes (held while 'b' or the mouse button is down) ----
    c.brakes = this._held('b') || this._mouseBrake === true;

    // ---- Primary flight controls ----
    if (this.useMouse && this.mouse.active) {
      // Mouse acts like a self-centring yoke.
      c.elevator = -this.mouse.y; // up on screen = nose down demand? invert:
      c.elevator = this._clip(-this.mouse.y);
      c.aileron = this._clip(this.mouse.x);
    } else {
      this._axis('elevator', this._held('ArrowUp', 'w') ? 1 : 0, this._held('ArrowDown', 's') ? 1 : 0, 'pitch', dt);
      this._axis('aileron', this._held('ArrowRight', 'd') ? 1 : 0, this._held('ArrowLeft', 'a') ? 1 : 0, 'roll', dt);
    }
    // Rudder is always on the keyboard pedals.
    this._axis('rudder', this._held('e') ? 1 : 0, this._held('q') ? 1 : 0, 'yaw', dt);

    // ---- Gamepad (if present) overrides while sticks are deflected ----
    this._gamepad(c);
  }

  _axis(name, pos, neg, kind, dt) {
    const c = this.model.controls;
    let val = c[name];
    const demand = pos - neg;
    if (demand !== 0) {
      val += demand * this.rate[kind] * dt;
    } else {
      // Spring back to centre.
      const s = this.center[kind] * dt;
      if (val > 0) val = Math.max(0, val - s);
      else if (val < 0) val = Math.min(0, val + s);
    }
    c[name] = this._clip(val);
  }

  _clip(v) {
    return Math.max(-1, Math.min(1, v));
  }

  _gamepad(c) {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const gp = pads && pads[0];
    if (!gp) return;
    const dz = (x) => (Math.abs(x) < 0.08 ? 0 : x);
    // Typical mapping: left stick = aileron/elevator, triggers = throttle,
    // shoulder/right stick x = rudder.
    const ax = gp.axes;
    if (ax.length >= 2) {
      c.aileron = this._clip(dz(ax[0]));
      c.elevator = this._clip(-dz(ax[1]));
    }
    if (ax.length >= 4) c.rudder = this._clip(dz(ax[2]));
    // Right trigger throttle up (button 7), left trigger down (button 6).
    if (gp.buttons.length > 7) {
      const up = gp.buttons[7].value || 0;
      const down = gp.buttons[6].value || 0;
      if (up || down) c.throttle = this._clip01(c.throttle + (up - down) * 0.02);
    }
  }

  _clip01(v) {
    return Math.max(0, Math.min(1, v));
  }
}

if (typeof window !== 'undefined') window.InputController = InputController;
