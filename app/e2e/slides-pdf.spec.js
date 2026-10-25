'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

test('4: new pptx -> text on slide 1 -> save -> slide1.xml has it', async () => {
  const app = await L.launch({ args: ['--new=pptx'] });
  try {
    const ed = await app.nextEditor();
    const ms = await L.waitEditor(ed);
    console.log(`[timing] pptx launch->editor ready: ${Date.now() - app.t0} ms (editor-load ${ms} ms)`);
    expect(await L.fatalDialog(ed)).toBeNull();
    expect(ed.url()).toContain('/editor');

    await L.pasteHtml(ed, '<p>Kiroku Slide Text</p>');
    await app.waitState((s) => s.tabs[0].dirty, 'dirty after edit');
    await L.ctrlS(ed);
    const file = path.join(app.testDir, 'Presentation 1.pptx');
    await L.waitFile(file);
    await app.waitState((s) => !s.tabs[0].dirty && s.tabs[0].path, 'clean after save');
    expect(L.unzipEntry(file, 'ppt/slides/slide1.xml')).toContain('Kiroku Slide Text');
  } finally { await app.kill(); }
});

test('5: PDF opens in pdfeditor without fatal error; annotate + Ctrl+S / export', async () => {
  const dir = L.tmpdir('pdf');
  const file = path.join(dir, 'two.pdf');
  await L.makePdf(file, 2);
  const app = await L.launch({ args: [file] });
  try {
    const ed = await app.nextEditor();
    const ms = await L.waitEditor(ed);
    console.log(`[timing] pdf launch->editor ready: ${Date.now() - app.t0} ms (editor-load ${ms} ms)`);
    expect(ed.frames().some((f) => /pdfeditor/.test(f.url()))).toBe(true);
    expect(await L.fatalDialog(ed)).toBeNull();
    const st = await app.waitState((s) => s.tabs[0]);
    expect(st.tabs[0]).toMatchObject({ kind: 'pdf', title: 'two.pdf' });
    expect(app.log(/Could not open|showErrorBox/)).toEqual([]);
    const pages = await L.inEditor(ed, (win, api) => api.getCountPages ? api.getCountPages() : (api.pdfDoc && api.pdfDoc.GetPagesCount && api.pdfDoc.GetPagesCount()));
    console.log('[info] pdf pages reported by editor:', pages);
    expect(pages).toBe(2);

    // annotate -> dirty -> Ctrl+S writes a PDF in place (not a .docx!)
    await L.inEditor(ed, (win, api) => api.AddFreeTextAnnot(0));
    await app.waitState((s) => s.tabs[0].dirty, 'dirty after annotation');
    const before = L.mtime(file);
    await L.ctrlS(ed);
    await L.waitFile(file, { after: before });
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1')).toMatch(/\/FreeText|\/Annots/);
    expect(await L.pdfPages(file)).toBe(2);
    expect(app.log(/showSaveDialog/)).toEqual([]);
    expect(fs.readdirSync(app.testDir)).toEqual([]);
    await app.waitState((s) => !s.tabs[0].dirty && s.tabs[0].path, 'clean after save');
  } finally { await app.kill(); }
});

test('6: PDF export from a docx tab -> Document 1.pdf, tab not rebound', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.pasteHtml(ed, '<p>Export me</p>');
    await app.waitState((s) => s.tabs[0].dirty);
    await L.inEditor(ed, (win, api) => api.asc_DownloadAs(new win.Asc.asc_CDownloadOptions(513)));
    const pdf = path.join(app.testDir, 'Document 1.pdf');
    await L.waitFile(pdf);
    expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    await L.sleep(500);
    const st = await app.state();
    expect(st.tabs[0].path).toBeNull();
    expect(st.tabs[0].title).toBe('Document 1.docx');
    expect(st.tabs[0].kind).toBe('word');
    expect(st.tabs[0].dirty).toBe(true); // exporting does not make the docx clean
    expect(app.log(/showSaveDialog/).length).toBe(1);
  } finally { await app.kill(); }
});
