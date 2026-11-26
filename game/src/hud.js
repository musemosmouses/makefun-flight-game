// HUD and cockpit instruments for Skyhook Valley, drawn on a 2D canvas over
// the WebGL view: attitude indicator, airspeed + altitude tapes, compass tape,
// fuel and hull bars, throttle lever, ring counter, minimap, and message banners.
// The numbers are the real flight state — nothing here is decoration.
import { clamp } from './rng.js';
import { RUNWAY, LAKE } from './terrain.js';

const GREEN = '#7dff8a';
const AMBER = '#ffc857';
const RED = '#ff5a4e';
const CYAN = '#7de3ff';
const PANEL = 'rgba(10, 14, 20, 0.72)';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.message = '';
    this.messageUntil = 0;
    this.flash = '';
    this.flashUntil = 0;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  showMessage(text, seconds, nowSec) {
    this.message = text;
    this.messageUntil = nowSec + seconds;
  }

  showFlash(text, seconds, nowSec) {
    this.flash = text;
    this.flashUntil = nowSec + seconds;
  }

  // Main draw. `s` is the game state snapshot (see game.js).
  draw(s, nowSec) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (s.screen === 'title') return;
    const p = s.plane;
    const knots = Math.round(p.speed * 1.944);
    const feet = Math.round(p.y * 3.281);
    // Compass heading: 0 = north (-Z), 90 = east (+X). Forward is
    // (cos h, -sin h), so the compass reads atan2(east, north).
    const headingDeg = Math.round(
      ((Math.atan2(Math.cos(p.heading), Math.sin(p.heading)) * 180 / Math.PI) % 360 + 360) % 360,
    );
    const vsFpm = Math.round(p.verticalSpeed * 196.85);
    this.drawTopBar(ctx, W, knots, feet, headingDeg, vsFpm, s);
    this.drawAttitude(ctx, W, H, p);
    this.drawTapes(ctx, W, H, knots, feet);
    this.drawFuelHull(ctx, W, H, s);
    this.drawMinimap(ctx, W, H, s);
    this.drawRingPanel(ctx, W, H, s);
    if (s.camera === 'cockpit') this.drawCockpitFrame(ctx, W, H, p);
    if (s.stalled) this.drawStallWarning(ctx, W, H);
    if (nowSec < this.messageUntil) this.drawBanner(ctx, W, H, this.message, CYAN, 44);
    if (nowSec < this.flashUntil) this.drawBanner(ctx, W, H - 130, this.flash, AMBER, 30);
    if (s.screen === 'paused') this.drawBanner(ctx, W, H, 'PAUSED — press P to resume', AMBER, 40);
  }

  panel(ctx, x, y, w, h) {
    ctx.fillStyle = PANEL;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  text(ctx, str, x, y, size, colour, align, weight) {
    ctx.font = (weight || '600') + ' ' + size + 'px system-ui, sans-serif';
    ctx.fillStyle = colour || '#fff';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  drawTopBar(ctx, W, knots, feet, headingDeg, vsFpm, s) {
    this.panel(ctx, 12, 10, W - 24, 46);
    this.text(ctx, 'SKYHOOK VALLEY', 28, 33, 17, CYAN, 'left', '700');
    this.text(ctx, 'ALT ' + feet.toLocaleString() + ' ft', 250, 33, 17, '#fff');
    this.text(ctx, 'SPD ' + knots + ' kt', 430, 33, 17, '#fff');
    this.text(ctx, 'HDG ' + String(headingDeg).padStart(3, '0') + '°', 580, 33, 17, '#fff');
    this.text(ctx, (vsFpm >= 0 ? '+' : '') + vsFpm + ' fpm', 720, 33, 15, vsFpm >= 0 ? GREEN : AMBER);
    const t = Math.max(0, Math.ceil(s.timeLeft));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    this.text(ctx, 'TIME ' + mm + ':' + ss, W - 330, 33, 17, t < 30 ? RED : '#fff');
    this.text(ctx, 'SCORE ' + s.score, W - 190, 33, 17, AMBER, 'left', '700');
  }

  drawAttitude(ctx, W, H, p) {
    const cx = W / 2;
    const cy = H - 128;
    const r = 62;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-p.roll);
    ctx.translate(0, p.pitch * r * 1.6);
    ctx.fillStyle = '#2f6fd0';
    ctx.fillRect(-r, -r * 2, r * 2, r * 2);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(-r, 0, r * 2, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Fixed wings marker.
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 34, cy);
    ctx.stroke();
    this.text(ctx, 'ATT', cx, cy + r + 16, 11, 'rgba(255,255,255,0.7)', 'center');
  }

  drawTapes(ctx, W, H, knots, feet) {
    // Airspeed tape, left.
    this.panel(ctx, 12, H - 230, 92, 120);
    this.text(ctx, 'AIRSPEED', 58, H - 212, 10, 'rgba(255,255,255,0.65)', 'center');
    this.text(ctx, String(knots), 58, H - 178, 26, knots < 47 ? RED : '#fff', 'center', '700');
    this.text(ctx, 'kt', 58, H - 152, 11, 'rgba(255,255,255,0.65)', 'center');
    // Altitude tape, right.
    this.panel(ctx, W - 104, H - 230, 92, 120);
    this.text(ctx, 'ALTITUDE', W - 58, H - 212, 10, 'rgba(255,255,255,0.65)', 'center');
    this.text(ctx, String(feet), W - 58, H - 178, 26, '#fff', 'center', '700');
    this.text(ctx, 'ft', W - 58, H - 152, 11, 'rgba(255,255,255,0.65)', 'center');
  }

  drawFuelHull(ctx, W, H, s) {
    const x = 12;
    const y = H - 96;
    // Wide enough for the bars plus their percentage labels beside them.
    this.panel(ctx, x, y, 268, 84);
    this.bar(ctx, x + 12, y + 18, 140, 12, s.fuel / 100, 'FUEL', s.fuel < 25 ? RED : GREEN);
    this.bar(ctx, x + 12, y + 48, 140, 12, s.hull / 100, 'HULL', s.hull < 30 ? RED : CYAN);
    // Throttle lever.
    const tx = x + 292;
    this.panel(ctx, tx, y, 54, 84);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(tx + 24, y + 12, 6, 60);
    const ty = y + 66 - s.plane.throttle * 54;
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.roundRect(tx + 14, ty, 26, 10, 3);
    ctx.fill();
    this.text(ctx, 'THR', tx + 27, y + 76, 9, 'rgba(255,255,255,0.65)', 'center');
  }

  bar(ctx, x, y, w, h, frac, label, colour) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(x, y, w * clamp(frac, 0, 1), h, 4);
    ctx.fill();
    this.text(ctx, label + ' ' + Math.round(frac * 100) + '%', x + w + 8, y + h / 2, 11, '#fff');
  }

  drawMinimap(ctx, W, H, s) {
    const size = 150;
    const x = W - size - 12;
    const y = 66;
    this.panel(ctx, x, y, size, size + 18);
    const scale = size / 4200;
    const toMap = (wx, wz) => [x + size / 2 + wx * scale, y + size / 2 + wz * scale + 9];
    // Valley tint.
    ctx.fillStyle = 'rgba(70, 110, 60, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 6, size - 12, size - 12, 6);
    ctx.fill();
    // Lake.
    const [lx, ly] = toMap(LAKE.x, LAKE.z);
    ctx.fillStyle = 'rgba(90, 150, 200, 0.9)';
    ctx.beginPath();
    ctx.arc(lx, ly, LAKE.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    // Runway.
    const [rx, ry] = toMap(RUNWAY.x, RUNWAY.z);
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rx - RUNWAY.length / 2 * scale, ry);
    ctx.lineTo(rx + RUNWAY.length / 2 * scale, ry);
    ctx.stroke();
    // Rings.
    for (const r of s.rings) {
      const [mx, my] = toMap(r.x, r.z);
      ctx.fillStyle = r.passed ? 'rgba(125,255,138,0.9)' : 'rgba(255,200,87,0.95)';
      ctx.beginPath();
      ctx.arc(mx, my, r.passed ? 3 : 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Plane arrow.
    const [px, py] = toMap(s.plane.x, s.plane.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-s.plane.heading);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    this.text(ctx, 'VALLEY MAP', x + size / 2, y + size + 9, 10, 'rgba(255,255,255,0.7)', 'center');
  }

  drawRingPanel(ctx, W, H, s) {
    const done = s.rings.filter((r) => r.passed).length;
    const next = s.rings.find((r) => !r.passed);
    const x = 12;
    const y = 66;
    this.panel(ctx, x, y, 210, 88);
    this.text(ctx, 'RING ' + done + ' / ' + s.rings.length, x + 16, y + 22, 19, AMBER, 'left', '700');
    if (next) {
      const d = Math.round(Math.hypot(next.x - s.plane.x, next.y - s.plane.y, next.z - s.plane.z));
      this.text(ctx, 'NEXT ' + d + ' m', x + 16, y + 46, 13, '#fff');
      // Direction arrow toward the next ring, relative to the nose: the ring
      // sits at canvas angle atan2(dz, dx), the nose at -heading.
      const ang = Math.atan2(next.z - s.plane.z, next.x - s.plane.x) + s.plane.heading;
      const ax = x + 182;
      const ay = y + 32;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      this.text(ctx, 'ALL RINGS — LAND!', x + 16, y + 46, 13, GREEN);
    }
    // Wind readout.
    const windKt = Math.round(Math.hypot(s.wind[0], s.wind[1]) * 1.944);
    this.text(ctx, 'WIND ' + windKt + ' kt', x + 16, y + 82, 12, 'rgba(255,255,255,0.75)');
  }

  drawCockpitFrame(ctx, W, H, p) {
    // Glareshield, panel edge and yoke silhouette: the cockpit you sit in.
    ctx.fillStyle = '#1a1d22';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H - 150);
    ctx.quadraticCurveTo(W * 0.25, H - 205, W * 0.5, H - 200);
    ctx.quadraticCurveTo(W * 0.75, H - 205, W, H - 150);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#23272e';
    ctx.fillRect(0, H - 158, W, 10);
    // Panel screws and a compass card.
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 9; i += 1) {
      ctx.beginPath();
      ctx.arc(40 + i * (W - 80) / 8, H - 176, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Yoke.
    ctx.strokeStyle = '#0c0e11';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 70, H - 60);
    ctx.quadraticCurveTo(W / 2, H - 110, W / 2 + 70, H - 60);
    ctx.stroke();
    ctx.strokeStyle = '#2c3138';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(W / 2, H - 88);
    ctx.lineTo(W / 2, H - 30);
    ctx.stroke();
  }

  drawStallWarning(ctx, W, H) {
    this.panel(ctx, W / 2 - 130, 66, 260, 44);
    this.text(ctx, '⚠ STALL — NOSE DOWN, POWER UP', W / 2, 88, 16, RED, 'center', '700');
  }

  drawBanner(ctx, W, H, str, colour, size) {
    ctx.font = '700 ' + size + 'px system-ui, sans-serif';
    const w = ctx.measureText(str).width + 48;
    this.panel(ctx, W / 2 - w / 2, H / 2 - 150, w, size + 26);
    this.text(ctx, str, W / 2, H / 2 - 150 + (size + 26) / 2 + 1, size, colour, 'center', '700');
  }
}
