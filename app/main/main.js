'use strict';
// Kiroku - Electron main process. Spec: ../../docs/ARCHITECTURE.md
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { execFile } = require('child_process');
const electron = require('electron');
const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, nativeTheme, session, shell, screen } = electron;

const { KINDS, ALL_EXTS, extOf, kindOfExt, decideSave, resolveKind } = require('./kinds');
const { parseArgs, userTasks } = require('./args');
const { createStore, atomicWriteFile } = require('./store');
const { createServer, PREFERRED_PORT, KEY_HEADER } = require('./server');
const { searchSmart } = require('./search');
const { normalizeBackup } = require('./backup');
const { listMusic } = require('./music');
const { isSupported, isLossy, dialogFilters, warningText } = require('./formats');
const { TAB_COLORS, normalizeStyle, createTabStyles, stripAt, placeWindow } = require('./tab-logic');

const DEBUG = !!process.env.KIROKU_DEBUG;
const TEST_DIR = process.env.KIROKU_TEST_DIR;
const USER_DATA = process.env.KIROKU_USER_DATA;
const dbg = (...a) => { if (DEBUG) console.log('[kiroku]', ...a); };

// ---- test mode: native dialogs never block (must run before any IPC / pdf-tools registration) ----
if (TEST_DIR) {
  const optsOf = (args) => args.find((a) => a && typeof a === 'object' && typeof a.isDestroyed !== 'function') || {};
  const say = (name, o) => console.log(`[kiroku-test] ${name} ${o.title || o.message || ''}`);
  const saveRes = (o) => { const f = path.join(TEST_DIR, path.basename(o.defaultPath || 'output')); const x = process.env.KIROKU_TEST_SAVE_EXT; return x ? f.replace(/\.[^.\\/]+$/, '') + '.' + x : f; };
  const openRes = (o) => (o.properties || []).includes('openDirectory') ? [TEST_DIR] : JSON.parse(process.env.KIROKU_TEST_OPEN || '[]');
  const msgRes = () => Number(process.env.KIROKU_TEST_MSGBOX || 0);
  dialog.showSaveDialog = async (...a) => { const o = optsOf(a); say('showSaveDialog', o); return { canceled: false, filePath: saveRes(o) }; };
  dialog.showSaveDialogSync = (...a) => { const o = optsOf(a); say('showSaveDialogSync', o); return saveRes(o); };
  dialog.showOpenDialog = async (...a) => { const o = optsOf(a); say('showOpenDialog', o); const f = openRes(o); return { canceled: !f.length, filePaths: f }; };
  dialog.showOpenDialogSync = (...a) => { const o = optsOf(a); say('showOpenDialogSync', o); const f = openRes(o); return f.length ? f : undefined; };
  dialog.showMessageBox = async (...a) => { say('showMessageBox', optsOf(a)); return { response: msgRes(), checkboxChecked: false }; };
  dialog.showMessageBoxSync = (...a) => { say('showMessageBoxSync', optsOf(a)); return msgRes(); };
  dialog.showErrorBox = (title, content) => say('showErrorBox', { title: title || content });
}
if (USER_DATA) app.setPath('userData', path.resolve(USER_DATA));
app.setAppUserModelId('com.kiroku.office');

// ---- state ----
const PAL = { light: { bg: '#CFE8E7', text: '#0F3A46' }, dark: { bg: '#041012', text: '#DDF8F7' } };
const pal = () => (nativeTheme.shouldUseDarkColors ? PAL.dark : PAL.light);
const ICON = path.join(__dirname, '..', 'build', 'icon.ico');
const icon = fs.existsSync(ICON) ? ICON : undefined;
const BAR = 40;

// Multi-window: `wins` holds one record per Kiroku window { win, activeId, main, allowClose, walking };
// `win` is always the LAST-FOCUSED window's BrowserWindow (dialogs, shortcuts, new tabs go there); `curW` is its record.
let win = null, store = null, engine = null, origin = '', ready = false;
const queued = [];
const wins = new Set();
let curW = null;
const tabs = new Map(); // id -> tab (insertion order = tab order; tab.w = the window record that shows it)
const counters = { word: 0, cell: 0, slide: 0 };
let tabSeq = 0;
const setCur = (W) => { curW = W; win = W && !W.win.isDestroyed() ? W.win : null; };
const mainW = () => [...wins].find((w) => w.main && !w.win.isDestroyed()) || null;
const tabsOf = (W) => [...tabs.values()].filter((t) => t.w === W);
const aliveWins = () => [...wins].filter((w) => !w.win.isDestroyed());
const winOfSender = (sender) => aliveWins().find((w) => w.win.webContents === sender) || null;

