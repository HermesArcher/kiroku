'use strict';
// Exposes window.kiroku to the engine editor pages (see docs/ARCHITECTURE.md).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiroku', {
  boot: () => ipcRenderer.invoke('editor:boot'),
  save: (name, bytes) => ipcRenderer.invoke('editor:save', String(name), bytes),
  setDirty: (dirty) => ipcRenderer.send('editor:dirty', !!dirty),
  abandon: () => ipcRenderer.send('editor:abandon'),
  getBackup: () => ipcRenderer.invoke('editor:getBackup'),
  setBackup: (patch) => ipcRenderer.invoke('editor:setBackup', patch),
  onBackup: (cb) => { ipcRenderer.on('editor:backup', (_e, v) => cb(v)); },
});
