'use strict';
// Settings > Backups: autosave switch, interval, versions kept, keep-for. Shell Settings page -> boot config -> engine.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const settingsJson = (app) => JSON.parse(fs.readFileSync(path.join(app.userData, 'settings.json'), 'utf8'));
const autosavePref = (ed) => ed.evaluate(() => localStorage.getItem('document-autosave-enabled'));

test('Settings has a Backups row (05, before About) whose controls persist', async () => {
  const app = await L.launch();
  try {
    const sp = app.shellPage();
    await sp.click('[data-nav="settings"]');
    const row = sp.locator('section.set-row', { hasText: 'Backups' });
    await row.waitFor({ state: 'visible' });
    const heads = await sp.locator('section.set-row h2').allTextContents();
    expect(heads.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(['01Appearance', '02Editors', '03Default apps', '04Privacy', '05Backups', '06About']);

    // defaults
    expect(await sp.locator('#bk-interval').inputValue()).toBe('60');
    expect(await sp.locator('#bk-versions').inputValue()).toBe('3');
    expect(await sp.locator('#bk-days').inputValue()).toBe('7');

    await sp.selectOption('#bk-interval', '30');
    await sp.selectOption('#bk-versions', '10');
    await sp.selectOption('#bk-days', '30');
    await L.until(() => settingsJson(app).backup && settingsJson(app).backup.keepDays === 30, { what: 'settings.json updated' });
    expect(settingsJson(app).backup).toEqual({ autosave: true, intervalSec: 30, keepVersions: 10, keepDays: 30 });

    // the Off/On switch
    await row.getByRole('radio', { name: 'Off' }).click().catch(async () => { await row.getByText('Off', { exact: true }).click(); });
    await L.until(() => settingsJson(app).backup.autosave === false, { what: 'autosave off persisted' });
    // hand-edited junk snaps to the offered choices
    const back = await sp.evaluate(() => window.shell.setSettings({ backup: { intervalSec: 7, keepVersions: 4, keepDays: 400 } }));
    expect(back.backup).toEqual({ autosave: false, intervalSec: 30, keepVersions: 3, keepDays: 30 });
  } finally { await app.kill(); }
});

test('editors get the values at boot, follow later changes, and /history shares the switch', async () => {
  const app = await L.launch();
  try {
    const sp = app.shellPage();
    await sp.evaluate(() => window.shell.setSettings({ backup: { autosave: false, intervalSec: 120, keepVersions: 5, keepDays: 30 } }));
    await sp.evaluate(() => window.shell.newDoc('word'));
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    expect(await ed.evaluate(() => window.kiroku.getBackup())).toEqual({ autosave: false, intervalSec: 120, keepVersions: 5, keepDays: 30 });
    expect(await autosavePref(ed)).toBe('false'); // the engine applied the boot config

    // live update, no reload
    await sp.evaluate(() => window.shell.setSettings({ backup: { autosave: true } }));
    await L.until(async () => (await autosavePref(ed)) === 'true', { what: 'editor follows the Settings page' });

    // the recovery page: retention note follows keep-for, and its switch writes back to the shell
    await sp.evaluate(() => window.shell.setSettings({ backup: { autosave: false } }));
    await sp.evaluate(() => window.shell.openRecovery());
    const hist = await app.nextEditor([ed]);
    await L.until(() => hist.evaluate(() => /30 days/.test(document.body.innerText)), { what: '30-day retention note' });
    expect(await hist.locator('#history-autosave').isChecked()).toBe(false);
    await hist.locator('#history-autosave').check();
    await L.until(async () => (await sp.evaluate(() => window.shell.getSettings())).backup.autosave === true, { what: '/history switch reached the shell' });
  } finally { await app.kill(); }
});

test('a 30 s interval takes a recovery snapshot of an edited document within a minute', async () => {
  test.setTimeout(150000);
  const app = await L.launch();
  try {
    const sp = app.shellPage();
    await sp.evaluate(() => window.shell.setSettings({ backup: { autosave: true, intervalSec: 30 } }));
    await sp.evaluate(() => window.shell.newDoc('word'));
    const ed = await app.nextEditor();
    await L.waitEditor(ed);
    await L.pasteHtml(ed, '<p>backup interval marker</p>');
    await app.waitState((s) => s.tabs[0].dirty, 'dirty');
    // Count the rows in the history DB from the editor page itself: switching tabs would hide the editor and
    // trigger the "page hidden" snapshot, which is not the interval under test. The default 60 s interval could not
    // have produced a row inside 50 s (ticks every 15 s from session start, first one allowed at 60 s).
    const rows = () => ed.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('document-history');
      r.onerror = () => res(0);
      r.onsuccess = () => { try { const q = r.result.transaction('docs').objectStore('docs').count(); q.onsuccess = () => res(q.result); q.onerror = () => res(0); } catch { res(0); } };
    }));
    expect(await rows()).toBe(0);
    await L.until(async () => (await rows()) >= 1, { timeout: 50000, step: 2000, what: 'recovery snapshot at the 30 s interval' });
  } finally { await app.kill(); }
});
