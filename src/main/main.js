'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  screen,
} = require('electron');

const { Store } = require('./store');
const { scanLibrary } = require('./library');
const { registerSchemePrivileges, registerProtocol, itemUrl } = require('./protocol');
const { WallpaperManager } = require('./wallpaper-manager');

const APP_ID = 'com.livedesk.app';
const ASSETS = path.join(__dirname, '..', '..', 'assets');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

registerSchemePrivileges();
app.setAppUserModelId(APP_ID);
// Video wallpapers should never need a click to start playing.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let store;
let manager;
let tray = null;
let libraryWindow = null;
let items = [];
let itemsById = new Map();
let watcher = null;
let pollTimer = null;
let rescanTimer = null;
let shuffleTimer = null;
let thumbDir;
let quitting = false;

// ---------------------------------------------------------------------------
// Library folder
// ---------------------------------------------------------------------------

function defaultLibraryPath() {
  return path.join(app.getPath('videos'), 'LiveDesk Wallpapers');
}

function libraryPath() {
  return store.get('libraryPath');
}

function ensureLibraryFolder() {
  try {
    fs.mkdirSync(libraryPath(), { recursive: true });
    const readme = path.join(libraryPath(), 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        [
          'Drop live wallpapers into this folder and they will show up in LiveDesk automatically.',
          '',
          'Supported:',
          '  - Videos: .mp4 .webm .m4v .mov .mkv',
          '  - Images: .jpg .png .webp .gif .avif .bmp',
          '  - Web wallpapers: a folder with an index.html (or a single .html file)',
          '  - Wallpaper Engine "video" and "web" wallpapers (folders with a project.json)',
          '',
          'Subfolders are fine; organise however you like.',
          '',
        ].join('\r\n')
      );
    }
  } catch (err) {
    console.error('Could not create library folder', err);
  }
}

function thumbFile(id) {
  return path.join(thumbDir, `${id}.jpg`);
}

