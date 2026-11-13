'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanLibrary, resolveItemFile } = require('../src/main/library');
const { injectCompat } = require('../src/main/protocol');

function makeLibrary(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'livedesk-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('finds loose videos, images and html files', () => {
  const root = makeLibrary({
    'ocean_waves.mp4': 'x',
    'sub/folder/city-night.webm': 'x',
    'still.png': 'x',
    'clock.html': '<html></html>',
    'notes.txt': 'ignored',
    'README.txt': 'ignored',
  });
  const items = scanLibrary(root);
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['city night', 'clock', 'ocean waves', 'still']);
  assert.equal(byTitle['ocean waves'].kind, 'video');
  assert.equal(byTitle['city night'].kind, 'video');
  assert.equal(byTitle['city night'].entry, 'city-night.webm');
  assert.equal(byTitle.still.kind, 'image');
  assert.equal(byTitle.still.preview, 'still.png');
  assert.equal(byTitle.clock.kind, 'web');
});

test('treats a folder with index.html as one web wallpaper', () => {
  const root = makeLibrary({
    'Particles/index.html': '<html></html>',
    'Particles/js/app.js': '',
    'Particles/img/bg.png': 'x',
    'Particles/preview.jpg': 'x',
  });
  const items = scanLibrary(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'web');
  assert.equal(items[0].entry, 'index.html');
  assert.equal(items[0].preview, 'preview.jpg');
  assert.equal(items[0].title, 'Particles');
});

test('reads Wallpaper Engine project.json (video, web, scene)', () => {
  const root = makeLibrary({
    '111/project.json': '﻿' + JSON.stringify({ title: 'Rainy Tokyo', type: 'video', file: 'rain.mp4', preview: 'preview.gif' }),
    '111/rain.mp4': 'x',
    '111/preview.gif': 'x',
    '222/project.json': JSON.stringify({
      title: 'Audio Bars',
      type: 'web',
      file: 'index.html',
      general: { properties: { barcolor: { type: 'color', value: '1 0 0' }, schemecolor: { value: '0 0 1' } } },
    }),
    '222/index.html': '<html></html>',
    '333/project.json': JSON.stringify({ title: 'Scene Thing', type: 'scene', file: 'scene.json' }),
    '333/scene.pkg': 'x',
    '444/project.json': JSON.stringify({ title: 'Broken', type: 'video', file: 'missing.mp4' }),
    '555/project.json': JSON.stringify({ title: 'Sneaky', type: 'video', file: '../111/rain.mp4' }),
  });
  const items = scanLibrary(root);
  const by = Object.fromEntries(items.map((i) => [i.title, i]));

  assert.equal(by['Rainy Tokyo'].kind, 'video');
  assert.equal(by['Rainy Tokyo'].entry, 'rain.mp4');
  assert.equal(by['Rainy Tokyo'].preview, 'preview.gif');
  assert.equal(by['Rainy Tokyo'].unsupported, null);

  assert.equal(by['Audio Bars'].kind, 'web');
  assert.deepEqual(by['Audio Bars'].properties, { barcolor: { value: '1 0 0' }, schemecolor: { value: '0 0 1' } });

  assert.match(by['Scene Thing'].unsupported, /scene/);
  assert.match(by.Broken.unsupported, /missing/);
  assert.match(by.Sneaky.unsupported, /missing/, 'entry outside the project folder is refused');

  // assets inside project folders are not listed separately
  assert.equal(items.length, 5);
});

test('ids are stable and hostname-safe', () => {
  const root = makeLibrary({ 'a/b.mp4': 'x' });
  const [a] = scanLibrary(root);
  const [b] = scanLibrary(root);
  assert.equal(a.id, b.id);
  assert.match(a.id, /^[0-9a-f]{16}$/);
});

test('missing library folder yields an empty list', () => {
  assert.deepEqual(scanLibrary(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now())), []);
});

test('resolveItemFile refuses path traversal', () => {
  const root = makeLibrary({ 'site/index.html': '', 'site/css/a.css': '', 'secret.txt': '' });
  const [item] = scanLibrary(root).filter((i) => i.kind === 'web');
  assert.equal(resolveItemFile(item, '/css/a.css'), path.join(root, 'site', 'css', 'a.css'));
  assert.equal(resolveItemFile(item, '/css/../index.html'), path.join(root, 'site', 'index.html'));
  assert.equal(resolveItemFile(item, '/..%2fsecret.txt'), null);
  assert.equal(resolveItemFile(item, '/%2e%2e/secret.txt'), null);
  assert.equal(resolveItemFile(item, '/'), null);
  assert.equal(resolveItemFile(item, '/%E0%A4%A'), null);
});

test('compat shim is injected into <head> and escapes properties', () => {
  const item = { properties: { evil: { value: '</script><script>alert(1)</script>' } } };
  const out = injectCompat('<html><head><title>x</title></head><body></body></html>', item);
  assert.ok(out.startsWith('<html><head><script>'));
  assert.ok(out.includes('wallpaperRegisterAudioListener'));
  assert.ok(!out.includes('</script><script>alert(1)'));
  const noHead = injectCompat('<canvas></canvas>', { properties: {} });
  assert.ok(noHead.startsWith('<script>'));
});
