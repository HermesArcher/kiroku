'use strict';
// Shared helpers for the Kiroku end-to-end suite: launch the real Electron app, drive it over CDP.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..');
const ELECTRON = require('electron'); // path to electron.exe
const UNZIP = 'C:\\Program Files\\Git\\usr\\bin\\unzip.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `kiroku-e2e-${tag}-`));
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

async function until(fn, { timeout = 30000, step = 200, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? ': ' + last.message : ''}`);
    await sleep(step);
  }
}

/** Launch the app. opts: args[], env{}, userData, testDir, connect. Returns a handle. */
async function launch(opts = {}) {
  const userData = opts.userData || tmpdir('ud');
  const testDir = opts.testDir || tmpdir('out');
  const port = await freePort();
  const inspectPort = await freePort();
  const out = [];
  const env = { ...process.env, KIROKU_USER_DATA: userData, KIROKU_TEST_DIR: testDir, KIROKU_DEBUG: '1', ...(opts.env || {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const t0 = Date.now();
  // KIROKU_EXE=<installed Kiroku.exe> runs the same suite against the packaged build.
  const exe = process.env.KIROKU_EXE;
  const proc = spawn(exe || ELECTRON, [...(exe ? [] : ['.']), ...(opts.args || []), `--remote-debugging-port=${port}`, `--inspect=${inspectPort}`], { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => out.push(...String(d).split(/\r?\n/).filter(Boolean));
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  const app = {
    proc, pid: proc.pid, port, inspectPort, userData, testDir, out, t0, browser: null, exited: false,
    log: (re) => out.filter((l) => re.test(l)),
    pages() { return this.browser ? this.browser.contexts().flatMap((c) => c.pages()) : []; },
    shellPage() { return this.pages().find((p) => /renderer\/index\.html/.test(p.url())); },
    editorPages() { return this.pages().filter((p) => /\/editor\?|\/history/.test(p.url())); },
    async kill() {
      if (this.browser) { try { await Promise.race([this.browser.close(), sleep(3000)]); } catch {} this.browser = null; }
      if (!this.exited) { try { execFileSync('taskkill', ['/PID', String(this.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    },
    /** Evaluate JS in the Electron MAIN process (node inspector). */
    async mainEval(expression) {
      const list = await (await fetch(`http://127.0.0.1:${this.inspectPort}/json`)).json();
      const ws = new WebSocket(list[0].webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('inspector ws error')); });
      const reply = await new Promise((res) => {
        ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); };
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      ws.close();
      if (reply.error || reply.result.exceptionDetails) throw new Error(JSON.stringify(reply.error || reply.result.exceptionDetails));
      return reply.result.result.value;
    },
    /**
     * Deliver a REAL keyboard event to a webContents (CDP Input.dispatchKeyEvent bypasses Electron's
     * before-input-event, which is where the shell shortcuts live). target: 'shell' or the n-th editor view (0-based).
     */
    sendKey(target, keyCode, modifiers = []) {
      const mods = JSON.stringify(modifiers);
      const pick = target === 'shell'
        ? "all.find((w) => w.getURL().startsWith('file:'))"
        : `all.filter((w) => w.getURL().startsWith('http://127.0.0.1') && (w.getURL().includes('/editor') || w.getURL().includes('/history'))).sort((a, b) => a.id - b.id)[${Number(target)}]`;
      return this.mainEval(`(() => { const all = process.mainModule.require('electron').webContents.getAllWebContents(); const w = ${pick}; if (!w) return 'no-target';
        for (const type of ['keyDown', 'keyUp']) w.sendInputEvent({ type, keyCode: ${JSON.stringify(keyCode)}, modifiers: ${mods} }); return 'sent'; })()`);
    },
    state() { return this.shellPage().evaluate(() => window.__e2eState); },
    async waitState(pred, what = 'shell state', timeout = 30000) {
      return until(async () => { const s = await this.state(); return s && pred(s) ? s : null; }, { timeout, what });
    },
    /** Wait for a new editor page (not in `known`), return it. */
    nextEditor(known = [], timeout = 30000) {
      return until(() => this.editorPages().find((p) => !known.includes(p)), { timeout, what: 'new editor page' });
    },
  };
  proc.on('exit', () => { app.exited = true; });
  if (opts.connect === false) return app;
  await connect(app);
  return app;
}

async function connect(app) {
  const url = `http://127.0.0.1:${app.port}`;
  app.browser = await until(() => chromium.connectOverCDP(url), { timeout: 40000, step: 300, what: 'CDP connect' });
  await until(() => app.shellPage(), { what: 'shell page' });
  await app.shellPage().waitForLoadState('domcontentloaded');
  const p = app.shellPage();
  await until(() => p.evaluate(() => !!window.shell), { what: 'window.shell' });
  await p.evaluate(() => { if (!window.__e2eHook) { window.__e2eHook = true; window.shell.onState((s) => { window.__e2eState = s; }); } });
  await until(() => app.state(), { what: 'first shell state' });
  return app;
}