const safeURL = (u) => { try { return new URL(u); } catch { return null; } };
const tabOf = (sender) => [...tabs.values()].find((t) => t.view && !t.view.webContents.isDestroyed() && t.view.webContents === sender);
const fromShell = (e) => !!winOfSender(e.sender);
const editorUrl = () => `${origin}/editor?locale=${encodeURIComponent(store.getSettings().language)}`;
const toBuffer = (b) => (ArrayBuffer.isView(b) ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : Buffer.from(b));

// ---- network: fully offline ----
const OK_PROTO = new Set(['devtools:', 'file:', 'blob:', 'data:', 'chrome-extension:', 'chrome:', 'about:']);
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);
function allowedUrl(url) {
  const u = safeURL(url);
  if (!u) return false;
  if (OK_PROTO.has(u.protocol)) return true;
  return ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && LOCAL.has(u.hostname);
}

// ---- window chrome / theme ----
function applyChrome() {
  const p = pal();
  for (const W of aliveWins()) {
    W.win.setBackgroundColor(p.bg);
    try { W.win.setTitleBarOverlay({ color: p.bg, symbolColor: p.text, height: BAR }); } catch {}
  }
  for (const t of tabs.values()) t.view && t.view.setBackgroundColor(p.bg);
}

// Settings > Backups: stored in settings.json, handed to every editor at boot and pushed live (engine/lib/history/backup-settings.ts)
const backupOf = () => normalizeBackup(store.getSettings().backup);
function setBackup(patch) {
  const next = normalizeBackup(patch, backupOf());
  store.setSettings({ backup: next });
  for (const t of tabs.values()) { try { if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.send('editor:backup', next); } catch {} }
  return next;
}

const publicSettings = () => {
  const { theme, language, recentFilter } = store.getSettings();
  return { theme, language, backup: backupOf(), recentFilter: recentFilter || 'all', encryptRecent: store.isRecentEncrypted(), canEncryptRecent: store.canEncryptRecent() };
};

function boundsOk(b) {
  return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 400 && b.height >= 300 &&
    screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 50 && b.x + b.width > w.x + 50 && b.y >= w.y - 20 && b.y < w.y + w.height - 50);
}

// extra = bounds of a torn-out window; no extra = the main window (restores the saved size)
function createWindow(extra) {
  const s = store.getSettings();
  const isMain = !extra;
  const saved = isMain && boundsOk(s.bounds) ? s.bounds : null;
  const bw = new BrowserWindow({
    width: 1400, height: 900, ...(saved || extra || {}), minWidth: 960, minHeight: 600, show: false,
    backgroundColor: pal().bg, icon, titleBarStyle: 'hidden',
    titleBarOverlay: { color: pal().bg, symbolColor: pal().text, height: BAR },
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'shell.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  const W = { win: bw, activeId: 'home', main: isMain, allowClose: false, walking: false };
  wins.add(W);
  setCur(W);
  if (isMain && s.maximized) bw.maximize();
  const show = () => { if (!bw.isDestroyed() && !bw.isVisible()) bw.show(); };
  bw.once('ready-to-show', show);
  bw.webContents.once('did-fail-load', show);
  bw.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((e) => dbg('renderer load failed', e.message));
  shortcuts(bw.webContents, () => W);
  bw.webContents.on('will-navigate', (e) => e.preventDefault());
  bw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'show']) bw.on(ev, () => layout(W));
  bw.on('focus', () => setCur(W));
  bw.on('close', (e) => {
    // the main window answers for every tab (closing it quits the app); a torn-out window only for its own
    if (!W.allowClose && (W.main ? [...tabs.values()] : tabsOf(W)).some((t) => t.dirty)) {
      e.preventDefault();
      walkDirty(W);
      return;
    }
    if (W.main) try { store.setSettings({ bounds: bw.getNormalBounds(), maximized: bw.isMaximized() }); } catch {}
  });
  bw.on('closed', () => {
    for (const t of tabsOf(W)) { try { t.view.webContents.close(); } catch {} tabs.delete(t.id); }
    wins.delete(W);
    if (W.main) for (const o of aliveWins()) { o.allowClose = true; o.win.close(); }
    if (curW === W || !curW) setCur(mainW() || aliveWins()[0] || null);
  });
  return W;
}

