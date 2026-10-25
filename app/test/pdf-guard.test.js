'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPdfTools } = require('../main/pdf-tools');

test('registerPdfTools: handlers refuse callers that are not the shell', async () => {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => (handlers[ch] = fn) };
  const electron = { BrowserWindow: { getFocusedWindow: () => null }, dialog: {} };
  registerPdfTools(ipcMain, electron, (e) => e.shell === true);
  assert.deepEqual(await handlers['pdf:info']({ shell: false }, { path: 'x.pdf' }), { ok: false, error: 'forbidden' });
  assert.deepEqual(await handlers['pdf:merge']({}, { paths: [] }), { ok: false, error: 'forbidden' });
  const r = await handlers['pdf:info']({ shell: true }, {});
  assert.equal(r.ok, false);
  assert.notEqual(r.error, 'forbidden'); // reached the real handler
});