/** Wait for ONLYOFFICE inside an editor page to finish loading the document. Resolves with elapsed ms. */
async function waitEditor(page, timeout = 120000) {
  const t0 = Date.now();
  await page.evaluate(async ({ timeout }) => {
    const t0 = Date.now();
    const find = (win) => {
      try { const api = win.Asc && win.Asc.editor; if (api && typeof api.asc_registerCallback === 'function') return { api, win }; } catch {}
      for (let i = 0; i < win.frames.length; i++) { const f = find(win.frames[i]); if (f) return f; }
      return null;
    };
    for (;;) {
      const f = find(window);
      if (f && f.api.isDocumentLoadComplete && f.api.isLoadFullApi) { await new Promise((r) => setTimeout(r, 1200)); return; }
      if (Date.now() - t0 > timeout) throw new Error('editor not ready: ' + JSON.stringify(f ? { c: f.api.isDocumentLoadComplete, f: f.api.isLoadFullApi } : 'no sdk'));
      await new Promise((r) => setTimeout(r, 250));
    }
  }, { timeout });
  return Date.now() - t0 - 1200;
}

/** Visible fatal editor dialog text (or null). */
const fatalDialog = (page) => page.evaluate(() => {
  const re = /error occurred during the work|failed to open|download failed/i;
  const visit = (win) => {
    try {
      for (const el of win.document.querySelectorAll('.asc-window, .modal, [role="dialog"]')) if (el.offsetParent !== null && re.test(el.textContent || '')) return el.textContent.trim().slice(0, 200);
    } catch {}
    for (let i = 0; i < win.frames.length; i++) { const f = visit(win.frames[i]); if (f) return f; }
    return null;
  };
  return visit(window);
});

/** Run fn(win, api, arg) inside the editor frame (fn is serialised: no closures; pass data via arg). */
const inEditor = (page, fn, arg) => page.evaluate(async ({ src, arg }) => {
  const find = (win) => {
    try { const api = win.Asc && win.Asc.editor; if (api && typeof api.asc_registerCallback === 'function') return { api, win }; } catch {}
    for (let i = 0; i < win.frames.length; i++) { const f = find(win.frames[i]); if (f) return f; }
    return null;
  };
  const f = find(window);
  if (!f) throw new Error('no SDK frame');
  // eslint-disable-next-line no-new-func
  return await new Function('return (' + src + ')')()(f.win, f.api, arg);
}, { src: fn.toString(), arg });

const focusEditor = (page) => inEditor(page, (win) => { const a = win.document.getElementById('area_id'); if (a) a.focus(); });

/** Insert HTML at the caret of a word/slide editor (keyboard.type drops characters). */
async function pasteHtml(page, html) {
  await inEditor(page, (win, api, h) => { const a = win.document.getElementById('area_id'); if (a) a.focus(); api.pluginMethod_PasteHtml(h); }, html);
  await sleep(1500);
}

/** Ctrl+S in the editor page (focus the SDK input first). */
async function ctrlS(page) {
  await focusEditor(page);
  await page.keyboard.press('Control+S');
}

const unzipEntry = (file, entry) => execFileSync(UNZIP, ['-p', file, entry], { maxBuffer: 1 << 28 }).toString('utf8');
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
/** Wait until `f` exists and (optionally) was modified after `after` (ms epoch). */
const waitFile = (f, { timeout = 60000, after = 0 } = {}) => until(() => fs.existsSync(f) && fs.statSync(f).size > 0 && mtime(f) > after, { timeout, what: `file ${f}` });

/** Minimal PDF with n pages via pdf-lib. */
async function makePdf(file, pages = 2) {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([595, 842]).drawText(`Kiroku page ${i}`, { x: 72, y: 700, size: 24, font });
  fs.writeFileSync(file, await doc.save());
}
const pdfPages = async (file) => (await require('pdf-lib').PDFDocument.load(fs.readFileSync(file))).getPageCount();

/** Dirty the open word doc so close prompts fire; returns when main reports dirty. */
async function makeDirty(app, page) {
  await pasteHtml(page, '<p>dirty edit</p>');
  await app.waitState((s) => s.tabs.some((t) => t.dirty), 'tab dirty');
}

module.exports = {
  APP_DIR, sleep, tmpdir, until, launch, connect, waitEditor, fatalDialog, inEditor, focusEditor, pasteHtml, ctrlS,
  unzipEntry, waitFile, mtime, makePdf, pdfPages, makeDirty,
};