// ---- tabs ----
const stateOf = (W = curW) => ({
  tabs: tabsOf(W).map(({ id, title, kind, dirty, path: p, color, bold }) => ({ id, title, kind, dirty, path: p, color: color || null, bold: !!bold })),
  activeId: W ? W.activeId : 'home',
  main: !!(W && W.main),
});
// no argument = every window
const broadcast = (W) => { for (const w of W ? [W] : aliveWins()) if (!w.win.isDestroyed()) w.win.webContents.send('shell:state', stateOf(w)); };
const notifyRecent = () => { for (const w of aliveWins()) w.win.webContents.send('shell:recentChanged'); };

function layout(W) {
  for (const w of W ? [W] : aliveWins()) {
    if (w.win.isDestroyed()) continue;
    const { width, height } = w.win.getContentBounds();
    for (const t of tabsOf(w)) {
      if (!t.view) continue;
      const show = t.id === w.activeId;
      t.view.setBounds({ x: 0, y: BAR, width, height: Math.max(0, height - BAR) });
      t.view.setVisible(show);
    }
  }
}
// Tab switches are instant: the view comes back with the frame it last painted, in place. No in-page enter animation: it could only
// start after the view was already visible (async executeJavaScript), so every switch showed a blank frame, then a fade + 10px slide.

// W0 = window to use when the id is 'home' (a tab id always knows its own window)
function activate(id, W0) {
  const t = tabs.get(id);
  const W = t ? t.w : (W0 || curW);
  if (!W || W.win.isDestroyed()) return;
  W.activeId = t ? id : 'home';
  if (t && W !== curW) { if (W.win.isMinimized()) W.win.restore(); W.win.show(); W.win.focus(); setCur(W); }
  layout(W);
  (t && t.view ? t.view.webContents : W.win.webContents).focus();
  broadcast(W);
}

function cycle(W, step) {
  const ids = ['home', ...tabsOf(W).map((t) => t.id)];
  activate(ids[(ids.indexOf(W.activeId) + step + ids.length) % ids.length], W);
}

function shortcuts(wc, getW) {
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const W = getW() || curW;
    if (!W || W.win.isDestroyed()) return;
    const k = String(i.key).toLowerCase();
    const mod = i.control && !i.alt && !i.meta;
    let handled = true;
    const active = tabs.get(W.activeId);
    if (mod || i.key === 'F11') setCur(W);
    if (i.key === 'F11' && !i.control && !i.alt && !i.shift) W.win.setFullScreen(!W.win.isFullScreen());
    else if (mod && !i.shift && k === 'w') { if (active) closeTab(active.id); }
    else if (mod && k === 'tab') cycle(W, i.shift ? -1 : 1);
    else if (mod && !i.shift && k === 'o') openDialog();
    else if (mod && !i.shift && k === 'n') newDoc(active && ['word', 'cell', 'slide'].includes(active.kind) ? active.kind : 'word');
    else handled = false;
    if (handled) e.preventDefault();
  });
}

