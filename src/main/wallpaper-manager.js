'use strict';

/**
 * Owns one borderless wallpaper window per monitor, keeps them attached to the desktop,
 * and pauses them when a full-screen app is running or the PC is on battery.
 */

const path = require('node:path');
const { BrowserWindow, screen, powerMonitor } = require('electron');
const desktop = require('./desktop');
const { itemUrl } = require('./protocol');

const WATCHDOG_MS = 3000;

class WallpaperManager {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {(id: string) => object|undefined} deps.getItem
   * @param {() => void} deps.onStateChange
   */
  constructor({ store, getItem, onStateChange }) {
    this.store = store;
    this.getItem = getItem;
    this.onStateChange = onStateChange || (() => {});
    this.windows = new Map(); // displayId -> { win, display, itemId }
    this.autoPaused = false;
    this.autoPauseReason = null;
    this._watchdog = null;
  }

  start() {
    screen.on('display-added', () => this.rebuild());
    screen.on('display-removed', () => this.rebuild());
    screen.on('display-metrics-changed', () => this.relayout());
    powerMonitor.on('on-battery', () => this.checkAutoPause());
    powerMonitor.on('on-ac', () => this.checkAutoPause());
    powerMonitor.on('resume', () => setTimeout(() => this.rebuild(), 1500));
    powerMonitor.on('lock-screen', () => this.checkAutoPause());
    powerMonitor.on('unlock-screen', () => this.checkAutoPause());

    this._watchdog = setInterval(() => {
      if (!desktop.isHostAlive()) {
        // Explorer restarted (or similar): our parent window is gone. Start over.
        this.rebuild();
        return;
      }
      this.checkAutoPause();
    }, WATCHDOG_MS);

    this.rebuild();
  }

