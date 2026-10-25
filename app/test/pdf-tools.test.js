'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const T = require('../main/pdf-tools.js');

// page i has width 100 + i so pages can be told apart
async function makePdf(n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([100 + i, 200]);
  return d.save();
}
const widths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('parseRanges: valid forms', () => {
  assert.deepEqual(T.parseRanges('1-3, 5, 8-', 10), [0, 1, 2, 4, 7, 8, 9]);
  assert.deepEqual(T.parseRanges('  2 ,\t 4 - 5 ', 6), [1, 3, 4]);
  assert.deepEqual(T.parseRanges('3,1,3,1-2', 5), [0, 1, 2]); // sorted + unique
  assert.deepEqual(T.parseRanges('2-', 4), [1, 2, 3]);
  assert.deepEqual(T.parseRanges('1', 1), [0]);
});

test('parseRanges: errors have human messages', () => {
  assert.throws(() => T.parseRanges('', 5), /Enter the pages/);
  assert.throws(() => T.parseRanges('   ', 5), /Enter the pages/);
  assert.throws(() => T.parseRanges('0', 5), /start at 1/);
  assert.throws(() => T.parseRanges('0-2', 5), /start at 1/);
  assert.throws(() => T.parseRanges('5-3', 9), /backwards/);
  assert.throws(() => T.parseRanges('6', 5), /Page 6 does not exist.*5 pages/);
  assert.throws(() => T.parseRanges('2-9', 5), /Page 9 does not exist/);
  assert.throws(() => T.parseRanges('6-', 5), /Page 6 does not exist/);
  assert.throws(() => T.parseRanges('1,,2', 5), /empty entry/);
  assert.throws(() => T.parseRanges('a-b', 5), /not a valid/);
  assert.throws(() => T.parseRanges('-3', 5), /not a valid/);
  assert.throws(() => T.parseRanges('1', 1) && T.parseRanges('2', 1), /1 page\./);
});

test('parseRangeGroups keeps groups and order', () => {
  assert.deepEqual(T.parseRangeGroups('1-3,4,7-9', 9), [[0, 1, 2], [3], [6, 7, 8]]);
  assert.deepEqual(T.parseRangeGroups('5, 1-2', 5), [[4], [0, 1]]);
  assert.throws(() => T.parseRangeGroups('1-3,10', 9), /does not exist/);
  assert.throws(() => T.parseRangeGroups('', 9), /Enter the pages/);
});

test('merge concatenates in order', async () => {
  const out = await T.merge([await makePdf(2), await makePdf(3)]);
  assert.deepEqual(await widths(out), [100, 101, 100, 101, 102]);
  await assert.rejects(T.merge([await makePdf(1)]), /at least two/);
});

test('splitEach: one pdf per page', async () => {
  const parts = await T.splitEach(await makePdf(3));
  assert.equal(parts.length, 3);
  assert.deepEqual(await Promise.all(parts.map(async (p) => (await widths(p))[0])), [100, 101, 102]);
});

test('splitGroups', async () => {
  const parts = await T.splitGroups(await makePdf(5), [[0, 1], [4]]);
  assert.deepEqual(await widths(parts[0]), [100, 101]);
  assert.deepEqual(await widths(parts[1]), [104]);
});

test('extract', async () => {
  assert.deepEqual(await widths(await T.extract(await makePdf(5), [3, 1])), [103, 101]);
  await assert.rejects(T.extract(await makePdf(2), []), /No pages/);
});

test('remove, refuses to remove every page', async () => {
  assert.deepEqual(await widths(await T.remove(await makePdf(4), [0, 2])), [101, 103]);
  await assert.rejects(T.remove(await makePdf(2), [0, 1]), /every page/);
});

test('rotate: adds to existing rotation, mod 360', async () => {
  const src = await makePdf(3);
  const once = await T.rotate(src, 90, [1]);
  let angles = (await PDFDocument.load(once)).getPages().map((p) => p.getRotation().angle);
  assert.deepEqual(angles, [0, 90, 0]);
  const twice = await T.rotate(once, 270, null); // all pages
  angles = (await PDFDocument.load(twice)).getPages().map((p) => p.getRotation().angle);
  assert.deepEqual(angles, [270, 0, 270]);
  await assert.rejects(T.rotate(src, 45), /90, 180 or 270/);
});

test('imagesToPdf: page sized to image, png + errors', async () => {
  const out = await T.imagesToPdf([{ bytes: PNG, ext: 'png' }, { bytes: PNG, ext: '.PNG' }]);
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()], [1, 1]);
  await assert.rejects(T.imagesToPdf([{ bytes: PNG, ext: 'gif' }]), /Only PNG and JPG/);
  await assert.rejects(T.imagesToPdf([{ bytes: Buffer.from('nope'), ext: 'png' }]), /could not be read/);
  await assert.rejects(T.imagesToPdf([]), /at least one/);
});

test('imagesToPdf: a JPEG that is a view into a larger buffer (Node small-file pool) still embeds', async () => {
  const jpg = await require('sharp')({ create: { width: 30, height: 60, channels: 3, background: '#2222cc' } }).jpeg().toBuffer();
  const view = Buffer.concat([Buffer.alloc(100, 1), jpg]).subarray(100);
  assert.notEqual(view.byteOffset, 0);
  const doc = await PDFDocument.load(await T.imagesToPdf([{ bytes: view, ext: '.jpg' }]));
  assert.deepEqual([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()], [30, 60]);
});

test('garbage bytes give a human error', async () => {
  await assert.rejects(T.extract(Buffer.from('not a pdf'), [0]), /could not be read as a PDF/);
});

test('registerPdfTools: extract writes via dialog path, can target the input file safely', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-pdf-'));
  const input = path.join(dir, 'in.pdf');
  fs.writeFileSync(input, await makePdf(4));
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => (handlers[ch] = fn) };
  let saveTo = input; // choose the input file as output
  const electron = {
    BrowserWindow: { getFocusedWindow: () => null },
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: saveTo }),
      showOpenDialog: async () => ({ canceled: false, filePaths: [dir] }),
    },
  };
  T.registerPdfTools(ipcMain, electron);
  for (const op of ['pick', 'info', 'merge', 'split', 'extract', 'delete', 'rotate', 'images']) assert.ok(handlers['pdf:' + op], op);

  assert.deepEqual(await handlers['pdf:info'](null, { path: input }), { pages: 4 });

  const bad = await handlers['pdf:extract'](null, { path: input, ranges: '9' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /does not exist/);
  assert.equal((await PDFDocument.load(fs.readFileSync(input))).getPageCount(), 4); // untouched

  const r = await handlers['pdf:extract'](null, { path: input, ranges: '2-3' });
  assert.deepEqual(r, { ok: true, output: input });
  assert.equal((await PDFDocument.load(fs.readFileSync(input))).getPageCount(), 2);
  assert.deepEqual(fs.readdirSync(dir), ['in.pdf']); // no temp files left

  const s = await handlers['pdf:split'](null, { path: input, mode: 'each' });
  assert.equal(s.ok, true);
  assert.equal(s.output.length, 2);
  assert.ok(s.output.every((f) => fs.existsSync(f)));

  electron.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.deepEqual(await handlers['pdf:rotate'](null, { path: input, degrees: 90 }), { ok: false, cancelled: true });

  fs.rmSync(dir, { recursive: true, force: true });
});
