/*
 * physics.js — 6-DOF flight dynamics model for a light single-engine aircraft.
 *
 * The model is a physically-motivated point-mass + rigid-body simulation using
 * classic aerodynamic stability derivatives, tuned to feel like a Cessna 172.
 * It is not a certified engineering model, but it reproduces the behaviour a
 * student pilot needs to learn: angle-of-attack driven lift, stall, adverse
 * yaw, the need for coordinated rudder in turns, trim, flap effects, ground
 * roll and a believable relationship between pitch, power, airspeed and
 * altitude.
 *
 * Reference frames
 * ----------------
 *  World: North-East-Down (NED). x = north, y = east, z = down.
 *         Altitude = -z. Gravity acts along +z.
 *  Body:  x = forward (out the nose), y = right wing, z = down (belly).
 *
 * Euler angles: phi (roll, right wing down +), theta (pitch, nose up +),
 *               psi (yaw / heading, clockwise from north +).
 */

'use strict';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const KT_PER_MS = 1.94384; // knots per metre/second
const FT_PER_M = 3.28084;
const FPM_PER_MS = 196.850394; // feet-per-minute per metre/second

// ---------------------------------------------------------------------------
// Aircraft definition — Cessna 172 Skyhawk class parameters (SI units).
// ---------------------------------------------------------------------------
const C172 = {
  name: 'Cessna 172 Skyhawk',
  mass: 1043, // kg (typical loaded weight)
  g: 9.81,

  // Geometry
  wingArea: 16.2, // m^2
  wingSpan: 11.0, // m
  chord: 1.49, // m (mean aerodynamic chord)
  get aspectRatio() {
    return (this.wingSpan * this.wingSpan) / this.wingArea;
  },

  // Moments of inertia (kg m^2)
  Ixx: 1285,
  Iyy: 1825,
  Izz: 2667,

  // Longitudinal (lift / pitch) coefficients
  CL0: 0.31, // lift at zero AoA
  CLa: 5.143, // per rad
  CLq: 3.9,
  CLde: 0.43, // elevator lift effectiveness
  CLmax: 1.6, // clean stall
  alphaStall: 16 * DEG, // clean stall angle of attack

  // Drag
  CD0: 0.031,
  oswald: 0.75,

  // Pitch moment
  Cm0: 0.04,
  Cma: -1.4, // static stability (negative = stable; strong so the trim AoA
  // for a given elevator stays realistic)
  Cmq: -12.4, // pitch damping
  Cmde: -0.55, // elevator authority (full aft ~ high-AoA / stall, not absurd)

  // Side force
  CYb: -0.31,
  CYdr: 0.187,

  // Roll moment
  Clb: -0.092, // dihedral effect (roll away from sideslip — stabilising)
  Clp: -0.52, // roll damping
  Clr: 0.045, // roll due to yaw rate (kept small to tame overbank/spiral)
  Clda: 0.15, // aileron authority
  Cldr: 0.012,

  // Yaw moment
  Cnb: 0.085, // weathervane / directional stability (docile trainer)
  Cnp: -0.03,
  Cnr: -0.17, // yaw damping (strong, prevents dutch-roll/spiral divergence)
  Cnda: -0.04, // adverse yaw from ailerons
  Cndr: -0.045, // rudder authority

  // Propulsion
  maxThrust: 3400, // N static thrust at full power, sea level
  idleThrust: 90, // N residual thrust at idle
  maxRPM: 2700,
  idleRPM: 700,

  // Flaps: [deflection deg, dCL0, dCDflap, dAlphaStall(rad), dCm]
  flapSettings: [
    { deg: 0, dCL: 0.0, dCD: 0.0, dStall: 0.0, dCm: 0.0 },
    { deg: 10, dCL: 0.35, dCD: 0.007, dStall: -1.0 * DEG, dCm: -0.05 },
    { deg: 20, dCL: 0.6, dCD: 0.02, dStall: -2.0 * DEG, dCm: -0.08 },
    { deg: 30, dCL: 0.85, dCD: 0.045, dStall: -3.0 * DEG, dCm: -0.1 },
  ],

  // Landing gear / ground
  gearHeight: 1.8, // m from CG to wheels when level
  wheelBase: 2.5,
  rollingResistance: 0.03,
  brakeResistance: 0.35,
  maxTireSideForce: 9000, // N before the tires skid sideways
};

