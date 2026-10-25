'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TAB_COLORS, normalizeStyle, createTabStyles, stripAt, placeWindow } = require('../main/tab-logic');

test('normalizeStyle: only palette colours, bold must be literally true', () => {
  assert.deepStrictEqual(normalizeStyle({ color: '#22afc4', bold: true }), { color: '#22AFC4', bold: true });
  assert.deepStrictEqual(normalizeStyle({ color: '#123456', bold: 'yes' }), { color: null, bold: false });
  assert.deepStrictEqual(normalizeStyle({ color: 'red; background:url(x)' }), { color: null, bold: false });
  assert.deepStrictEqual(normalizeStyle(null), { color: null, bold: false });
  assert.strictEqual(TAB_COLORS.length, 6);
});

function fakeStore() {
  let s = { theme: 'system' };
  return { getSettings: () => ({ ...s }), setSettings: (p) => { s = { ...s, ...p }; return { ...s }; }, raw: () => s };
}

test('createTabStyles: per file path, case-insensitive, empty style removes the entry', () => {
  const store = fakeStore();
  const ts = createTabStyles(store);
  assert.deepStrictEqual(ts.get('C:\Docs\A.docx'), { color: null, bold: false });
  ts.set('C:\Docs\A.docx', { color: '#F0653F', bold: true });
  assert.deepStrictEqual(ts.get('c:\docs\a.DOCX'), { color: '#F0653F', bold: true });
  assert.strictEqual(store.raw().theme, 'system'); // other settings untouched
  ts.set('C:\Docs\A.docx', { color: null, bold: false });
  assert.deepStrictEqual(store.raw().tabStyles, {});
  ts.set('', { color: '#22AFC4' }); // no path: nothing stored
  assert.deepStrictEqual(store.raw().tabStyles, {});
});

test('createTabStyles: map is capped, oldest drop first; survives a corrupt value', () => {
  const store = fakeStore();
  const ts = createTabStyles(store);
  for (let i = 0; i < 305; i++) ts.set(`C:\f${i}.docx`, { color: '#22AFC4' });
  assert.strictEqual(Object.keys(store.raw().tabStyles).length, 300);
  assert.strictEqual(ts.get('C:\f0.docx').color, null);
  assert.strictEqual(ts.get('C:\f304.docx').color, '#22AFC4');
  store.setSettings({ tabStyles: [1, 2] });
  assert.deepStrictEqual(ts.get('x'), { color: null, bold: false });
});

test('stripAt: finds the window whose tab strip is under the point', () => {
  const rects = [{ id: 'A', x: 0, y: 0, width: 1000, height: 700 }, { id: 'B', x: 1200, y: 100, width: 800, height: 600 }];
  assert.strictEqual(stripAt(rects, { x: 500, y: 20 }, 44), 'A');
  assert.strictEqual(stripAt(rects, { x: 500, y: 60 }, 44), null);
  assert.strictEqual(stripAt(rects, { x: 1500, y: 130 }, 44), 'B');
  assert.strictEqual(stripAt(rects, { x: 500, y: 20 }, 44, 'A'), null);
});

test('placeWindow: near the cursor, clamped into the work area, never below the minimum size', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const src = { x: 100, y: 100, width: 1400, height: 900 };
  assert.deepStrictEqual(placeWindow({ x: 800, y: 300 }, src, wa), { x: 680, y: 280, width: 1120, height: 720 });
  const edge = placeWindow({ x: 1900, y: 1030 }, src, wa);
  assert.ok(edge.x + edge.width <= 1920 && edge.y + edge.height <= 1040);
  assert.deepStrictEqual(placeWindow(null, { x: 10, y: 10, width: 500, height: 400 }, wa), { x: 50, y: 50, width: 960, height: 600 });
  const small = placeWindow({ x: 5, y: 5 }, src, { x: 0, y: 0, width: 800, height: 500 });
  assert.deepStrictEqual([small.width, small.height], [800, 500]);
});
