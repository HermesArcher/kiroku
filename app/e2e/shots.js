'use strict';
// Screenshot tour of the real app: node e2e/shots.js <outDir> [tag] [--dark] [--recent] [--narrow]
// --recent seeds recent.json (pinned + normal + one missing file) so the tracklist is populated; --narrow = 1100px wide; --shell = skip editors.
const fs = require('fs');
const path = require('path');
const L = require('./lib');

(async () => {
  const out = process.argv[2] || '.';
  const tag = process.argv[3] || 'shot';
  const dark = process.argv.includes('--dark');
  const seed = process.argv.includes('--recent');
  const narrow = process.argv.includes('--narrow');

  const userData = L.tmpdir('ud');
  if (seed) {
    const dir = L.tmpdir('seed');
    const tpl = (n) => path.join(L.APP_DIR, 'templates', n);
    const files = [
      ['Quarterly report.docx', 'new.docx'], ['Budget 2026.xlsx', 'new.xlsx'], ['Pitch deck.pptx', 'new.pptx'], ['Invoice 0142.pdf', null],
    ].map(([name, src]) => { const f = path.join(dir, name); if (src) fs.copyFileSync(tpl(src), f); else fs.writeFileSync(f, '%PDF-1.4\n'); return f; });
    const now = Date.now();
    const rec = (p, kind, ago, extra = {}) => ({ path: p, name: path.basename(p), kind, openedAt: now - ago, pinned: false, ...extra });
    fs.writeFileSync(path.join(userData, 'recent.json'), JSON.stringify([
      rec(files[0], 'word', 4 * 60e3, { pinned: true }),
      rec(files[1], 'cell', 3 * 3600e3),
      rec(files[2], 'slide', 26 * 3600e3),
      rec(files[3], 'pdf', 5 * 86400e3),
      rec(path.join(dir, 'Reports', 'Old thesis draft.docx'), 'word', 40 * 86400e3), // never created: the "missing file" row
    ]));
  }

  const app = await L.launch({ userData });
  const snap = async (page, name) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
  try {
    if (dark) await app.mainEval("process.mainModule.require('electron').nativeTheme.themeSource = 'dark'");
    const shell = await L.until(() => app.shellPage(), { what: 'shell page' });
    const scheme = dark ? 'dark' : 'light'; // Playwright pins prefers-color-scheme on attached pages; set it explicitly
    await shell.emulateMedia({ colorScheme: scheme }).catch(() => {});
    await shell.setViewportSize({ width: narrow ? 1100 : 1440, height: 900 }).catch(() => {});
    await L.sleep(1800);
    await snap(shell, 'home');
    await shell.evaluate(() => { document.querySelector('#main').scrollTop = 99999; });
    const row = await shell.$('.row'); if (row) await row.hover();
    await L.sleep(500);
    await snap(shell, 'home-bottom');
    await shell.evaluate(() => { document.querySelector('#main').scrollTop = 0; });
    await shell.click('[data-nav="pdf"]'); await L.sleep(500);
    await shell.click('.tools .card-btn'); await L.sleep(1500);
    await snap(shell, 'pdf');
    await shell.click('[data-nav="settings"]'); await L.sleep(1500);
    await snap(shell, 'settings');
    await shell.click('[data-nav="home"]');
    if (narrow || process.argv.includes('--shell')) return;
    for (const kind of ['word', 'cell', 'slide']) {
      await shell.evaluate((k) => window.shell.newDoc(k), kind);
      const ed = await L.until(() => app.editorPages()[app.editorPages().length - 1], { what: 'editor page' });
      await ed.emulateMedia({ colorScheme: scheme }).catch(() => {});
      await L.waitEditor(ed);
      await L.sleep(2500);
      await snap(ed, kind);
    }
    await snap(shell, 'tabs');
  } finally { await app.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
