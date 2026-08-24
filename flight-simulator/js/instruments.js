/*
 * instruments.js — the classic "six-pack" analogue instrument panel plus
 * engine gauges, drawn on a 2D canvas. These are the primary references a
 * student pilot learns to scan:
 *
 *   Airspeed Indicator | Attitude Indicator | Altimeter
 *   Turn Coordinator   | Heading Indicator  | Vertical Speed Indicator
 *
 * Plus a tachometer, throttle/flap/trim tapes and a fuel-ish power gauge.
 */

'use strict';

class InstrumentPanel {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.model = model;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    // Lay out a 3-column grid; two rows for the six-pack, engine row below.
    const cols = 3;
    const pad = 10;
    const gaugeW = (this.W - pad * (cols + 1)) / cols;
    const size = Math.min(gaugeW, (this.H - pad * 4) / 2.5);
    const r = size / 2;

    // Centre X of each of the three columns.
    const colX = (c) => pad + c * (gaugeW + pad) + gaugeW / 2;
    const row1 = pad + r + 6;
    const row2 = row1 + size + pad;

    this.airspeed(colX(0), row1, r);
    this.attitude(colX(1), row1, r);
    this.altimeter(colX(2), row1, r);
    this.turnCoord(colX(0), row2, r);
    this.heading(colX(1), row2, r);
    this.vsi(colX(2), row2, r);

