'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

/** Displayed value (`value`) and editable text, i.e. the formula for formula cells (`text`), of a cell like "B1". */
const cellInfo = (page, addr) => L.inEditor(page, (win, api, a) => {
  api.asc_findCell(a);
  const col = a.charCodeAt(0) - 65, row = Number(a.slice(1)) - 1;
  return { text: api.asc_getCellInfo().asc_getText(), value: String(api.wb.getWorksheet().model.getCell3(row, col).getValue()) };
}, addr);

test('3: new xlsx -> A1=42, B1==A1*2 -> save -> reopen computes 84', async () => {
  const app = await L.launch({ args: ['--new=xlsx'] });
  try {
    const ed = await app.nextEditor();
    const ms = await L.waitEditor(ed);
    console.log(`[timing] xlsx launch->editor ready: ${Date.now() - app.t0} ms (editor-load ${ms} ms)`);
    expect(await L.fatalDialog(ed)).toBeNull();
    expect(ed.url()).toContain('/editor');

    await L.focusEditor(ed);
    await ed.keyboard.press('Control+Home');
    await ed.keyboard.type('42', { delay: 60 });
    await ed.keyboard.press('Tab');
    await ed.keyboard.type('=A1*2', { delay: 60 });
    await ed.keyboard.press('Enter');
    await L.sleep(800);
    expect(await cellInfo(ed, 'B1')).toEqual({ text: '=A1*2', value: '84' });
    await app.waitState((s) => s.tabs[0].dirty, 'dirty');

    await L.ctrlS(ed);
    const file = path.join(app.testDir, 'Spreadsheet 1.xlsx');
    await L.waitFile(file);
    await app.waitState((s) => !s.tabs[0].dirty && s.tabs[0].path, 'clean after save');

    const sheet = L.unzipEntry(file, 'xl/worksheets/sheet1.xml');
    expect(sheet).toMatch(/<c r="A1"[^>]*>\s*<v>42<\/v>/);
    expect(sheet).toMatch(/<c r="B1"[^>]*>\s*<f[^>]*>A1\*2<\/f>/);
    await app.kill();

    const app2 = await L.launch({ args: [file], userData: app.userData, testDir: L.tmpdir('out2') });
    try {
      const ed2 = await app2.nextEditor();
      await L.waitEditor(ed2);
      expect(await L.fatalDialog(ed2)).toBeNull();
      const b1 = await cellInfo(ed2, 'B1');
      expect(b1.value).toBe('84');
      expect(b1.text).toBe('=A1*2');
      expect((await cellInfo(ed2, 'A1')).value).toBe('42');
    } finally { await app2.kill(); }
  } finally { await app.kill(); }
});

test('7: CSV with Arabic -> edit a cell -> saved in place as CSV', async () => {
  const dir = L.tmpdir('csv');
  const file = path.join(dir, 'data.csv');
  fs.writeFileSync(file, 'name,city\nعلي,القاهرة\nسارة,دبي\n', 'utf8');
  const app = await L.launch({ args: [file] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    expect(await L.fatalDialog(ed)).toBeNull();
    expect((await cellInfo(ed, 'A2')).value).toBe('علي');

    await L.focusEditor(ed);
    await ed.keyboard.press('Control+Home');
    await ed.keyboard.press('ArrowDown');
    await ed.keyboard.press('ArrowDown');
    await ed.keyboard.press('ArrowDown'); // A4: empty
    await ed.keyboard.type('Zed', { delay: 60 });
    await ed.keyboard.press('Tab');
    await ed.keyboard.type('Oslo', { delay: 60 });
    await ed.keyboard.press('Enter');
    await L.sleep(500);
    await app.waitState((s) => s.tabs[0].dirty, 'dirty');

    const before = L.mtime(file);
    await L.ctrlS(ed);
    await L.waitFile(file, { after: before });
    expect(app.log(/\[kiroku-test\] showSaveDialog/)).toEqual([]);
    const text = fs.readFileSync(file, 'utf8');
    expect(text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4b).toBe(false); // not a zip
    expect(text).toContain('name,city');
    expect(text).toContain('علي,القاهرة');
    expect(text).toContain('سارة,دبي');
    expect(text).toContain('Zed,Oslo');
    expect(fs.existsSync(path.join(dir, 'data.xlsx'))).toBe(false);
    const st = await app.waitState((s) => !s.tabs[0].dirty, 'clean');
    expect(st.tabs[0].path.toLowerCase()).toBe(file.toLowerCase());
  } finally { await app.kill(); }
});
