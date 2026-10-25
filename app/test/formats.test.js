'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FORMATS, formatsFor, isSupported, isLossy, dialogFilters, warningText } = require('../main/formats');

test('every kind lists its native format first and never offers legacy binary doc/xls/ppt', () => {
  assert.equal(FORMATS.word[0][0], 'docx');
  assert.equal(FORMATS.cell[0][0], 'xlsx');
  assert.equal(FORMATS.slide[0][0], 'pptx');
  for (const kind of Object.keys(FORMATS)) {
    for (const [ext] of FORMATS[kind]) assert.ok(!['doc', 'xls', 'ppt'].includes(ext), `${kind}:${ext}`);
    assert.equal(new Set(FORMATS[kind].map(([e]) => e)).size, FORMATS[kind].length, `${kind} has duplicates`);
  }
});

test('per-kind lists match what x2t writes', () => {
  assert.deepEqual(formatsFor('word').map((f) => f[0]), ['docx', 'docm', 'dotx', 'odt', 'ott', 'rtf', 'txt', 'pdf']);
  assert.deepEqual(formatsFor('cell').map((f) => f[0]), ['xlsx', 'xlsm', 'xltx', 'ods', 'ots', 'csv', 'pdf']);
  assert.deepEqual(formatsFor('slide').map((f) => f[0]), ['pptx', 'pptm', 'potx', 'odp', 'otp', 'pdf']);
  assert.deepEqual(formatsFor('nope'), []);
  assert.ok(isSupported('word', 'rtf') && !isSupported('cell', 'rtf'));
  for (const k of ['html', 'epub', 'fb2', 'png', 'jpg']) assert.ok(!isSupported('word', k) && !isSupported('slide', k), k); // x2t cannot write these here
});

test('lossy rule: flat/text/image formats and ODF warn, OOXML siblings and PDF do not', () => {
  for (const to of ['txt', 'rtf', 'html', 'epub', 'fb2']) assert.equal(isLossy('docx', to), true, to);
  assert.equal(isLossy('xlsx', 'csv'), true);
  assert.equal(isLossy('pptx', 'png'), true);
  assert.equal(isLossy('pptx', 'jpg'), true);
  for (const to of ['odt', 'ott', 'ods', 'odp', 'otp']) assert.equal(isLossy('docx', to), true, to);
  for (const to of ['docm', 'dotx', 'pdf']) assert.equal(isLossy('docx', to), false, to);
  assert.equal(isLossy('docx', 'docx'), false);
  assert.equal(isLossy('txt', 'txt'), false); // same format
  assert.equal(isLossy('odt', 'ott'), false); // ODF to ODF keeps its structure
  assert.equal(isLossy('odt', 'docx'), false);
  assert.equal(isLossy('odt', 'rtf'), true);
});

test('dialog filters put the editor-produced format first and include the rest', () => {
  const f = dialogFilters('word', 'pdf');
  assert.deepEqual(f[0].extensions, ['pdf']);
  assert.equal(f.length, formatsFor('word').length);
  assert.deepEqual(dialogFilters('cell', 'xlsx')[0].extensions, ['xlsx']);
  // a format outside the table is still offered, first
  assert.deepEqual(dialogFilters('word', 'mht')[0].extensions, ['mht']);
});

test('warning text names both formats', () => {
  assert.equal(warningText('docx', 'txt'), 'Saving as TXT may lose formatting. Keep working in DOCX and save a copy?');
});
