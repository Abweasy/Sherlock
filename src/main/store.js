'use strict';

/** Tiny JSON settings store kept in the app's userData folder. */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  libraryPath: null, // filled in on first run
  // displayId -> wallpaper id
  assignments: {},
  fit: 'cover', // cover | contain | fill | center
  volume: 0, // 0..1, applies to video wallpapers
  playbackRate: 1,
  pauseOnFullscreen: true,
  pauseOnBattery: true,
  paused: false,
  launchAtLogin: false,
  shuffleMinutes: 0, // 0 = off
  favorites: [],
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object') this.data = { ...DEFAULTS, ...raw };
    } catch {
      /* first run or corrupt file: use defaults */
    }
    this._timer = null;
  }

  get(key) {
    return this.data[key];
  }

  all() {
    return { ...this.data };
  }

  set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULTS) this.data[k] = v;
    }
    this.save();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }
}

module.exports = { Store, DEFAULTS };