function attachView(tab) {
  const view = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'editor.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  view.setBackgroundColor(pal().bg);
  const wc = view.webContents;
  tab.view = view;
  tab.w.win.contentView.addChildView(view);

  wc.on('will-prevent-unload', (e) => e.preventDefault()); // we run our own dirty prompts
  shortcuts(wc, () => tab.w);

  wc.setWindowOpenHandler(({ url }) => {
    const u = safeURL(url);
    if (!u) return { action: 'deny' };
    if (u.origin === origin || u.protocol === 'blob:' || u.protocol === 'about:') {
      return { action: 'allow', overrideBrowserWindowOptions: { parent: tab.w.win, autoHideMenuBar: true, icon } };
    }
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    const u = safeURL(url);
    if (u && u.origin === origin) return;
    e.preventDefault();
    if (!u) return;
    if (u.protocol === 'file:') { try { openPath(fileURLToPath(url)); } catch {} }
    else if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url);
  });

  const onNav = (_e, url) => {
    const u = safeURL(url);
    if (!u || u.origin !== origin) return;
    if (u.pathname === '/history' && tab.kind !== 'recovery') {
      Object.assign(tab, { kind: 'recovery', title: 'Recovered files', path: null, ext: null });
    } else if (u.pathname === '/editor' && tab.kind === 'recovery') {
      // resumed recovered doc: kind unknown until the page title reveals the file name
      Object.assign(tab, { kind: 'word', title: 'Document', ext: 'docx', sniff: true });
    }
    broadcast();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('page-title-updated', (_e, title) => {
    if (!tab.sniff) return;
    const m = String(title).match(new RegExp(`([^\\\\/:*?"<>|]+\\.(${ALL_EXTS.join('|')}))\\b`, 'i'));
    if (!m) return;
    Object.assign(tab, { kind: kindOfExt(m[2]), title: m[1], ext: m[2].toLowerCase(), sniff: false });
    broadcast();
  });

  wc.on('render-process-gone', async (_e, d) => {
    if (d.reason === 'clean-exit' || !tabs.has(tab.id) || tab.view !== view) return;
    dbg('render-process-gone', tab.id, d.reason);
    const { response } = await dialog.showMessageBox(tab.w.win, {
      type: 'warning', message: 'This tab stopped working. Reload it?', buttons: ['Reload', 'Close tab'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (!tabs.has(tab.id)) return;
    if (response === 0) reloadTab(tab); else destroyTab(tab);
  });

  if (DEBUG) {
    wc.on('console-message', (e, ...r) => dbg('console', tab.id, e && e.message !== undefined ? e.message : r[1]));
    wc.on('did-finish-load', () => dbg('loaded', tab.id, wc.getURL()));
    wc.on('did-fail-load', (_e, code, desc, url) => dbg('load-failed', tab.id, code, desc, url));
  }
  wc.loadURL(tab.url).catch((e) => dbg('loadURL failed', tab.id, e.message));
}

function createTab(init) {
  const tab = { id: 't' + ++tabSeq, dirty: false, closing: false, path: null, ext: null, boot: null, view: null, w: curW, color: null, bold: false, ...init };
  if (!tab.w || tab.w.win.isDestroyed()) return null;
  if (tab.path) Object.assign(tab, tabStyles().get(tab.path)); // colour / bold remembered per file
  tabs.set(tab.id, tab);
  attachView(tab);
  dbg('tab opened', tab.id, tab.kind, tab.title);
  activate(tab.id);
  return tab;
}

function dropView(tab) {
  const v = tab.view;
  tab.view = null;
  if (!v) return;
  try { tab.w.win.contentView.removeChildView(v); } catch {}
  try { v.webContents.close(); } catch {}
}

function reloadTab(tab) {
  dropView(tab);
  if (tab.kind !== 'recovery') {
    tab.url = editorUrl();
    tab.boot = tab.path ? { type: 'open' } : { type: 'new' };
  }
  tab.dirty = false;
  attachView(tab);
  layout(tab.w);
  broadcast(tab.w);
}

function destroyTab(tab) {
  const W = tab.w;
  const ids = tabsOf(W).map((t) => t.id);
  const idx = ids.indexOf(tab.id);
  tabs.delete(tab.id);
  dropView(tab);
  dbg('tab closed', tab.id);
  if (W.activeId === tab.id) activate(ids[idx + 1] || ids[idx - 1] || 'home', W);
  else broadcast(W);
  closeIfEmpty(W);
}
// a torn-out window with no documents left closes itself
function closeIfEmpty(W) {
  if (!W.main && !W.win.isDestroyed() && !tabsOf(W).length) { W.allowClose = true; W.win.close(); }
}

// ---- tab colour / bold (persisted per file path in settings.json) + tear-out windows ----
let tabStylesStore = null;
const tabStyles = () => tabStylesStore || (tabStylesStore = createTabStyles(store));

function setTabStyle(tab, patch) {
  if (!tab) return;
  const next = normalizeStyle({ color: tab.color, bold: tab.bold, ...patch });
  Object.assign(tab, next);
  if (tab.path) tabStyles().set(tab.path, next);
  broadcast(tab.w);
}

// Re-parent the tab's existing WebContentsView into another window: no reload, unsaved edits and JS state survive.
function moveTab(tab, to) {
  if (!tab || !tab.view || !to || to.win.isDestroyed() || tab.w === to) return;
  const from = tab.w;
  const ids = tabsOf(from).map((t) => t.id);
  const idx = ids.indexOf(tab.id);
  try { from.win.contentView.removeChildView(tab.view); } catch {}
  tab.w = to;
  tabs.delete(tab.id); tabs.set(tab.id, tab); // last tab of the new window
  to.win.contentView.addChildView(tab.view);
  dbg('tab moved', tab.id, from.main ? 'main' : 'other', '->', to.main ? 'main' : 'other');
  if (from.activeId === tab.id) activate(ids[idx + 1] || ids[idx - 1] || 'home', from);
  else broadcast(from);
  activate(tab.id);
  closeIfEmpty(from);
}

function tearOut(tab, point) {
  if (!tab || !tab.view) return;
  const src = tab.w.win.getBounds();
  const wa = screen.getDisplayNearestPoint(point || { x: src.x + 40, y: src.y + 40 }).workArea;
  moveTab(tab, createWindow(placeWindow(point, src, wa)));
}

// Tab dropped after a drag: onto another window's tab strip -> dock there; onto its own strip -> nothing; anywhere else -> new window.
function dropTab(tab) {
  if (!tab || !tab.view) return;
  const p = (TEST_DIR && globalThis.__kirokuCursor) || screen.getCursorScreenPoint(); // tests cannot move the real cursor
  const rects = aliveWins().filter((w) => !w.win.isMinimized()).map((w) => ({ id: w, ...w.win.getBounds() }));
  const hit = stripAt(rects, p, BAR + 4);
  if (hit === tab.w) return;
  if (hit) { moveTab(tab, hit); return; }
  if (!tab.w.main && tabsOf(tab.w).length === 1) return; // a lone tab already has its own window
  tearOut(tab, p);
}

function tabMenu(tab, W) {
  if (!tab || !W || W.win.isDestroyed()) return;
  Menu.buildFromTemplate([
    {
      label: 'Tab colour',
      submenu: [{ label: 'None', type: 'radio', checked: !tab.color, click: () => setTabStyle(tab, { color: null }) },
        ...TAB_COLORS.map((c) => ({ label: c.name, type: 'radio', checked: tab.color === c.hex, click: () => setTabStyle(tab, { color: c.hex }) }))],
    },
    { label: 'Bold title', type: 'checkbox', checked: !!tab.bold, click: (mi) => setTabStyle(tab, { bold: mi.checked }) },
    { type: 'separator' },
    tab.w.main ? { label: 'Move to new window', click: () => tearOut(tab) } : { label: 'Move back to main window', click: () => moveTab(tab, mainW()) },
    { label: 'Close tab', click: () => closeTab(tab.id) },
  ]).popup({ window: W.win });
}

async function confirmClose(tab) {
  if (!tab.dirty) return true;
  activate(tab.id);
  const { response } = await dialog.showMessageBox(tab.w.win, {
    type: 'question', message: `Save changes to ${tab.title}?`, buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
  });
  if (response === 2) return false;
  if (response === 1) return true;
  let r;
  try {
    r = await tab.view.webContents.executeJavaScript('window.__kirokuSave ? window.__kirokuSave() : "unavailable"');
  } catch { r = 'failed'; }
  if (r === 'failed') {
    await dialog.showMessageBox(tab.w.win, { type: 'error', message: `Could not save ${tab.title}.`, detail: 'The tab was left open.', buttons: ['OK'] });
  }
  return r === 'written';
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.closing) return false;
  tab.closing = true;
  const ok = await confirmClose(tab);
  tab.closing = false;
  if (ok && tabs.has(id)) destroyTab(tab);
  return ok;
}

// Closing the main window answers for every tab (and then quits); a torn-out window only for its own.
async function walkDirty(W) {
  if (W.walking) return;
  W.walking = true;
  try {
    for (const t of [...(W.main ? tabs.values() : tabsOf(W))]) {
      if (!t.dirty) continue;
      if (t.closing) return;
      t.closing = true;
      const ok = await confirmClose(t);
      t.closing = false;
      if (!ok) return;
    }
    W.allowClose = true;
    if (!W.win.isDestroyed()) W.win.close();
  } finally { W.walking = false; }
}

// ---- opening ----
function newDoc(kind) {
  const k = KINDS[kind];
  if (!k || !k.newExt) return;
  const title = `${k.label} ${++counters[kind]}.${k.newExt}`;
  createTab({ kind, title, ext: k.newExt, boot: { type: 'new' }, url: editorUrl() });
}

function openPath(p) {
  const abs = path.resolve(p);
  const same = [...tabs.values()].find((t) => t.path && t.path.toLowerCase() === abs.toLowerCase());
  if (same) { activate(same.id); return; }
  const found = resolveKind(abs); // by content first; the engine gets the real format as tab.ext
  if (!found) {
    const e = extOf(abs);
    dialog.showMessageBox(win, { type: 'info', message: e ? `Kiroku can't open ".${e}" files.` : "Kiroku can't open this file.", detail: abs, buttons: ['OK'] });
    return;
  }
  createTab({ kind: found.kind, title: path.basename(abs), path: abs, ext: found.ext, boot: { type: 'open' }, url: editorUrl() });
}

async function openDialog(dir) {
  const pick = (name, exts) => ({ name, extensions: exts });
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open', ...(dir ? { defaultPath: dir } : {}), properties: ['openFile', 'multiSelections'],
    filters: [pick('All supported files', ALL_EXTS), ...Object.values(KINDS).map((k) => pick(k.label + 's', k.opens)), pick('All files', ['*'])],
  });
  if (!canceled) filePaths.forEach(openPath);
}

