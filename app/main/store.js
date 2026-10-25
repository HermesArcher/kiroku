'use strict';
// settings.json + recent.json in a directory; atomic writes; corrupt JSON -> defaults.
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = { theme: 'system', language: 'en' };
const RECENT_MAX = 50;
const FOLDERS_MAX = 12;

function atomicWriteFileSync(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

async function atomicWriteFile(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
}

function readJson(file, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === typeof fallback && Array.isArray(v) === Array.isArray(fallback) ? v : fallback;
  } catch {
    return fallback;
  }
}

// opts.safeStorage = Electron's safeStorage (or a fake in tests); used only for the "encrypt recent list" option.
function createStore(dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(dir, 'settings.json');
  const recentFile = path.join(dir, 'recent.json');
  const foldersFile = path.join(dir, 'recent-folders.json');
  const encFile = path.join(dir, 'recent.enc'); // encrypted {files, folders}; replaces the two plain files while the option is on
  const ss = opts.safeStorage;
  const write = (file, v) => { try { atomicWriteFileSync(file, JSON.stringify(v, null, 2)); } catch {} };
  const key = (p) => String(p).toLowerCase();
  const canEnc = () => { try { return !!(ss && ss.isEncryptionAvailable()); } catch { return false; } };
  const rm = (f) => { try { fs.unlinkSync(f); } catch {} };
  const okRecent = (r) => r && typeof r.path === 'string';
  const folderOf = (p, openedAt, pinned = false) => { const d = path.dirname(p); return { path: d, name: path.basename(d) || d, openedAt, pinned }; };

  let settings = { ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) };
  let encOk = true; // false = recent.enc exists but could not be decrypted: never delete it

  // pinned first, then newest first; trimming to the limit therefore drops oldest unpinned first
  const byPin = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.openedAt - a.openedAt;
  let recent = [], folders = [];
  const sortRecent = () => { recent.sort(byPin); recent = recent.slice(0, RECENT_MAX); };
  const sortFolders = () => { folders.sort(byPin); folders = folders.slice(0, FOLDERS_MAX); };

  const loadEnc = () => {
    if (!fs.existsSync(encFile)) return null;
    try {
      if (!canEnc()) throw new Error('no safeStorage');
      const v = JSON.parse(ss.decryptString(fs.readFileSync(encFile)));
      return { files: Array.isArray(v.files) ? v.files : [], folders: Array.isArray(v.folders) ? v.folders : null };
    } catch { encOk = false; return null; }
  };
  const loadPlain = () => (fs.existsSync(recentFile) || fs.existsSync(foldersFile)
    ? { files: readJson(recentFile, []), folders: fs.existsSync(foldersFile) ? readJson(foldersFile, []) : null } : null);
  {
    const first = settings.encryptRecent ? [loadEnc, loadPlain] : [loadPlain, loadEnc];
    const got = first[0]() || first[1]() || { files: [], folders: null };
    recent = got.files.filter(okRecent);
    sortRecent();
    // lists saved before folders existed: derive folders from the files
    if (got.folders) folders = got.folders.filter(okRecent);
    else {
      for (const r of recent) {
        const f = folders.find((x) => key(x.path) === key(path.dirname(r.path)));
        if (f) f.openedAt = Math.max(f.openedAt, r.openedAt); else folders.push(folderOf(r.path, r.openedAt));
      }
    }
    sortFolders();
  }

  // Write the new copy first, delete the other one only after that succeeded (a failed toggle never loses the list).
  const persist = () => {
    if (settings.encryptRecent && canEnc()) {
      try {
        atomicWriteFileSync(encFile, ss.encryptString(JSON.stringify({ files: recent, folders })));
        rm(recentFile); rm(foldersFile);
        encOk = true;
        return;
      } catch { /* fall through: keep it in plain files rather than lose it */ }
    }
    write(recentFile, recent);
    write(foldersFile, folders);
    if (encOk && fs.existsSync(recentFile) && fs.existsSync(foldersFile)) rm(encFile);
  };

  return {
    getSettings: () => ({ ...settings }),
    setSettings(patch) {
      settings = { ...settings, ...patch };
      write(settingsFile, settings);
      return { ...settings };
    },
    listRecent: () => recent.map((r) => ({ ...r })),
    addRecent({ path: p, name, kind }, now = Date.now()) {
      const old = recent.find((r) => key(r.path) === key(p));
      recent = recent.filter((r) => r !== old);
      recent.push({ path: p, name, kind, openedAt: now, pinned: !!(old && old.pinned) });
      sortRecent();
      const oldF = folders.find((f) => key(f.path) === key(path.dirname(p)));
      folders = folders.filter((f) => f !== oldF);
      folders.push(folderOf(p, now, !!(oldF && oldF.pinned)));
      sortFolders();
      persist();
    },
    removeRecent(p) {
      recent = recent.filter((r) => key(r.path) !== key(p));
      persist();
    },
    pinRecent(p, pinned) {
      const r = recent.find((x) => key(x.path) === key(p));
      if (r) { r.pinned = !!pinned; sortRecent(); persist(); }
    },
    clearRecent() {
      recent = recent.filter((r) => r.pinned);
      folders = folders.filter((f) => f.pinned);
      persist();
    },
    listFolders: () => folders.map((f) => ({ ...f })),
    removeFolder(p) {
      folders = folders.filter((f) => key(f.path) !== key(p));
      persist();
    },
    pinFolder(p, pinned) {
      const f = folders.find((x) => key(x.path) === key(p));
      if (f) { f.pinned = !!pinned; sortFolders(); persist(); }
    },
    // encrypted recent list (files + folders) via safeStorage; false = unavailable, nothing changed
    canEncryptRecent: canEnc,
    isRecentEncrypted: () => !!settings.encryptRecent && canEnc(),
    setRecentEncrypted(on) {
      if (on && !canEnc()) return false;
      settings = { ...settings, encryptRecent: !!on };
      write(settingsFile, settings);
      persist();
      return true;
    },
  };
}

module.exports = { createStore, atomicWriteFile, DEFAULT_SETTINGS, RECENT_MAX, FOLDERS_MAX };
