// Canvas renderer. Draws a "view" object that has the same shape whether it
// comes straight from the local simulation (solo) or is rebuilt from network
// snapshots (online).

import { COLS, DX, DY, POWERUPS, ENEMIES, chainMult } from '/shared/constants.js';
import { key } from '/shared/maze.js';
import { itemPower, laserBeam, dronePositions } from '/shared/sim.js';

// Zone colour themes, cycling every 64 rows.
const THEMES = [
  { edge: '#3ef2ff', fill: '#071a33', dot: '#bfefff' },
  { edge: '#ff4dd8', fill: '#2a0730', dot: '#ffd1f4' },
  { edge: '#9dff3e', fill: '#0f2a08', dot: '#e4ffcc' },
  { edge: '#ffb13e', fill: '#2e1806', dot: '#ffe7c4' },
  { edge: '#8d7bff', fill: '#130d36', dot: '#ddd6ff' },
  { edge: '#ff3b5c', fill: '#2e0710', dot: '#ffd0d8' },
];
const ZONE_ROWS = 64;
export const themeFor = (y) => THEMES[Math.floor(Math.max(0, y) / ZONE_ROWS) % THEMES.length];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.camY = 0;
    this.particles = [];
    this.popups = [];
    this.rings = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#fff';
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ts = Math.max(12, Math.floor(Math.min(this.w / (COLS + 0.8), this.h / 18)));
    this.ox = Math.round((this.w - COLS * this.ts) / 2);
    this.anchor = this.h * 0.64;
  }

  sx(x) { return this.ox + (x + 0.5) * this.ts; }
  sy(y) { return this.anchor - (y - this.camY) * this.ts; }

  snapCamera(y) { this.camY = y + 3; }

  // ---------------- effects -----------------
  burst(x, y, color, n = 14, speed = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, max: 0.9, color, size: 0.08 + Math.random() * 0.1 });
    }
  }
  popup(x, y, text, color = '#fff') { this.popups.push({ x, y, text: String(text), color, life: 1 }); }
  ring(x, y, r, color) { this.rings.push({ x, y, r, color, life: 0.5 }); }
  doShake(v) { this.shake = Math.max(this.shake, v); }
  doFlash(color, v = 0.5) { this.flash = v; this.flashColor = color; }

  // ---------------- frame -----------------
  draw(view, dt, meId, focusY = null) {
    const g = this.g, ts = this.ts;
    const me = view.players.find((p) => p.id === meId);
    let target = focusY != null ? focusY
      : me && me.alive ? me.y : view.players.reduce((m, p) => (p.alive && p.y > m ? p.y : m), me ? me.y : 0);
    target += 3;
    this.camY += (target - this.camY) * Math.min(1, dt * 7);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#05060f';
    g.fillRect(0, 0, this.w, this.h);

    let shx = 0, shy = 0;
    if (this.shake > 0) {
      shx = (Math.random() - 0.5) * this.shake * 14;
      shy = (Math.random() - 0.5) * this.shake * 14;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    g.translate(shx, shy);

    const yTop = Math.ceil(this.camY + this.anchor / ts) + 1;
    const yBot = Math.floor(this.camY - (this.h - this.anchor) / ts) - 1;
    view.maze.ensure(yTop + 2);
    const t = view.time;

    this.drawWalls(view.maze, yBot, yTop);
    this.drawPickups(view, yBot, yTop, me, t);
    this.drawFires(view, t);

    for (const e of view.enemies) this.drawEnemy(e, view, me, t);
    for (const p of view.players) if (p.id !== meId) this.drawPlayer(p, view, t, false);
    if (me) this.drawPlayer(me, view, t, true);

    this.drawFx(dt);
    this.drawVoid(view.voidY, t);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (view.timers.freeze > 0) { g.fillStyle = 'rgba(140,220,255,0.10)'; g.fillRect(0, 0, this.w, this.h); }
    if (view.timers.chrono > 0) { g.fillStyle = 'rgba(77,214,255,0.07)'; g.fillRect(0, 0, this.w, this.h); }
    if (this.flash > 0) {
      g.globalAlpha = Math.min(1, this.flash);
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, this.w, this.h);
      g.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 2.5);
    }
  }

  drawWalls(maze, yBot, yTop) {
    const g = this.g, ts = this.ts;
    const y0 = Math.max(0, yBot);
    const wall = (x, y) => {
      if (y < 0) return true;
      if (x < 0 || x >= COLS) {
        if (maze.isWrap(y)) return false;
        return true;
      }
      return !maze.isFloor(x, y);
    };
    // Below the maze floor: solid
    if (yBot < 0) {
      const top = this.sy(-0.5);
      g.fillStyle = THEMES[0].fill;
      g.fillRect(this.ox - ts, top, (COLS + 2) * ts, this.h - top);
    }
    // Draw two passes per zone: outline colour then inner fill (inset more),
    // which leaves a neon border wherever a wall meets a corridor.
    let zoneStart = y0;
    while (zoneStart <= yTop) {
      const zone = Math.floor(zoneStart / ZONE_ROWS);
      const zoneEnd = Math.min(yTop, (zone + 1) * ZONE_ROWS - 1);
      const th = THEMES[zone % THEMES.length];
      for (let pass = 0; pass < 2; pass++) {
        const m = pass === 0 ? ts * 0.18 : ts * 0.18 + Math.max(2, ts * 0.11);
        g.fillStyle = pass === 0 ? th.edge : th.fill;
        g.beginPath();
        for (let y = zoneStart; y <= zoneEnd; y++) {
          const py = this.sy(y) - ts / 2;
          for (let x = -1; x <= COLS; x++) {
            if (!wall(x, y)) continue;
            const px = this.ox + x * ts;
            const r = wall(x + 1, y), u = wall(x, y + 1);
            g.rect(px + m, py + m, ts - 2 * m, ts - 2 * m);
            if (r && x < COLS) g.rect(px + ts - m, py + m, 2 * m, ts - 2 * m);
            if (u) g.rect(px + m, py - m, ts - 2 * m, 2 * m);
            if (r && u && x < COLS && wall(x + 1, y + 1)) g.rect(px + ts - m, py - m, 2 * m, 2 * m);
          }
        }
        g.fill();
      }
      zoneStart = zoneEnd + 1;
    }
  }

  drawPickups(view, yBot, yTop, me, t) {
    const g = this.g, ts = this.ts, maze = view.maze, taken = view.taken;
    const y0 = Math.max(0, yBot);
    // Dots, batched per zone colour
    let curTheme = null;
    g.beginPath();
    const dr = Math.max(1.5, ts * 0.09);
    const items = [];
    for (let y = y0; y <= yTop; y++) {
      const th = themeFor(y);
      if (th !== curTheme) {
        if (curTheme) { g.fillStyle = curTheme.dot; g.fill(); g.beginPath(); }
        curTheme = th;
      }
      const row = maze.tiles[y];
      if (!row) continue;
      const py = this.sy(y);
      for (let x = 0; x < COLS; x++) {
        if (!row[x]) continue;
        const k = key(x, y);
        if (taken.has(k)) continue;
        const it = maze.items.get(k);
        if (it) { items.push([x, y, it, k]); continue; }
        const px = this.sx(x);
        g.rect(px - dr, py - dr, dr * 2, dr * 2);
      }
    }
    if (curTheme) { g.fillStyle = curTheme.dot; g.fill(); }

    for (const [x, y, it, k] of items) {
      const px = this.sx(x), py = this.sy(y);
      if (it === 'S') {
        const r = ts * (0.28 + Math.sin(t * 8) * 0.05);
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#ff4dd8'; g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, r + ts * 0.12, 0, Math.PI * 2); g.stroke();
      } else if (it === 'P') {
        const id = itemPower(me ? me.loadout : [], k);
        const def = POWERUPS[id];
        const s = ts * 0.8, bob = Math.sin(t * 4 + x) * ts * 0.05;
        g.fillStyle = def.color;
        roundRect(g, px - s / 2, py - s / 2 + bob, s, s, s * 0.25); g.fill();
        g.fillStyle = '#05060f';
        g.font = `900 ${Math.floor(s * 0.62)}px system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(def.glyph + '︎', px, py + bob + 1);
      } else if (it === 'C') {
        const sq = Math.abs(Math.cos(t * 3 + x * 0.7));
        g.fillStyle = '#ffd84d';
        g.beginPath(); g.ellipse(px, py, ts * 0.28 * Math.max(0.2, sq), ts * 0.28, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#b8860b';
        g.beginPath(); g.ellipse(px, py, ts * 0.13 * Math.max(0.2, sq), ts * 0.13, 0, 0, Math.PI * 2); g.fill();
      } else if (it === 'G') {
        const s = ts * 0.36;
        g.save(); g.translate(px, py); g.rotate(t * 2);
        g.fillStyle = `hsl(${(t * 120) % 360},100%,65%)`;
        g.beginPath(); g.moveTo(0, -s); g.lineTo(s, 0); g.lineTo(0, s); g.lineTo(-s, 0); g.closePath(); g.fill();
        g.restore();
      }
    }
  }

  drawFires(view, t) {
    if (!view.fires.size) return;
    const g = this.g, ts = this.ts;
    for (const [k, rem] of view.fires) {
      const x = k & 31, y = k >> 5;
      const px = this.sx(x), py = this.sy(y);
      const f = 0.7 + Math.sin(t * 20 + k) * 0.3;
      g.globalAlpha = Math.min(1, rem) * 0.85;
      g.fillStyle = '#ff5a1f';
      g.fillRect(px - ts * 0.45, py - ts * 0.45 * f, ts * 0.9, ts * 0.9 * f);
      g.fillStyle = '#ffd84d';
      g.fillRect(px - ts * 0.22, py - ts * 0.25 * f, ts * 0.44, ts * 0.5 * f);
    }
    g.globalAlpha = 1;
  }

  // Draws a shape at x and, if it straddles the wrap edge, at x±COLS.
  wrapDraw(x, fn) {
    fn(x);
    if (x < 0.6) fn(x + COLS);
    else if (x > COLS - 1.6) fn(x - COLS);
  }

  drawEnemy(e, view, me, t) {
    const g = this.g, ts = this.ts;
    const def = ENEMIES[e.type];
    const frozen = view.timers.freeze > 0;
    let color = def.color;
    if (e.vuln > 0) color = e.vuln < 1.5 && Math.floor(t * 8) % 2 ? '#ffffff' : '#2b6cff';
    else if (frozen) color = '#bff4ff';
    let alpha = 1;
    if (e.type === 'phantom' && me && !(e.vuln > 0)) {
      const d = Math.hypot(e.x - me.x, e.y - me.y);
      alpha = Math.max(0.08, Math.min(1, 1.3 - d / 6));
    }
    const r = ts * 0.42;
    const dir = e.dir >= 0 ? e.dir : 2;
    const ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][dir];
    g.globalAlpha = alpha;
    this.wrapDraw(e.x, (ex) => {
      const px = this.sx(ex), py = this.sy(e.y);
      g.save();
      g.translate(px, py);
      g.fillStyle = color;
      g.beginPath();
      switch (e.type) {
        case 'hunter': { // spiky triangle pointing where it goes
          g.rotate(ang);
          g.moveTo(r * 1.1, 0); g.lineTo(-r * 0.8, r * 0.95); g.lineTo(-r * 0.45, 0); g.lineTo(-r * 0.8, -r * 0.95);
          g.closePath(); g.fill(); g.rotate(-ang);
          break;
        }
        case 'flanker':
          g.moveTo(0, -r * 1.1); g.lineTo(r, 0); g.lineTo(0, r * 1.1); g.lineTo(-r, 0); g.closePath(); g.fill();
          break;
        case 'drifter': {
          for (let i = 0; i <= 16; i++) {
            const a = (i / 16) * Math.PI * 2, rr = r * (0.9 + Math.sin(a * 5 + t * 6) * 0.1);
            i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          g.fill();
          break;
        }
        case 'rusher': {
          g.rotate(ang);
          g.moveTo(r * 1.1, 0); g.lineTo(-r * 0.2, r); g.lineTo(-r, r); g.lineTo(r * 0.1, 0); g.lineTo(-r, -r); g.lineTo(-r * 0.2, -r);
          g.closePath(); g.fill(); g.rotate(-ang);
          break;
        }
        case 'phantom':
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + t;
            i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          g.closePath(); g.fill();
          break;
        case 'charger': {
          const spikes = 8, rot = e.dash ? t * 20 : t * 2;
          for (let i = 0; i < spikes * 2; i++) {
            const a = (i / (spikes * 2)) * Math.PI * 2 + rot, rr = i % 2 ? r * 0.65 : r * 1.05;
            i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          g.closePath(); g.fill();
          break;
        }
        default:
          g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      }
      // eyes
      const ex2 = DX[dir] * r * 0.25, ey2 = -DY[dir] * r * 0.25;
      g.fillStyle = e.vuln > 0 ? '#ffd1d1' : '#fff';
      g.beginPath();
      g.arc(-r * 0.3 + ex2, -r * 0.1 + ey2, r * 0.2, 0, Math.PI * 2);
      g.arc(r * 0.3 + ex2, -r * 0.1 + ey2, r * 0.2, 0, Math.PI * 2);
      g.fill();
      if (!(e.vuln > 0)) {
        g.fillStyle = '#05060f';
        g.beginPath();
        g.arc(-r * 0.3 + ex2 * 1.5, -r * 0.1 + ey2 * 1.5, r * 0.09, 0, Math.PI * 2);
        g.arc(r * 0.3 + ex2 * 1.5, -r * 0.1 + ey2 * 1.5, r * 0.09, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    });
    g.globalAlpha = 1;
  }

  drawPlayer(p, view, t, isMe) {
    if (!p.alive) return;
    const g = this.g, ts = this.ts;
    const fx = p.fx || {};
    const face = p.face ?? 0;
    // laser beam
    if (fx.laser) {
      const b = laserBeam(view.maze, p, POWERUPS.laser.stat((p.fxLvl && p.fxLvl.laser) || 1).range);
      const x1 = this.sx(b.x0), y1 = this.sy(b.y0);
      const x2 = this.sx(b.x1 + DX[b.d] * 0.5), y2 = this.sy(b.y1 + DY[b.d] * 0.5);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,77,109,0.45)'; g.lineWidth = ts * (0.5 + Math.sin(t * 40) * 0.08);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = ts * 0.14;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    const moving = p.dir >= 0;
    const squash = p.bite > 0 ? 0.18 : moving ? Math.sin(t * 22) * 0.05 : 0;
    g.globalAlpha = fx.phase ? 0.4 + Math.sin(t * 15) * 0.15 : 1;
    this.wrapDraw(p.x, (x) => {
      const px = this.sx(x), py = this.sy(p.y);
      const horiz = face === 1 || face === 3;
      const s = ts * 0.82;
      const sw = s * (horiz ? 1 + squash : 1 - squash), sh = s * (horiz ? 1 - squash : 1 + squash);
      if (isMe) {
        g.fillStyle = 'rgba(62,242,255,0.18)';
        g.beginPath(); g.arc(px, py, ts * 0.75, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = p.color || '#3ef2ff';
      roundRect(g, px - sw / 2, py - sh / 2, sw, sh, s * 0.32); g.fill();
      // visor eye
      const ex = px + DX[face] * s * 0.18, ey = py - DY[face] * s * 0.18;
      g.fillStyle = '#05060f';
      roundRect(g, ex - s * 0.28, ey - s * 0.17, s * 0.56, s * 0.34, s * 0.16); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex + DX[face] * s * 0.1, ey - DY[face] * s * 0.1, s * 0.1, 0, Math.PI * 2); g.fill();
      if (fx.shield) {
        g.strokeStyle = '#5effa1'; g.lineWidth = 2.5;
        g.beginPath(); g.arc(px, py, ts * (0.68 + Math.sin(t * 10) * 0.04), 0, Math.PI * 2); g.stroke();
      }
      if (!isMe && p.name) {
        g.font = `700 ${Math.max(10, Math.floor(ts * 0.5))}px ui-monospace, monospace`;
        g.textAlign = 'center'; g.textBaseline = 'bottom';
        g.fillStyle = p.color;
        g.fillText(p.name, px, py - ts * 0.55);
      }
    });
    g.globalAlpha = 1;
    if (fx.drone) {
      for (const [dx, dy] of dronePositions(p, t)) {
        const px = this.sx(dx), py = this.sy(dy);
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(px, py, ts * 0.2, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, ts * 0.32, 0, Math.PI * 2); g.stroke();
      }
    }
  }

  drawFx(dt) {
    const g = this.g, ts = this.ts;
    for (const r of this.rings) {
      r.life -= dt;
      const k = 1 - r.life / 0.5;
      g.strokeStyle = r.color; g.globalAlpha = Math.max(0, r.life * 2); g.lineWidth = 4;
      g.beginPath(); g.arc(this.sx(r.x), this.sy(r.y), r.r * ts * k, 0, Math.PI * 2); g.stroke();
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      const s = p.size * ts;
      g.fillRect(this.sx(p.x) - s / 2, this.sy(p.y) - s / 2, s, s);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.max(11, Math.floor(ts * 0.6))}px ui-monospace, monospace`;
    for (const p of this.popups) {
      p.life -= dt; p.y += dt * 1.5;
      g.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      g.fillStyle = p.color;
      g.fillText(p.text, this.sx(p.x), this.sy(p.y));
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    g.globalAlpha = 1;
  }

  drawVoid(voidY, t) {
    const g = this.g, ts = this.ts;
    const top = this.sy(voidY);
    if (top > this.h + 20) return;
    const grad = g.createLinearGradient(0, top, 0, Math.min(this.h, top + ts * 6));
    grad.addColorStop(0, 'rgba(255,42,109,0.85)');
    grad.addColorStop(0.15, 'rgba(60,0,40,0.95)');
    grad.addColorStop(1, 'rgba(8,0,12,1)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-20, this.h + 20);
    const step = ts * 0.5;
    for (let x = -20; x <= this.w + 20; x += step) {
      g.lineTo(x, top + Math.sin(x * 0.05 + t * 6) * ts * 0.15 + (Math.random() - 0.5) * ts * 0.2);
    }
    g.lineTo(this.w + 20, this.h + 20);
    g.closePath();
    g.fill();
    // glitch blocks
    const cols = ['#ff2a6d', '#05d9e8', '#d1f7ff', '#000000', '#7a04eb'];
    for (let i = 0; i < 26; i++) {
      const y = top - ts * 0.8 + Math.random() * Math.max(ts, Math.min(this.h - top + ts, ts * 7));
      g.globalAlpha = 0.25 + Math.random() * 0.5;
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * this.w, y, ts * (0.3 + Math.random() * 3), ts * (0.08 + Math.random() * 0.25));
    }
    g.globalAlpha = 1;
  }
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export { chainMult };
