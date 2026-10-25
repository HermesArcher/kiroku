'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseArgs, userTasks } = require('../main/args');

const cwd = path.resolve('/work');

test('parseArgs: switches, --new=, files; packaged vs dev argv', () => {
  assert.deepEqual(parseArgs(['k.exe', '--writer', '--sheet', '--slides', '--pdf'], cwd, null), [
    { type: 'new', kind: 'word' }, { type: 'new', kind: 'cell' }, { type: 'new', kind: 'slide' }, { type: 'pdf' },
  ]);
  assert.deepEqual(parseArgs(['k.exe', '--new=docx', '--NEW=XLSX', '--new=pptx'], cwd, null), [
    { type: 'new', kind: 'word' }, { type: 'new', kind: 'cell' }, { type: 'new', kind: 'slide' },
  ]);
  assert.deepEqual(parseArgs(['k.exe', 'a.docx', '--unknown', '--remote-debugging-port=1'], cwd, null), [{ type: 'open', path: path.resolve(cwd, 'a.docx') }]);
  // dev: argv = [electron, appDir, ...]
  assert.deepEqual(parseArgs(['electron.exe', '.', '--sheet', 'b.csv'], cwd, '.'), [
    { type: 'new', kind: 'cell' }, { type: 'open', path: path.resolve(cwd, 'b.csv') },
  ]);
  // after a bare -- everything is a file, even if it looks like a switch
  assert.deepEqual(parseArgs(['k.exe', '--', '--writer'], cwd, null), [{ type: 'open', path: path.resolve(cwd, '--writer') }]);
  assert.deepEqual(parseArgs(['k.exe'], cwd, null), []);
  // second instance: Electron moves positionals behind the switches and adds a valueless --source-app-id
  assert.deepEqual(parseArgs(['electron.exe', '--sheet', '--source-app-id', '.', 'c.docx'], cwd, '.'), [
    { type: 'new', kind: 'cell' }, { type: 'open', path: path.resolve(cwd, 'c.docx') },
  ]);
  assert.deepEqual(parseArgs(['k.exe', '--source-app-id', 'c.docx'], cwd, null), [{ type: 'open', path: path.resolve(cwd, 'c.docx') }]); // packaged: the file follows the switch
});

test('userTasks: four tasks launching the matching switch; dev passes the app dir first', () => {
  const t = userTasks('K/Kiroku.exe', '/app', false);
  assert.deepEqual(t.map((x) => x.title), ['New document', 'New spreadsheet', 'New presentation', 'Open PDF']);
  assert.deepEqual(t.map((x) => x.arguments), ['--writer', '--sheet', '--slides', '--pdf']);
  assert.ok(t.every((x) => x.program === 'K/Kiroku.exe'));
  const d = userTasks('el/electron.exe', '/app', true);
  assert.equal(d[0].arguments, '"/app" --writer');
  // what a dev task launches parses back to the right action
  assert.deepEqual(parseArgs(['electron.exe', '.', '--pdf'], cwd, '.'), [{ type: 'pdf' }]);
});
