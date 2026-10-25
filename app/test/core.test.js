'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { KINDS, extOf, kindOfExt, decideSave } = require('../main/kinds');
const { createStore, RECENT_MAX } = require('../main/store');
const { createServer } = require('../main/server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-test-'));

test('kinds table', () => {
  assert.deepEqual(KINDS.word.opens, ['docx', 'doc', 'odt', 'rtf', 'txt']);
  assert.deepEqual(KINDS.cell.opens, ['xlsx', 'xls', 'ods', 'csv']);
  assert.deepEqual(KINDS.slide.opens, ['pptx', 'ppt', 'odp']);
  assert.deepEqual(KINDS.pdf.opens, ['pdf']);
  assert.equal(KINDS.word.newExt, 'docx');
  assert.equal(KINDS.pdf.newExt, null);
  assert.equal(kindOfExt('XLS'), 'cell');
  assert.equal(kindOfExt('exe'), null);
  assert.equal(extOf('C:\\a\\B.PPTX'), 'pptx');
  assert.equal(extOf('noext'), '');
});

test('save rules', () => {
  // same ext with a path -> write in place
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.docx', tabExt: 'docx', tabKind: 'word', ext: 'docx' }), { action: 'write' });
  // no path -> dialog + rebind (same kind)
  assert.deepEqual(decideSave({ tabPath: null, tabExt: 'docx', tabKind: 'word', ext: 'docx' }), { action: 'dialog', rebind: true });
  // legacy -> OOXML sibling -> dialog + rebind
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.doc', tabExt: 'doc', tabKind: 'word', ext: 'docx' }), { action: 'dialog', rebind: true });
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.xls', tabExt: 'xls', tabKind: 'cell', ext: 'xlsx' }), { action: 'dialog', rebind: true });
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.ppt', tabExt: 'ppt', tabKind: 'slide', ext: 'pptx' }), { action: 'dialog', rebind: true });
  // export to another kind -> dialog, no rebind
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.docx', tabExt: 'docx', tabKind: 'word', ext: 'pdf' }), { action: 'dialog', rebind: false });
  assert.deepEqual(decideSave({ tabPath: null, tabExt: 'docx', tabKind: 'word', ext: 'pdf' }), { action: 'dialog', rebind: false });
  // same kind but a path-bound non-legacy tab exporting to another format (docx -> odt) -> no rebind
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.docx', tabExt: 'docx', tabKind: 'word', ext: 'odt' }), { action: 'dialog', rebind: false });
  // legacy doc saved as something other than docx -> no rebind
  assert.deepEqual(decideSave({ tabPath: 'C:\\a.doc', tabExt: 'doc', tabKind: 'word', ext: 'odt' }), { action: 'dialog', rebind: false });
});

test('store: settings defaults, patch, corrupt file', () => {
  const dir = tmp();
  let s = createStore(dir);
  assert.deepEqual(s.getSettings(), { theme: 'system', language: 'en' });
  s.setSettings({ theme: 'dark' });
  assert.equal(createStore(dir).getSettings().theme, 'dark');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'recent.json'), '[1, "x"');
  s = createStore(dir);
  assert.deepEqual(s.getSettings(), { theme: 'system', language: 'en' });
  assert.deepEqual(s.listRecent(), []);
  assert.equal(fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), false);
});

