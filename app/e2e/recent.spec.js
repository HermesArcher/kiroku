'use strict';
// Home: recent folders (side c), kind filter, encrypted recent list.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const TEMPLATES = path.join(L.APP_DIR, 'templates');

/** userData with a seeded recent.json: 2 docs + 1 sheet in dirA, 1 slide in dirB. */
function seed() {
  const userData = L.tmpdir('ud');
  const dirA = path.join(L.tmpdir('seedA'), 'Reports');
  const dirB = path.join(L.tmpdir('seedB'), 'Decks');
  fs.mkdirSync(dirA, { recursive: true }); fs.mkdirSync(dirB, { recursive: true });
  const put = (dir, name, tpl) => { const f = path.join(dir, name); fs.copyFileSync(path.join(TEMPLATES, tpl), f); return f; };
  const now = Date.now();
  const rec = (p, kind, ago) => ({ path: p, name: path.basename(p), kind, openedAt: now - ago, pinned: false });
  fs.writeFileSync(path.join(userData, 'recent.json'), JSON.stringify([
    rec(put(dirA, 'Memo.docx', 'new.docx'), 'word', 60e3),
    rec(put(dirA, 'Notes.docx', 'new.docx'), 'word', 120e3),
    rec(put(dirA, 'Budget.xlsx', 'new.xlsx'), 'cell', 180e3),
    rec(put(dirB, 'Pitch.pptx', 'new.pptx'), 'slide', 240e3),
  ]));
  return { userData, dirA, dirB };
}

const rows = (p, sel) => p.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));

test('R1: folders group (side c), n files, filter segmented control + persistence, folder click opens dialog at folder', async () => {
  const { userData, dirA, dirB } = seed();
  let app = await L.launch({ userData });
  try {
    const sp = await L.until(() => app.shellPage(), { what: 'shell page' });
    await expect(sp.locator('.folder-row')).toHaveCount(2);
    expect(await rows(sp, '.group-label')).toEqual(expect.arrayContaining([expect.stringContaining('side c'), expect.stringContaining('Folders')]));
    const f = await rows(sp, '.folder-row .name');
    expect(f.some((t) => /Reports\s*3 files/.test(t))).toBe(true);
    expect(f.some((t) => /Decks\s*1 file$/.test(t))).toBe(true);

    // filter strip: 26px tall, 5 options
    const box = await sp.locator('#filter-slot .seg').boundingBox();
    expect(Math.round(box.height)).toBe(26);
    await sp.locator('#filter-slot button', { hasText: 'Sheets' }).click();
    await expect(sp.locator('#recent .row:not(.folder-row)')).toHaveCount(1);
    await expect(sp.locator('.folder-row')).toHaveCount(1);
    expect(await rows(sp, '.folder-row .name')).toEqual([expect.stringMatching(/Reports\s*1 file$/)]);
    await L.until(() => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).recentFilter === 'cell', { what: 'filter persisted' });

    // clicking a folder opens the Open dialog at that folder
    await app.mainEval("(()=>{const d=process.mainModule.require('electron').dialog;const f=d.showOpenDialog;d.showOpenDialog=async(...a)=>{globalThis.__openOpts=a.find((x)=>x&&typeof x==='object'&&typeof x.isDestroyed!=='function');return f(...a)};return 1})()");
    await sp.locator('.folder-row .row-main').first().click();
    const got = await L.until(() => app.mainEval('globalThis.__openOpts && globalThis.__openOpts.defaultPath'), { what: 'open dialog at folder' });
    expect(got.toLowerCase()).toBe(dirA.toLowerCase());
    void dirB;
    await app.kill();

    // restart: the filter is remembered
    app = await L.launch({ userData });
    const sp2 = await L.until(() => app.shellPage(), { what: 'shell page' });
    await expect(sp2.locator('#filter-slot [aria-checked="true"]')).toHaveText('Sheets');
    await expect(sp2.locator('#recent .row:not(.folder-row)')).toHaveCount(1);
  } finally { await app.kill(); }
});

test('R2: encrypt recent list toggle: enc file replaces plain JSON, list survives both ways', async () => {
  const { userData } = seed();
  const app = await L.launch({ userData });
  try {
    const sp = await L.until(() => app.shellPage(), { what: 'shell page' });
    const can = await sp.evaluate(() => window.shell.getSettings().then((s) => s.canEncryptRecent));
    test.skip(!can, 'safeStorage unavailable on this machine');
    await sp.click('[data-nav="settings"]');
    const on = sp.locator('.set-row', { hasText: 'Privacy' }).locator('button', { hasText: 'On' });
    await on.click();
    await L.until(() => fs.existsSync(path.join(userData, 'recent.enc')) && !fs.existsSync(path.join(userData, 'recent.json')), { what: 'recent.enc written, plain removed' });
    expect(fs.existsSync(path.join(userData, 'recent-folders.json'))).toBe(false);
    expect(fs.readFileSync(path.join(userData, 'recent.enc')).toString('latin1')).not.toContain('Memo.docx');
    expect(await sp.evaluate(() => window.shell.getRecent().then((r) => r.length))).toBe(4);
    await expect(sp.locator('.set-row', { hasText: 'Privacy' }).locator('[aria-checked="true"]')).toHaveText('On');

    await sp.locator('.set-row', { hasText: 'Privacy' }).locator('button', { hasText: 'Off' }).click();
    await L.until(() => !fs.existsSync(path.join(userData, 'recent.enc')) && fs.existsSync(path.join(userData, 'recent.json')), { what: 'plain restored, enc removed' });
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'recent.json'), 'utf8')).length).toBe(4);
    expect(await sp.evaluate(() => window.shell.getRecentFolders().then((r) => r.length))).toBe(2);
  } finally { await app.kill(); }
});
