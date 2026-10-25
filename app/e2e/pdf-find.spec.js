'use strict';
// PDF editor Find (Ctrl+F) must search every page, not just the visible one.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

test('PDF Find: a word that exists only on page 3 is found, and a common word counts every page', async () => {
  const dir = L.tmpdir('pdffind');
  const file = path.join(dir, 'three.pdf');
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  ['alpha page one', 'beta page two', 'zebrafinch page three'].forEach((t) => doc.addPage([595, 842]).drawText(t, { x: 72, y: 700, size: 24, font }));
  fs.writeFileSync(file, await doc.save());

  const app = await L.launch({ args: [file] });
  try {
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    expect(await L.inEditor(ed, (win, api) => api.getCountPages())).toBe(3);

    await L.focusEditor(ed);
    await ed.keyboard.press('Control+F');
    const frame = await L.until(() => ed.frames().find((f) => /pdfeditor/.test(f.url())), { what: 'pdf editor frame' });
    const input = frame.locator('#search-bar-text');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    const results = frame.locator('#search-bar-results');
    const find = async (word) => { await input.fill(word); await input.press('Enter'); await L.sleep(1500); return (await results.textContent()).replace(/\s/g, ''); };

    expect(await find('zebrafinch')).toBe('1/1');   // only on page 3
    expect(await find('page')).toMatch(/^\d+\/3$/); // once on each of the 3 pages
    expect(await find('nothere')).toBe('0/0');
  } finally { await app.kill(); }
});