function openRecovery() {
  createTab({ kind: 'recovery', title: 'Recovered files', url: `${origin}/history` });
}

function handleArgs(argv, cwd) {
  if (!ready) { queued.push([argv, cwd]); return; }
  for (const a of parseArgs(argv, cwd, process.defaultApp ? app.getAppPath() : null)) {
    if (a.type === 'new') newDoc(a.kind);
    else if (a.type === 'pdf') openPdfPicker();
    else openPath(a.path);
  }
}

async function openPdfPicker() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open PDF', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!canceled) filePaths.forEach(openPath);
}

// Only the Kiroku shell page (renderer/index.html, top frame) may drive the pdf: handlers, in any shell window.
const SHELL_PAGE = path.join(__dirname, '..', 'renderer', 'index.html').toLowerCase();
function isShellSender(e) {
  const f = e.senderFrame;
  if (!f || f !== e.sender.mainFrame) return false;
  const u = safeURL(f.url);
  if (!u || u.protocol !== 'file:') return false;
  try { return fileURLToPath(u).toLowerCase() === SHELL_PAGE; } catch { return false; }
}

// Every session the app's pages use carries this run's secret to the local engine server (and only to it).
function lockSession(ses) {
  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    const h = d.requestHeaders;
    if (origin && d.url.startsWith(origin + '/')) h[KEY_HEADER] = engine.key;
    cb({ requestHeaders: h });
  });
}

