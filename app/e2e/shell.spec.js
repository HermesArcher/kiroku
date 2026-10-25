'use strict';
// Shell behaviour: legacy formats, close prompts, single instance, offline, recovery, PDF tools, home UI, crash recovery.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');

const TEMPLATE_DOCX = path.join(L.APP_DIR, 'templates', 'new.docx');
const fixtureDocx = () => { const f = path.join(L.tmpdir('fx'), 'fixture.docx'); fs.copyFileSync(TEMPLATE_DOCX, f); return f; };
const shellCall = (app, fn, arg) => app.shellPage().evaluate(fn, arg);

test('8: legacy .xls opens, saves as .xlsx via dialog (original untouched); .doc skipped', async () => {
  // SheetJS (vendored in the engine) can write BIFF8; there is no .doc writer available, so .doc is not covered here.
  const XLSX = require(path.join(L.APP_DIR, '..', 'engine', 'public', 'libs', 'sheetjs', 'xlsx.full.min.js'));
  const dir = L.tmpdir('xls');
  const file = path.join(dir, 'legacy.xls');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['item', 'qty'], ['apples', 7]]), 'S');
  fs.writeFileSync(file, XLSX.write(wb, { bookType: 'biff8', type: 'buffer' }));
  const original = fs.readFileSync(file);

  const app = await L.launch({ args: [file] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    expect(await L.fatalDialog(ed)).toBeNull();
    await L.focusEditor(ed);
    await ed.keyboard.press('Control+Home');
    await ed.keyboard.type('edited', { delay: 60 });
    await ed.keyboard.press('Enter');
    await app.waitState((s) => s.tabs[0].dirty, 'dirty');

    await L.ctrlS(ed);
    const out = path.join(app.testDir, 'legacy.xlsx');
    await L.waitFile(out);
    expect(app.log(/showSaveDialog/).length).toBe(1);
    expect(L.unzipEntry(out, 'xl/sharedStrings.xml')).toContain('apples');
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    const st = await app.waitState((s) => !s.tabs[0].dirty && /legacy\.xlsx$/i.test(s.tabs[0].path || ''), 'tab rebound to legacy.xlsx');
    expect(st.tabs[0].title).toBe('legacy.xlsx');

    // second save goes in place, no new dialog
    await L.focusEditor(ed);
    await ed.keyboard.type('again', { delay: 60 });
    await ed.keyboard.press('Enter');
    const before = L.mtime(out);
    await L.ctrlS(ed);
    await L.waitFile(out, { after: before });
    expect(app.log(/showSaveDialog/).length).toBe(1);
  } finally { await app.kill(); }
});

for (const [label, box] of [['Cancel', 2], ["Don't Save", 1], ['Save', 0]]) {
  test(`9: dirty close -> ${label}`, async () => {
    const file = fixtureDocx();
    const original = fs.readFileSync(file);
    const app = await L.launch({ args: [file], env: { KIROKU_TEST_MSGBOX: String(box) } });
    try {
      const ed = await app.nextEditor();
      await L.waitEditor(ed);
      await L.makeDirty(app, ed);
      const id = (await app.state()).tabs[0].id;
      const before = L.mtime(file);
      await app.shellPage().evaluate((i) => window.shell.close(i), id);
      await L.until(() => app.log(/showMessageBox Save changes to fixture\.docx\?/).length, { what: 'close prompt' });
      if (label === 'Cancel') {
        await L.sleep(1500);
        const st = await app.state();
        expect(st.tabs.length).toBe(1);
        expect(st.tabs[0].dirty).toBe(true);
        expect(fs.readFileSync(file).equals(original)).toBe(true);
      } else if (label === "Don't Save") {
        await app.waitState((s) => s.tabs.length === 0, 'tab closed');
        expect(fs.readFileSync(file).equals(original)).toBe(true);
      } else {
        await app.waitState((s) => s.tabs.length === 0, 'tab closed after save');
        expect(L.mtime(file)).toBeGreaterThan(before);
        expect(L.unzipEntry(file, 'word/document.xml')).toContain('dirty edit');
        expect(app.log(/showSaveDialog/)).toEqual([]); // saved in place
      }
    } finally { await app.kill(); }
  });
}

test('9b: closing the window with a dirty tab prompts, Cancel keeps the app alive', async () => {
  const file = fixtureDocx();
  const app = await L.launch({ args: [file], env: { KIROKU_TEST_MSGBOX: '2' } });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.makeDirty(app, ed);
    // closing the window must trigger the same prompt
    execFileSync('taskkill', ['/PID', String(app.pid)], { stdio: 'ignore' }); // no /F: posts WM_CLOSE, like the X button
    await L.until(() => app.log(/showMessageBox Save changes to fixture\.docx\?/).length, { what: 'window-close prompt', timeout: 15000 });
    await L.sleep(1000);
    expect(app.exited).toBe(false);
    expect((await app.state()).tabs.length).toBe(1);
  } finally { await app.kill(); }
});

