'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('livedesk', {
  getState: () => ipcRenderer.invoke('lib:get'),
  onState: (cb) => ipcRenderer.on('lib:state', (_e, state) => cb(state)),
  apply: (itemId, displayId) => ipcRenderer.invoke('lib:apply', itemId, displayId),
  setPaused: (paused) => ipcRenderer.invoke('lib:pause', paused),
  next: () => ipcRenderer.invoke('lib:next'),
  updateSettings: (patch) => ipcRenderer.invoke('lib:settings', patch),
  chooseFolder: () => ipcRenderer.invoke('lib:chooseFolder'),
  openFolder: () => ipcRenderer.invoke('lib:openFolder'),
  reveal: (itemId) => ipcRenderer.invoke('lib:reveal', itemId),
  setFavorite: (itemId, on) => ipcRenderer.invoke('lib:favorite', itemId, on),
  rescan: () => ipcRenderer.invoke('lib:rescan'),
  saveThumb: (itemId, dataUrl) => ipcRenderer.invoke('lib:saveThumb', itemId, dataUrl),
  importFiles: (files) => ipcRenderer.invoke('lib:import', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
});
