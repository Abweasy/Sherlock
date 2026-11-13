'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  onLoad: (cb) => ipcRenderer.on('wallpaper:load', (_e, msg) => cb(msg)),
  onSettings: (cb) => ipcRenderer.on('wallpaper:settings', (_e, msg) => cb(msg)),
  onPlayback: (cb) => ipcRenderer.on('wallpaper:playback', (_e, msg) => cb(msg)),
});