    // Engine strip under the six-pack.
    const stripY = row2 + r + 8;
    this.engineStrip(pad, stripY, this.W - pad * 2, this.H - stripY - pad);
  }

  // ---- shared bezel ----
  _bezel(cx, cy, r, label) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#111318';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0d10';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a2e35';
    ctx.stroke();
    if (label) {
      ctx.fillStyle = '#8b93a0';
      ctx.font = `${Math.max(8, r * 0.16)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, cy + r - 6);
    }
    ctx.restore();
  }

  _needle(cx, cy, angleRad, len, width, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);
    ctx.beginPath();
    ctx.moveTo(0, width);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, -width);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ---- Airspeed Indicator (knots) ----
  airspeed(cx, cy, r) {
    const ctx = this.ctx;
    this._bezel(cx, cy, r, 'AIRSPEED  KTS');
    const kt = Math.max(0, this.model.iasKt);
    // Arc from 40kt (bottom-left) to 180kt around the dial.
    const minKt = 40, maxKt = 180;
    const a0 = 140 * Math.PI / 180; // start angle
    const a1 = 400 * Math.PI / 180; // end angle (wraps)
    const toAngle = (v) => a0 + ((v - minKt) / (maxKt - minKt)) * (a1 - a0);

    // Colour arcs: white (flaps), green (normal), yellow (caution), red (Vne).
    const drawArc = (v0, v1, color, rr) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.arc(cx, cy, rr, toAngle(v0), toAngle(v1));
      ctx.stroke();
    };
    drawArc(40, 85, '#e8e8e8', r * 0.78); // white (flap operating) — Vso..Vfe
    drawArc(48, 129, '#37b24d', r * 0.86); // green normal (Vs1..Vno)
    drawArc(129, 163, '#f6c445', r * 0.86); // yellow caution
    drawArc(163, 180, '#e03131', r * 0.86); // red line Vne

    // Ticks + labels every 20 kt.
    ctx.fillStyle = '#e8e8e8';
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 1.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${r * 0.16}px "Segoe UI", sans-serif`;
    for (let v = minKt; v <= maxKt; v += 20) {
      const a = toAngle(v);
      const c = Math.cos(a), s = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + c * r * 0.72, cy + s * r * 0.72);
      ctx.lineTo(cx + c * r * 0.62, cy + s * r * 0.62);
      ctx.stroke();
      ctx.fillText(String(v), cx + c * r * 0.5, cy + s * r * 0.5);
    }
    const av = toAngle(Math.min(maxKt, Math.max(minKt, kt)));
    this._needle(cx, cy, av, r * 0.72, 3, '#ffffff');
    this._hub(cx, cy, r);
    this._digital(cx, cy + r * 0.32, `${Math.round(kt)}`, r);
  }

  // ---- Attitude Indicator (artificial horizon) ----
  attitude(cx, cy, r) {
    const ctx = this.ctx;
    this._bezel(cx, cy, r, '');
    const m = this.model;
    ctx.save();
    // Clip to the instrument face.
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-m.phi); // bank
    const pitchPx = (m.theta * (180 / Math.PI)) * (r / 45); // ~45deg fills dial
    ctx.translate(0, pitchPx);

    // Sky and ground.
    const big = r * 3;
    const sky = ctx.createLinearGradient(0, -big, 0, 0);
    sky.addColorStop(0, '#2f6bb0');
    sky.addColorStop(1, '#5aa0e0');
    ctx.fillStyle = sky;
    ctx.fillRect(-big, -big, big * 2, big);
    const gnd = ctx.createLinearGradient(0, 0, 0, big);
    gnd.addColorStop(0, '#8a5a2b');
    gnd.addColorStop(1, '#5c3a17');
    ctx.fillStyle = gnd;
    ctx.fillRect(-big, 0, big * 2, big);
    // Horizon line.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-big, 0);
    ctx.lineTo(big, 0);
    ctx.stroke();

    // Pitch ladder.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.textAlign = 'center';
    ctx.font = `${r * 0.12}px "Segoe UI", sans-serif`;
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const y = -p * (r / 45);
      const w = p % 20 === 0 ? r * 0.35 : r * 0.2;
      ctx.beginPath();
      ctx.moveTo(-w, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(String(Math.abs(p)), -w - r * 0.12, y + 3);
      ctx.fillText(String(Math.abs(p)), w + r * 0.12, y + 3);
    }
    ctx.restore();

    // Bank angle arc + pointer (fixed to case).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#e8e8e8';
    ctx.fillStyle = '#e8e8e8';
    ctx.lineWidth = 1.5;
    const marks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
    for (const b of marks) {
      const a = -Math.PI / 2 + (b * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      const inner = b % 30 === 0 ? 0.74 : 0.8;
      ctx.beginPath();
      ctx.moveTo(c * r * 0.86, s * r * 0.86);
      ctx.lineTo(c * r * inner, s * r * inner);
      ctx.stroke();
    }
    // Sky pointer (moves with bank).
    ctx.rotate(-m.phi);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.86);
    ctx.lineTo(-r * 0.05, -r * 0.78);
    ctx.lineTo(r * 0.05, -r * 0.78);
    ctx.closePath();
    ctx.fillStyle = '#ffd43b';
    ctx.fill();
    ctx.restore();

    // Fixed aircraft symbol (miniature wings).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#ffcc00';
    ctx.fillStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(-r * 0.16, 0);
    ctx.moveTo(r * 0.16, 0);
    ctx.lineTo(r * 0.5, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.16, 0);
    ctx.lineTo(0, r * 0.08);
    ctx.lineTo(r * 0.16, 0);
    ctx.stroke();
    ctx.restore();
  }

  // ---- Altimeter (feet) ----
  altimeter(cx, cy, r) {
    const ctx = this.ctx;
    this._bezel(cx, cy, r, 'ALT  FT');
    const ft = this.model.altitudeFt;
    // Hundreds needle (long) + thousands needle (short), classic three-pointer.
    ctx.fillStyle = '#e8e8e8';
    ctx.strokeStyle = '#c9ced6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${r * 0.2}px "Segoe UI", sans-serif`;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + c * r * 0.78, cy + s * r * 0.78);
      ctx.lineTo(cx + c * r * 0.66, cy + s * r * 0.66);
      ctx.stroke();
      ctx.fillText(String(i), cx + c * r * 0.52, cy + s * r * 0.52);
    }
    const hundreds = ((ft % 1000) / 1000) * Math.PI * 2 - Math.PI / 2;
    const thousands = ((ft % 10000) / 10000) * Math.PI * 2 - Math.PI / 2;
    this._needle(cx, cy, thousands, r * 0.45, 4, '#dfe4ea');
    this._needle(cx, cy, hundreds, r * 0.74, 2.5, '#ffffff');
    this._hub(cx, cy, r);
    this._digital(cx, cy + r * 0.34, `${Math.round(ft / 10) * 10}`, r);
  }

  // ---- Turn Coordinator + inclinometer (slip/skid ball) ----
  turnCoord(cx, cy, r) {
    const ctx = this.ctx;
    this._bezel(cx, cy, r, 'TURN  COORD');
    const m = this.model;
    // Miniature aircraft banks with turn rate. Standard rate ~ 3 deg/s.
    const turnRate = m.r * (180 / Math.PI); // deg/s (yaw rate approx)
    const bankVis = Math.max(-1, Math.min(1, turnRate / 3)) * (20 * Math.PI / 180);
    ctx.save();
    ctx.translate(cx, cy - r * 0.1);
    ctx.rotate(bankVis);
    ctx.strokeStyle = '#dfe4ea';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(r * 0.6, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r * 0.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#dfe4ea';
    ctx.fill();
    ctx.restore();
    // Standard-rate index marks "L / R".
    ctx.fillStyle = '#37b24d';
    ctx.font = `${r * 0.16}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('L', cx - r * 0.55, cy - r * 0.28);
    ctx.fillText('R', cx + r * 0.55, cy - r * 0.28);

    // Inclinometer ball near the bottom.
    const bx = cx, by = cy + r * 0.55;
    ctx.save();
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by - r * 0.6, r * 0.9, Math.PI * 0.28, Math.PI * 0.72);
    ctx.stroke();
    // ball position from slip (lateral g).
    const ballX = bx + m.slipBall * r * 0.5;
    const ballY = by + Math.abs(m.slipBall) * r * 0.05;
    ctx.beginPath();
    ctx.arc(ballX, ballY, r * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.stroke();
    // cage lines
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.14, by - r * 0.05);
    ctx.lineTo(bx - r * 0.14, by + r * 0.12);
    ctx.moveTo(bx + r * 0.14, by - r * 0.05);
    ctx.lineTo(bx + r * 0.14, by + r * 0.12);
    ctx.stroke();
    ctx.restore();
  }

  // ---- Heading Indicator (directional gyro) ----
  heading(cx, cy, r) {
    const ctx = this.ctx;
    this._bezel(cx, cy, r, '');
    const hdg = this.model.headingDeg;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate((-hdg * Math.PI) / 180);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180 - Math.PI / 2;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.strokeStyle = '#dfe4ea';
      ctx.lineWidth = d % 10 === 0 ? 2 : 1;
      const inner = d % 30 === 0 ? 0.66 : d % 10 === 0 ? 0.74 : 0.8;
      ctx.beginPath();
      ctx.moveTo(c * r * 0.86, s * r * 0.86);
      ctx.lineTo(c * r * inner, s * r * inner);
      ctx.stroke();
      if (d % 30 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${r * 0.16}px "Segoe UI", sans-serif`;
        const label = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
        ctx.save();
        ctx.translate(c * r * 0.52, s * r * 0.52);
        ctx.rotate((hdg * Math.PI) / 180);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();

    // Fixed aircraft symbol + lubber line.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#ffcc00';
    ctx.fillStyle = '#ffcc00';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.5);
    ctx.lineTo(0, r * 0.5);
    ctx.moveTo(-r * 0.28, 0);
    ctx.lineTo(r * 0.28, 0);
    ctx.moveTo(-r * 0.16, r * 0.36);
    ctx.lineTo(r * 0.16, r * 0.36);
    ctx.stroke();
    // top index triangle
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.86);
    ctx.lineTo(-r * 0.06, -r * 0.74);
    ctx.lineTo(r * 0.06, -r * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    this._digital(cx, cy + r * 0.4, `${Math.round(hdg).toString().padStart(3, '0')}°`, r);
  }

  // ---- Vertical Speed Indicator (feet per minute) ----
  vsi(cx, cy, r) {
    const ctx = this.ctx;
    this._bezel(cx, cy, r, 'VERT SPD  FPM');
    const fpm = this.model.vsFpm;
    // Scale +/- 2000 fpm, needle sweeps ~ +/-150 deg from 9 o'clock.
    const maxF = 2000;
    const v = Math.max(-maxF, Math.min(maxF, fpm));
    const a = Math.PI + (v / maxF) * (150 * Math.PI / 180); // 0 at 9 o'clock left
    ctx.fillStyle = '#e8e8e8';
    ctx.strokeStyle = '#c9ced6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${r * 0.15}px "Segoe UI", sans-serif`;
    for (let f = -maxF; f <= maxF; f += 500) {
      const ang = Math.PI + (f / maxF) * (150 * Math.PI / 180);
      const c = Math.cos(ang), s = Math.sin(ang);
      ctx.lineWidth = f % 1000 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + c * r * 0.78, cy + s * r * 0.78);
      ctx.lineTo(cx + c * r * 0.66, cy + s * r * 0.66);
      ctx.stroke();
      if (f % 1000 === 0) ctx.fillText(String(Math.abs(f / 100)), cx + c * r * 0.5, cy + s * r * 0.5);
    }
    this._needle(cx, cy, a, r * 0.74, 2.5, '#ffffff');
    this._hub(cx, cy, r);
    this._digital(cx, cy + r * 0.4, `${Math.round(fpm / 50) * 50}`, r);
  }

  _hub(cx, cy, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = '#20242b';
    ctx.fill();
    ctx.strokeStyle = '#3a3f47';
    ctx.stroke();
  }

  _digital(cx, cy, text, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${r * 0.2}px "Consolas", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + r * 0.14;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx - w / 2, cy - r * 0.13, w, r * 0.26);
    ctx.fillStyle = '#7CFC98';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // ---- Engine strip: RPM tach + throttle/flap/trim tapes ----
  engineStrip(x, y, w, h) {
    if (h < 30) return;
    const ctx = this.ctx;
    const m = this.model;
    ctx.save();
    // Tachometer dial on the left.
    const r = Math.min(h, w * 0.22) / 2;
    const cx = x + r + 6;
    const cy = y + h / 2;
    this._bezel(cx, cy, r, 'RPM x100');
    const rpm = m.rpm;
    const a0 = 140 * Math.PI / 180, a1 = 400 * Math.PI / 180;
    const toA = (v) => a0 + (v / 2700) * (a1 - a0);
    ctx.strokeStyle = '#37b24d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, toA(2100), toA(2500));
    ctx.stroke();
    ctx.strokeStyle = '#e03131';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, toA(2600), toA(2700));
    ctx.stroke();
    ctx.fillStyle = '#e8e8e8';
    ctx.font = `${r * 0.2}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= 2700; v += 500) {
      const a = toA(v);
      const c = Math.cos(a), s = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + c * r * 0.72, cy + s * r * 0.72);
      ctx.lineTo(cx + c * r * 0.6, cy + s * r * 0.6);
      ctx.strokeStyle = '#c9ced6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillText(String(v / 100), cx + c * r * 0.46, cy + s * r * 0.46);
    }
    this._needle(cx, cy, toA(rpm), r * 0.7, 2.5, '#fff');
    this._hub(cx, cy, r);

    // Vertical tapes for throttle, flaps, trim, power.
    const tapeX = cx + r + 24;
    const tapeW = 26;
    const gap = 16;
    const tapeH = h - 20;
    const tapeY = y + 6;
    const drawTape = (tx, label, frac, color, valueText) => {
      ctx.fillStyle = '#0b0d10';
      ctx.fillRect(tx, tapeY, tapeW, tapeH);
      ctx.strokeStyle = '#2a2e35';
      ctx.strokeRect(tx, tapeY, tapeW, tapeH);
      const fh = tapeH * Math.max(0, Math.min(1, frac));
      ctx.fillStyle = color;
      ctx.fillRect(tx, tapeY + tapeH - fh, tapeW, fh);
      ctx.fillStyle = '#c9ced6';
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, tx + tapeW / 2, tapeY + tapeH + 3);
      if (valueText) {
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'bottom';
        ctx.fillText(valueText, tx + tapeW / 2, tapeY - 2);
      }
    };
    let tx = tapeX;
    drawTape(tx, 'THR', m.controls.throttle, '#37b24d', `${Math.round(m.controls.throttle * 100)}`);
    tx += tapeW + gap;
    const flapFrac = m.controls.flaps / (m.def.flapSettings.length - 1);
    drawTape(tx, 'FLAP', flapFrac, '#f6c445', `${m.flapDeg}°`);
    tx += tapeW + gap;
    drawTape(tx, 'TRIM', (m.controls.trim + 0.6) / 1.2, '#4dabf7', m.controls.trim >= 0 ? `+${m.controls.trim.toFixed(1)}` : m.controls.trim.toFixed(1));
    tx += tapeW + gap;
    // Load factor "G" tape.
    drawTape(tx, 'G', (m.loadFactor + 1) / 4, m.loadFactor > 3.8 || m.loadFactor < -1.5 ? '#e03131' : '#adb5bd', m.loadFactor.toFixed(1));

    ctx.restore();
  }
}

if (typeof window !== 'undefined') window.InstrumentPanel = InstrumentPanel;