function thumbUrlFor(item) {
  if (item.preview) return itemUrl(item, item.preview);
  try {
    const st = fs.statSync(thumbFile(item.id));
    return `wallpaper://thumb/${item.id}.jpg?v=${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

function rescan() {
  items = scanLibrary(libraryPath());
  itemsById = new Map(items.map((i) => [i.id, i]));
  if (manager) manager.refreshItems();
  queueWebThumbnails();
  notifyUi();
}

function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(rescan, 800);
}

function startWatching() {
  stopWatching();
  ensureLibraryFolder();
  try {
    watcher = fs.watch(libraryPath(), { recursive: true }, scheduleRescan);
    watcher.on('error', () => {
      stopWatching();
      pollTimer = setInterval(rescan, 15000);
    });
  } catch {
    // Some file systems (network drives) don't support watching; poll instead.
    pollTimer = setInterval(rescan, 15000);
  }
  rescan();
}

function stopWatching() {
  if (watcher) watcher.close();
  watcher = null;
  clearInterval(pollTimer);
  pollTimer = null;
}

// ---------------------------------------------------------------------------
// Thumbnails for web wallpapers (videos are thumbnailed by the library UI)
// ---------------------------------------------------------------------------

const thumbQueue = [];
let thumbBusy = false;

function queueWebThumbnails() {
  for (const item of items) {
    if (item.kind !== 'web' || item.preview || item.unsupported) continue;
    if (fs.existsSync(thumbFile(item.id)) || thumbQueue.includes(item.id)) continue;
    thumbQueue.push(item.id);
  }
  pumpThumbs();
}

async function pumpThumbs() {
  if (thumbBusy) return;
  const id = thumbQueue.shift();
  const item = id && itemsById.get(id);
  if (!item) {
    if (thumbQueue.length) setImmediate(pumpThumbs);
    return;
  }
  thumbBusy = true;
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  try {
    await Promise.race([win.loadURL(itemUrl(item)), new Promise((r) => setTimeout(r, 8000))]);
    await new Promise((r) => setTimeout(r, 2500)); // let animations get going
    const image = await win.capturePage();
    if (!image.isEmpty()) {
      fs.mkdirSync(thumbDir, { recursive: true });
      fs.writeFileSync(thumbFile(item.id), image.resize({ width: 480 }).toJPEG(80));
      notifyUi();
    }
  } catch (err) {
    console.error('thumbnail failed for', item.title, err.message);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    thumbBusy = false;
    if (thumbQueue.length) setTimeout(pumpThumbs, 200);
  }
}

// ---------------------------------------------------------------------------
// Library window + tray
// ---------------------------------------------------------------------------

function uiState() {
  const favorites = new Set(store.get('favorites'));
  return {
    libraryPath: libraryPath(),
    settings: store.all(),
    displays: manager.displays(),
    playback: manager.state(),
    platform: process.platform,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      relPath: i.relPath,
      source: i.source,
      unsupported: i.unsupported,
      url: i.unsupported ? null : itemUrl(i),
      thumbUrl: thumbUrlFor(i),
      favorite: favorites.has(i.id),
    })),
  };
}

function notifyUi() {
  updateTrayMenu();
  if (libraryWindow && !libraryWindow.isDestroyed()) libraryWindow.webContents.send('lib:state', uiState());
}

function openLibrary() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    if (libraryWindow.isMinimized()) libraryWindow.restore();
    libraryWindow.show();
    libraryWindow.focus();
    return;
  }
  libraryWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'LiveDesk',
    backgroundColor: '#0f1117',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-library.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  libraryWindow.setMenu(null);
  libraryWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  libraryWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  libraryWindow.once('ready-to-show', () => libraryWindow.show());
  // Closing the library just closes the window; wallpapers keep running from the tray.
  libraryWindow.on('closed', () => (libraryWindow = null));
  libraryWindow.loadFile(path.join(__dirname, '..', 'renderer', 'library', 'index.html'));
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('LiveDesk');
  tray.on('click', openLibrary);
  tray.on('double-click', openLibrary);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray || !manager) return;
  const st = manager.state();
  const pauseLabel = st.manualPaused ? 'Resume wallpapers' : 'Pause wallpapers';
  tray.setToolTip(st.paused ? `LiveDesk (paused${st.autoPauseReason ? `: ${st.autoPauseReason}` : ''})` : 'LiveDesk');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open LiveDesk', click: openLibrary },
      { type: 'separator' },
      { label: pauseLabel, click: () => manager.setPaused(!st.manualPaused) },
      { label: 'Next wallpaper', click: () => nextWallpaper(true) },
      { label: 'Open wallpaper folder', click: () => shell.openPath(libraryPath()) },
      { type: 'separator' },
      { label: 'Quit LiveDesk', click: () => app.quit() },
    ])
  );
}

// ---------------------------------------------------------------------------
// Shuffle
// ---------------------------------------------------------------------------

function nextWallpaper(unpause) {
  const usable = items.filter((i) => !i.unsupported);
  const favs = new Set(store.get('favorites'));
  const favItems = usable.filter((i) => favs.has(i.id));
  const pool = favItems.length >= 2 ? favItems : usable;
  if (!pool.length) return;
  const assignments = store.get('assignments');
  const primary = String(screen.getPrimaryDisplay().id);
  const currentId = assignments[primary];
  const choices = pool.length > 1 ? pool.filter((i) => i.id !== currentId) : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  manager.assign(pick.id, null, { unpause });
}

function resetShuffle() {
  clearInterval(shuffleTimer);
  const minutes = Number(store.get('shuffleMinutes')) || 0;
  if (minutes > 0) shuffleTimer = setInterval(() => nextWallpaper(false), minutes * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Import (drag & drop into the library window)
// ---------------------------------------------------------------------------

function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base} (${n})${ext}`);
  return target;
}

