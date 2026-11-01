'use strict';
// Exposes window.shell to renderer/index.html (see docs/ARCHITECTURE.md).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const send = (ch, ...a) => ipcRenderer.send(ch, ...a);

contextBridge.exposeInMainWorld('shell', {
  onState(cb) {
    let pushed = false;
    ipcRenderer.on('shell:state', (_e, s) => { pushed = true; cb(s); });
    inv('shell:getState').then((s) => { if (!pushed) cb(s); });
  },
  activate: (id) => send('shell:activate', id),
  close: (id) => send('shell:close', id),
  tabMenu: (id) => send('shell:tabMenu', id),
  setTabStyle: (id, patch) => send('shell:setTabStyle', id, patch),
  moveTab: (id, where) => send('shell:moveTab', id, where),
  newMenu: () => send('shell:newMenu'),
  newDoc: (kind) => send('shell:newDoc', kind),
  openDialog: () => send('shell:openDialog'),
  openPaths: (paths) => send('shell:openPaths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  getRecent: () => inv('shell:getRecent'),
  getRecentFolders: () => inv('shell:getRecentFolders'),
  openDialogAt: (dir) => send('shell:openDialogAt', dir),
  removeRecentFolder: (p) => inv('shell:removeRecentFolder', p),
  pinRecentFolder: (p, pinned) => inv('shell:pinRecentFolder', p, pinned),
  searchFiles: (q) => inv('shell:searchFiles', q),
  removeRecent: (p) => inv('shell:removeRecent', p),
  pinRecent: (p, pinned) => inv('shell:pinRecent', p, pinned),
  clearRecent: () => inv('shell:clearRecent'),
  showInFolder: (p) => send('shell:showInFolder', p),
  onRecentChanged: (cb) => { ipcRenderer.on('shell:recentChanged', () => cb()); },
  getSettings: () => inv('shell:getSettings'),
  setSettings: (patch) => inv('shell:setSettings', patch),
  openDefaultApps: () => send('shell:openDefaultApps'),
  defaultStatus: () => inv('shell:defaultStatus'),
  openRecovery: () => send('shell:openRecovery'),
  getInfo: () => inv('shell:getInfo'),
  music: () => inv('shell:music'),
  pickMusic: () => inv('shell:pickMusic'),
  pdf: (op, args) => ipcRenderer.invoke('pdf:' + op, args),
});