test('store: recent order, pin, dedupe, limit, clear', () => {
  const dir = tmp();
  const s = createStore(dir);
  const add = (p, t) => s.addRecent({ path: p, name: path.basename(p), kind: 'word' }, t);
  add('C:\\a.docx', 1); add('C:\\b.docx', 2); add('C:\\c.docx', 3);
  assert.deepEqual(s.listRecent().map((r) => r.name), ['c.docx', 'b.docx', 'a.docx']);
  add('c:\\A.DOCX', 4); // case-insensitive dedupe, moves to top, keeps the newest spelling
  assert.deepEqual(s.listRecent().map((r) => r.name), ['A.DOCX', 'c.docx', 'b.docx']);
  assert.equal(s.listRecent().length, 3);
  s.pinRecent('C:\\b.docx', true);
  assert.deepEqual(s.listRecent().map((r) => r.pinned), [true, false, false]);
  assert.equal(s.listRecent()[0].name, 'b.docx');
  add('C:\\b.docx', 9); // reopening keeps the pin
  assert.equal(s.listRecent()[0].pinned, true);
  s.clearRecent();
  assert.deepEqual(s.listRecent().map((r) => r.name), ['b.docx']);
  s.removeRecent('C:\\B.docx');
  assert.equal(s.listRecent().length, 0);
  for (let i = 0; i < RECENT_MAX + 10; i++) add(`C:\\f${i}.docx`, 100 + i);
  const l = s.listRecent();
  assert.equal(l.length, RECENT_MAX);
  assert.equal(l[0].name, `f${RECENT_MAX + 9}.docx`);
  assert.equal(createStore(dir).listRecent().length, RECENT_MAX); // persisted
});

function get(port, p, method = 'GET', headers = { 'x-kiroku-key': 'testkey' }) {
  return new Promise((resolve, reject) => {
    // raw request so '..' segments are not normalised by a URL parser
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('server', async (t) => {
  const outer = tmp();
  const root = path.join(outer, 'root');
  fs.mkdirSync(path.join(root, 'sdkjs', 'common', 'wasm', 'x2t'), { recursive: true });
  fs.writeFileSync(path.join(outer, 'secret.txt'), 'SECRET');
  fs.writeFileSync(path.join(root, 'index.html'), 'INDEX');
  fs.writeFileSync(path.join(root, 'editor.html'), 'EDITOR');
  fs.writeFileSync(path.join(root, 'a.js'), 'x');
  const wasm = Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.alloc(100, 7)]);
  const x2t = path.join(root, 'sdkjs', 'common', 'wasm', 'x2t', 'x2t.wasm.br');
  fs.writeFileSync(x2t, zlib.brotliCompressSync(wasm));

  const srv = createServer({ root, port: 0, key: 'testkey' });
  const port = await srv.start();
  t.after(() => srv.close());

  let r = await get(port, '/');
  assert.equal(r.status, 200); assert.equal(r.body.toString(), 'INDEX');
  assert.match(r.headers['content-type'], /text\/html/); assert.equal(r.headers['cache-control'], 'no-cache');

  r = await get(port, '/editor?locale=en');
  assert.equal(r.status, 200); assert.equal(r.body.toString(), 'EDITOR');

  r = await get(port, '/a.js');
  assert.match(r.headers['content-type'], /javascript/); assert.equal(r.headers['cache-control'], 'max-age=604800');

  assert.equal((await get(port, '/nope')).status, 404);
  assert.equal((await get(port, '/nope.js')).status, 404);

  r = await get(port, '/a.js', 'HEAD');
  assert.equal(r.status, 200); assert.equal(r.body.length, 0); assert.equal(r.headers['content-length'], '1');

  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/a/../../secret.txt', '/%00', '/%zz']) {
    r = await get(port, p);
    assert.notEqual(r.body.toString(), 'SECRET', p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
  }

  // dev: brotli on disk is decompressed on the fly; packaged: raw wasm served as-is
  const X = '/sdkjs/common/wasm/x2t/x2t.wasm.br';
  r = await get(port, X);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/octet-stream');
  assert.equal(r.headers['content-encoding'], undefined);
  assert.ok(r.body.equals(wasm));

  const root2 = path.join(outer, 'packaged');
  fs.mkdirSync(path.join(root2, 'sdkjs', 'common', 'wasm', 'x2t'), { recursive: true });
  fs.writeFileSync(path.join(root2, 'sdkjs', 'common', 'wasm', 'x2t', 'x2t.wasm.br'), wasm);
  const srv2 = createServer({ root: root2, port: 0, key: 'testkey' });
  const port2 = await srv2.start();
  t.after(() => srv2.close());
  r = await get(port2, X);
  assert.ok(r.body.equals(wasm));
});