async function importPaths(paths) {
  const root = libraryPath();
  let count = 0;
  for (const src of paths) {
    try {
      const resolved = path.resolve(src);
      if (resolved.startsWith(path.resolve(root) + path.sep)) continue; // already in the library
      const st = await fs.promises.stat(resolved);
      const target = uniqueTarget(root, path.basename(resolved));
      if (st.isDirectory()) await fs.promises.cp(resolved, target, { recursive: true, errorOnExist: true });
      else await fs.promises.copyFile(resolved, target);
      count++;
    } catch (err) {
      console.error('import failed', src, err);
    }
  }
  rescan();
  return count;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('lib:get', () => uiState());

  ipcMain.handle('lib:apply', (_e, itemId, displayId) => {
    if (itemId && !itemsById.has(itemId)) return false;
    manager.assign(itemId || null, displayId || null);
    return true;
  });

  ipcMain.handle('lib:pause', (_e, paused) => {
    manager.setPaused(Boolean(paused));
    return manager.state();
  });

  ipcMain.handle('lib:next', () => nextWallpaper(true));

  ipcMain.handle('lib:settings', (_e, patch) => {
    const allowed = ['fit', 'volume', 'playbackRate', 'pauseOnFullscreen', 'pauseOnBattery', 'launchAtLogin', 'shuffleMinutes'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ('fit' in clean && !['cover', 'contain', 'fill', 'center'].includes(clean.fit)) delete clean.fit;
    if ('volume' in clean) clean.volume = Math.max(0, Math.min(1, Number(clean.volume) || 0));
    if ('playbackRate' in clean) clean.playbackRate = Math.max(0.25, Math.min(4, Number(clean.playbackRate) || 1));
    if ('shuffleMinutes' in clean) clean.shuffleMinutes = Math.max(0, Math.min(1440, Number(clean.shuffleMinutes) || 0));
    store.set(clean);

    if ('launchAtLogin' in clean) applyLoginItem();
    if ('shuffleMinutes' in clean) resetShuffle();
    manager.updateSettings();
    notifyUi();
    return store.all();
  });

  ipcMain.handle('lib:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(libraryWindow, {
      title: 'Choose your wallpaper folder',
      defaultPath: libraryPath(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    store.set({ libraryPath: res.filePaths[0] });
    startWatching();
    return res.filePaths[0];
  });

  ipcMain.handle('lib:openFolder', () => shell.openPath(libraryPath()));

  ipcMain.handle('lib:reveal', (_e, itemId) => {
    const item = itemsById.get(itemId);
    if (item) shell.showItemInFolder(item.entry ? path.join(item.root, item.entry) : item.root);
  });

  ipcMain.handle('lib:favorite', (_e, itemId, on) => {
    const favs = new Set(store.get('favorites'));
    if (on) favs.add(itemId);
    else favs.delete(itemId);
    store.set({ favorites: [...favs] });
    notifyUi();
  });

  ipcMain.handle('lib:rescan', () => rescan());

  ipcMain.handle('lib:import', (_e, paths) => (Array.isArray(paths) ? importPaths(paths.map(String)) : 0));

  ipcMain.handle('lib:saveThumb', (_e, itemId, dataUrl) => {
    if (!itemsById.has(itemId) || typeof dataUrl !== 'string') return false;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return false;
    fs.mkdirSync(thumbDir, { recursive: true });
    fs.writeFileSync(thumbFile(itemId), Buffer.from(m[1], 'base64'));
    return thumbUrlFor(itemsById.get(itemId));
  });
}

function applyLoginItem() {
  if (process.platform === 'linux') return; // not supported by Electron on Linux
  app.setLoginItemSettings({ openAtLogin: Boolean(store.get('launchAtLogin')), args: ['--hidden'] });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.on('second-instance', openLibrary);

app.on('window-all-closed', () => {
  /* keep running in the tray */
});

app.on('before-quit', () => {
  quitting = true;
  stopWatching();
  clearInterval(shuffleTimer);
  if (manager) manager.stop();
  if (store) store.flush();
});

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  thumbDir = path.join(app.getPath('userData'), 'thumbs');
  if (!store.get('libraryPath')) store.set({ libraryPath: defaultLibraryPath() });

  registerProtocol({ getItem: (id) => itemsById.get(id), thumbDir });
  registerIpc();

  manager = new WallpaperManager({
    store,
    getItem: (id) => itemsById.get(id),
    onStateChange: () => !quitting && notifyUi(),
  });

  startWatching();
  manager.start();
  createTray();
  resetShuffle();

  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  const hasWallpaper = Object.keys(store.get('assignments')).length > 0;
  if (!hidden || !hasWallpaper) openLibrary();
});
