// Renders build/icon.svg to PNGs and a multi-size Windows .ico.
// Usage: node build/make-icons.js   (needs the `playwright` package)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pngs = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    pngs.push(await page.screenshot({ omitBackground: true }));
  }
  await browser.close();

  fs.writeFileSync(path.join(__dirname, 'icon.png'), pngs[SIZES.indexOf(256)]);

  // ICO = 6-byte header + 16-byte directory entry per image + PNG data.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(SIZES.length, 4);
  let offset = 6 + 16 * SIZES.length;
  const entries = SIZES.map((size, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
  console.log('Wrote build/icon.png and build/icon.ico');
})();
