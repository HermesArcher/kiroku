'use strict';
// Save As: every format x2t writes, plus the "may lose formatting" warning for lossy ones.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const download = (ed, code) => L.inEditor(ed, (win, api, c) => api.asc_DownloadAs(new win.Asc.asc_CDownloadOptions(c)), code);
const warnings = (app) => app.log(/showMessageBox Saving as/);

async function newDocx(env) {
  const app = await L.launch({ args: ['--new=docx'], env });
  const ed = await app.nextEditor();
  await L.waitEditor(ed);
  await L.pasteHtml(ed, '<p>Save as every format</p>');
  await app.waitState((s) => s.tabs[0].dirty, 'dirty after edit');
  return { app, ed };
}

test('lossy format (TXT): warns, "Save copy" writes it, the tab stays on its docx', async () => {
  const { app, ed } = await newDocx();
  try {
    await download(ed, 69); // TXT
    const txt = path.join(app.testDir, 'Document 1.txt');
    await L.waitFile(txt);
    expect(fs.readFileSync(txt, 'utf8')).toContain('Save as every format');
    const w = warnings(app);
    expect(w.length).toBe(1);
    expect(w[0]).toContain('Saving as TXT may lose formatting. Keep working in DOCX and save a copy?');
    const st = await app.state();
    expect(st.tabs[0]).toMatchObject({ title: 'Document 1.docx', path: null, kind: 'word', dirty: true });
  } finally { await app.kill(); }
});

test('lossy format: Cancel on the warning writes nothing', async () => {
  const { app, ed } = await newDocx({ KIROKU_TEST_MSGBOX: '1' });
  try {
    await download(ed, 68); // RTF
    await L.until(() => warnings(app).length === 1, { what: 'the warning dialog' });
    await L.sleep(1500);
    expect(fs.readdirSync(app.testDir)).toEqual([]);
    expect((await app.state()).tabs[0]).toMatchObject({ title: 'Document 1.docx', path: null });
  } finally { await app.kill(); }
});

test('a format picked in the Save dialog is exported from the live document (RTF), still warned, tab not rebound', async () => {
  // editor exports ODT; the dialog result is .rtf
  const { app, ed } = await newDocx({ KIROKU_TEST_SAVE_EXT: 'rtf' });
  try {
    await download(ed, 67); // ODT
    const rtf = path.join(app.testDir, 'Document 1.rtf');
    await L.waitFile(rtf);
    expect(fs.readFileSync(rtf).subarray(0, 5).toString('hex')).toBe('7b5c727466'); // {, backslash, rtf
    expect(fs.readFileSync(rtf, 'latin1')).toContain('u83*'); // RTF writes the text as numeric escapes: S is u83*
    expect(fs.existsSync(path.join(app.testDir, 'Document 1.odt'))).toBe(false);
    expect(warnings(app)[0]).toContain('Saving as RTF may lose formatting');
    expect((await app.state()).tabs[0]).toMatchObject({ title: 'Document 1.docx', path: null });
  } finally { await app.kill(); }
});

test('a lossless sibling format (DOCM) is written without any warning', async () => {
  const { app, ed } = await newDocx({ KIROKU_TEST_SAVE_EXT: 'docm' });
  try {
    await download(ed, 513); // PDF from the editor, dialog says .docm
    const f = path.join(app.testDir, 'Document 1.docm');
    await L.waitFile(f);
    expect(L.unzipEntry(f, 'word/document.xml')).toContain('Save as every format');
    expect(L.unzipEntry(f, '*Content_Types*.xml')).toContain('macroEnabled');
    expect(warnings(app)).toEqual([]);
  } finally { await app.kill(); }
});

test('spreadsheet: CSV is offered, warned, and written', async () => {
  const app = await L.launch({ args: ['--new=xlsx'], env: { KIROKU_TEST_SAVE_EXT: 'csv' } });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.focusEditor(ed);
    await ed.keyboard.press('Control+Home');
    await ed.keyboard.type('hello', { delay: 60 });
    await ed.keyboard.press('Tab');
    await ed.keyboard.type('42', { delay: 60 });
    await ed.keyboard.press('Enter');
    await L.sleep(800);
    await download(ed, 259); // ODS from the editor, dialog says .csv
    const f = path.join(app.testDir, 'Spreadsheet 1.csv');
    await L.waitFile(f);
    expect(fs.readFileSync(f, 'utf8')).toMatch(/hello.*42/);
    expect(warnings(app)[0]).toContain('Saving as CSV may lose formatting. Keep working in XLSX');
  } finally { await app.kill(); }
});
