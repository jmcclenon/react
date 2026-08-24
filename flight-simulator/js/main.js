/*
 * main.js — ties the flight model, input, world view and instruments together,
 * runs a fixed-timestep simulation loop, and layers on the training features:
 * selectable scenarios, a live objective tracker, an instructor tip feed, a
 * stall-warning horn and a heads-up readout.
 */

'use strict';

(function () {
  const { KT_PER_MS } = window.FlightConst;

  // --- DOM ---
  const worldCanvas = document.getElementById('world');
  const panelCanvas = document.getElementById('panel');
  const hud = document.getElementById('hud');
  const objText = document.getElementById('objective-text');
  const objTitle = document.getElementById('objective-title');
  const tipEl = document.getElementById('instructor-tip');
  const scenarioSel = document.getElementById('scenario');
  const pauseBtn = document.getElementById('pause');
  const resetBtn = document.getElementById('reset');
  const soundBtn = document.getElementById('sound');
  const statusEl = document.getElementById('status');

  // --- Core objects ---
  const model = new window.FlightModel(window.AircraftDefs.C172);
  const input = new window.InputController(model);
  const world = new window.WorldRenderer(worldCanvas, model);
  const panel = new window.InstrumentPanel(panelCanvas, model);
  input.attachMouse(worldCanvas);

  // ---------------------------------------------------------------------------
  // Training scenarios. Each sets up the aircraft and defines an objective the
  // student works toward, with live evaluation and instructor guidance.
  // ---------------------------------------------------------------------------
  const scenarios = {
    takeoff: {
      title: 'Lesson 1 — Takeoff & Climb',
      brief:
        'Hold the centreline with rudder, apply full power (Z), rotate gently at ~55 kt, ' +
        'and establish a steady climb at 75–85 kt to 1,000 ft.',
      setup: () => model.reset({ altitude: 0, speed: 0, heading: 0, parkingBrake: false }),
      objective: (m) => {
        if (m.altitudeFt < 50) return { done: false, msg: 'Roll out, full power, rotate at ~55 kt.' };
        if (m.altitudeFt < 1000)
          return {
            done: false,
            msg: `Climbing — hold 75–85 kt (now ${Math.round(m.iasKt)} kt). ${Math.round(m.altitudeFt)} ft.`,
          };
        return { done: true, msg: 'Reached 1,000 ft AGL. Nicely flown!' };
      },
      tips: (m) => {
        if (m.onGround && m.iasKt < 40) return 'Add full power with Z and keep straight with rudder (Q/E).';
        if (m.onGround && m.iasKt >= 50) return 'Ease back on the elevator (S / ↓) to rotate.';
        if (!m.onGround && m.iasKt > 90) return 'Too fast for the climb — raise the nose a little.';
        if (!m.onGround && m.iasKt < 70) return 'Watch your speed — lower the nose slightly to keep 75–85 kt.';
        return 'Good climb. Trim off the pressure with [ if the nose is heavy.';
      },
    },

    level: {
      title: 'Lesson 2 — Straight & Level',
      brief:
        'Maintain heading 360°, altitude 2,500 ft (±100 ft) and 100 kt for 20 seconds. ' +
        'Use small control inputs and trim to hold hands-off.',
      setup: () => model.reset({ altitude: 2500 / 3.28084, speed: 52, heading: 0, pitch: 0.03, throttle: 0.6 }),
      state: { timer: 0 },
      objective: (m, s) => {
        const altOk = Math.abs(m.altitudeFt - 2500) < 100;
        const hdgOk = Math.min(Math.abs(m.headingDeg - 360), m.headingDeg) < 10;
        const spdOk = Math.abs(m.iasKt - 100) < 12;
        if (altOk && hdgOk && spdOk) s.timer += 1 / 60;
        else s.timer = Math.max(0, s.timer - 0.5 / 60);
        if (s.timer >= 20) return { done: true, msg: 'Stable cruise held for 20 s. Well done!' };
        return {
          done: false,
          msg: `Alt ${Math.round(m.altitudeFt)}ft ${altOk ? '✓' : '✗'} · Hdg ${Math.round(m.headingDeg)}° ${hdgOk ? '✓' : '✗'} · ${Math.round(m.iasKt)}kt ${spdOk ? '✓' : '✗'} · hold ${s.timer.toFixed(0)}/20s`,
        };
      },
      tips: (m) => {
        if (m.altitudeFt > 2650) return 'Descending needed — reduce a touch of power or lower the nose.';
        if (m.altitudeFt < 2350) return 'Add a little power / raise the nose to regain altitude.';
        if (Math.abs(m.rollDeg) > 6) return 'Level the wings with aileron to stop the heading drifting.';
        return 'Trim ([ / ]) so you can fly with fingertip pressure.';
      },
    },

    turns: {
      title: 'Lesson 3 — Coordinated Turns',
      brief:
        'Roll into a 30° banked turn and keep the slip/skid ball centred with rudder. ' +
        'Complete a 360° turn back to your start heading.',
      setup: () => model.reset({ altitude: 3000 / 3.28084, speed: 53, heading: 0, pitch: 0.03, throttle: 0.65 }),
      state: { start: null, accum: 0, last: null },
      objective: (m, s) => {
        if (s.start === null) {
          s.start = m.headingDeg;
          s.last = m.headingDeg;
          s.accum = 0;
        }
        let d = m.headingDeg - s.last;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        s.accum += d;
        s.last = m.headingDeg;
        const ballCentered = Math.abs(m.slipBall) < 0.08;
        const banked = Math.abs(m.rollDeg) > 15;
        if (Math.abs(s.accum) >= 350) return { done: true, msg: 'Full 360° turn complete!' };
        return {
          done: false,
          msg: `Turned ${Math.abs(s.accum).toFixed(0)}° / 360°. Bank ${Math.round(m.rollDeg)}° · ball ${ballCentered ? 'centred ✓' : (m.slipBall > 0 ? 'right — add right rudder' : 'left — add left rudder')}`,
        };
      },
      tips: (m) => {
        if (Math.abs(m.rollDeg) < 15) return 'Roll to about 30° of bank with aileron (A/D or ←/→).';
        if (m.slipBall > 0.1) return 'Skidding — "step on the ball": add right rudder (E).';
        if (m.slipBall < -0.1) return 'Slipping — add left rudder (Q).';
        if (m.altitudeFt < 2800) return 'Losing altitude in the turn — add a little back pressure.';
        return 'Nicely coordinated. Keep the ball centred.';
      },
    },

    stall: {
      title: 'Lesson 4 — Stall Recognition & Recovery',
      brief:
        'Reduce power, raise the nose and let the aircraft slow until it stalls. ' +
        'Recover promptly: lower the nose to reduce angle of attack, add full power, ' +
        'then climb away. Regain 90 kt.',
      setup: () => model.reset({ altitude: 4000 / 3.28084, speed: 55, heading: 0, pitch: 0.03, throttle: 0.55 }),
      state: { stalled: false },
      objective: (m, s) => {
        if (m.stall) s.stalled = true;
        if (!s.stalled) return { done: false, msg: 'Slow down (idle power, nose up) until the stall warning sounds.' };
        if (m.stall) return { done: false, msg: 'STALL — lower the nose and add full power to recover.' };
        if (m.iasKt < 90) return { done: false, msg: `Recovering — build speed to 90 kt (now ${Math.round(m.iasKt)} kt).` };
        return { done: true, msg: 'Clean recovery with minimal height loss. Excellent.' };
      },
      tips: (m) => {
        if (!m.stall && m.iasKt > 60) return 'Bring the throttle to idle (X) and gently raise the nose.';
        if (m.stall) return 'Break the stall: push the nose DOWN (S / ↓) and add full power (Z).';
        return 'Recovering well — level off once you reach 90 kt.';
      },
    },

    landing: {
      title: 'Lesson 5 — Approach & Landing',
      brief:
        'You are on final for Runway 36. Add flaps (F), aim for the numbers at ~65 kt on a ' +
        '~3° glidepath, flare gently and touch down softly on the centreline.',
      setup: () =>
        model.reset({ altitude: 700 / 3.28084, speed: 33, heading: 0, pitch: -0.02 }),
      setupExtra: () => {
        // Position ~2 km south of the threshold, descending toward it.
        model.pos[0] = -2000;
        model.pos[1] = 0;
        model.vel = [33, 0, 2.0];
        model.controls.throttle = 0.35;
        model.controls.flaps = 2;
      },
      objective: (m) => {
        if (m.onGround && !m.crashed && m.groundSpeedKt < 5)
          return { done: true, msg: 'Touchdown and rollout complete. Great landing!' };
        if (m.crashed) return { done: false, msg: 'Hard arrival — press Reset and try a gentler flare.' };
        if (m.onGround) return { done: false, msg: 'On the ground — brake (B) and hold the centreline.' };
        const dist = -model.pos[0];
        return {
          done: false,
          msg: `On final: ${Math.round(m.altitudeFt)} ft, ${Math.round(m.iasKt)} kt, ${(dist / 1000).toFixed(1)} km out. Aim 65 kt.`,
        };
      },
      tips: (m) => {
        if (m.altitudeFt > 400) return 'Set flaps (F) and pitch for ~65 kt; use power to control your descent rate.';
        if (m.iasKt > 75) return 'A little fast — reduce power and raise the nose slightly.';
        if (m.altitudeFt < 40 && m.vsFpm < -300) return 'Begin the flare: ease back to arrest the descent.';
        if (m.altitudeFt < 15) return 'Hold it off — keep raising the nose gently until it settles.';
        return 'Keep it on the centreline with rudder; small corrections.';
      },
    },

    free: {
      title: 'Free Flight',
      brief:
        'Airborne at 3,500 ft and 100 kt — explore the controls, practise anything you like. ' +
        'There are no objectives here.',
      setup: () => model.reset({ altitude: 3500 / 3.28084, speed: 53, heading: 0, pitch: 0.03, throttle: 0.6 }),
      objective: () => ({ done: false, msg: 'Free flight — fly the aircraft and enjoy.' }),
      tips: () => 'Try slow flight, steep turns, or set up your own approach to Runway 36.',
    },
  };

  let currentKey = 'takeoff';
  let current = scenarios[currentKey];
  let paused = false;
  let completed = false;

  // Fresh mutable state for scenarios that track progress over time.
  const freshState = {
    level: () => ({ timer: 0 }),
    turns: () => ({ start: null, accum: 0, last: null }),
    stall: () => ({ stalled: false }),
  };

  function loadScenario(key) {
    currentKey = key;
    current = scenarios[key];
    if (freshState[key]) current.state = freshState[key]();
    current.setup();
    if (current.setupExtra) current.setupExtra();
    completed = false;
    objTitle.textContent = current.title;
    tipEl.textContent = '';
    statusEl.textContent = '';
    statusEl.className = 'status';
  }

  // ---------------------------------------------------------------------------
  // Audio — stall horn + a simple engine drone that tracks RPM.
  // ---------------------------------------------------------------------------
  const audio = {
    ctx: null,
    enabled: false,
    engine: null,
    engineGain: null,
    horn: null,
    hornGain: null,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // Engine drone
      this.engine = this.ctx.createOscillator();
      this.engine.type = 'sawtooth';
      this.engine.frequency.value = 60;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engine.connect(this.engineGain).connect(this.ctx.destination);
      this.engine.start();
      // Stall horn
      this.horn = this.ctx.createOscillator();
      this.horn.type = 'square';
      this.horn.frequency.value = 800;
      this.hornGain = this.ctx.createGain();
      this.hornGain.gain.value = 0;
      this.horn.connect(this.hornGain).connect(this.ctx.destination);
      this.horn.start();
    },
    toggle() {
      this.init();
      if (!this.ctx) return false;
      this.enabled = !this.enabled;
      if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
      return this.enabled;
    },
    update(m) {
      if (!this.enabled || !this.ctx) return;
      const rpmFrac = (m.rpm - 700) / (2700 - 700);
      this.engine.frequency.setTargetAtTime(55 + rpmFrac * 90, this.ctx.currentTime, 0.1);
      this.engineGain.gain.setTargetAtTime(0.02 + rpmFrac * 0.05, this.ctx.currentTime, 0.1);
      // Stall horn near the stall (a touch before it fully breaks).
      const nearStall = m.stall || (m.airspeed > 0 && m.iasKt < m.stallSpeed() * KT_PER_MS + 6 && !m.onGround);
      this.hornGain.gain.setTargetAtTime(nearStall ? 0.06 : 0, this.ctx.currentTime, 0.02);
    },
  };

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  function updateHUD() {
    const m = model;
    const stallCls = m.stall ? 'warn' : '';
    const gCls = m.loadFactor > 3.8 || m.loadFactor < -1.5 ? 'warn' : '';
    hud.innerHTML = `
      <div class="hud-row"><span>IAS</span><b>${Math.round(m.iasKt)}</b> kt</div>
      <div class="hud-row"><span>ALT</span><b>${Math.round(m.altitudeFt)}</b> ft</div>
      <div class="hud-row"><span>HDG</span><b>${Math.round(m.headingDeg).toString().padStart(3, '0')}</b>°</div>
      <div class="hud-row"><span>V/S</span><b>${Math.round(m.vsFpm / 10) * 10}</b> fpm</div>
      <div class="hud-row"><span>PWR</span><b>${Math.round(m.controls.throttle * 100)}</b>%</div>
      <div class="hud-row"><span>FLAP</span><b>${m.flapDeg}</b>°</div>
      <div class="hud-row ${gCls}"><span>G</span><b>${m.loadFactor.toFixed(1)}</b></div>
      <div class="hud-row ${stallCls}">${m.stall ? '⚠ STALL' : (m.onGround ? 'ON GROUND' : 'AIRBORNE')}</div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Simulation loop — fixed timestep with accumulator for stable physics.
  // ---------------------------------------------------------------------------
  const DT = 1 / 120;
  let acc = 0;
  let last = performance.now();
  let tipTimer = 0;

  function frame(now) {
    let dtReal = (now - last) / 1000;
    last = now;
    if (dtReal > 0.1) dtReal = 0.1; // avoid spiral of death after a tab switch

    if (!paused) {
      acc += dtReal;
      let steps = 0;
      while (acc >= DT && steps < 12) {
        input.update(DT);
        model.step(DT);
        acc -= DT;
        steps++;
      }

      // Evaluate objective.
      const res = current.objective(model, current.state || {});
      objText.textContent = res.msg;
      if (res.done && !completed) {
        completed = true;
        statusEl.textContent = '✓ Objective complete — ' + res.msg;
        statusEl.className = 'status ok';
      }
      if (model.crashed) {
        statusEl.textContent = '✗ Crash — press Reset to try again.';
        statusEl.className = 'status bad';
      }

      // Instructor tips, refreshed a few times a second.
      tipTimer += dtReal;
      if (tipTimer > 0.5) {
        tipTimer = 0;
        tipEl.textContent = '👨‍✈️ ' + current.tips(model);
      }
    }

    world.render();
    panel.render();
    updateHUD();
    audio.update(model);
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function resizeAll() {
    world.resize();
    panel.resize();
  }
  window.addEventListener('resize', resizeAll);

  // Populate scenario selector.
  for (const [key, s] of Object.entries(scenarios)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = s.title;
    scenarioSel.appendChild(opt);
  }
  scenarioSel.value = currentKey;
  scenarioSel.addEventListener('change', () => loadScenario(scenarioSel.value));

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  });
  resetBtn.addEventListener('click', () => loadScenario(currentKey));
  soundBtn.addEventListener('click', () => {
    const on = audio.toggle();
    soundBtn.textContent = on ? '🔊 Sound On' : '🔈 Sound Off';
  });

  // Keyboard: R resets, space pauses (when not typing in a control).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') loadScenario(currentKey);
    if (e.key === ' ') {
      paused = !paused;
      pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    }
    // Enable audio on first interaction.
    if (!audio.ctx) audio.init();
  });

  // Boot.
  resizeAll();
  loadScenario(currentKey);
  requestAnimationFrame(frame);
})();