  stop() {
    clearInterval(this._watchdog);
    for (const { win } of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
    desktop.restore();
  }

  displays() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: d.label || `Display ${i + 1}`,
      primary: d.id === primary.id,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      itemId: this.store.get('assignments')[String(d.id)] || null,
    }));
  }

  /** Assign a wallpaper to one display, or to all of them when displayId is null. */
  assign(itemId, displayId = null, { unpause = true } = {}) {
    const assignments = { ...this.store.get('assignments') };
    const targets = displayId ? [displayId] : screen.getAllDisplays().map((d) => String(d.id));
    for (const id of targets) {
      if (itemId) assignments[id] = itemId;
      else delete assignments[id];
    }
    // Choosing a wallpaper is a clear signal the user wants to see it move.
    this.store.set(unpause ? { assignments, paused: false } : { assignments });
    for (const id of targets) this.applyToDisplay(id);
    this.onStateChange();
  }

  /** Called after a library rescan: refresh windows whose wallpaper changed or vanished. */
  refreshItems() {
    for (const [id, entry] of this.windows) {
      const item = this.getItem(entry.itemId);
      if (!item || item.mtimeMs !== entry.mtimeMs) this.applyToDisplay(id, true);
    }
    for (const d of screen.getAllDisplays()) {
      if (!this.windows.has(String(d.id))) this.applyToDisplay(String(d.id));
    }
  }

  rebuild() {
    for (const { win } of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
    for (const d of screen.getAllDisplays()) this.applyToDisplay(String(d.id));
    this.onStateChange();
  }

  relayout() {
    for (const [id, entry] of this.windows) {
      const display = screen.getAllDisplays().find((d) => String(d.id) === id);
      if (!display) continue;
      entry.display = display;
      this.place(entry.win, display);
    }
  }

  place(win, display) {
    if (win.isDestroyed()) return;
    if (process.platform === 'win32') {
      // Once parented into the desktop, Electron's setBounds would use the wrong coordinate
      // space, so the Win32 module positions the window itself (in physical pixels).
      desktop.attach(win, screen.dipToScreenRect(null, display.bounds));
    } else {
      win.setBounds(display.bounds);
      desktop.attach(win, display.bounds);
    }
  }

  applyToDisplay(displayId, force = false) {
    const display = screen.getAllDisplays().find((d) => String(d.id) === displayId);
    const itemId = this.store.get('assignments')[displayId];
    const item = itemId && this.getItem(itemId);
    const existing = this.windows.get(displayId);

    if (!display || !item || item.unsupported) {
      if (existing && !existing.win.isDestroyed()) existing.win.destroy();
      this.windows.delete(displayId);
      if (existing) desktop.restore();
      return;
    }

    if (existing && !existing.win.isDestroyed()) {
      if (!force && existing.itemId === item.id) return;
      existing.itemId = item.id;
      existing.mtimeMs = item.mtimeMs;
      this.load(existing.win, item);
      return;
    }

    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      title: 'LiveDesk Wallpaper',
      ...desktop.windowOptions(),
      webPreferences: {
        preload: path.join(__dirname, 'preload-wallpaper.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
      },
    });
    win.setMenu(null);
    // Wallpapers are untrusted content: no popups, no navigating away.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('render-process-gone', () => setTimeout(() => this.applyToDisplay(displayId, true), 1000));
    win.on('closed', () => {
      const cur = this.windows.get(displayId);
      if (cur && cur.win === win) this.windows.delete(displayId);
    });

    const entry = { win, display, itemId: item.id, mtimeMs: item.mtimeMs };
    this.windows.set(displayId, entry);

    win.once('ready-to-show', () => {
      win.showInactive();
      this.place(win, display);
      this.pushPlayback(entry);
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'wallpaper', 'index.html'));
    win.webContents.once('did-finish-load', () => this.load(win, item));
  }

  async load(win, item) {
    if (win.isDestroyed()) return;
    await this.setFrozen(win, false); // a frozen page can't process the load message
    if (win.isDestroyed()) return;
    win.webContents.send('wallpaper:load', {
      kind: item.kind,
      url: itemUrl(item),
      fit: this.store.get('fit'),
      volume: this.store.get('volume'),
      playbackRate: this.store.get('playbackRate'),
    });
    this.pushPlayback(this.findEntry(win));
  }

  findEntry(win) {
    for (const e of this.windows.values()) if (e.win === win) return e;
    return null;
  }

  /** Push live settings (fit/volume/rate) to all windows without reloading. */
  updateSettings() {
    for (const { win } of this.windows.values()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('wallpaper:settings', {
        fit: this.store.get('fit'),
        volume: this.store.get('volume'),
        playbackRate: this.store.get('playbackRate'),
      });
    }
    this.checkAutoPause();
  }

  isPaused() {
    return this.store.get('paused') || this.autoPaused;
  }

  setPaused(paused) {
    this.store.set({ paused });
    this.syncPlayback();
  }

  checkAutoPause() {
    let reason = null;
    try {
      if (this.store.get('pauseOnFullscreen') && desktop.isFullscreenAppRunning()) reason = 'fullscreen app';
      else if (this.store.get('pauseOnBattery') && powerMonitor.isOnBatteryPower()) reason = 'on battery';
    } catch (err) {
      console.error('auto-pause check failed', err);
    }
    if (Boolean(reason) !== this.autoPaused || reason !== this.autoPauseReason) {
      this.autoPaused = Boolean(reason);
      this.autoPauseReason = reason;
      this.syncPlayback();
    }
  }

  syncPlayback() {
    for (const entry of this.windows.values()) this.pushPlayback(entry);
    this.onStateChange();
  }

  async pushPlayback(entry) {
    if (!entry || entry.win.isDestroyed()) return;
    const { win } = entry;
    const paused = this.isPaused();
    if (!paused) {
      // Thaw first, otherwise the page can't receive the "play" message.
      await this.setFrozen(win, false);
      if (!win.isDestroyed()) win.webContents.send('wallpaper:playback', { paused: false });
      return;
    }
    win.webContents.send('wallpaper:playback', { paused: true });
    // Then freeze the page entirely (timers, requestAnimationFrame, workers) so a paused
    // wallpaper costs ~0% CPU/GPU. The last frame stays on screen.
    setTimeout(() => {
      if (!win.isDestroyed() && this.isPaused()) this.setFrozen(win, true);
    }, 250);
  }

  async setFrozen(win, frozen) {
    if (win.isDestroyed()) return;
    const wc = win.webContents;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: frozen ? 'frozen' : 'active' });
    } catch {
      /* debugger unavailable: the renderer-level pause still applies */
    }
  }

  state() {
    return {
      paused: this.isPaused(),
      manualPaused: Boolean(this.store.get('paused')),
      autoPauseReason: this.autoPauseReason,
      desktopMode: desktop.describe(),
    };
  }
}

module.exports = { WallpaperManager };
