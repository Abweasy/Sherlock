// Every texture in the game is painted on a <canvas> here, so there are no image assets to ship.
import * as THREE from 'three';
import { SYMBOLS } from '../../shared/constants.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Small seeded RNG so procedural textures look the same for both players.
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function toTexture(c, { repeat, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function noise(ctx, w, h, amount, seed, alpha = 0.06) {
  const r = rng(seed);
  for (let i = 0; i < amount; i++) {
    const v = r() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

export function woodPlanks({ base = '#6b4428', seed = 3 } = {}) {
  const [c, ctx] = canvas(512);
  const r = rng(seed);
  const plankH = 64;
  for (let y = 0; y < 512; y += plankH) {
    const offset = r() * 512;
    for (let x = -offset; x < 512; x += 256 + r() * 128) {
      const shade = 0.82 + r() * 0.3;
      ctx.fillStyle = shadeColor(base, shade);
      ctx.fillRect(x, y, 512, plankH);
      // grain
      for (let g = 0; g < 14; g++) {
        ctx.strokeStyle = `rgba(30,15,5,${0.05 + r() * 0.12})`;
        ctx.lineWidth = 1 + r() * 2;
        const gy = y + r() * plankH;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + 80, gy + r() * 6 - 3, x + 160, gy + r() * 6 - 3, x + 300, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,10,4,0.55)';
      ctx.fillRect(x, y, 3, plankH);
    }
    ctx.fillStyle = 'rgba(20,10,4,0.6)';
    ctx.fillRect(0, y, 512, 3);
  }
  noise(ctx, 512, 512, 4000, seed);
  return c;
}

export function wallpaper() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#23402f';
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 64) {
    ctx.fillStyle = '#2b4d39';
    ctx.fillRect(x + 20, 0, 24, 256);
    ctx.fillStyle = 'rgba(214,180,100,0.35)';
    ctx.fillRect(x + 18, 0, 2, 256);
    ctx.fillRect(x + 44, 0, 2, 256);
  }
  // little gold fleurs
  ctx.fillStyle = 'rgba(214,180,100,0.45)';
  for (let y = 16; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      ctx.save();
      ctx.translate(x + 0, y + (x % 128 ? 32 : 0));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
  }
  noise(ctx, 256, 256, 2500, 7, 0.05);
  return c;
}

export function bricks() {
  const [c, ctx] = canvas(512);
  ctx.fillStyle = '#8f8576';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(11);
  const bw = 128;
  const bh = 48;
  for (let row = 0; row * bh < 512; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -off; x < 512; x += bw) {
      const tone = 0.75 + r() * 0.35;
      ctx.fillStyle = shadeColor('#9c4a32', tone);
      ctx.fillRect(x + 4, row * bh + 4, bw - 8, bh - 8);
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
      ctx.fillRect(x + 4, row * bh + bh - 12, bw - 8, 8);
    }
  }
  noise(ctx, 512, 512, 9000, 12, 0.1);
  return c;
}

export function stoneTiles() {
  const [c, ctx] = canvas(512);
  const r = rng(21);
  const s = 128;
  for (let y = 0; y < 512; y += s) {
    for (let x = 0; x < 512; x += s) {
      ctx.fillStyle = shadeColor('#6d665c', 0.8 + r() * 0.3);
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = 'rgba(30,25,20,0.7)';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
    }
  }
  noise(ctx, 512, 512, 12000, 22, 0.12);
  return c;
}

export function rug() {
  const [c, ctx] = canvas(512, 384);
  ctx.fillStyle = '#6e1f23';
  ctx.fillRect(0, 0, 512, 384);
  const bands = [
    [0, '#3c1013'],
    [14, '#c79b4c'],
    [22, '#2f3d63'],
    [44, '#c79b4c'],
    [50, '#7a2328'],
  ];
  for (const [inset, color] of bands) {
    ctx.fillStyle = color;
    ctx.fillRect(inset, inset, 512 - inset * 2, 384 - inset * 2);
  }
  // medallion
  ctx.save();
  ctx.translate(256, 192);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ['#2f3d63', '#c79b4c', '#7a2328', '#d9c08a'][i];
    ctx.beginPath();
    ctx.ellipse(0, 0, 110 - i * 24, 70 - i * 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  noise(ctx, 512, 384, 6000, 31, 0.1);
  return c;
}

export function velvet() {
  const [c, ctx] = canvas(256);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 8; i++) {
    g.addColorStop(i / 8, i % 2 ? '#5a0f16' : '#9c1f2a');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#d6aa4f';
  ctx.fillRect(0, 236, 256, 20);
  return c;
}

export function glow() {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

export function contactShadow() {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

// ---------- symbols ----------

export function drawSymbol(ctx, name, x, y, size, color) {
  const r = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (name) {
    case 'moon': {
      ctx.arc(0, 0, r, Math.PI * 0.32, Math.PI * 1.68, false);
      ctx.arc(r * 0.45, 0, r * 0.82, Math.PI * 1.55, Math.PI * 0.45, true);
      break;
    }
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? r * 0.42 : r;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      break;
    }
    case 'triangle':
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.95, r * 0.75);
      ctx.lineTo(-r * 0.95, r * 0.75);
      break;
    case 'circle':
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
      break;
    case 'diamond':
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.65, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.65, 0);
      break;
    case 'cross': {
      const t = r * 0.32;
      ctx.rect(-t, -r * 0.9, t * 2, r * 1.8);
      ctx.rect(-r * 0.9, -t, r * 1.8, t * 2);
      break;
    }
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      }
      break;
  }
  ctx.closePath();
  ctx.fill('nonzero');
  ctx.restore();
}

