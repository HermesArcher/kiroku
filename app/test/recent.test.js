'use strict';
// Recent folders + encrypted recent list (injected fake safeStorage).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, FOLDERS_MAX } = require('../main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-recent-'));
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64')),
  decryptString: (b) => {
    const t = b.toString();
    if (!t.startsWith('ENC:')) throw new Error('bad blob');
    return Buffer.from(t.slice(4), 'base64').toString('utf8');
  },
});
const add = (s, p, t, kind = 'word') => s.addRecent({ path: p, name: path.basename(p), kind }, t);

test('folders: tracked from opened files, newest first, dedupe, pin, cap, remove, clear', () => {
  const dir = tmp();
  const s = createStore(dir);
  add(s, 'C:\\Work\\a.docx', 1); add(s, 'C:\\Work\\b.docx', 2); add(s, 'D:\\Misc\\c.xlsx', 3);
  assert.deepEqual(s.listFolders().map((f) => f.path), ['D:\\Misc', 'C:\\Work']);
  assert.equal(s.listFolders()[0].name, 'Misc');
  add(s, 'c:\\work\\a.docx', 4); // same folder, different case -> deduped, moved to top
  assert.deepEqual(s.listFolders().map((f) => f.openedAt), [4, 3]);
  s.pinFolder('D:\\Misc', true);
  assert.deepEqual(s.listFolders().map((f) => f.pinned), [true, false]);
  add(s, 'D:\\Misc\\z.xlsx', 9); // reopening keeps the pin
  assert.equal(s.listFolders()[0].pinned, true);
  s.clearRecent(); // keeps pinned only
  assert.deepEqual(s.listFolders().map((f) => f.path), ['D:\\Misc']);
  s.removeFolder('d:\\misc');
  assert.equal(s.listFolders().length, 0);
  for (let i = 0; i < FOLDERS_MAX + 5; i++) add(s, `C:\\f${i}\\x.docx`, 100 + i);
  const l = s.listFolders();
  assert.equal(l.length, FOLDERS_MAX);
  assert.equal(l[0].path, `C:\\f${FOLDERS_MAX + 4}`);
  assert.equal(createStore(dir).listFolders().length, FOLDERS_MAX); // persisted
});

test('folders: derived from an old recent.json that has no folder list yet', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'recent.json'), JSON.stringify([
    { path: 'C:\\A\\1.docx', name: '1.docx', kind: 'word', openedAt: 5, pinned: false },
    { path: 'C:\\A\\2.docx', name: '2.docx', kind: 'word', openedAt: 9, pinned: false },
    { path: 'C:\\B\\3.pdf', name: '3.pdf', kind: 'pdf', openedAt: 7, pinned: false },
  ]));
  const f = createStore(dir).listFolders();
  assert.deepEqual(f.map((x) => [x.path, x.openedAt]), [['C:\\A', 9], ['C:\\B', 7]]);
});

test('encrypt recent: round-trip on and off, plain JSON removed/restored, never lost', () => {
  const dir = tmp();
  const ss = fakeSafe();
  let s = createStore(dir, { safeStorage: ss });
  add(s, 'C:\\Work\\a.docx', 1); add(s, 'C:\\Work\\b.docx', 2);
  s.pinRecent('C:\\Work\\a.docx', true);
  s.pinFolder('C:\\Work', true);
  const files = (n) => fs.existsSync(path.join(dir, n));
  assert.ok(files('recent.json') && files('recent-folders.json') && !files('recent.enc'));

  assert.equal(s.setRecentEncrypted(true), true);
  assert.ok(files('recent.enc') && !files('recent.json') && !files('recent-folders.json'));
  assert.ok(!fs.readFileSync(path.join(dir, 'recent.enc'), 'utf8').includes('Work')); // not readable as plain text
  assert.equal(s.isRecentEncrypted(), true);

  add(s, 'C:\\Work\\c.docx', 3); // writes while encrypted stay encrypted
  assert.ok(files('recent.enc') && !files('recent.json'));

  s = createStore(dir, { safeStorage: ss }); // restart
  assert.deepEqual(s.listRecent().map((r) => r.name), ['a.docx', 'c.docx', 'b.docx']);
  assert.deepEqual(s.listFolders().map((f) => [f.path, f.pinned]), [['C:\\Work', true]]);

  assert.equal(s.setRecentEncrypted(false), true);
  assert.ok(files('recent.json') && files('recent-folders.json') && !files('recent.enc'));
  s = createStore(dir, { safeStorage: ss });
  assert.deepEqual(s.listRecent().map((r) => r.name), ['a.docx', 'c.docx', 'b.docx']);
  assert.equal(s.isRecentEncrypted(), false);
});

test('encrypt recent: unavailable safeStorage refuses and changes nothing; undecryptable file is kept', () => {
  const dir = tmp();
  const s = createStore(dir, { safeStorage: fakeSafe(false) });
  add(s, 'C:\\Work\\a.docx', 1);
  assert.equal(s.canEncryptRecent(), false);
  assert.equal(s.setRecentEncrypted(true), false);
  assert.equal(s.getSettings().encryptRecent, undefined);
  assert.ok(fs.existsSync(path.join(dir, 'recent.json')));
  assert.equal(createStore(dir).setRecentEncrypted(true), false); // no safeStorage at all

  // encrypted by another profile / machine: list is empty, but the blob is never deleted by later writes
  const d2 = tmp();
  const a = createStore(d2, { safeStorage: fakeSafe() });
  add(a, 'C:\\Work\\a.docx', 1);
  a.setRecentEncrypted(true);
  const b = createStore(d2, { safeStorage: fakeSafe(false) });
  assert.equal(b.listRecent().length, 0);
  add(b, 'C:\\Other\\x.docx', 2);
  assert.ok(fs.existsSync(path.join(d2, 'recent.enc')));
});
