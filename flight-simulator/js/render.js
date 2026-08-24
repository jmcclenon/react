/*
 * render.js — the out-the-window view.
 *
 * A lightweight 3D renderer (no WebGL, no libraries) that draws the world the
 * pilot sees through the windscreen: sky, ground, a receding runway, taxiway,
 * threshold markings, distant terrain features and a horizon that banks and
 * pitches with the aircraft. It uses a pinhole camera built from the aircraft's
 * attitude so the picture is geometrically consistent with the instruments.
 */

'use strict';

class WorldRenderer {
  constructor(canvas, model) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.model = model;
    this.fov = 65 * Math.PI / 180;
    this.runway = {
      // Runway centre in world NED (metres). Oriented along +north (heading 360).
      length: 1100,
      width: 45,
      heading: 0, // runway 36
      threshold: [0, 0], // north, east of the near threshold
    };
    this._buildScenery();
  }

  _buildScenery() {
    // Scatter some ground features so motion is perceptible: fields, a few
    // "buildings" near the airport, and trees along the approach.
    this.features = [];
    const rand = mulberry32(1234);
    for (let i = 0; i < 240; i++) {
      const n = (rand() - 0.5) * 9000;
      const e = (rand() - 0.5) * 9000;
      // keep the runway strip clear
      if (Math.abs(e) < 120 && n > -300 && n < this.runway.length + 300) continue;
      const type = rand();
      if (type < 0.12) {
        this.features.push({ kind: 'building', n, e, w: 12 + rand() * 30, h: 6 + rand() * 20 });
      } else if (type < 0.45) {
        this.features.push({ kind: 'tree', n, e, r: 3 + rand() * 5, h: 6 + rand() * 8 });
      } else {
        this.features.push({ kind: 'field', n, e, r: 60 + rand() * 160, hue: 70 + rand() * 40 });
      }
    }
    // Windsock + a control tower near the field.
    this.features.push({ kind: 'building', n: 120, e: 90, w: 14, h: 28, tower: true });
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

  // Build camera basis vectors (world NED) from aircraft attitude.
  _camera() {
    const m = this.model;
    const phi = m.phi, theta = m.theta, psi = m.psi;
    const cphi = Math.cos(phi), sphi = Math.sin(phi);
    const cth = Math.cos(theta), sth = Math.sin(theta);
    const cpsi = Math.cos(psi), spsi = Math.sin(psi);
    // Body axes in world.
    const fwd = [cth * cpsi, cth * spsi, -sth];
    const right = [
      sphi * sth * cpsi - cphi * spsi,
      sphi * sth * spsi + cphi * cpsi,
      sphi * cth,
    ];
    const down = [
      cphi * sth * cpsi + sphi * spsi,
      cphi * sth * spsi - sphi * cpsi,
      cphi * cth,
    ];
    // Camera at the pilot's eye, slightly ahead and above the CG.
    const eye = [
      m.pos[0] + fwd[0] * 1.5 - down[0] * 0.6,
      m.pos[1] + fwd[1] * 1.5 - down[1] * 0.6,
      m.pos[2] + fwd[2] * 1.5 - down[2] * 0.6,
    ];
    return { fwd, right, down, eye };
  }

  // Project a world point to screen. Returns null if behind the camera.
  _project(cam, p) {
    const dx = p[0] - cam.eye[0];
    const dy = p[1] - cam.eye[1];
    const dz = p[2] - cam.eye[2];
    const zc = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2]; // depth
    if (zc <= 0.5) return null;
    const xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
    const yc = dx * cam.down[0] + dy * cam.down[1] + dz * cam.down[2];
    const f = this.H / 2 / Math.tan(this.fov / 2);
    return {
      x: this.W / 2 + (xc / zc) * f,
      y: this.H / 2 + (yc / zc) * f,
      z: zc,
    };
  }

  render() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const m = this.model;
    ctx.clearRect(0, 0, W, H);

    const cam = this._camera();

    // --- Sky & ground split via the true horizon line ---
    this._drawSkyGround(ctx, cam);

    // --- Ground grid for motion cues ---
    this._drawGroundGrid(ctx, cam);

    // --- Scenery features, painted far-to-near ---
    this._drawFeatures(ctx, cam);

    // --- Runway ---
    this._drawRunway(ctx, cam);

    // --- Cowling / glareshield frame for immersion ---
    this._drawCowling(ctx);
  }

  _drawSkyGround(ctx, cam) {
    const W = this.W, H = this.H;
    // Sky gradient (top).
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2b5c9c');
    sky.addColorStop(0.5, '#79acda');
    sky.addColorStop(1, '#cfe3f2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Fill the ground as the region below the horizon. The horizon is found by
    // projecting a fan of far-away points on the ground plane (world z = 0)
    // across the field of view, then closing the polygon along the screen
    // bottom. This keeps the horizon geometrically consistent with bank/pitch.
    const far = 9000;
    ctx.save();
    const groundGrad = ctx.createLinearGradient(0, 0, 0, H);
    groundGrad.addColorStop(0, '#6f8f4e');
    groundGrad.addColorStop(1, '#4a6b34');

    // Sample horizon across the screen width by projecting far ground points.
    const pts = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * 2 - 1; // -1..1 across right axis
      const wp = [
        cam.eye[0] + cam.fwd[0] * far + cam.right[0] * far * s * 1.2,
        cam.eye[1] + cam.fwd[1] * far + cam.right[1] * far * s * 1.2,
        0,
      ];
      const pr = this._project(cam, wp);
      // If a far point projects behind the camera (looking well above the
      // horizon), anchor that sample to the top of the screen instead.
      if (pr) pts.push([pr.x, pr.y]);
      else pts.push([this.W * (i / N), -50]);
    }
    // Ground polygon: horizon samples then wrap around the bottom of screen.
    ctx.beginPath();
    ctx.moveTo(-50, H + 50);
    // sort by x for a clean fill
    for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(W + 50, H + 50);
    ctx.closePath();
    ctx.fillStyle = groundGrad;
    ctx.fill();
    ctx.restore();
  }

  _drawGroundGrid(ctx, cam) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    const step = 200;
    const range = 4000;
    const ex = Math.round(cam.eye[0] / step) * step;
    const ey = Math.round(cam.eye[1] / step) * step;
    // North lines
    for (let e = ey - range; e <= ey + range; e += step) {
      this._segment(ctx, cam, [ex - range, e, 0], [ex + range, e, 0]);
    }
    for (let n = ex - range; n <= ex + range; n += step) {
      this._segment(ctx, cam, [n, ey - range, 0], [n, ey + range, 0]);
    }
    ctx.restore();
  }

  _segment(ctx, cam, a, b) {
    // Clip a segment to the near plane and draw.
    let pa = this._project(cam, a);
    let pb = this._project(cam, b);
    if (!pa && !pb) return;
    if (!pa || !pb) {
      // crude near-plane clip: skip if either endpoint is behind
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  _drawFeatures(ctx, cam) {
    // Sort by distance so nearer objects paint over far ones.
    const list = this.features
      .map((f) => {
        const dn = f.n - cam.eye[0];
        const de = f.e - cam.eye[1];
        return { f, d2: dn * dn + de * de };
      })
      .sort((a, b) => b.d2 - a.d2);

    for (const item of list) {
      const f = item.f;
      if (item.d2 > 8000 * 8000) continue;
      if (f.kind === 'field') this._drawField(ctx, cam, f);
      else if (f.kind === 'tree') this._drawTree(ctx, cam, f);
      else if (f.kind === 'building') this._drawBuilding(ctx, cam, f);
    }
  }

  _drawField(ctx, cam, f) {
    const c = this._project(cam, [f.n, f.e, 0]);
    if (!c) return;
    const edge = this._project(cam, [f.n + f.r, f.e, 0]);
    if (!edge) return;
    const rad = Math.hypot(edge.x - c.x, edge.y - c.y);
    if (rad < 1) return;
    ctx.fillStyle = `hsla(${f.hue}, 40%, 42%, 0.5)`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawTree(ctx, cam, f) {
    const base = this._project(cam, [f.n, f.e, 0]);
    const top = this._project(cam, [f.n, f.e, -f.h]);
    if (!base || !top) return;
    const w = Math.max(1, Math.abs((this.H / base.z) * f.r * 0.02));
    ctx.strokeStyle = '#5b3a1e';
    ctx.lineWidth = Math.max(1, w * 0.4);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.fillStyle = '#2f6b2f';
    ctx.beginPath();
    ctx.arc(top.x, top.y, Math.max(1.5, w), 0, Math.PI * 2);
    ctx.fill();
  }

  _drawBuilding(ctx, cam, f) {
    const h = f.h;
    const hw = f.w / 2;
    const corners = [
      [f.n - hw, f.e - hw, 0],
      [f.n + hw, f.e - hw, 0],
      [f.n + hw, f.e + hw, 0],
      [f.n - hw, f.e + hw, 0],
      [f.n - hw, f.e - hw, -h],
      [f.n + hw, f.e - hw, -h],
      [f.n + hw, f.e + hw, -h],
      [f.n - hw, f.e + hw, -h],
    ].map((p) => this._project(cam, p));
    if (corners.some((c) => !c)) return;
    const faces = [
      [4, 5, 6, 7], // roof
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    const shades = ['#8a8f96', '#6f747b', '#7c828a', '#5f646b', '#787e86'];
    faces.forEach((face, i) => {
      ctx.beginPath();
      ctx.moveTo(corners[face[0]].x, corners[face[0]].y);
      for (let j = 1; j < face.length; j++) ctx.lineTo(corners[face[j]].x, corners[face[j]].y);
      ctx.closePath();
      ctx.fillStyle = f.tower ? (i === 0 ? '#3a4a5a' : '#c9d3dc') : shades[i];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });
  }

  _drawRunway(ctx, cam) {
    const rw = this.runway;
    const hw = rw.width / 2;
    const L = rw.length;
    // Runway surface corners.
    const surf = [
      [0, -hw, 0],
      [0, hw, 0],
      [L, hw, 0],
      [L, -hw, 0],
    ].map((p) => this._project(cam, p));
    if (!surf.some((c) => !c)) {
      ctx.fillStyle = '#3a3d42';
      ctx.beginPath();
      ctx.moveTo(surf[0].x, surf[0].y);
      for (let i = 1; i < surf.length; i++) ctx.lineTo(surf[i].x, surf[i].y);
      ctx.closePath();
      ctx.fill();

      // Threshold "piano keys".
      ctx.fillStyle = '#e8e8e8';
      for (let i = -3; i <= 3; i++) {
        const y0 = i * 5;
        const stripe = [
          [8, y0, 0],
          [8, y0 + 3, 0],
          [28, y0 + 3, 0],
          [28, y0, 0],
        ].map((p) => this._project(cam, p));
        if (stripe.some((s) => !s)) continue;
        ctx.beginPath();
        ctx.moveTo(stripe[0].x, stripe[0].y);
        for (let j = 1; j < stripe.length; j++) ctx.lineTo(stripe[j].x, stripe[j].y);
        ctx.closePath();
        ctx.fill();
      }

      // Dashed centreline.
      ctx.fillStyle = '#f4f4f4';
      for (let d = 40; d < L - 20; d += 30) {
        const seg = [
          [d, -0.5, 0],
          [d, 0.5, 0],
          [d + 15, 0.5, 0],
          [d + 15, -0.5, 0],
        ].map((p) => this._project(cam, p));
        if (seg.some((s) => !s)) continue;
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        for (let j = 1; j < seg.length; j++) ctx.lineTo(seg[j].x, seg[j].y);
        ctx.closePath();
        ctx.fill();
      }

      // Runway number "36" near the threshold.
      this._drawRunwayNumber(ctx, cam);
      // Aiming point markers.
      ctx.fillStyle = '#f0f0f0';
      for (const side of [-1, 1]) {
        const box = [
          [280, side * 6, 0],
          [280, side * 10, 0],
          [320, side * 10, 0],
          [320, side * 6, 0],
        ].map((p) => this._project(cam, p));
        if (box.some((s) => !s)) continue;
        ctx.beginPath();
        ctx.moveTo(box[0].x, box[0].y);
        for (let j = 1; j < box.length; j++) ctx.lineTo(box[j].x, box[j].y);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Runway edge lights (subtle) so it's visible from the pattern.
    ctx.fillStyle = 'rgba(255,255,240,0.9)';
    for (let d = 0; d <= L; d += 60) {
      for (const side of [-hw - 1, hw + 1]) {
        const p = this._project(cam, [d, side, 0]);
        if (!p) continue;
        const s = Math.max(0.6, 60 / p.z);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
  }

  _drawRunwayNumber(ctx, cam) {
    // Runway "36" painted as two blocky glyphs a short way in from the threshold.
    this._runwayGlyph(ctx, cam, 48, -8, '3');
    this._runwayGlyph(ctx, cam, 48, 2, '6');
  }

  _runwayGlyph(ctx, cam, n0, e0, ch) {
    // 3x5 blocky font, cell ~2.4m, painted flat on the runway (n = row).
    const font = {
      '3': ['111', '001', '111', '001', '111'],
      '6': ['111', '100', '111', '101', '111'],
    };
    const g = font[ch];
    if (!g) return;
    const cell = 2.6;
    ctx.fillStyle = '#f2f2f2';
    for (let r = 0; r < g.length; r++) {
      for (let col = 0; col < g[r].length; col++) {
        if (g[r][col] !== '1') continue;
        const n = n0 + (g.length - 1 - r) * cell;
        const e = e0 + col * cell;
        const quad = [
          [n, e, 0],
          [n + cell * 0.9, e, 0],
          [n + cell * 0.9, e + cell * 0.9, 0],
          [n, e + cell * 0.9, 0],
        ].map((p) => this._project(cam, p));
        if (quad.some((q) => !q)) continue;
        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        for (let j = 1; j < 4; j++) ctx.lineTo(quad[j].x, quad[j].y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  _drawCowling(ctx) {
    const W = this.W, H = this.H;
    // A subtle glareshield at the bottom to frame the view like a real cockpit.
    const grad = ctx.createLinearGradient(0, H - 60, 0, H);
    grad.addColorStop(0, 'rgba(20,22,26,0)');
    grad.addColorStop(1, 'rgba(20,22,26,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - 60, W, 60);
  }
}

// Small deterministic PRNG so scenery is stable between reloads.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof window !== 'undefined') window.WorldRenderer = WorldRenderer;