// ---------------------------------------------------------------------------
// Small vector / rotation helpers
// ---------------------------------------------------------------------------
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// Rotation matrix from body to world (NED) for Z-Y-X (yaw-pitch-roll) Euler.
function bodyToWorldMatrix(phi, theta, psi) {
  const cphi = Math.cos(phi), sphi = Math.sin(phi);
  const cth = Math.cos(theta), sth = Math.sin(theta);
  const cpsi = Math.cos(psi), spsi = Math.sin(psi);
  return [
    [cth * cpsi, sphi * sth * cpsi - cphi * spsi, cphi * sth * cpsi + sphi * spsi],
    [cth * spsi, sphi * sth * spsi + cphi * cpsi, cphi * sth * spsi - sphi * cpsi],
    [-sth, sphi * cth, cphi * cth],
  ];
}

function matTvec(m, v) {
  // transpose(m) * v  (world -> body)
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

function matVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// Air density with a simple ISA-lite lapse (good enough to feel altitude).
function airDensity(altitudeM) {
  const rho0 = 1.225;
  return rho0 * Math.exp(-altitudeM / 8500);
}

// ---------------------------------------------------------------------------
// FlightModel
// ---------------------------------------------------------------------------
class FlightModel {
  constructor(def = C172) {
    this.def = def;
    this.reset();
  }

  reset(opts = {}) {
    const d = this.def;
    // World position in NED metres. Down is negative altitude.
    this.pos = [0, 0, -(opts.altitude != null ? opts.altitude : 0)];
    // World velocity NED.
    const spd = opts.speed != null ? opts.speed : 0;
    this.vel = [spd, 0, 0];
    // Attitude.
    this.phi = 0;
    this.theta = opts.pitch != null ? opts.pitch : 0;
    this.psi = opts.heading != null ? opts.heading : 0;
    // Body angular rates (rad/s): p roll, q pitch, r yaw.
    this.p = 0;
    this.q = 0;
    this.r = 0;

    // Controls, all normalised.
    this.controls = {
      elevator: 0, // -1 (nose down) .. +1 (nose up)
      aileron: 0, // -1 (left) .. +1 (right)
      rudder: 0, // -1 (left) .. +1 (right)
      throttle: opts.throttle != null ? opts.throttle : 0, // 0 .. 1
      trim: 0, // -1 .. +1 elevator trim
      flaps: 0, // index into flapSettings
      brakes: false,
      parkingBrake: opts.parkingBrake || false,
    };

    // Derived state exposed for instruments (filled by step()).
    this.airspeed = spd; // m/s true airspeed
    this.alpha = 0;
    this.beta = 0;
    this.loadFactor = 1;
    this.verticalSpeed = 0;
    this.rpm = d.idleRPM;
    this.onGround = this.altitude <= 0.5;
    this.stall = false;
    this.crashed = false;
    this.hardLanding = false;
    this.impactSink = null;
    this.impactRoll = 0;
    this.impactPitch = 0;
    this.slipBall = 0; // lateral g (skid/slip indicator), + = right
    this.thrust = 0;
    this.time = 0;
  }

  get altitude() {
    return -this.pos[2];
  }
  get altitudeFt() {
    return this.altitude * FT_PER_M;
  }
  get airspeedKt() {
    return this.airspeed * KT_PER_MS;
  }
  // Indicated airspeed shrinks with density (what the ASI actually reads).
  get iasKt() {
    const rho = airDensity(this.altitude);
    return this.airspeed * Math.sqrt(rho / 1.225) * KT_PER_MS;
  }
  get headingDeg() {
    let h = this.psi * RAD;
    h = ((h % 360) + 360) % 360;
    return h;
  }
  get pitchDeg() {
    return this.theta * RAD;
  }
  get rollDeg() {
    return this.phi * RAD;
  }
  get vsFpm() {
    return this.verticalSpeed * FPM_PER_MS;
  }
  get groundSpeedKt() {
    return Math.hypot(this.vel[0], this.vel[1]) * KT_PER_MS;
  }
  get flapDeg() {
    return this.def.flapSettings[this.controls.flaps].deg;
  }

  // Integrate one physics step. dt in seconds. wind is optional NED vector.
  step(dt, wind = [0, 0, 0]) {
    if (this.crashed) return;
    const d = this.def;
    const c = this.controls;

    const R = bodyToWorldMatrix(this.phi, this.theta, this.psi);

    // Air-relative velocity in world, then body frame.
    const va = [this.vel[0] - wind[0], this.vel[1] - wind[1], this.vel[2] - wind[2]];
    const vb = matTvec(R, va); // [u, v, w]
    const u = vb[0], v = vb[1], w = vb[2];
    const V = Math.hypot(u, v, w);
    this.airspeed = V;

    // Angle of attack and sideslip.
    const alpha = Math.abs(u) < 1e-3 && Math.abs(w) < 1e-3 ? 0 : Math.atan2(w, u);
    const beta = V < 1e-3 ? 0 : Math.asin(clamp(v / V, -1, 1));
    this.alpha = alpha;
    this.beta = beta;

    const rho = airDensity(this.altitude);
    const qbar = 0.5 * rho * V * V; // dynamic pressure
    const S = d.wingArea, b = d.wingSpan, chord = d.chord;

    // ---- Flaps ----
    const flap = d.flapSettings[c.flaps];

    // ---- Lift coefficient with stall model ----
    const alphaStall = d.alphaStall + flap.dStall;
    // Control convention: elevator/trim +1 = nose-up command, aileron +1 =
    // roll right, rudder +1 = yaw right. The stability derivatives below carry
    // their physical (wind-tunnel) signs, so the control terms are written to
    // turn a positive command into the intuitive positive response.
    const elevEff = clamp(c.elevator + c.trim, -1, 1);
    // A nose-up command momentarily off-loads the tail, so it slightly reduces
    // total lift before angle of attack builds (correct transient feel).
    let CL = d.CL0 + flap.dCL + d.CLa * alpha - d.CLde * elevEff * 0.3;
    // pitch-rate contribution
    if (V > 1) CL += d.CLq * (this.q * chord) / (2 * V);

    // Smoothly kill lift past the stall angle (both directions).
    const aAbs = Math.abs(alpha);
    if (aAbs > alphaStall) {
      const over = aAbs - alphaStall;
      const fade = Math.exp(-over / (6 * DEG)); // lose most lift within ~6deg
      CL *= 0.4 + 0.6 * fade;
      this.stall = true;
    } else {
      this.stall = false;
    }
    const CLcap = d.CLmax + flap.dCL + 0.2;
    CL = clamp(CL, -CLcap, CLcap);

    // ---- Drag ----
    const AR = d.aspectRatio;
    const k = 1 / (Math.PI * d.oswald * AR);
    let CD = d.CD0 + flap.dCD + k * CL * CL;
    // add a little extra drag deep in the stall / high beta
    CD += 0.9 * Math.pow(Math.max(0, aAbs - alphaStall) / DEG, 1.3) * 0.01;
    CD += 0.2 * beta * beta;

    // ---- Side force ----
    const CY = d.CYb * beta + d.CYdr * c.rudder;

    // Aerodynamic forces in WIND axes: drag opposes V, lift perpendicular.
    const lift = qbar * S * CL;
    const drag = qbar * S * CD;
    const side = qbar * S * CY;

    // Convert wind-axis lift/drag into body axes using alpha & beta.
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const cb = Math.cos(beta), sb = Math.sin(beta);
    // Body-frame aerodynamic force.
    const Fax = -drag * ca * cb + lift * sa - side * ca * sb;
    const Fay = -drag * sb + side * cb;
    const Faz = -drag * sa * cb - lift * ca - side * sa * sb;

    // ---- Thrust (along body x) ----
    this.rpm = d.idleRPM + (d.maxRPM - d.idleRPM) * c.throttle;
    // Thrust falls off with airspeed and density (fixed-pitch prop behaviour).
    const vFactor = clamp(1 - V / 130, 0.35, 1);
    const thrust =
      (d.idleThrust + (d.maxThrust - d.idleThrust) * c.throttle) *
      vFactor *
      (rho / 1.225);
    this.thrust = thrust;

    // ---- Gravity in body frame ----
    const gWorld = [0, 0, d.mass * d.g];
    const gBody = matTvec(R, gWorld);

    // ---- Ground reaction ----
    const wasOnGround = this.onGround;
    this.onGround = false;
    const alt = this.altitude;
    if (alt <= d.gearHeight * Math.cos(this.phi) * Math.cos(this.theta) + 0.05) {
      this.onGround = true;
    }
    // Capture the true sink rate at the instant of first contact, before the
    // ground spring arrests it — that's what a hard-landing check must judge.
    if (this.onGround && !wasOnGround) {
      this.impactSink = this.vel[2]; // +z is down, so a descent is positive
      this.impactRoll = this.rollDeg;
      this.impactPitch = this.pitchDeg;
    }

    // Ground forces are accumulated in the WORLD frame for correctness.
    let worldGround = [0, 0, 0];
    if (this.onGround) {
      const penetration = d.gearHeight - alt;
      const kN = 120000, cN = 15000;
      let N = kN * Math.max(0, penetration) + cN * Math.max(0, -this.vel[2]);
      N = Math.max(0, Math.min(N, 6 * d.mass * d.g));
      worldGround[2] -= N; // up

      // Ground friction opposes horizontal ground velocity.
      const gsE = this.vel[1];
      const gsN = this.vel[0];
      const gs = Math.hypot(gsN, gsE);
      // Rolling / braking resistance along the direction of travel.
      let mu = d.rollingResistance;
      if (c.brakes || c.parkingBrake) mu = d.brakeResistance;
      if (gs > 0.05) {
        const fFric = mu * N;
        worldGround[0] -= (gsN / gs) * fFric;
        worldGround[1] -= (gsE / gs) * fFric;
      }
      // Nosewheel/tire cornering: resist sideways body velocity so the plane
      // tracks the runway and responds to rudder steering on the ground.
      const bodyV = matTvec(R, this.vel);
      const lateral = bodyV[1];
      let sideForceBody = -clamp(lateral * 4000, -d.maxTireSideForce, d.maxTireSideForce);
      // rudder steers the nosewheel at low speed
      sideForceBody += c.rudder * N * 0.4;
      const sideWorld = matVec(R, [0, sideForceBody, 0]);
      worldGround[0] += sideWorld[0];
      worldGround[1] += sideWorld[1];
      // Keep the plane from sinking / damp vertical.
      if (this.vel[2] > 0) worldGround[2] -= this.vel[2] * cN * 0.0;
    }

    // ---- Sum forces (body frame) ----
    let Fx = Fax + thrust + gBody[0];
    let Fy = Fay + gBody[1];
    let Fz = Faz + gBody[2];

    // Body -> world acceleration, add world ground force, divide by mass.
    const Fbody = [Fx, Fy, Fz];
    const Fworld = matVec(R, Fbody);
    const accWorld = [
      (Fworld[0] + worldGround[0]) / d.mass,
      (Fworld[1] + worldGround[1]) / d.mass,
      (Fworld[2] + worldGround[2]) / d.mass,
    ];

    // ---- Moments (body frame) ----
    const twoV = 2 * Math.max(V, 1);
    const Cl =
      d.Clb * beta +
      d.Clp * (this.p * b) / twoV +
      d.Clr * (this.r * b) / twoV +
      d.Clda * c.aileron +
      d.Cldr * c.rudder;
    const Cm =
      d.Cm0 +
      d.Cma * alpha +
      d.Cmq * (this.q * chord) / twoV -
      d.Cmde * elevEff + // -Cmde (<0) so a nose-up command pitches the nose up
      flap.dCm;
    const Cn =
      d.Cnb * beta +
      d.Cnp * (this.p * b) / twoV +
      d.Cnr * (this.r * b) / twoV +
      d.Cnda * c.aileron - // adverse yaw: rolling right yaws the nose left
      d.Cndr * c.rudder; // -Cndr (<0) so right rudder yaws the nose right

    let L = qbar * S * b * Cl;
    let M = qbar * S * chord * Cm;
    let Nm = qbar * S * b * Cn;

    if (this.onGround) {
      // Damp rotational rates when wheels are planted; add gear steering yaw.
      L -= this.p * 8000;
      M -= this.q * 8000;
      Nm -= this.r * 4000;
      Nm += c.rudder * this.groundSpeedKt * 20; // taxi steering feel
    }

    // Angular accelerations (ignoring cross-coupling inertia terms for clarity,
    // adding the dominant gyroscopic coupling for realism).
    const pd = (L - (d.Izz - d.Iyy) * this.q * this.r) / d.Ixx;
    const qd = (M - (d.Ixx - d.Izz) * this.p * this.r) / d.Iyy;
    const rd = (Nm - (d.Iyy - d.Ixx) * this.p * this.q) / d.Izz;

    // ---- Integrate (semi-implicit Euler) ----
    this.p += pd * dt;
    this.q += qd * dt;
    this.r += rd * dt;

    // Euler angle rates from body rates.
    const cphi = Math.cos(this.phi), sphi = Math.sin(this.phi);
    const cth = Math.cos(this.theta);
    const tth = Math.tan(this.theta);
    const secth = 1 / (Math.abs(cth) < 1e-3 ? 1e-3 * Math.sign(cth || 1) : cth);
    const phid = this.p + (sphi * this.q + cphi * this.r) * tth;
    const thetad = cphi * this.q - sphi * this.r;
    const psid = (sphi * this.q + cphi * this.r) * secth;

    this.phi += phid * dt;
    this.theta += thetad * dt;
    this.psi += psid * dt;
    // Wrap.
    if (this.psi > Math.PI) this.psi -= 2 * Math.PI;
    if (this.psi < -Math.PI) this.psi += 2 * Math.PI;
    this.theta = clamp(this.theta, -89 * DEG, 89 * DEG);

    // Velocity & position.
    this.vel[0] += accWorld[0] * dt;
    this.vel[1] += accWorld[1] * dt;
    this.vel[2] += accWorld[2] * dt;
    this.pos[0] += this.vel[0] * dt;
    this.pos[1] += this.vel[1] * dt;
    this.pos[2] += this.vel[2] * dt;

    // Don't sink through the earth.
    if (-this.pos[2] < d.gearHeight - 0.02) {
      this.pos[2] = -(d.gearHeight);
      if (this.vel[2] > 0) this.vel[2] = 0;
    }

    // ---- Derived indicators ----
    this.verticalSpeed = -this.vel[2];
    // Load factor along body z (what the pilot & structure feel).
    this.loadFactor = -Faz / (d.mass * d.g);
    // Slip/skid ball. It tracks sideslip so that "step on the ball" always
    // gives the correct rudder: positive (right) sideslip -> ball right ->
    // press right rudder to centre it. Full deflection at ~8 deg of slip.
    // A little lateral acceleration is blended in for feel during quick inputs.
    const latAcc = Fay / (d.mass * d.g);
    this.slipBall = clamp(beta / (8 * DEG) + latAcc * 0.15, -1, 1);

    // ---- Crash / hard-landing detection ----
    // Judged from the sink rate and attitude captured at the moment of impact.
    if (this.impactSink != null) {
      const sinkFpm = this.impactSink * FPM_PER_MS; // +ve = descending
      const bank = Math.abs(this.impactRoll);
      const pitch = this.impactPitch;
      this.hardLanding = sinkFpm > 400 || bank > 12 || pitch < -6;
      if (sinkFpm > 1000 || bank > 25 || pitch < -12 || pitch > 22) {
        this.crashed = true;
      }
      this.impactSink = null; // consume the event
    }

    this.time += dt;
  }

  // Trim helper: returns approximate stall speed (m/s) for current config.
  stallSpeed() {
    const d = this.def;
    const flap = d.flapSettings[this.controls.flaps];
    const rho = airDensity(this.altitude);
    const CLmax = d.CLmax + flap.dCL;
    return Math.sqrt((2 * d.mass * d.g) / (rho * d.wingArea * CLmax));
  }
}

// Expose for the browser (no module system, keep it simple & portable).
if (typeof window !== 'undefined') {
  window.FlightModel = FlightModel;
  window.AircraftDefs = { C172 };
  window.FlightConst = { DEG, RAD, KT_PER_MS, FT_PER_M, FPM_PER_MS, airDensity, clamp };
}
