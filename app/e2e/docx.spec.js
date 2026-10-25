'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const HELLO = 'Hello Kiroku';
const AR = 'مرحبا بالعالم';

test('1+2: new docx -> save -> reopen -> edit -> in-place save', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    const ms = await L.waitEditor(ed);
    console.log(`[timing] docx launch->editor ready: ${Date.now() - app.t0} ms (editor-load ${ms} ms)`);
    expect(await L.fatalDialog(ed)).toBeNull();
    expect(ed.url()).toContain('/editor');

    await L.pasteHtml(ed, `<p>${HELLO}</p><p dir="rtl">${AR}</p>`);
    await app.waitState((s) => s.tabs[0].dirty, 'dirty after edit');

    await L.ctrlS(ed);
    const file = path.join(app.testDir, 'Document 1.docx');
    await L.waitFile(file);
    const st = await app.waitState((s) => s.tabs[0] && !s.tabs[0].dirty && s.tabs[0].path, 'clean + path after save');
    expect(st.tabs[0].path.toLowerCase()).toBe(file.toLowerCase());
    expect(st.tabs[0].title).toBe('Document 1.docx');

    const xml = L.unzipEntry(file, 'word/document.xml');
    expect(xml).toContain(HELLO);
    expect(xml).toContain(AR);
    expect(xml).not.toMatch(/DengXian|等线/);
    const styles = L.unzipEntry(file, 'word/styles.xml');
    expect(styles).not.toMatch(/DengXian|等线/);

    const recent = await app.shellPage().evaluate(() => window.shell.getRecent());
    expect(recent.map((r) => r.path.toLowerCase())).toContain(file.toLowerCase());
    expect(app.log(/\[kiroku-test\] showSaveDialog/).length).toBe(1); // first save asked once
    await app.kill();

    // ---- test 2: reopen via argv, edit, save in place ----
    const app2 = await L.launch({ args: [file], userData: app.userData, testDir: L.tmpdir('out2') });
    try {
      const ed2 = await app2.nextEditor();
      await L.waitEditor(ed2);
      expect(await L.fatalDialog(ed2)).toBeNull();
      const before = L.mtime(file);
      await L.pasteHtml(ed2, '<p>Second edit marker</p>');
      await L.ctrlS(ed2);
      await L.waitFile(file, { after: before });
      expect(app2.log(/\[kiroku-test\] showSaveDialog/)).toEqual([]);
      expect(fs.readdirSync(app2.testDir)).toEqual([]); // nothing written to the dialog target dir
      const xml2 = L.unzipEntry(file, 'word/document.xml');
      expect(xml2).toContain('Second edit marker');
      expect(xml2).toContain(HELLO);
      expect(xml2).toContain(AR);
      const st2 = await app2.waitState((s) => s.tabs[0] && !s.tabs[0].dirty, 'clean after in-place save');
      expect(st2.tabs[0].path.toLowerCase()).toBe(file.toLowerCase());
    } finally { await app2.kill(); }
  } finally { await app.kill(); }
});