export function dialFace(symbolIndex) {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(50, 45, 5, 64, 64, 64);
  g.addColorStop(0, '#f6dc94');
  g.addColorStop(1, '#a8802f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 63, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5c4314';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.stroke();
  drawSymbol(ctx, SYMBOLS[symbolIndex], 64, 64, 70, '#2a1d08');
  return c;
}

export function chalkboard(target) {
  const [c, ctx] = canvas(1024, 640);
  ctx.fillStyle = '#1f3127';
  ctx.fillRect(0, 0, 1024, 640);
  // chalk dust smudges
  const r = rng(5);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
    ctx.beginPath();
    ctx.ellipse(r() * 1024, r() * 640, 40 + r() * 120, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(240,240,230,0.9)';
  ctx.font = 'italic 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('The safe remembers...', 512, 90);
  const xs = [232, 512, 792];
  target.forEach((s, i) => {
    ctx.font = 'bold 44px Georgia, serif';
    ctx.fillStyle = 'rgba(240,240,230,0.75)';
    ctx.fillText(String(i + 1), xs[i], 190);
    drawSymbol(ctx, SYMBOLS[s], xs[i], 360, 200, 'rgba(245,245,235,0.92)');
  });
  ctx.strokeStyle = 'rgba(240,240,230,0.6)';
  ctx.lineWidth = 6;
  for (const x of [372, 652]) {
    ctx.beginPath();
    ctx.moveTo(x - 20, 360);
    ctx.lineTo(x + 20, 360);
    ctx.lineTo(x + 6, 346);
    ctx.moveTo(x + 20, 360);
    ctx.lineTo(x + 6, 374);
    ctx.stroke();
  }
  ctx.font = 'italic 36px Georgia, serif';
  ctx.fillStyle = 'rgba(240,240,230,0.55)';
  ctx.fillText('left to right', 512, 560);
  noise(ctx, 1024, 640, 20000, 9, 0.08);
  return c;
}

export function note(timeText) {
  const [c, ctx] = canvas(512, 360);
  ctx.fillStyle = '#efe2c2';
  ctx.fillRect(0, 0, 512, 360);
  const g = ctx.createRadialGradient(256, 180, 80, 256, 180, 320);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(120,80,30,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 360);
  ctx.fillStyle = '#2b1d10';
  ctx.textAlign = 'center';
  ctx.font = 'italic 34px Georgia, serif';
  ctx.fillText('The vault wakes at', 256, 110);
  ctx.font = 'bold 96px Georgia, serif';
  ctx.fillText(timeText, 256, 225);
  ctx.font = 'italic 28px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.fillText('— H.', 460, 310);
  noise(ctx, 512, 360, 5000, 13, 0.08);
  return c;
}

export function clockFace() {
  const [c, ctx] = canvas(512);
  ctx.fillStyle = '#f1e6cc';
  ctx.beginPath();
  ctx.arc(256, 256, 254, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a2a14';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(256, 256, 236, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    ctx.lineWidth = long ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(256 + Math.sin(a) * 230, 256 - Math.cos(a) * 230);
    ctx.lineTo(256 + Math.sin(a) * (long ? 200 : 215), 256 - Math.cos(a) * (long ? 200 : 215));
    ctx.stroke();
  }
  ctx.fillStyle = '#2a1d0c';
  ctx.font = 'bold 54px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    ctx.fillText(String(h), 256 + Math.sin(a) * 162, 258 - Math.cos(a) * 162);
  }
  ctx.font = 'italic 22px Georgia, serif';
  ctx.fillText('HOLLIS', 256, 340);
  return c;
}

export function plaque(text, { w = 512, h = 128, bg = '#b8913f', fg = '#2b1d08', font = 'bold 64px Georgia, serif' } = {}) {
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shadeColor(bg, 1.25));
  g.addColorStop(1, shadeColor(bg, 0.8));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = shadeColor(bg, 0.5);
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  return c;
}

export function nameTag(text, color = '#ffffff') {
  const [c, ctx] = canvas(512, 128);
  ctx.font = 'bold 56px system-ui, sans-serif';
  const w = Math.min(500, ctx.measureText(text).width + 60);
  ctx.fillStyle = 'rgba(15,12,10,0.75)';
  roundRect(ctx, 256 - w / 2, 20, w, 88, 40);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);
  return c;
}

export function painting(kind) {
  const [c, ctx] = canvas(256, 320);
  if (kind === 'portrait') {
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, '#5f4a33');
    g.addColorStop(1, '#2c2118');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#16100b';
    // shoulders, head, hat with a brim front and back, a pipe
    ctx.beginPath();
    ctx.ellipse(128, 330, 120, 90, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(128, 170, 46, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(128, 118, 66, 22, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(126, 104, 44, 32, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(160, 196, 44, 9);
    ctx.fillRect(196, 186, 14, 26);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, '#f3c27a');
    g.addColorStop(0.55, '#c9774a');
    g.addColorStop(1, '#3e3a52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#f8e2a8';
    ctx.beginPath();
    ctx.arc(170, 150, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3f57';
    ctx.beginPath();
    ctx.moveTo(0, 230);
    ctx.quadraticCurveTo(90, 160, 160, 220);
    ctx.quadraticCurveTo(210, 190, 256, 210);
    ctx.lineTo(256, 320);
    ctx.lineTo(0, 320);
    ctx.fill();
    ctx.fillStyle = '#2b2638';
    ctx.beginPath();
    ctx.moveTo(0, 270);
    ctx.quadraticCurveTo(120, 230, 256, 280);
    ctx.lineTo(256, 320);
    ctx.lineTo(0, 320);
    ctx.fill();
  }
  noise(ctx, 256, 320, 3000, 17, 0.08);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shadeColor(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
