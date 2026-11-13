'use strict';

/**
 * Generates assets/icon.png (512px, app/installer icon) and assets/tray.png (+@2x).
 * Pure Node (no image libraries): rasterises a rounded gradient square with a wave
 * and writes PNGs by hand. Run with: node scripts/make-icons.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shape functions work in unit space [0,1]^2.
function insideRoundRect(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

function sample(x, y) {
  if (!insideRoundRect(x, y, 0.22)) return null;
  // diagonal gradient #6c8cff -> #9b6cff
  const t = (x + y) / 2;
  let r = 0x6c + (0x9b - 0x6c) * t;
  let g = 0x8c + (0x6c - 0x8c) * t;
  let b = 0xff;
  // two white waves ("live" motion)
  const w1 = 0.56 + 0.09 * Math.sin((x - 0.12) * Math.PI * 2.4);
  const w2 = 0.72 + 0.07 * Math.sin((x + 0.1) * Math.PI * 2.4);
  const inBand = x > 0.16 && x < 0.84;
  if (inBand && Math.abs(y - w1) < 0.045) return [255, 255, 255];
  if (inBand && Math.abs(y - w2) < 0.035) return [255, 255, 255, 0.75, r, g, b];
  // sun
  const sx = x - 0.66;
  const sy = y - 0.3;
  if (sx * sx + sy * sy < 0.011) return [255, 236, 170];
  return [r, g, b];
}

function render(size) {
  const ss = 4; // supersampling
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (!s) continue;
          let [r, g, b] = s;
          if (s.length === 7) {
            const a = s[3];
            r = r * a + s[4] * (1 - a);
            g = g * a + s[5] * (1 - a);
            b = b * a + s[6] * (1 - a);
          }
          R += r; G += g; B += b; A += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (A) {
        out[i] = Math.round(R / A);
        out[i + 1] = Math.round(G / A);
        out[i + 2] = Math.round(B / A);
      }
      out[i + 3] = Math.round((A / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.png'), render(512));
fs.writeFileSync(path.join(assets, 'tray.png'), render(16));
fs.writeFileSync(path.join(assets, 'tray@2x.png'), render(32));
console.log('icons written to', assets);