test('10: single instance hands the file to the running app', async () => {
  const app = await L.launch();
  try {
    const file = fixtureDocx();
    const second = await L.launch({ userData: app.userData, args: [file], connect: false });
    try {
      await L.until(() => second.exited, { timeout: 30000, what: 'second instance to exit' });
      const ed = await app.nextEditor();
      await L.waitEditor(ed);
      const st = await app.waitState((s) => s.tabs.length === 1, 'one tab');
      expect(st.tabs[0].path.toLowerCase()).toBe(file.toLowerCase());
      // a third launch with the same file just re-activates the tab
      const third = await L.launch({ userData: app.userData, args: [file], connect: false });
      await L.until(() => third.exited, { timeout: 30000, what: 'third instance to exit' });
      await L.sleep(500);
      expect((await app.state()).tabs.length).toBe(1);
      await third.kill();
    } finally { await second.kill(); }
  } finally { await app.kill(); }
});

test('11: offline - external fetch fails, 127.0.0.1 works', async () => {
  const app = await L.launch({ args: ['--new=docx'] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    const r = await ed.evaluate(async () => {
      const ext = await fetch('https://example.com', { mode: 'no-cors' }).then(() => 'ok', (e) => 'rejected:' + e.message);
      const ext2 = await fetch('http://example.com/').then(() => 'ok', () => 'rejected');
      const local = await fetch(location.origin + '/editor?x=1').then((x) => x.status, (e) => 'rejected:' + e.message);
      return { ext, ext2, local };
    });
    expect(r.ext).toMatch(/^rejected/);
    expect(r.ext2).toBe('rejected');
    expect(r.local).toBe(200);
    const s = await shellCall(app, async () => fetch('https://example.com', { mode: 'no-cors' }).then(() => 'ok', () => 'rejected'));
    expect(s).toBe('rejected');
  } finally { await app.kill(); }
});

test('12: recovery tab renders /history', async () => {
  const app = await L.launch();
  try {
    await shellCall(app, () => window.shell.openRecovery());
    const page = await app.nextEditor();
    await L.until(() => /\/history/.test(page.url()), { what: 'history url' });
    const st = await app.waitState((s) => s.tabs.some((t) => t.kind === 'recovery'), 'recovery tab');
    expect(st.tabs.find((t) => t.kind === 'recovery').title).toBe('Recovered files');
    await page.waitForLoadState('load');
    const info = await L.until(async () => {
      const i = await page.evaluate(() => ({ text: document.body.innerText.trim(), h: document.title }));
      return i.text.length > 20 ? i : null;
    }, { what: 'history page text' });
    console.log('[info] recovery page title:', info.h);
    expect(info.text).not.toMatch(/Not found|Cannot GET/i);
  } finally { await app.kill(); }
});

test('13: PDF tools merge + images', async () => {
  const dir = L.tmpdir('pdftools');
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await L.makePdf(a, 2);
  await L.makePdf(b, 3);
  const sharp = require('sharp');
  const png = path.join(dir, 'one.png'), jpg = path.join(dir, 'two.jpg');
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#cc2222' } }).png().toFile(png);
  await sharp({ create: { width: 30, height: 60, channels: 3, background: '#2222cc' } }).jpeg().toFile(jpg);

  const app = await L.launch();
  try {
    expect(await shellCall(app, (p) => window.shell.pdf('info', { path: p }), a)).toEqual({ pages: 2 });
    const m = await shellCall(app, (paths) => window.shell.pdf('merge', { paths }), [a, b]);
    expect(m.ok).toBe(true);
    expect(fs.existsSync(m.output)).toBe(true);
    expect(path.dirname(m.output).toLowerCase()).toBe(app.testDir.toLowerCase());
    expect(await L.pdfPages(m.output)).toBe(5);

    const im = await shellCall(app, (paths) => window.shell.pdf('images', { paths }), [png, jpg]);
    expect(im.ok).toBe(true);
    expect(fs.existsSync(im.output)).toBe(true);
    expect(await L.pdfPages(im.output)).toBe(2);
    expect(im.output).not.toBe(m.output);

    const bad = await shellCall(app, (paths) => window.shell.pdf('merge', { paths }), [a]);
    expect(bad.ok).toBe(false);
  } finally { await app.kill(); }
});

test('14: home UI, theme, shortcuts', async () => {
  const app = await L.launch();
  try {
    const sp = app.shellPage();
    const titles = await L.until(async () => {
      const t = await sp.$$eval('.card-btn', (els) => els.map((e) => e.textContent.trim()));
      return t.length >= 4 ? t : null;
    }, { what: 'quick-create cards' });
    for (const label of ['New document', 'New spreadsheet', 'New presentation', 'Open PDF']) expect(titles.join('|')).toContain(label);

    await sp.locator('.card-btn', { hasText: 'New spreadsheet' }).first().click();
    const ed = await app.nextEditor();
    const st = await app.waitState((s) => s.tabs.length === 1, 'tab opened');
    expect(st.tabs[0]).toMatchObject({ kind: 'cell', title: 'Spreadsheet 1.xlsx' });
    await L.waitEditor(ed);
    expect(ed.frames().some((f) => /spreadsheeteditor/.test(f.url()))).toBe(true);

    // theme (Playwright pins prefers-color-scheme to light on pages it attaches to; drop that override)
    await sp.emulateMedia({ colorScheme: null });
    await ed.emulateMedia({ colorScheme: null });
    await sp.evaluate(() => window.shell.setSettings({ theme: 'dark' }));
    const dark = (p) => p.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    await L.until(() => dark(sp), { what: 'dark in main page' });
    await L.until(() => dark(ed), { what: 'dark in editor page' });
    await sp.evaluate(() => window.shell.setSettings({ theme: 'light' }));
    await L.until(async () => !(await dark(sp)) && !(await dark(ed)), { what: 'light again' });

    // Shortcuts live in main's before-input-event, which CDP-synthesised keys bypass: deliver real input events instead.
    await sp.evaluate(() => window.shell.newDoc('word'));
    await app.nextEditor([ed]);
    await app.waitState((s) => s.tabs.length === 2, 'two tabs');
    let s = await app.state();
    const [t1, t2] = s.tabs.map((t) => t.id);
    expect(s.activeId).toBe(t2);
    await app.sendKey(1, 'Tab', ['control']);
    expect((await app.waitState((x) => x.activeId !== t2, 'cycle 1')).activeId).toBe('home');
    await app.sendKey('shell', 'Tab', ['control']);
    expect((await app.waitState((x) => x.activeId !== 'home', 'cycle 2')).activeId).toBe(t1);
    await app.sendKey(0, 'Tab', ['control', 'shift']);
    expect((await app.waitState((x) => x.activeId !== t1, 'cycle back')).activeId).toBe('home');

    // Ctrl+W in an editor page closes the (active) tab
    await sp.evaluate((id) => window.shell.activate(id), t2);
    await app.waitState((x) => x.activeId === t2, 'activate t2');
    await app.sendKey(1, 'W', ['control']);
    s = await app.waitState((x) => x.tabs.length === 1, 'Ctrl+W closed tab');
    expect(s.tabs[0].id).toBe(t1);
  } finally { await app.kill(); }
});

test('15: renderer crash -> reload -> document comes back from its file', async () => {
  // build a docx on disk with known text
  const seed = await L.launch({ args: ['--new=docx'] });
  let file;
  try {
    const ed = await seed.nextEditor();
    await L.waitEditor(ed);
    await L.pasteHtml(ed, '<p>Crash Survivor 123</p>');
    await L.ctrlS(ed);
    file = path.join(seed.testDir, 'Document 1.docx');
    await L.waitFile(file);
  } finally { await seed.kill(); }

  const app = await L.launch({ args: [file], env: { KIROKU_TEST_MSGBOX: '0' } });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    const cdp = await ed.context().newCDPSession(ed);
    await cdp.send('Page.crash').catch(() => {});
    await L.until(() => app.log(/render-process-gone t1/).length, { what: 'render-process-gone' });
    await L.until(() => app.log(/showMessageBox This tab stopped working/).length, { what: 'crash prompt' });
    await L.until(() => { const e = app.editorPages().find((p) => p !== ed && !p.isClosed()); return e || null; }, { timeout: 30000, what: 'reloaded editor page' });
    const ed2 = app.editorPages().find((p) => p !== ed && !p.isClosed());
    await L.waitEditor(ed2);
    expect(await L.fatalDialog(ed2)).toBeNull();
    const st = await app.state();
    expect(st.tabs.length).toBe(1);
    expect(st.tabs[0].path.toLowerCase()).toBe(file.toLowerCase());
    expect(st.tabs[0].dirty).toBe(false);
    // the document content is back: save in place and read the file
    const before = L.mtime(file);
    await L.ctrlS(ed2);
    await L.waitFile(file, { after: before });
    expect(L.unzipEntry(file, 'word/document.xml')).toContain('Crash Survivor 123');
  } finally { await app.kill(); }
});
