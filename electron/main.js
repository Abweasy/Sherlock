/*
 * Desktop wrapper: opens the Sherlock web player in its own window.
 *
 *   npm run app         run it from source
 *   npm run build:win   build dist/Sherlock-win32-x64/Sherlock.exe
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 420,
    minHeight: 480,
    title: 'Sherlock',
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });

  // The player is a single page: never navigate away from it (e.g. when a
  // file is dropped somewhere unexpected), and open web links in the browser.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Only one Sherlock window: launching it again focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // the player has its own controls
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
