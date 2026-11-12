/*
 * End-to-end smoke test: serves the app, loads generated WAV files into it
 * in headless Chromium, and checks playback, playlist and controls.
 *
 *   npm run test:e2e
 *
 * Requires the `playwright` package and a Chromium build it can launch.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

/** Builds a mono 16-bit PCM WAV file containing a sine tone. */
function makeWav(seconds, freq = 440, sampleRate = 22050) {
  const samples = Math.floor(seconds * sampleRate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000), 44 + i * 2);
  }
  return buf;
}

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

  const state = () => page.evaluate(() => {
    const { playlist, media } = window.sherlock;
    return {
      count: playlist.length,
      current: playlist.current && playlist.current.name,
      paused: media.paused,
      time: media.currentTime,
    };
  });

  try {
    await page.goto(url);
    assert.equal(await page.textContent('#playlist-count'), '0');
    assert.ok(await page.isVisible('#empty-state'));

    // 1. Add three tracks plus one unsupported file.
    await page.setInputFiles('#file-input', [
      { name: 'Alpha.wav', mimeType: 'audio/wav', buffer: makeWav(1.2, 440) },
      { name: 'Bravo.wav', mimeType: 'audio/wav', buffer: makeWav(4, 550) },
      { name: 'Charlie.wav', mimeType: 'audio/wav', buffer: makeWav(4, 660) },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('nope') },
    ]);
    assert.equal(await page.textContent('#playlist-count'), '3', 'unsupported file is skipped');
    assert.deepEqual(
      await page.$$eval('.track-name', (els) => els.map((e) => e.textContent)),
      ['Alpha', 'Bravo', 'Charlie'],
    );

    // 2. First track autoplays, shown as audio.
    await page.waitForFunction(() => !window.sherlock.media.paused);
    let s = await state();
    assert.equal(s.current, 'Alpha');
    assert.ok(await page.isVisible('#audio-card'));
    assert.equal(await page.textContent('#audio-title'), 'Alpha');

    // 3. Durations get filled in.
    await page.waitForFunction(() => [...document.querySelectorAll('.track-duration')].every((e) => e.textContent));
    assert.deepEqual(
      await page.$$eval('.track-duration', (els) => els.map((e) => e.textContent)),
      ['0:01', '0:04', '0:04'],
    );

    // 4. Short first track ends and auto-advances.
    await page.waitForFunction(() => window.sherlock.playlist.current.name === 'Bravo', null, { timeout: 5000 });
    await page.waitForFunction(() => window.sherlock.media.currentTime > 0.2);
    assert.equal(await page.textContent('.track.is-current .track-name'), 'Bravo');

    // 5. Space pauses and resumes.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.sherlock.media.paused);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !window.sherlock.media.paused);

    // 6. Next button / clicking a track.
    await page.click('#next-btn');
    await page.waitForFunction(() => window.sherlock.playlist.current.name === 'Charlie');
    await page.click('.track:nth-child(1)');
    await page.waitForFunction(() => window.sherlock.playlist.current.name === 'Alpha');

    // 7. Seek with number key: 5 => 50%.
    await page.click('.track:nth-child(2)');
    await page.waitForFunction(() => window.sherlock.playlist.current.name === 'Bravo' && window.sherlock.media.duration > 0);
    await page.keyboard.press('5');
    await page.waitForFunction(() => window.sherlock.media.currentTime >= 1.9);

    // 8. Volume, mute and settings persistence.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('m');
    const vol = await page.evaluate(() => [window.sherlock.media.volume, window.sherlock.media.muted]);
    assert.ok(Math.abs(vol[0] - 0.9) < 0.001, `volume was ${vol[0]}`);
    assert.equal(vol[1], true);
    await page.waitForFunction(() => document.querySelector('#mute-btn').classList.contains('is-muted'));

    await page.keyboard.press('r');
    assert.equal(await page.getAttribute('#repeat-btn', 'data-mode'), 'all');
    await page.keyboard.press('s');
    assert.equal(await page.getAttribute('#shuffle-btn', 'aria-pressed'), 'true');

    // 9. Removing the current track moves on to the next one.
    await page.hover('.track:nth-child(2)');
    await page.click('.track:nth-child(2) .track-remove');
    s = await state();
    assert.equal(s.count, 2);
    assert.equal(s.current, 'Charlie');

    // 10. Settings survive a reload.
    await page.reload();
    const restored = await page.evaluate(() => ({
      volume: window.sherlock.media.volume,
      muted: window.sherlock.media.muted,
      repeat: window.sherlock.playlist.repeat,
      shuffle: window.sherlock.playlist.shuffle,
    }));
    assert.ok(Math.abs(restored.volume - 0.9) < 0.001);
    assert.equal(restored.muted, true);
    assert.equal(restored.repeat, 'all');
    assert.equal(restored.shuffle, true);

    // 11. Clear.
    await page.setInputFiles('#file-input', [
      { name: 'Delta.wav', mimeType: 'audio/wav', buffer: makeWav(2) },
    ]);
    await page.click('#clear-btn');
    s = await state();
    assert.equal(s.count, 0);
    assert.equal(s.current, null);
    assert.ok(await page.isVisible('#empty-state'));

    assert.deepEqual(errors, [], 'no page errors');
    console.log('e2e: all checks passed');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
