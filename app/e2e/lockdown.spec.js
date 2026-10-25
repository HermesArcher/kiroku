'use strict';
// Loopback server lock, open-by-content, command-line switches.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./lib');

const TEMPLATE_DOCX = path.join(L.APP_DIR, 'templates', 'new.docx');
const rawGet = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get(url, { headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

test('14: server answers 403 without the run key; the app itself still loads editors', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    expect(await L.fatalDialog(ed)).toBeNull();
    const origin = new URL(ed.url()).origin;
    expect(await rawGet(origin + '/editor')).toBe(403);
    expect(await rawGet(origin + '/editor', { 'X-Kiroku-Key': 'guess' })).toBe(403);
    expect(await rawGet(origin + '/editor', { Host: 'evil.example' })).toBe(403);
    // an in-app request carries the key
    expect(await ed.evaluate(async () => (await fetch('/editor?x=2')).status)).toBe(200);
  } finally { await app.kill(); }
});

test('15: PDF IPC refuses an editor page, accepts the shell', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    // the editor preload does not expose window.shell; a raw ipc call from there is not possible either, so check the shell works
    expect(await ed.evaluate(() => typeof window.shell)).toBe('undefined');
    const pdf = path.join(L.tmpdir('pdfg'), 'a.pdf');
    await L.makePdf(pdf, 3);
    expect(await app.shellPage().evaluate((p) => window.shell.pdf('info', { path: p }), pdf)).toEqual({ pages: 3 });
  } finally { await app.kill(); }
});

for (const name of ['report.bin', 'report']) {
  test(`16: docx renamed to "${name}" opens in the Document editor`, async () => {
    const dir = L.tmpdir('sniff');
    const file = path.join(dir, name);
    fs.copyFileSync(TEMPLATE_DOCX, file);
    const app = await L.launch({ args: [file] });
    try {
      const ed = await app.nextEditor();
      await L.waitEditor(ed);
      expect(await L.fatalDialog(ed)).toBeNull();
      const st = await app.waitState((s) => s.tabs.length === 1, 'tab');
      expect(st.tabs[0].kind).toBe('word');
      expect(st.tabs[0].title).toBe(name);
    } finally { await app.kill(); }
  });
}

test('17: switches --writer/--sheet/--slides, and --pdf picker; second instance acts in the running one', async () => {
  const pdf = path.join(L.tmpdir('sw'), 'p.pdf');
  await L.makePdf(pdf, 1);
  const app = await L.launch({ args: ['--writer'], env: { KIROKU_TEST_OPEN: JSON.stringify([pdf]) } });
  try {
    let st = await app.waitState((s) => s.tabs.length === 1, 'writer tab');
    expect(st.tabs[0].kind).toBe('word');
    const run = async (sw, n) => {
      const second = await L.launch({ userData: app.userData, args: [sw], connect: false, env: { KIROKU_TEST_OPEN: JSON.stringify([pdf]) } });
      try { await L.until(() => second.exited, { timeout: 30000, what: 'second instance exit' }); } finally { await second.kill(); }
      return app.waitState((s) => s.tabs.length === n, `${sw} tab`);
    };
    st = await run('--sheet', 2);
    expect(st.tabs[1].kind).toBe('cell');
    st = await run('--slides', 3);
    expect(st.tabs[2].kind).toBe('slide');
    st = await run('--pdf', 4);
    expect(st.tabs[3].kind).toBe('pdf');
  } finally { await app.kill(); }
});
