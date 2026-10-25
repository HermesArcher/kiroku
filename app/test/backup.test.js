'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBackup, DEFAULTS } = require('../main/backup');

test('defaults are autosave on, 1 minute, 3 versions, 7 days', () => {
  assert.deepEqual(normalizeBackup(undefined), { autosave: true, intervalSec: 60, keepVersions: 3, keepDays: 7 });
  assert.deepEqual(normalizeBackup('junk'), DEFAULTS);
});

test('values snap to the offered choices', () => {
  assert.deepEqual(normalizeBackup({ intervalSec: 1, keepVersions: 4, keepDays: 100, autosave: 'x' }), { autosave: true, intervalSec: 30, keepVersions: 3, keepDays: 30 });
  assert.deepEqual(normalizeBackup({ intervalSec: 150, keepVersions: 99, keepDays: 0 }), { autosave: true, intervalSec: 120, keepVersions: 10, keepDays: 1 });
  assert.equal(normalizeBackup({ intervalSec: NaN }).intervalSec, 60);
});

test('a patch keeps the other fields of the base', () => {
  const base = normalizeBackup({ intervalSec: 180, keepDays: 30, autosave: false });
  assert.deepEqual(normalizeBackup({ keepVersions: 10 }, base), { autosave: false, intervalSec: 180, keepVersions: 10, keepDays: 30 });
});
