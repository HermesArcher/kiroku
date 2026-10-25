'use strict';
// Name search over the user's document folders, like WPS's search box. No index file: walk on demand, breadth-first, capped.
// Limit: no index, every query re-walks the folders. Upgrade to a persistent index (or the NTFS USN journal, as WPS's Everything engine does) if walks feel slow.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ALL_EXTS, extOf, kindOfExt } = require('./kinds');

const SKIP = (name) => name.startsWith('.') || name === 'node_modules';

/** Files under `roots` whose name contains `query` (case-insensitive) and whose ext Kiroku opens. */
async function searchFiles(query, roots, { limit = 50, maxDepth = 6, maxDirs = 5000 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  const queue = roots.map((dir) => ({ dir, depth: 0 }));
  let dirs = 0;
  while (queue.length && hits.length < limit && dirs++ < maxDirs) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (SKIP(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile() && ALL_EXTS.includes(extOf(e.name)) && e.name.toLowerCase().includes(q)) {
        hits.push({ path: full, name: e.name, kind: kindOfExt(extOf(e.name)) });
        if (hits.length >= limit) break;
      }
    }
  }
  return hits;
}

// ---- Everything (voidtools) via its command-line client es.exe: instant whole-PC results, strictly local (IPC to the running Everything). ----
/** First es.exe found on PATH, then the usual install dirs; null if none. */
function findEs(env = process.env, exists = fs.existsSync) {
  const dirs = [
    ...String(env.PATH || env.Path || '').split(path.delimiter),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Everything'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Everything'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Everything'),
  ].filter(Boolean);
  for (const d of dirs) { const f = path.join(d, 'es.exe'); if (exists(f)) return f; }
  return null;
}

/** es.exe prints one full path per line. Keep absolute paths with a supported extension (error text never matches). */
function parseEs(stdout) {
  const hits = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const p = line.trim();
    if (!/^([A-Za-z]:[\\/]|\\\\)/.test(p) || !ALL_EXTS.includes(extOf(p))) continue;
    hits.push({ path: p, name: path.basename(p), kind: kindOfExt(extOf(p)) });
  }
  return hits;
}

/** Run es.exe; resolves with stdout, rejects on spawn error, non-zero exit (e.g. Everything not running) or timeout. */
function runEs(es, args, { spawnFn = spawn, timeout = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    let out = '', done = false, timer = null, child;
    const fin = (err) => { if (done) return; done = true; clearTimeout(timer); if (err) reject(err); else resolve(out); };
    try { child = spawnFn(es, args, { windowsHide: true }); } catch (e) { fin(e); return; }
    timer = setTimeout(() => { try { child.kill(); } catch (_) { /* gone */ } fin(new Error('es.exe timed out')); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', fin);
    child.on('close', (code) => fin(code === 0 ? null : new Error('es.exe exit ' + code)));
  });
}

/**
 * Whole-PC search: Everything when es.exe exists and an instance answers within `timeout`, else the folder walk.
 * Returns { engine: 'everything' | 'folders', hits }.
 * Limit: es.exe prints in the console code page, so non-Latin names can come back mangled; those hits fail the exists() check and are dropped.
 * Upgrade: ask es.exe for UTF-8 output once a build that supports it is confirmed.
 */
async function searchSmart(query, roots, { es = findEs(), spawnFn, timeout = 1500, limit = 50, exists = fs.existsSync, ...walk } = {}) {
  const q = String(query || '').trim();
  if (!q) return { engine: 'folders', hits: [] };
  if (es && !q.startsWith('-')) {
    try {
      const out = await runEs(es, ['-n', String(limit), 'ext:' + ALL_EXTS.join(';'), q], { spawnFn, timeout });
      return { engine: 'everything', hits: parseEs(out).filter((h) => exists(h.path)).slice(0, limit) };
    } catch (_) { /* Everything not running / slow: fall back to the walk */ }
  }
  return { engine: 'folders', hits: await searchFiles(q, roots, { limit, ...walk }) };
}

module.exports = { searchFiles, searchSmart, findEs, parseEs, runEs };
