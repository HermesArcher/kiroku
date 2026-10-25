'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { searchFiles, searchSmart, findEs, parseEs } = require('../main/search');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-search-'));

test('searchFiles: name match, ext filter, skips dot/node_modules, depth + limit caps', async () => {
  const root = tmp();
  const touch = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), ''); };
  touch('Budget Q3.xlsx');
  touch('sub/budget notes.docx');
  touch('sub/deep/a/b/c/d/e/f/g/budget-too-deep.docx');   // beyond maxDepth
  touch('.hidden/budget-hidden.docx');
  touch('node_modules/budget-dep.docx');
  touch('budget.exe');                                    // not an office ext

  const names = (r) => r.map((h) => h.name).sort();
  assert.deepEqual(names(await searchFiles('BUDGET', [root])), ['Budget Q3.xlsx', 'budget notes.docx']);
  assert.equal((await searchFiles('budget', [root]))[0].kind, 'cell'); // BFS: shallowest first
  assert.equal((await searchFiles('budget', [root], { limit: 1 })).length, 1);
  assert.deepEqual(await searchFiles('   ', [root]), []);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- Everything via es.exe (stubbed spawn) ----

// fake child: emits `stdout`, then closes with `code` (or never closes when hang)
const fakeSpawn = ({ stdout = '', code = 0, hang = false, calls = [] } = {}) => (file, args) => {
  calls.push([file, args]);
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.kill = () => { c.killed = true; };
  if (!hang) setImmediate(() => { c.stdout.emit('data', Buffer.from(stdout)); c.emit('close', code); });
  return c;
};

test('parseEs: keeps absolute supported paths, drops errors/blank/unsupported', () => {
  const out = 'Error 8: Everything IPC not found\r\nC:\\Docs\\Report.DOCX\r\n\r\n  D:\\x\\y.pdf  \r\nC:\\a\\run.exe\r\n\\\\srv\\share\\t.xlsx\r\nrelative\\n.docx\r\n';
  assert.deepEqual(parseEs(out).map((h) => [h.path, h.name, h.kind]), [
    ['C:\\Docs\\Report.DOCX', 'Report.DOCX', 'word'], ['D:\\x\\y.pdf', 'y.pdf', 'pdf'], ['\\\\srv\\share\\t.xlsx', 't.xlsx', 'cell'],
  ]);
});

test('findEs: PATH first, then install dirs, else null', () => {
  const has = (set) => (f) => set.includes(f);
  const env = { PATH: 'C:\\bin;C:\\tools', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  const inTools = path.join('C:\\tools', 'es.exe');
  const inLocal = path.join('C:\\Users\\u\\AppData\\Local', 'Programs', 'Everything', 'es.exe');
  assert.equal(findEs(env, has([inTools, path.join('C:\\Program Files', 'Everything', 'es.exe')])), inTools);
  assert.equal(findEs(env, has([inLocal])), inLocal);
  assert.equal(findEs(env, has([])), null);
});

test('searchSmart: Everything answers -> engine everything, query args, missing files dropped', async () => {
  const calls = [];
  const r = await searchSmart('budget', [], {
    es: 'es.exe', exists: (p) => !p.includes('gone'),
    spawnFn: fakeSpawn({ stdout: 'C:\\d\\budget.xlsx\r\nC:\\d\\gone budget.docx\r\n', calls }),
  });
  assert.equal(r.engine, 'everything');
  assert.deepEqual(r.hits.map((h) => h.name), ['budget.xlsx']);
  assert.deepEqual(calls[0][1].slice(0, 2), ['-n', '50']);
  assert.match(calls[0][1][2], /^ext:docx;.*pdf$/);
  assert.equal(calls[0][1][3], 'budget');
});

test('searchSmart: falls back to the folder walk (no es.exe, exit!=0, timeout, spawn throws)', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'budget.docx'), '');
  const walked = async (opts) => {
    const r = await searchSmart('budget', [root], opts);
    assert.equal(r.engine, 'folders');
    assert.deepEqual(r.hits.map((h) => h.name), ['budget.docx']);
  };
  await walked({ es: null });
  await walked({ es: 'es.exe', spawnFn: fakeSpawn({ code: 8, stdout: 'Error 8: Everything IPC not found' }) });
  const t0 = Date.now();
  await walked({ es: 'es.exe', spawnFn: fakeSpawn({ hang: true }), timeout: 60 });
  assert.ok(Date.now() - t0 < 1000);
  await walked({ es: 'es.exe', spawnFn: () => { throw new Error('ENOENT'); } });
  assert.deepEqual((await searchSmart('  ', [root], { es: null })).hits, []);
  fs.rmSync(root, { recursive: true, force: true });
});