// ---- IPC ----
function registerIpc() {
  // any shell window may call these; the calling window becomes the current one (new tabs, dialogs and 'home' act on it)
  const onShell = (ch, fn) => ipcMain.on(ch, (e, ...a) => { const W = winOfSender(e.sender); if (W) { setCur(W); fn(...a); } });
  const handleShell = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromShell(e)) throw new Error('forbidden'); return fn(...a); });

  ipcMain.handle('shell:getState', (e) => { const W = winOfSender(e.sender); if (!W) throw new Error('forbidden'); return stateOf(W); });
  onShell('shell:activate', (id) => activate(id));
  onShell('shell:close', (id) => { closeTab(id); });
  onShell('shell:newMenu', () => Menu.buildFromTemplate(
    ['word', 'cell', 'slide'].map((k) => ({ label: KINDS[k].label, click: () => newDoc(k) })),
  ).popup({ window: win }));
  onShell('shell:newDoc', (kind) => newDoc(kind));
  onShell('shell:openDialog', () => { openDialog(); });
  onShell('shell:openPaths', (paths) => { if (Array.isArray(paths)) paths.filter((p) => typeof p === 'string' && p).forEach(openPath); });
  handleShell('shell:getRecent', () => store.listRecent().map((r) => ({ ...r, exists: fs.existsSync(r.path) })));
  handleShell('shell:getRecentFolders', () => store.listFolders().map((f) => ({ ...f, exists: fs.existsSync(f.path) })));
  onShell('shell:openDialogAt', (dir) => { if (typeof dir === 'string' && dir) openDialog(dir); });
  handleShell('shell:removeRecentFolder', (p) => { store.removeFolder(p); notifyRecent(); });
  handleShell('shell:pinRecentFolder', (p, pinned) => { store.pinFolder(p, pinned); notifyRecent(); });
  handleShell('shell:searchFiles', (q) => searchSmart(q, [app.getPath('documents'), app.getPath('desktop'), app.getPath('downloads')]));
  handleShell('shell:removeRecent', (p) => { store.removeRecent(p); notifyRecent(); });
  handleShell('shell:pinRecent', (p, pinned) => { store.pinRecent(p, pinned); notifyRecent(); });
  handleShell('shell:clearRecent', () => { store.clearRecent(); notifyRecent(); });
  onShell('shell:showInFolder', (p) => { if (typeof p === 'string') shell.showItemInFolder(p); });
  handleShell('shell:getSettings', publicSettings);
  handleShell('shell:setSettings', (p = {}) => {
    const patch = {};
    if (['system', 'light', 'dark'].includes(p.theme)) patch.theme = p.theme;
    if (typeof p.language === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(p.language)) patch.language = p.language;
    if (['all', 'word', 'cell', 'slide', 'pdf'].includes(p.recentFilter)) patch.recentFilter = p.recentFilter;
    store.setSettings(patch);
    if (p.backup && typeof p.backup === 'object') setBackup(p.backup);
    if (typeof p.encryptRecent === 'boolean') { store.setRecentEncrypted(p.encryptRecent); notifyRecent(); }
    nativeTheme.themeSource = store.getSettings().theme;
    applyChrome();
    return publicSettings();
  });
  onShell('shell:openDefaultApps', () => {
    shell.openExternal('ms-settings:defaultapps?registeredAppUser=Kiroku').catch(() => shell.openExternal('ms-settings:defaultapps').catch(() => {}));
  });
  // Main types Explorer still opens with another app. UserChoice is Windows-owned, so we only read it.
  handleShell('shell:defaultStatus', () => process.platform !== 'win32' ? [] : Promise.all(['docx', 'xlsx', 'pptx', 'pdf'].map((ext) => new Promise((done) => {
    execFile('reg', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}`, '/s'], { windowsHide: true }, (_err, out) => {
      const ids = [...String(out || '').matchAll(/^\s+ProgId\s+REG_SZ\s+(\S+)/gim)].map((m) => m[1]);
      done(ids.length && ids[ids.length - 1].startsWith('Kiroku.') ? null : ext);
    });
  }))).then((exts) => exts.filter(Boolean)));
  onShell('shell:openRecovery', openRecovery);
  // tabs: colour/bold (persisted per file), tear-out / re-dock (see docs/ARCHITECTURE.md)
  onShell('shell:tabMenu', (id) => tabMenu(tabs.get(id), curW));
  onShell('shell:setTabStyle', (id, patch) => setTabStyle(tabs.get(id), patch));
  onShell('shell:moveTab', (id, where) => {
    const tab = tabs.get(id);
    if (!tab) return;
    if (where === 'new') tearOut(tab);
    else if (where === 'main') moveTab(tab, mainW());
    else if (where === 'drop') dropTab(tab);
  });
  handleShell('shell:getInfo', () => ({ version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData') }));
  // rail player: the folder the user picked (settings.musicDir); pickMusic = folder dialog, null when cancelled
  const musicOf = (dir) => ({ dir: dir || null, tracks: dir ? listMusic(dir) : [] });
  handleShell('shell:music', () => musicOf(store.getSettings().musicDir));
  handleShell('shell:pickMusic', async () => {
    const cur = store.getSettings().musicDir;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose a music folder', defaultPath: cur || app.getPath('music'), properties: ['openDirectory'] });
    if (canceled || !filePaths || !filePaths[0]) return null;
    store.setSettings({ musicDir: filePaths[0] });
    return musicOf(filePaths[0]);
  });

  // editor views
  ipcMain.handle('editor:boot', async (e) => {
    const tab = tabOf(e.sender);
    dbg('editor:boot', tab ? `${tab.id} ${tab.boot ? tab.boot.type : 'none'}` : 'unknown-sender');
    if (!tab || !tab.boot) return { kind: 'none', backup: backupOf() };
    const type = tab.boot.type;
    tab.boot = null;
    // Blank docs start from English templates: the engine's built-in blank is zh-CN (DengXian 10.5pt).
    if (type === 'new') {
      try {
        const bytes = await fs.promises.readFile(path.join(__dirname, '..', 'templates', `new.${tab.ext}`));
        return { kind: 'open', name: tab.title, bytes, backup: backupOf() };
      } catch {
        return { kind: 'new', ext: tab.ext, backup: backupOf() };
      }
    }
    try {
      const bytes = await fs.promises.readFile(tab.path);
      store.addRecent({ path: tab.path, name: path.basename(tab.path), kind: tab.kind });
      notifyRecent();
      // the editor picks the converter from the name's extension: give it the sniffed format, not a misleading one
      const real = path.basename(tab.path);
      const name = tab.ext && extOf(real) !== tab.ext ? `${path.parse(real).name}.${tab.ext}` : real;
      return { kind: 'open', name, bytes, backup: backupOf() };
    } catch (err) {
      const name = path.basename(tab.path);
      destroyTab(tab);
      dialog.showMessageBox(win, { type: 'error', message: `Could not open ${name}.`, detail: err.message, buttons: ['OK'] });
      return { kind: 'none' };
    }
  });
  // Backups: editor pages read the current values, and the /history autosave switch writes back
  ipcMain.handle('editor:getBackup', (e) => (tabOf(e.sender) ? backupOf() : normalizeBackup()));
  ipcMain.handle('editor:setBackup', (e, patch) => (tabOf(e.sender) ? setBackup(patch) : normalizeBackup()));

  // the user declined a password prompt: nothing to show, close this tab
  ipcMain.on('editor:abandon', (e) => { const tab = tabOf(e.sender); if (tab) { tab.dirty = false; destroyTab(tab); } });

  ipcMain.on('editor:dirty', (e, dirty) => {
    const tab = tabOf(e.sender);
    if (!tab) return;
    tab.dirty = !!dirty;
    dbg('editor:dirty', tab.id, tab.dirty);
    broadcast();
  });

  ipcMain.handle('editor:save', async (e, name, bytes) => {
    const tab = tabOf(e.sender);
    dbg('editor:save', tab ? tab.id : 'unknown-sender', name, bytes && bytes.length);
    if (!tab || typeof name !== 'string' || !bytes) return 'unavailable';
    const ext = extOf(name);
    if (!ext) return 'unavailable';
    const d = decideSave({ tabPath: tab.path, tabExt: tab.ext, tabKind: tab.kind, ext });
    let target = tab.path, outExt = ext, outBytes = bytes;
    if (d.action === 'dialog') {
      // Save As: every format x2t writes for this kind; the editor's pick is the default filter.
      const dir = tab.path ? path.dirname(tab.path) : app.getPath('documents');
      const base = path.basename(tab.path || tab.title, path.extname(tab.path || tab.title));
      const r = await dialog.showSaveDialog(win, {
        title: 'Save As', defaultPath: path.join(dir, `${base}.${ext}`),
        filters: dialogFilters(tab.kind, ext),
      });
      if (r.canceled || !r.filePath) return 'cancelled';
      const picked = extOf(r.filePath);
      outExt = picked !== ext && isSupported(tab.kind, picked) ? picked : ext;
      target = picked === outExt ? r.filePath : `${r.filePath}.${outExt}`;
      // A format that can drop formatting: say so, and keep the tab on its own file (no rebind below).
      if (isLossy(tab.ext, outExt)) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', message: warningText(tab.ext, outExt), buttons: ['Save copy', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
        });
        if (response !== 0) return 'cancelled';
      }
      if (outExt !== ext) { // the user chose another format in the dialog: export the live document in it
        let again = null;
        try {
          again = await e.sender.executeJavaScript(`window.__kirokuExport ? window.__kirokuExport(${JSON.stringify(outExt)}) : null`);
        } catch {}
        if (!again || !again.base64) {
          dialog.showErrorBox('Could not save', `Could not export as ${outExt.toUpperCase()}.`);
          return 'unavailable';
        }
        outBytes = Buffer.from(again.base64, 'base64');
      }
    }
    try {
      await atomicWriteFile(target, toBuffer(outBytes));
    } catch (err) {
      dialog.showErrorBox('Could not save', `${target}\n\n${err.message}`);
      return 'unavailable';
    }
    const rebind = d.action === 'dialog' && !isLossy(tab.ext, outExt) && decideSave({ tabPath: tab.path, tabExt: tab.ext, tabKind: tab.kind, ext: outExt }).rebind;
    if (rebind && tabs.has(tab.id)) {
      Object.assign(tab, { path: target, ext: outExt, title: path.basename(target) });
      store.addRecent({ path: target, name: tab.title, kind: tab.kind });
      notifyRecent();
      broadcast();
    }
    return 'written';
  });
}

// ---- startup ----
const gotLock = app.requestSingleInstanceLock(); // Electron scopes the lock to userData, so KIROKU_USER_DATA keeps tests isolated
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    if (win && !win.isDestroyed()) { // the last-focused window gets the files
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    handleArgs(argv, cwd);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { if (engine) engine.close(); });

  app.whenReady().then(async () => {
    store = createStore(app.getPath('userData'), { safeStorage: electron.safeStorage });
    nativeTheme.themeSource = store.getSettings().theme;
    nativeTheme.on('updated', applyChrome);
    Menu.setApplicationMenu(null);
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
      const ok = allowedUrl(d.url);
      if (!ok) dbg('blocked', d.url);
      cb({ cancel: !ok });
    });
    lockSession(session.defaultSession);
    app.on('session-created', lockSession); // any other session/partition an editor window ends up in
    // jump list: packaged builds only (never touch the installed app's list from tests or dev runs)
    if (process.platform === 'win32' && app.isPackaged && !USER_DATA) {
      try { app.setUserTasks(userTasks(process.execPath, app.getAppPath(), process.defaultApp)); } catch (e) { dbg('jump list failed:', e.message); }
    }

    const root = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, '..', '..', 'engine', 'dist');
    engine = createServer({ root, port: USER_DATA ? 0 : PREFERRED_PORT });
    const port = await engine.start();
    origin = `http://127.0.0.1:${port}`;
    console.log(`[kiroku] server ${origin} root=${root}`);

    registerIpc();
    try { require('./pdf-tools').registerPdfTools(ipcMain, electron, isShellSender); } catch (e) { dbg('pdf-tools unavailable:', e.message); }

    createWindow();
    ready = true;
    handleArgs(process.argv, process.cwd());
    queued.splice(0).forEach(([a, c]) => handleArgs(a, c));
  });
}
